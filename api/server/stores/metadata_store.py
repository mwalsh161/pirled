from __future__ import annotations

import json

from ..config import LED_COUNT, METADATA_FILE, PIR_COUNT
from ..schemas import DeviceLabelMetadataModel


def load_metadata() -> dict:
    if METADATA_FILE.exists():
        try:
            return json.loads(METADATA_FILE.read_text())
        except Exception:
            return {}
    return {}


def _write_metadata(payload: dict) -> None:
    METADATA_FILE.write_text(json.dumps(payload, indent=2))


def write_device_metadata(device_name: str, metadata: DeviceLabelMetadataModel) -> None:
    payload = load_metadata()
    payload[device_name] = metadata.model_dump(mode="json")
    _write_metadata(payload)


def default_device_label_metadata() -> DeviceLabelMetadataModel:
    return DeviceLabelMetadataModel(
        ledNames=["" for _ in range(LED_COUNT)],
        ledByPir=[pir_index for pir_index in range(PIR_COUNT)],
        alias="",
    )


def parse_stored_device_label_metadata(
    value: object,
) -> DeviceLabelMetadataModel | None:
    if value is None:
        return None
    try:
        return DeviceLabelMetadataModel.model_validate(value)
    except Exception:
        return None


def metadata_alias_value(metadata: dict, device_name: str) -> str:
    parsed = parse_stored_device_label_metadata(metadata.get(device_name))
    if parsed is None:
        return ""
    return parsed.alias


def gather_global_labels(
    metadata: dict, *, exclude_device_name: str | None = None
) -> set[str]:
    labels: set[str] = set()
    for current_device_name, value in metadata.items():
        if (
            exclude_device_name is not None
            and isinstance(current_device_name, str)
            and current_device_name == exclude_device_name
        ):
            continue
        parsed = parse_stored_device_label_metadata(value)
        if parsed is None:
            continue
        for label in parsed.ledNames:
            if label:
                labels.add(label)
    return labels
