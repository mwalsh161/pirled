from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..scheduler import ApplyReport
from ..schemas import (
    MoodApplyRequest,
    MoodApplyStatusResponse,
    MoodConfigResponse,
    MoodConfigSummaryResponse,
    MoodNamedStatusResponse,
    SaveMoodConfigRequest,
)
from ..services.mood_apply import apply_mood_by_name
from ..stores.apply_status_store import read_apply_status, record_apply_status
from ..stores.mood_store import (
    delete_mood_config,
    list_mood_configs,
    load_mood_config,
    save_mood_config,
)
from ..validation import clean_config_name

router = APIRouter()


@router.get("/mood-configs", response_model=list[MoodConfigSummaryResponse])
def list_mood_configs_route() -> list[MoodConfigSummaryResponse]:
    return list_mood_configs()


@router.get("/mood-configs/{name}", response_model=MoodConfigResponse)
def get_mood_config(name: str) -> MoodConfigResponse:
    try:
        cleaned_name = clean_config_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return load_mood_config(cleaned_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/mood-configs/{name}", response_model=MoodNamedStatusResponse)
def save_mood_config_route(
    name: str, config_data: SaveMoodConfigRequest
) -> MoodNamedStatusResponse:
    try:
        cleaned_name = clean_config_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return save_mood_config(cleaned_name, config_data)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.delete("/mood-configs/{name}", response_model=MoodNamedStatusResponse)
def delete_mood_config_route(name: str) -> MoodNamedStatusResponse:
    try:
        cleaned_name = clean_config_name(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        return delete_mood_config(cleaned_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/mood-apply-status", response_model=MoodApplyStatusResponse)
def get_mood_apply_status() -> MoodApplyStatusResponse:
    return read_apply_status()


@router.post("/mood-configs/{name}/apply", response_model=ApplyReport)
def apply_mood_config(
    name: str, payload: MoodApplyRequest | None = None
) -> ApplyReport:
    group_id = payload.groupId if payload is not None else None
    try:
        cleaned_name = clean_config_name(name)
        report = apply_mood_by_name(cleaned_name, group_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    record_apply_status(
        source="manual",
        mood_name=cleaned_name,
        group_id=group_id,
        schedule_id=None,
        report=report,
    )
    return report
