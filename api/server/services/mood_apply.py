from __future__ import annotations

from urllib.parse import urlencode
from urllib.request import Request, urlopen

from ..config import LED_COUNT
from ..scheduler import ApplyReport, MoodSchedule
from ..schemas import assignments_to_api_dict
from ..stores.apply_status_store import record_apply_status
from ..stores.groups_store import get_group_by_id
from ..stores.metadata_store import load_metadata, parse_stored_device_label_metadata
from ..stores.mood_store import load_mood_config
from ..validation import normalize_label
from .discovery import list_resolved_devices, resolve_devices_now


def _apply_led_config(device_uri: str, led_index: int, config: dict[str, int]) -> None:
    params = {"index": str(led_index)}
    for key, value in config.items():
        params[key] = str(value)

    request = Request(
        f"http://{device_uri}/config/led",
        data=urlencode(params).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=3):
        pass


def _resolve_allowed_labels(group_id: str | None) -> set[str] | None:
    if not group_id:
        return None
    group = get_group_by_id(group_id)
    if group is None:
        raise FileNotFoundError("Group not found")
    return {normalize_label(label) for label in group.labels if normalize_label(label)}


def apply_mood_by_name(name: str, group_id: str | None) -> ApplyReport:
    config_data = load_mood_config(name)
    allowed_labels = _resolve_allowed_labels(group_id)
    assignments_by_label = assignments_to_api_dict(config_data.assignments)
    metadata = load_metadata()
    success_count = 0
    failures: list[str] = []

    resolve_devices_now()
    for device in list_resolved_devices():
        device_name = device.name
        host = device.host
        port = device.port

        stored_led_names: list[str] = []
        parsed_metadata = parse_stored_device_label_metadata(metadata.get(device_name))
        if parsed_metadata is not None:
            stored_led_names = parsed_metadata.ledNames

        for led_index in range(LED_COUNT):
            raw_label = (
                stored_led_names[led_index] if led_index < len(stored_led_names) else ""
            )
            label = normalize_label(raw_label)
            if not label:
                continue
            if allowed_labels is not None and label not in allowed_labels:
                continue

            config = assignments_by_label.get(label)
            if config is None:
                continue

            try:
                _apply_led_config(f"{host}:{port}", led_index, config)
                success_count += 1
            except Exception as exc:
                failures.append(f"{device_name} LED {led_index}: {exc}")

    return ApplyReport(
        successCount=success_count,
        failureCount=len(failures),
        failures=failures,
    )


def run_scheduled_mood_apply(schedule: MoodSchedule) -> ApplyReport:
    mood_name = schedule.moodName
    group_id = schedule.groupId
    try:
        report = apply_mood_by_name(mood_name, group_id)
    except FileNotFoundError as exc:
        report = ApplyReport(successCount=0, failureCount=1, failures=[str(exc)])
    except ValueError as exc:
        report = ApplyReport(successCount=0, failureCount=1, failures=[str(exc)])
    except Exception as exc:
        report = ApplyReport(successCount=0, failureCount=1, failures=[str(exc)])

    record_apply_status(
        source="scheduled",
        mood_name=mood_name,
        group_id=group_id,
        schedule_id=schedule.id,
        report=report,
    )
    return report
