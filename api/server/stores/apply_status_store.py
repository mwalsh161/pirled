from __future__ import annotations

import json
import threading
import time
from typing import Literal

from ..config import MOOD_APPLY_STATUS_FILE
from ..scheduler import ApplyReport
from ..schemas import MoodApplyStatusEntry, MoodApplyStatusResponse

_APPLY_STATUS_LOCK = threading.Lock()


def _load_apply_status_state() -> MoodApplyStatusResponse:
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
    with _APPLY_STATUS_LOCK:
        return _load_apply_status_state()


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
    with _APPLY_STATUS_LOCK:
        MOOD_APPLY_STATUS_FILE.write_text(
            json.dumps(payload.model_dump(mode="json"), indent=2)
        )
        return payload
