from __future__ import annotations

import pathlib

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

LED_COUNT = 4
PIR_COUNT = 4
DISPLAY_TEXT_MAX_LENGTH = 64

MDNS_SERVICE_TYPE = "_http._tcp.local."
DEVICE_NAME_PREFIX = "pirled-"
DEVICE_HTTP_PORT = 80
