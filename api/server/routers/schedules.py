from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..scheduler import MoodSchedule
from ..schemas import (
    DeleteScheduleResponse,
    MoodScheduleCreateRequest,
    MoodScheduleUpdateRequest,
)
from ..services.scheduler_runtime import MOOD_SCHEDULER
from ..stores.groups_store import get_group_by_id
from ..stores.mood_store import ensure_mood_config_exists
from ..validation import clean_config_name

router = APIRouter()


@router.get("/mood-schedules", response_model=list[MoodSchedule])
def list_mood_schedules() -> list[MoodSchedule]:
    return MOOD_SCHEDULER.list_schedules()


@router.post("/mood-schedules", response_model=MoodSchedule)
def create_mood_schedule(payload: MoodScheduleCreateRequest) -> MoodSchedule:
    try:
        cleaned_mood_name = clean_config_name(payload.moodName)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        ensure_mood_config_exists(cleaned_mood_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    group_id = payload.groupId
    if group_id and get_group_by_id(group_id) is None:
        raise HTTPException(status_code=404, detail="Group not found")

    try:
        return MOOD_SCHEDULER.add_schedule(
            mood_name=cleaned_mood_name,
            group_id=group_id,
            time_of_day=payload.timeOfDay,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/mood-schedules/{schedule_id}", response_model=MoodSchedule)
def update_mood_schedule(
    schedule_id: str, payload: MoodScheduleUpdateRequest
) -> MoodSchedule:
    mood_name: str | None = None
    if payload.moodName is not None:
        try:
            mood_name = clean_config_name(payload.moodName)
            ensure_mood_config_exists(mood_name)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

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
            time_of_day=payload.timeOfDay,
            enabled=payload.enabled,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if updated is None:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return updated


@router.delete("/mood-schedules/{schedule_id}", response_model=DeleteScheduleResponse)
def delete_mood_schedule(schedule_id: str) -> DeleteScheduleResponse:
    deleted = MOOD_SCHEDULER.delete_schedule(schedule_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Schedule not found")
    return DeleteScheduleResponse(status="deleted", id=schedule_id)
