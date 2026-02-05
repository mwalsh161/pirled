import json
import pathlib
import re
import socket
import subprocess
import threading
import time
import uuid
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

THIS_DIR = pathlib.Path(__file__).parent
app = FastAPI()

# Pre-compiled regex patterns
VALID_NAME_PATTERN = re.compile(r"[^a-zA-Z0-9_-]")
LED_COUNT = 4
PIR_COUNT = 4
LED_CONFIG_FIELDS: tuple[str, ...] = (
    "brightness",
    "rampOnMs",
    "holdOnMs",
    "rampOffMs",
    "waitOnMs",
    "pirMaskOn",
    "pirMaskOff",
)

# -----------------------------
# mDNS discovery
# -----------------------------


SERVICES: list[tuple[str, str]] = [
    ("_http._tcp.local.", "pirled-7BF498._http._tcp.local."),
    ("_http._tcp.local.", "pirled-5EE086._http._tcp.local."),
]  # For testing, pre-populate with a known device.


class MDNSListener(ServiceListener):
    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        if not name.startswith("pirled-") or (type_, name) in SERVICES:
            return
        SERVICES.append((type_, name))

    def remove_service(self, zc, type_, name):
        pass

    def update_service(self, zc, type_, name):
        pass


zc = Zeroconf()


def start_mdns():
    ServiceBrowser(zc, "_http._tcp.local.", MDNSListener())


threading.Thread(target=start_mdns, daemon=True).start()


def ping(ip: str) -> str:
    if (ret := subprocess.call(("ping", "-c", "1", ip))) != 0:
        raise socket.gaierror(f"Ping failed: {ret}")
    return ip


# -----------------------------
# API
# -----------------------------


def discover_devices() -> list[dict]:
    devs = []
    failed = []

    # Go through and resolve hostname + ping (remove failed ones).
    # JS app is chatty, so it should only use IP.
    for type_, name in SERVICES:
        info = zc.get_service_info(type_, name)
        if info and info.server and info.port:
            try:
                ip = ping(socket.gethostbyname(info.server))
                # Strip the mDNS suffix (e.g., "._http._tcp.local.") from the name
                # NOTE, this looks like the hostname but technically isn't (see firmware).
                device_name = name.split(".", maxsplit=1)[0]
                devs.append({"host": ip, "port": info.port, "name": device_name})
            except socket.gaierror:  # Failed to resolve.
                failed.append((type_, name))
                continue

    for failure in failed:
        SERVICES.remove(failure)

    return devs


@app.get("/api/devices")
def get_devices():
    return JSONResponse(discover_devices())


# -----------------------------
# Device Metadata (LED naming)
# -----------------------------

METADATA_DIR = THIS_DIR / "data"
METADATA_DIR.mkdir(exist_ok=True)
METADATA_FILE = METADATA_DIR / "devices_metadata.json"


def clean_config_name(name: str) -> str:
    """Clean config name: allow only alphanumeric, dash, underscore."""
    cleaned = VALID_NAME_PATTERN.sub("", name)
    if not cleaned:
        raise ValueError("Config name must contain at least one alphanumeric character")
    return cleaned


def normalize_label(label: str) -> str:
    return label.strip()


def clean_led_label(label: str) -> str:
    trimmed = normalize_label(label)
    if VALID_NAME_PATTERN.search(trimmed):
        raise ValueError(
            "LED labels may only contain letters, numbers, dash, and underscore"
        )
    return trimmed


def load_metadata() -> dict:
    """Load device metadata from file."""
    if METADATA_FILE.exists():
        try:
            return json.loads(METADATA_FILE.read_text())
        except Exception:
            return {}
    return {}


def default_device_label_metadata(device_name: str) -> dict:
    return {
        "ledNames": ["" for _ in range(LED_COUNT)],
        "ledByPir": [pir_index for pir_index in range(PIR_COUNT)],
    }


