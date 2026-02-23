import json
import pathlib
import re
import socket
import threading
import time
import uuid
from typing import Literal
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

from .scheduler import MIN_INTERVAL_SECONDS, ApplyReport, MoodSchedule, MoodScheduler

THIS_DIR = pathlib.Path(__file__).resolve().parent
API_DIR = THIS_DIR.parent
PROJECT_ROOT = API_DIR.parent
DATA_DIR = API_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

METADATA_FILE = DATA_DIR / "devices_metadata.json"
MOODS_DIR = DATA_DIR / "moods"
MOODS_DIR.mkdir(exist_ok=True)
GROUPS_DIR = DATA_DIR / "groups"
GROUPS_DIR.mkdir(exist_ok=True)
GROUPS_FILE = GROUPS_DIR / "logical_groups.json"
MOOD_SCHEDULES_FILE = DATA_DIR / "mood_schedules.json"
MOOD_APPLY_STATUS_FILE = DATA_DIR / "mood_apply_status.json"

app = FastAPI()

# Pre-compiled regex patterns
VALID_NAME_PATTERN = re.compile(r"[^a-zA-Z0-9_-]")
LED_COUNT = 4
PIR_COUNT = 4
DISPLAY_TEXT_MAX_LENGTH = 64


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class MoodApplyRequest(FrozenModel):
    groupId: str | None = None


class MoodApplyStatusEntry(FrozenModel):
    appliedAt: int
    source: Literal["manual", "scheduled"]
    moodName: str
    groupId: str | None = None
    scheduleId: str | None = None
    successCount: int
    failureCount: int
    failures: list[str] = Field(default_factory=list)


class MoodApplyStatusResponse(FrozenModel):
    lastApply: MoodApplyStatusEntry | None = None


class MoodScheduleCreateRequest(FrozenModel):
    moodName: str
    groupId: str | None = None
    intervalSeconds: int = Field(ge=MIN_INTERVAL_SECONDS)
    firstRunAt: int | None = None
    enabled: bool = True


class MoodScheduleUpdateRequest(FrozenModel):
    moodName: str | None = None
    groupId: str | None = None
    intervalSeconds: int | None = Field(default=None, ge=MIN_INTERVAL_SECONDS)
    nextRunAt: int | None = None
    enabled: bool | None = None


class DeleteScheduleResponse(FrozenModel):
    status: Literal["deleted"]
    id: str


class KnownDeviceResponse(FrozenModel):
    name: str
    alias: str
    fromConfig: bool
    discovered: bool
    resolved: bool


class DiscoverDevicesResponse(FrozenModel):
    status: Literal["ok"]
    discovered: list[str]


class ResolveFailureResponse(FrozenModel):
    name: str
    error: str


class ResolvedDeviceResponse(FrozenModel):
    name: str
    alias: str
    host: str
    port: int


class ResolveDevicesResponse(FrozenModel):
    status: Literal["ok"]
    requestedCount: int
    resolved: list[ResolvedDeviceResponse]
    failed: list[ResolveFailureResponse]


