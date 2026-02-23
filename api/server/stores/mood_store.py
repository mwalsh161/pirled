from __future__ import annotations

import json
import pathlib
import time

from ..config import MOODS_DIR
from ..schemas import (
    MoodConfigResponse,
    MoodConfigSummaryResponse,
    MoodNamedStatusResponse,
    SaveMoodConfigRequest,
)


def _mood_config_path(name: str) -> pathlib.Path:
    return MOODS_DIR / f"{name}.json"


def ensure_mood_config_exists(name: str) -> None:
    if not _mood_config_path(name).exists():
        raise FileNotFoundError("Config not found")


def list_mood_configs() -> list[MoodConfigSummaryResponse]:
    configs: list[MoodConfigSummaryResponse] = []
    if not MOODS_DIR.exists():
        return []

    for config_file in MOODS_DIR.glob("*.json"):
        try:
            cfg = MoodConfigResponse.model_validate(json.loads(config_file.read_text()))
            configs.append(
                MoodConfigSummaryResponse(
                    name=config_file.stem,
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


def load_mood_config(name: str) -> MoodConfigResponse:
    config_path = _mood_config_path(name)
    if not config_path.exists():
        raise FileNotFoundError("Config not found")
    loaded = MoodConfigResponse.model_validate(json.loads(config_path.read_text()))
    if loaded.name != name:
        return loaded.model_copy(update={"name": name})
    return loaded


def save_mood_config(
    name: str, config_data: SaveMoodConfigRequest
) -> MoodNamedStatusResponse:
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
    _mood_config_path(name).write_text(
        json.dumps(payload.model_dump(mode="json"), indent=2)
    )
    return MoodNamedStatusResponse(status="saved", name=name)


def delete_mood_config(name: str) -> MoodNamedStatusResponse:
    config_path = _mood_config_path(name)
    if not config_path.exists():
        raise FileNotFoundError("Config not found")
    config_path.unlink()
    return MoodNamedStatusResponse(status="deleted", name=name)