def parse_device_label_metadata_payload(data: dict) -> tuple[list[str], list[int]]:
    if "ledNames" not in data:
        raise ValueError("Missing 'ledNames' field")
    if "ledByPir" not in data:
        raise ValueError("Missing 'ledByPir' field")

    raw_led_names = data["ledNames"]
    if not isinstance(raw_led_names, list):
        raise ValueError("'ledNames' must be a list")
    if len(raw_led_names) != LED_COUNT:
        raise ValueError(f"'ledNames' must include exactly {LED_COUNT} entries")

    cleaned_led_names: list[str] = []
    seen_labels: set[str] = set()
    for name in raw_led_names:
        if not isinstance(name, str):
            raise ValueError("'ledNames' entries must be strings")
        cleaned = clean_led_label(name)
        if cleaned and cleaned in seen_labels:
            raise ValueError("Duplicate non-empty labels are not allowed on a device")
        if cleaned:
            seen_labels.add(cleaned)
        cleaned_led_names.append(cleaned)

    raw_led_by_pir = data["ledByPir"]
    if not isinstance(raw_led_by_pir, list):
        raise ValueError("'ledByPir' must be a list")
    if len(raw_led_by_pir) != PIR_COUNT:
        raise ValueError(f"'ledByPir' must include exactly {PIR_COUNT} entries")

    cleaned_led_by_pir: list[int] = []
    used_led_indices: set[int] = set()
    for led_index in raw_led_by_pir:
        if not isinstance(led_index, int):
            raise ValueError("ledByPir entries must be integers")
        if led_index < 0 or led_index >= LED_COUNT:
            raise ValueError(f"'ledByPir' values must be in range 0..{LED_COUNT - 1}")
        if led_index in used_led_indices:
            raise ValueError(
                "Each LED can only be assigned to one physical PIR default"
            )
        used_led_indices.add(led_index)
        cleaned_led_by_pir.append(led_index)

    return cleaned_led_names, cleaned_led_by_pir


def parse_stored_device_label_metadata(
    value: object,
) -> tuple[list[str], list[int]] | None:
    if not isinstance(value, dict):
        return None
    try:
        return parse_device_label_metadata_payload(value)
    except ValueError:
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
        led_names, _ = parsed
        for label in led_names:
            if label:
                labels.add(label)
    return labels