class DeviceLabelMetadataModel(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    ledNames: list[str]
    ledByPir: list[int]
    alias: str = ""

    @field_validator("ledNames")
    @classmethod
    def validate_led_names(cls, led_names: list[str]) -> list[str]:
        if len(led_names) != LED_COUNT:
            raise ValueError(f"'ledNames' must include exactly {LED_COUNT} entries")
        cleaned_led_names: list[str] = []
        seen_labels: set[str] = set()
        for led_name in led_names:
            cleaned = clean_led_label(led_name)
            if cleaned and cleaned in seen_labels:
                raise ValueError("Duplicate non-empty labels are not allowed on a device")
            if cleaned:
                seen_labels.add(cleaned)
            cleaned_led_names.append(cleaned)
        return cleaned_led_names

    @field_validator("ledByPir")
    @classmethod
    def validate_led_by_pir(cls, led_by_pir: list[int]) -> list[int]:
        if len(led_by_pir) != PIR_COUNT:
            raise ValueError(f"'ledByPir' must include exactly {PIR_COUNT} entries")
        used_led_indices: set[int] = set()
        for led_index in led_by_pir:
            if led_index < 0 or led_index >= LED_COUNT:
                raise ValueError(f"'ledByPir' values must be in range 0..{LED_COUNT - 1}")
            if led_index in used_led_indices:
                raise ValueError(
                    "Each LED can only be assigned to one physical PIR default"
                )
            used_led_indices.add(led_index)
        return led_by_pir

    @field_validator("alias")
    @classmethod
    def validate_alias(cls, alias: str) -> str:
        return clean_device_alias(alias)


class UpdateDeviceLabelsResponse(FrozenModel):
    status: Literal["updated"]
    device: str


class LogicalGroupModel(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    name: str
    labels: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        trimmed = name.strip()
        if not trimmed:
            raise ValueError("Group name is required")
        return trimmed

    @field_validator("labels")
    @classmethod
    def validate_labels(cls, labels: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for label in labels:
            cleaned = normalize_label(label)
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            normalized.append(cleaned)
        return normalized


class CreateGroupRequest(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    labels: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        trimmed = name.strip()
        if not trimmed:
            raise ValueError("Group name is required")
        return trimmed


class DeleteGroupResponse(FrozenModel):
    status: Literal["deleted"]
    id: str


class LedConfigModel(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    brightness: StrictInt
    rampOnMs: StrictInt
    holdOnMs: StrictInt
    rampOffMs: StrictInt
    waitOnMs: StrictInt
    pirMaskOn: StrictInt
    pirMaskOff: StrictInt

    def to_api_dict(self) -> dict[str, int]:
        return {
            "brightness": self.brightness,
            "rampOnMs": self.rampOnMs,
            "holdOnMs": self.holdOnMs,
            "rampOffMs": self.rampOffMs,
            "waitOnMs": self.waitOnMs,
            "pirMaskOn": self.pirMaskOn,
            "pirMaskOff": self.pirMaskOff,
        }


class SaveMoodConfigRequest(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    description: str = ""
    timestamp: StrictInt | None = None
    assignments: dict[str, LedConfigModel]

    @field_validator("description")
    @classmethod
    def validate_description(cls, description: str) -> str:
        return description.strip()

    @field_validator("assignments")
    @classmethod
    def validate_assignments(
        cls, assignments: dict[str, LedConfigModel]
    ) -> dict[str, LedConfigModel]:
        return normalize_assignment_map(assignments)


class MoodConfigResponse(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    description: str = ""
    timestamp: StrictInt
    assignments: dict[str, LedConfigModel]

    @field_validator("assignments")
    @classmethod
    def validate_assignments(
        cls, assignments: dict[str, LedConfigModel]
    ) -> dict[str, LedConfigModel]:
        return normalize_assignment_map(assignments)


class MoodConfigSummaryResponse(FrozenModel):
    name: str
    timestamp: int | None = None
    description: str = ""


class MoodNamedStatusResponse(FrozenModel):
    status: Literal["saved", "deleted"]
    name: str

# -----------------------------
# mDNS discovery
# -----------------------------


MDNS_SERVICE_TYPE = "_http._tcp.local."
DEVICE_NAME_PREFIX = "pirled-"

DISCOVERED_SERVICES: set[tuple[str, str]] = {
    ("_http._tcp.local.", "pirled-7BF498._http._tcp.local."),
    ("_http._tcp.local.", "pirled-5EE086._http._tcp.local."),
}  # For testing, pre-populate with known devices.
SERVICE_BY_DEVICE_NAME: dict[str, tuple[str, str]] = {}
RESOLVED_DEVICE_BY_NAME: dict[str, dict[str, object]] = {}
DISCOVERY_STATE_LOCK = threading.Lock()
MDNS_BROWSER: ServiceBrowser | None = None


def device_name_from_service_name(service_name: str) -> str:
    return service_name.split(".", maxsplit=1)[0]


def register_discovered_service(type_: str, service_name: str) -> str | None:
    if not service_name.startswith(DEVICE_NAME_PREFIX):
        return None
    device_name = device_name_from_service_name(service_name)
    with DISCOVERY_STATE_LOCK:
        DISCOVERED_SERVICES.add((type_, service_name))
        SERVICE_BY_DEVICE_NAME[device_name] = (type_, service_name)
    return device_name


def unregister_discovered_service(type_: str, service_name: str) -> None:
    device_name = device_name_from_service_name(service_name)
    with DISCOVERY_STATE_LOCK:
        DISCOVERED_SERVICES.discard((type_, service_name))
        mapped_service = SERVICE_BY_DEVICE_NAME.get(device_name)
        if mapped_service == (type_, service_name):
            del SERVICE_BY_DEVICE_NAME[device_name]
            RESOLVED_DEVICE_BY_NAME.pop(device_name, None)


def sync_device_name_index_from_discovery() -> list[str]:
    with DISCOVERY_STATE_LOCK:
        service_snapshot = sorted(DISCOVERED_SERVICES)

    discovered_names: set[str] = set()
    for type_, service_name in service_snapshot:
        registered_name = register_discovered_service(type_, service_name)
        if registered_name is not None:
            discovered_names.add(registered_name)
    return sorted(discovered_names)


def pick_host_address(type_: str, service_name: str) -> tuple[str | None, int | None, str | None]:
    info = zc.get_service_info(type_, service_name)
    if info is None:
        return None, None, "No mDNS service info"
    if not info.port:
        return None, None, "mDNS service missing port"

    addresses = info.parsed_addresses()
    for address in addresses:
        if ":" not in address:
            return address, int(info.port), None

    if info.server:
        try:
            return socket.gethostbyname(info.server), int(info.port), None
        except socket.gaierror:
            pass

    return None, None, "No IPv4 address found"


def resolve_device_name(device_name: str) -> tuple[dict[str, object] | None, str | None]:
    with DISCOVERY_STATE_LOCK:
        service = SERVICE_BY_DEVICE_NAME.get(device_name)

    if service is None:
        with DISCOVERY_STATE_LOCK:
            RESOLVED_DEVICE_BY_NAME.pop(device_name, None)
        return None, "No discovered mDNS service"

    type_, service_name = service
    host, port, error = pick_host_address(type_, service_name)
    if error is not None or host is None or port is None:
        with DISCOVERY_STATE_LOCK:
            RESOLVED_DEVICE_BY_NAME.pop(device_name, None)
        return None, error or "Unknown resolve error"

    payload: dict[str, object] = {"name": device_name, "host": host, "port": port}
    with DISCOVERY_STATE_LOCK:
        RESOLVED_DEVICE_BY_NAME[device_name] = payload
    return payload, None


def resolve_devices_now() -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    with DISCOVERY_STATE_LOCK:
        target_names = sorted(SERVICE_BY_DEVICE_NAME.keys())
    resolved: list[dict[str, object]] = []
    failed: list[dict[str, str]] = []
    for device_name in target_names:
        payload, error = resolve_device_name(device_name)
        if payload is not None:
            resolved.append(payload)
        else:
            failed.append({"name": device_name, "error": error or "Resolve failed"})
    return resolved, failed


def list_resolved_devices() -> list[ResolvedDeviceResponse]:
    metadata = load_metadata()
    with DISCOVERY_STATE_LOCK:
        resolved_snapshot = [dict(entry) for entry in RESOLVED_DEVICE_BY_NAME.values()]
    resolved_payload: list[ResolvedDeviceResponse] = []
    for device in resolved_snapshot:
        device_name = device.get("name")
        host = device.get("host")
        port = device.get("port")
        if not isinstance(device_name, str) or not isinstance(host, str) or not isinstance(
            port, int
        ):
            continue
        alias = metadata_alias_value(metadata, device_name)
        resolved_payload.append(
            ResolvedDeviceResponse(
                name=device_name, alias=alias, host=host, port=port
            )
        )
    return sorted(
        resolved_payload,
        key=lambda device: device.name.lower(),
    )


def list_known_devices() -> list[KnownDeviceResponse]:
    metadata = load_metadata()
    config_device_names = {
        key for key in metadata.keys() if isinstance(key, str) and key.strip()
    }
    with DISCOVERY_STATE_LOCK:
        discovered_device_names = set(SERVICE_BY_DEVICE_NAME.keys())
        resolved_snapshot = {name: dict(payload) for name, payload in RESOLVED_DEVICE_BY_NAME.items()}

    known_device_names = sorted(config_device_names | discovered_device_names)
    payload: list[KnownDeviceResponse] = []
    for device_name in known_device_names:
        row = KnownDeviceResponse(
            name=device_name,
            alias=metadata_alias_value(metadata, device_name),
            fromConfig=device_name in config_device_names,
            discovered=device_name in discovered_device_names,
            resolved=device_name in resolved_snapshot,
        )
        payload.append(row)
    return payload


class MDNSListener(ServiceListener):
    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        register_discovered_service(type_, name)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        unregister_discovered_service(type_, name)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        register_discovered_service(type_, name)


zc = Zeroconf()


def start_mdns() -> None:
    global MDNS_BROWSER
    MDNS_BROWSER = ServiceBrowser(zc, MDNS_SERVICE_TYPE, MDNSListener())


threading.Thread(target=start_mdns, daemon=True).start()
sync_device_name_index_from_discovery()


# -----------------------------
# API
# -----------------------------


@app.get("/api/devices", response_model=list[KnownDeviceResponse])
def get_devices() -> list[KnownDeviceResponse]:
    return list_known_devices()


@app.post("/api/devices/discover", response_model=DiscoverDevicesResponse)
def discover_devices() -> DiscoverDevicesResponse:
    discovered_names = sync_device_name_index_from_discovery()
    return DiscoverDevicesResponse(status="ok", discovered=discovered_names)


@app.post("/api/devices/resolve", response_model=ResolveDevicesResponse)
def resolve_devices() -> ResolveDevicesResponse:
    _, failed = resolve_devices_now()
    resolved = list_resolved_devices()
    return ResolveDevicesResponse(
        status="ok",
        requestedCount=len(resolved) + len(failed),
        resolved=resolved,
        failed=[ResolveFailureResponse.model_validate(item) for item in failed],
    )


# -----------------------------
# Device Metadata (LED naming)
# -----------------------------


def clean_config_name(name: str) -> str:
    """Clean config name: map whitespace to underscores, allow only alphanumeric, dash, underscore."""
    normalized = re.sub(r"\s+", "_", name.strip())
    cleaned = VALID_NAME_PATTERN.sub("", normalized)
    if not cleaned:
        raise ValueError("Config name must contain at least one alphanumeric character")
    return cleaned


def normalize_label(label: str) -> str:
    return label.strip()


def clean_display_text(
    value: str,
    *,
    field_name: str,
    enforce_charset: bool,
    allow_empty: bool,
) -> str:
    trimmed = value.strip()
    if len(trimmed) > DISPLAY_TEXT_MAX_LENGTH:
        raise ValueError(
            f"'{field_name}' must be at most {DISPLAY_TEXT_MAX_LENGTH} characters"
        )
    if enforce_charset and VALID_NAME_PATTERN.search(trimmed):
        raise ValueError(
            f"'{field_name}' may only contain letters, numbers, dash, and underscore"
        )
    if not allow_empty and not trimmed:
        raise ValueError(f"'{field_name}' must not be empty")
    return trimmed


def clean_device_alias(value: str) -> str:
    return clean_display_text(
        value,
        field_name="alias",
        enforce_charset=False,
        allow_empty=True,
    )


def metadata_alias_value(metadata: dict, device_name: str) -> str:
    parsed = parse_stored_device_label_metadata(metadata.get(device_name))
    if parsed is None:
        return ""
    return parsed.alias


def clean_led_label(label: str) -> str:
    return clean_display_text(
        label,
        field_name="ledNames entry",
        enforce_charset=True,
        allow_empty=True,
    )


def clean_mood_assignment_label(label: str) -> str:
    return clean_display_text(
        label,
        field_name="Mood assignment label",
        enforce_charset=True,
        allow_empty=False,
    )


def normalize_assignment_map(
    assignments: dict[str, LedConfigModel],
) -> dict[str, LedConfigModel]:
    if not assignments:
        raise ValueError("Mood must include at least one assignment")
    normalized: dict[str, LedConfigModel] = {}
    for raw_label, config in assignments.items():
        cleaned_label = clean_mood_assignment_label(raw_label)
        normalized[cleaned_label] = config
    return normalized


def load_metadata() -> dict:
    """Load device metadata from file."""
    if METADATA_FILE.exists():
        try:
            return json.loads(METADATA_FILE.read_text())
        except Exception:
            return {}
    return {}


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


def assignments_to_api_dict(
    assignments: dict[str, LedConfigModel],
) -> dict[str, dict[str, int]]:
    return {label: config.to_api_dict() for label, config in assignments.items()}


@app.get(
    "/api/devices/{device_name}/led-names", response_model=DeviceLabelMetadataModel
)
def get_led_names(device_name: str) -> DeviceLabelMetadataModel:
    """Get label metadata for a device; returns canonical defaults if not configured."""
    metadata = load_metadata()

    if device_name not in metadata:
        return default_device_label_metadata()

    parsed = parse_stored_device_label_metadata(metadata[device_name])
    if parsed is None:
        return default_device_label_metadata()

    return parsed


@app.post(
    "/api/devices/{device_name}/led-names", response_model=UpdateDeviceLabelsResponse
)
def update_led_names(
    device_name: str, data: DeviceLabelMetadataModel
) -> UpdateDeviceLabelsResponse:
    """Update LED names for a device."""
    metadata = load_metadata()
    cleaned_led_names = data.ledNames
    cleaned_led_by_pir = data.ledByPir
    cleaned_alias = data.alias

    labels_on_other_devices = gather_global_labels(
        metadata, exclude_device_name=device_name
    )
    duplicate_global_labels = sorted(
        {label for label in cleaned_led_names if label and label in labels_on_other_devices}
    )
    if duplicate_global_labels:
        raise HTTPException(
            status_code=400,
            detail=(
                "Non-empty labels must be globally unique across devices. "
                f"Conflicts: {', '.join(duplicate_global_labels)}"
            ),
        )

    metadata[device_name] = {
        "ledNames": cleaned_led_names,
        "ledByPir": cleaned_led_by_pir,
        "alias": cleaned_alias,
    }
    METADATA_FILE.write_text(json.dumps(metadata, indent=2))

    return UpdateDeviceLabelsResponse(status="updated", device=device_name)


# -----------------------------
# Saved Configs
# -----------------------------


def load_groups() -> list[LogicalGroupModel]:
    if not GROUPS_FILE.exists():
        return []
    try:
        payload = json.loads(GROUPS_FILE.read_text())
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    parsed_groups: list[LogicalGroupModel] = []
    for item in payload:
        try:
            parsed_group = LogicalGroupModel.model_validate(item)
        except Exception:
            continue
        parsed_groups.append(parsed_group)
    return parsed_groups


def save_groups(groups: list[LogicalGroupModel]) -> None:
    GROUPS_FILE.write_text(
        json.dumps(
            [group.model_dump(mode="json") for group in groups],
            indent=2,
        )
    )


def apply_led_config(device_uri: str, led_index: int, config: dict) -> None:
    params = {"index": str(led_index)}
    for key, value in config.items():
        if value is None:
            continue
        params[key] = str(value)

    request = Request(
        f"http://{device_uri}/config/led",
        data=urlencode(params).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=3):
        pass


def get_group_by_id(group_id: str) -> LogicalGroupModel | None:
    for group in load_groups():
        if group.id == group_id:
            return group
    return None


@app.get("/api/groups", response_model=list[LogicalGroupModel])
def list_groups() -> list[LogicalGroupModel]:
    groups = load_groups()
    return sorted(groups, key=lambda group: group.name.lower())


@app.post("/api/groups", response_model=LogicalGroupModel)
def create_group(payload: CreateGroupRequest) -> LogicalGroupModel:
    next_group = LogicalGroupModel(
        id=f"{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}",
        name=payload.name,
        labels=payload.labels,
    )

    groups = load_groups()
    groups.append(next_group)
    save_groups(sorted(groups, key=lambda group: group.name.lower()))
    return next_group


@app.delete("/api/groups/{group_id}", response_model=DeleteGroupResponse)
def delete_group(group_id: str) -> DeleteGroupResponse:
    groups = load_groups()
    filtered = [group for group in groups if group.id != group_id]
    if len(filtered) == len(groups):
        raise HTTPException(status_code=404, detail="Group not found")
    save_groups(sorted(filtered, key=lambda group: group.name.lower()))
    return DeleteGroupResponse(status="deleted", id=group_id)


@app.get("/api/mood-configs", response_model=list[MoodConfigSummaryResponse])
def list_mood_configs() -> list[MoodConfigSummaryResponse]:
    """List all saved mood configs."""
    configs: list[MoodConfigSummaryResponse] = []
    if not MOODS_DIR.exists():
        return []

    for f in MOODS_DIR.glob("*.json"):
        try:
            cfg = MoodConfigResponse.model_validate(json.loads(f.read_text()))
            configs.append(
                MoodConfigSummaryResponse(
                    name=f.stem,
                    timestamp=cfg.timestamp,
                    description=cfg.description,
                )
            )
        except Exception:
            pass

    return sorted(
        configs,
        key=lambda summary: summary.timestamp or 0,
        reverse=True,
    )


@app.get("/api/mood-configs/{name}", response_model=MoodConfigResponse)
def get_mood_config(name: str) -> MoodConfigResponse:
    """Get a saved mood config by name."""
    try:
        name = clean_config_name(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    config_path = MOODS_DIR / f"{name}.json"

    if not config_path.exists():
        raise HTTPException(status_code=404, detail="Config not found")

    try:
        loaded = MoodConfigResponse.model_validate(json.loads(config_path.read_text()))
        if loaded.name != name:
            return loaded.model_copy(update={"name": name})
        return loaded
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.post("/api/mood-configs/{name}", response_model=MoodNamedStatusResponse)
def save_mood_config(name: str, config_data: SaveMoodConfigRequest) -> MoodNamedStatusResponse:
    """Save a mood config with the given name."""
    try:
        name = clean_config_name(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    config_path = MOODS_DIR / f"{name}.json"
    payload = MoodConfigResponse(
        name=name,
        description=config_data.description,
        timestamp=(
            config_data.timestamp
            if config_data.timestamp is not None
            else int(time.time())
        ),
        assignments=config_data.assignments,
    )

    try:
        config_path.write_text(
            json.dumps(payload.model_dump(mode="json"), indent=2)
        )
        return MoodNamedStatusResponse(status="saved", name=name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


@app.delete("/api/mood-configs/{name}", response_model=MoodNamedStatusResponse)
def delete_mood_config(name: str) -> MoodNamedStatusResponse:
    """Delete a saved mood config."""
    try:
        name = clean_config_name(name)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    config_path = MOODS_DIR / f"{name}.json"

    if not config_path.exists():
        raise HTTPException(status_code=404, detail="Config not found")

    try:
        config_path.unlink()
        return MoodNamedStatusResponse(status="deleted", name=name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e


APPLY_STATUS_LOCK = threading.Lock()


def ensure_mood_config_exists(name: str) -> None:
    config_path = MOODS_DIR / f"{name}.json"
    if not config_path.exists():
        raise FileNotFoundError("Config not found")


def resolve_allowed_labels(group_id: str | None) -> set[str] | None:
    if not group_id:
        return None
    group = get_group_by_id(group_id)
    if group is None:
        raise FileNotFoundError("Group not found")
    return {
        normalize_label(label)
        for label in group.labels
        if normalize_label(label)
    }


def load_mood_config_payload(name: str) -> MoodConfigResponse:
    config_path = MOODS_DIR / f"{name}.json"
    ensure_mood_config_exists(name)
    loaded = MoodConfigResponse.model_validate(json.loads(config_path.read_text()))
    if loaded.name != name:
        return loaded.model_copy(update={"name": name})
    return loaded


def apply_mood_by_name(name: str, group_id: str | None) -> ApplyReport:
    config_data = load_mood_config_payload(name)
    allowed_labels = resolve_allowed_labels(group_id)
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
                apply_led_config(f"{host}:{port}", led_index, config)
                success_count += 1
            except Exception as e:
                failures.append(f"{device_name} LED {led_index}: {e}")

    return ApplyReport(
        successCount=success_count,
        failureCount=len(failures),
        failures=failures,
    )


def load_apply_status_state() -> MoodApplyStatusResponse:
    if not MOOD_APPLY_STATUS_FILE.exists():
        return MoodApplyStatusResponse()
    try:
        payload = json.loads(MOOD_APPLY_STATUS_FILE.read_text())
    except Exception:
        return MoodApplyStatusResponse()
    try:
        return MoodApplyStatusResponse.model_validate(payload)
    except Exception:
        return MoodApplyStatusResponse()


def read_apply_status() -> MoodApplyStatusResponse:
    with APPLY_STATUS_LOCK:
        return load_apply_status_state()


def record_apply_status(
    *,
    source: Literal["manual", "scheduled"],
    mood_name: str,
    group_id: str | None,
    schedule_id: str | None,
    report: ApplyReport,
) -> MoodApplyStatusResponse:
    entry = MoodApplyStatusEntry(
        appliedAt=int(time.time()),
        source=source,
        moodName=mood_name,
        groupId=group_id,
        scheduleId=schedule_id,
        successCount=report.successCount,
        failureCount=report.failureCount,
        failures=report.failures,
    )
    payload = MoodApplyStatusResponse(lastApply=entry)
    with APPLY_STATUS_LOCK:
        MOOD_APPLY_STATUS_FILE.write_text(
            json.dumps(payload.model_dump(mode="json"), indent=2)
        )
        return payload


def run_scheduled_mood_apply(schedule: MoodSchedule) -> ApplyReport:
    mood_name = schedule.moodName
    group_id = schedule.groupId
    try:
        report = apply_mood_by_name(mood_name, group_id)
    except FileNotFoundError as e:
        report = ApplyReport(successCount=0, failureCount=1, failures=[str(e)])
    except ValueError as e:
        report = ApplyReport(successCount=0, failureCount=1, failures=[str(e)])
    except Exception as e:
        report = ApplyReport(successCount=0, failureCount=1, failures=[str(e)])

    record_apply_status(
        source="scheduled",
        mood_name=mood_name,
        group_id=group_id,
        schedule_id=schedule.id,
        report=report,
    )
    return report


MOOD_SCHEDULER = MoodScheduler(MOOD_SCHEDULES_FILE, run_scheduled_mood_apply)


@app.on_event("startup")
def startup() -> None:
    MOOD_SCHEDULER.start()


@app.on_event("shutdown")
def shutdown() -> None:
    MOOD_SCHEDULER.stop()


@app.get("/api/mood-apply-status", response_model=MoodApplyStatusResponse)
def get_mood_apply_status() -> MoodApplyStatusResponse:
    return read_apply_status()


@app.post("/api/mood-configs/{name}/apply", response_model=ApplyReport)
def apply_mood_config(name: str, payload: MoodApplyRequest | None = None) -> ApplyReport:
    group_id = payload.groupId if payload is not None else None
    try:
        cleaned_name = clean_config_name(name)
        report = apply_mood_by_name(cleaned_name, group_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e)) from e

    record_apply_status(
        source="manual",
        mood_name=cleaned_name,
        group_id=group_id,
        schedule_id=None,
        report=report,
    )
    return report


@app.get("/api/mood-schedules", response_model=list[MoodSchedule])
def list_mood_schedules() -> list[MoodSchedule]:
    return MOOD_SCHEDULER.list_schedules()


@app.post("/api/mood-schedules", response_model=MoodSchedule)
def create_mood_schedule(payload: MoodScheduleCreateRequest) -> MoodSchedule:
    try:
        cleaned_mood_name = clean_config_name(payload.moodName)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    try:
        ensure_mood_config_exists(cleaned_mood_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e

    group_id = payload.groupId
    if group_id and get_group_by_id(group_id) is None:
        raise HTTPException(status_code=404, detail="Group not found")

    try:
        created = MOOD_SCHEDULER.add_schedule(
            mood_name=cleaned_mood_name,
            group_id=group_id,
            interval_seconds=payload.intervalSeconds,
            first_run_at=payload.firstRunAt,
            enabled=payload.enabled,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    return created


@app.patch("/api/mood-schedules/{schedule_id}", response_model=MoodSchedule)
def update_mood_schedule(
    schedule_id: str, payload: MoodScheduleUpdateRequest
) -> MoodSchedule:
    mood_name: str | None = None
    if payload.moodName is not None:
        try:
            mood_name = clean_config_name(payload.moodName)
            ensure_mood_config_exists(mood_name)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
        except FileNotFoundError as e:
            raise HTTPException(status_code=404, detail=str(e)) from e

    group_id_set = "groupId" in payload.model_fields_set
    group_id = payload.groupId
    if group_id and get_group_by_id(group_id) is None:
        raise HTTPException(status_code=404, detail="Group not found")

    try:
        updated = MOOD_SCHEDULER.update_schedule(
            schedule_id,
            mood_name=mood_name,
            group_id=group_id,
            group_id_set=group_id_set,
            interval_seconds=payload.intervalSeconds,
            next_run_at=payload.nextRunAt,
            enabled=payload.enabled,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e

    if updated is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return updated


@app.delete("/api/mood-schedules/{schedule_id}", response_model=DeleteScheduleResponse)
def delete_mood_schedule(schedule_id: str) -> DeleteScheduleResponse:
    deleted = MOOD_SCHEDULER.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return DeleteScheduleResponse(status="deleted", id=schedule_id)


# Serve React app from frontend/dist in production, fallback to static for dev
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