def is_valid_led_config(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    for field in LED_CONFIG_FIELDS:
        field_value = value.get(field)
        if not isinstance(field_value, int):
            return False
    return True


def parse_mood_assignments(assignments: object) -> dict[str, dict]:
    if not isinstance(assignments, dict):
        raise ValueError("Mood payload must include an 'assignments' object")

    parsed: dict[str, dict] = {}
    for raw_label, raw_config in assignments.items():
        if not isinstance(raw_label, str):
            raise ValueError("Mood assignment labels must be strings")
        label = clean_led_label(raw_label)
        if not label:
            raise ValueError("Mood assignment labels must be non-empty")
        if not is_valid_led_config(raw_config):
            raise ValueError(f"Invalid LED config for label '{label}'")
        parsed[label] = raw_config

    if not parsed:
        raise ValueError("Mood must include at least one assignment")
    return parsed


@app.get("/api/devices/{device_name}/led-names")
def get_led_names(device_name: str):
    """Get label metadata for a device; returns canonical defaults if not configured."""
    metadata = load_metadata()

    if device_name not in metadata:
        return JSONResponse(default_device_label_metadata(device_name))

    parsed = parse_stored_device_label_metadata(metadata[device_name])
    if parsed is None:
        return JSONResponse(default_device_label_metadata(device_name))

    led_names, led_by_pir = parsed
    return JSONResponse({"ledNames": led_names, "ledByPir": led_by_pir})


@app.post("/api/devices/{device_name}/led-names")
def update_led_names(device_name: str, data: dict):
    """Update LED names for a device."""
    metadata = load_metadata()

    try:
        cleaned_led_names, cleaned_led_by_pir = parse_device_label_metadata_payload(data)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    labels_on_other_devices = gather_global_labels(
        metadata, exclude_device_name=device_name
    )
    duplicate_global_labels = sorted(
        {label for label in cleaned_led_names if label and label in labels_on_other_devices}
    )
    if duplicate_global_labels:
        return JSONResponse(
            {
                "error": (
                    "Non-empty labels must be globally unique across devices. "
                    f"Conflicts: {', '.join(duplicate_global_labels)}"
                )
            },
            status_code=400,
        )

    metadata[device_name] = {
        "ledNames": cleaned_led_names,
        "ledByPir": cleaned_led_by_pir,
    }
    METADATA_FILE.write_text(json.dumps(metadata, indent=2))

    return JSONResponse({"status": "updated", "device": device_name})


# -----------------------------
# Saved Configs
# -----------------------------

DATA_DIR = THIS_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
GROUPS_DIR = DATA_DIR / "groups"
GROUPS_DIR.mkdir(exist_ok=True)
GROUPS_FILE = GROUPS_DIR / "logical_groups.json"


def load_groups() -> list[dict]:
    if not GROUPS_FILE.exists():
        return []
    try:
        payload = json.loads(GROUPS_FILE.read_text())
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    parsed_groups = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        group_id = item.get("id")
        name = item.get("name")
        labels = item.get("labels")
        if not isinstance(group_id, str) or not isinstance(name, str):
            continue
        if not isinstance(labels, list):
            labels = []
        normalized_labels = [
            normalize_label(label)
            for label in labels
            if isinstance(label, str) and normalize_label(label)
        ]
        parsed_groups.append(
            {"id": group_id, "name": name.strip(), "labels": list(dict.fromkeys(normalized_labels))}
        )
    return parsed_groups


def save_groups(groups: list[dict]) -> None:
    GROUPS_FILE.write_text(json.dumps(groups, indent=2))


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


def get_group_by_id(group_id: str) -> dict | None:
    for group in load_groups():
        if group.get("id") == group_id:
            return group
    return None


@app.get("/api/groups")
def list_groups():
    groups = load_groups()
    return JSONResponse(sorted(groups, key=lambda group: group["name"].lower()))


@app.post("/api/groups")
def create_group(payload: dict):
    if not isinstance(payload, dict):
        return JSONResponse({"error": "Invalid group payload"}, status_code=400)

    name = payload.get("name")
    labels = payload.get("labels")
    if not isinstance(name, str) or not name.strip():
        return JSONResponse({"error": "Group name is required"}, status_code=400)
    if not isinstance(labels, list):
        return JSONResponse({"error": "Group labels must be an array"}, status_code=400)

    normalized_labels = [
        normalize_label(label)
        for label in labels
        if isinstance(label, str) and normalize_label(label)
    ]
    next_group = {
        "id": f"{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}",
        "name": name.strip(),
        "labels": list(dict.fromkeys(normalized_labels)),
    }

    groups = load_groups()
    groups.append(next_group)
    save_groups(sorted(groups, key=lambda group: group["name"].lower()))
    return JSONResponse(next_group)


@app.delete("/api/groups/{group_id}")
def delete_group(group_id: str):
    groups = load_groups()
    filtered = [group for group in groups if group.get("id") != group_id]
    if len(filtered) == len(groups):
        return JSONResponse({"error": "Group not found"}, status_code=404)
    save_groups(sorted(filtered, key=lambda group: group["name"].lower()))
    return JSONResponse({"status": "deleted", "id": group_id})


@app.get("/api/mood-configs")
def list_mood_configs():
    """List all saved mood configs."""
    configs = []
    if not DATA_DIR.exists():
        return JSONResponse([])

    for f in DATA_DIR.glob("*.json"):
        # Skip metadata file
        if f.name == "devices_metadata.json":
            continue
        try:
            cfg = json.loads(f.read_text())
            configs.append(
                {
                    "name": f.stem,
                    "timestamp": cfg.get("timestamp"),
                    "description": cfg.get("description", ""),
                }
            )
        except Exception:
            pass

    return JSONResponse(sorted(configs, key=lambda x: x["timestamp"], reverse=True))


@app.get("/api/mood-configs/{name}")
def get_mood_config(name: str):
    """Get a saved mood config by name."""
    try:
        name = clean_config_name(name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    config_path = DATA_DIR / f"{name}.json"

    if not config_path.exists():
        return JSONResponse({"error": "Config not found"}, status_code=404)

    try:
        return JSONResponse(json.loads(config_path.read_text()))
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/mood-configs/{name}")
def save_mood_config(name: str, config_data: dict):
    """Save a mood config with the given name."""
    try:
        name = clean_config_name(name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    config_path = DATA_DIR / f"{name}.json"

    if not isinstance(config_data, dict):
        return JSONResponse({"error": "Invalid mood payload"}, status_code=400)

    try:
        assignments = parse_mood_assignments(config_data.get("assignments"))
        timestamp = config_data.get("timestamp", int(time.time()))
        if not isinstance(timestamp, int):
            raise ValueError("'timestamp' must be an integer")
        description = config_data.get("description", "")
        if not isinstance(description, str):
            raise ValueError("'description' must be a string")
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    payload = {
        "name": name,
        "description": description.strip(),
        "timestamp": timestamp,
        "assignments": assignments,
    }

    try:
        config_path.write_text(json.dumps(payload, indent=2))
        return JSONResponse({"status": "saved", "name": name})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.delete("/api/mood-configs/{name}")
def delete_mood_config(name: str):
    """Delete a saved mood config."""
    try:
        name = clean_config_name(name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    config_path = DATA_DIR / f"{name}.json"

    if not config_path.exists():
        return JSONResponse({"error": "Config not found"}, status_code=404)

    try:
        config_path.unlink()
        return JSONResponse({"status": "deleted", "name": name})
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/mood-configs/{name}/apply")
def apply_mood_config(name: str, payload: dict | None = None):
    try:
        name = clean_config_name(name)
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)

    config_path = DATA_DIR / f"{name}.json"
    if not config_path.exists():
        return JSONResponse({"error": "Config not found"}, status_code=404)

    try:
        config_data = json.loads(config_path.read_text())
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

    group_id: str | None = None
    if isinstance(payload, dict):
        candidate_group_id = payload.get("groupId")
        if candidate_group_id is not None and not isinstance(candidate_group_id, str):
            return JSONResponse({"error": "groupId must be a string"}, status_code=400)
        group_id = candidate_group_id

    allowed_labels = None
    if group_id:
        group = get_group_by_id(group_id)
        if group is None:
            return JSONResponse({"error": "Group not found"}, status_code=404)
        allowed_labels = {
            normalize_label(label)
            for label in group.get("labels", [])
            if isinstance(label, str) and normalize_label(label)
        }

    try:
        assignments_by_label = parse_mood_assignments(config_data.get("assignments"))
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    metadata = load_metadata()
    success_count = 0
    failures: list[str] = []

    for device in discover_devices():
        device_name = device.get("name")
        host = device.get("host")
        port = device.get("port")
        if not isinstance(device_name, str) or not isinstance(host, str) or not isinstance(
            port, int
        ):
            continue

        stored_led_names: list[str] = []
        parsed_metadata = parse_stored_device_label_metadata(metadata.get(device_name))
        if parsed_metadata is not None:
            stored_led_names, _ = parsed_metadata

        for led_index in range(LED_COUNT):
            raw_label = (
                stored_led_names[led_index]
                if led_index < len(stored_led_names)
                else ""
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

    return JSONResponse(
        {
            "successCount": success_count,
            "failureCount": len(failures),
            "failures": failures,
        }
    )


# Serve React app from frontend/dist in production, fallback to static for dev
FRONTEND_DIST = THIS_DIR.parent / "frontend" / "dist"
app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")

if __name__ == "__main__":
    import sys

    import uvicorn

    port = int(sys.argv[1]) if len(sys.argv) == 2 else 8000

    uvicorn.run(app, port=port)
