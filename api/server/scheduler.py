from __future__ import annotations

import heapq
import json
import pathlib
import re
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

_TIME_OF_DAY_PATTERN = re.compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


class ApplyReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    successCount: int = 0
    failureCount: int = 0
    failures: list[str] = Field(default_factory=list)


class _StoredMoodSchedule(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    moodName: str
    groupId: str | None = None
    timeOfDay: str
    enabled: bool
    createdAt: int
    updatedAt: int
    lastRunAt: int | None = None
    lastResult: ApplyReport | None = None

    @field_validator("timeOfDay")
    @classmethod
    def _validate_time_of_day(cls, value: str) -> str:
        return _validate_time_of_day_value(value)


class MoodSchedule(_StoredMoodSchedule):
    nextRunAt: int


_STORED_SCHEDULE_FIELDS = set(_StoredMoodSchedule.model_fields)


def _validate_time_of_day_value(value: str) -> str:
    if not isinstance(value, str):
        raise ValueError("timeOfDay must use HH:MM 24-hour format")
    if _TIME_OF_DAY_PATTERN.fullmatch(value) is None:
        raise ValueError("timeOfDay must use HH:MM 24-hour format")
    return value


def _compute_next_run_at(*, time_of_day: str, now: int) -> int:
    hour_text, minute_text = _validate_time_of_day_value(time_of_day).split(":")
    current = datetime.fromtimestamp(now)
    candidate_datetime = current.replace(
        hour=int(hour_text),
        minute=int(minute_text),
        second=0,
        microsecond=0,
    )
    candidate = int(candidate_datetime.timestamp())
    if candidate <= now:
        next_date = current.date() + timedelta(days=1)
        candidate_datetime = datetime.combine(
            next_date,
            candidate_datetime.time(),
        )
        candidate = int(candidate_datetime.timestamp())
    return candidate


def _with_next_run(
    schedule: _StoredMoodSchedule,
    *,
    next_run_at: int | None = None,
    now: int | None = None,
) -> MoodSchedule:
    if next_run_at is None:
        if now is None:
            now = int(time.time())
        next_run_at = _compute_next_run_at(time_of_day=schedule.timeOfDay, now=now)
    return MoodSchedule(
        **schedule.model_dump(mode="python"),
        nextRunAt=next_run_at,
    )


class MoodScheduler:
    def __init__(
        self,
        schedules_file: pathlib.Path,
        runner: Callable[[MoodSchedule], ApplyReport],
    ) -> None:
        self._schedules_file = schedules_file
        self._runner = runner
        self._schedules_by_id: dict[str, _StoredMoodSchedule] = {}
        self._heap: list[tuple[int, str]] = []
        self._condition = threading.Condition()
        self._thread = threading.Thread(target=self._run_loop, daemon=True)
        self._started = False
        self._stopped = False

    def start(self) -> None:
        with self._condition:
            if self._started:
                return
            self._load_locked()
            self._started = True
            self._thread.start()

    def stop(self) -> None:
        with self._condition:
            if not self._started or self._stopped:
                return
            self._stopped = True
            self._condition.notify_all()
        self._thread.join(timeout=2)

    def list_schedules(self) -> list[MoodSchedule]:
        with self._condition:
            now = int(time.time())
            return [
                _with_next_run(schedule, now=now)
                for schedule in sorted(
                    self._schedules_by_id.values(),
                    key=lambda schedule: (
                        _compute_next_run_at(time_of_day=schedule.timeOfDay, now=now),
                        schedule.id,
                    ),
                )
            ]

    def add_schedule(
        self,
        *,
        mood_name: str,
        group_id: str | None,
        time_of_day: str,
        enabled: bool,
    ) -> MoodSchedule:
        time_of_day = _validate_time_of_day_value(time_of_day)
        now = int(time.time())
        next_run_at = _compute_next_run_at(time_of_day=time_of_day, now=now)

        schedule = _StoredMoodSchedule(
            id=f"{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}",
            moodName=mood_name,
            groupId=group_id,
            timeOfDay=time_of_day,
            enabled=enabled,
            createdAt=now,
            updatedAt=now,
        )

        with self._condition:
            self._schedules_by_id[schedule.id] = schedule
            if schedule.enabled:
                heapq.heappush(self._heap, (next_run_at, schedule.id))
            self._persist_locked()
            self._condition.notify_all()
            return _with_next_run(schedule, next_run_at=next_run_at)

    def update_schedule(
        self,
        schedule_id: str,
        *,
        mood_name: str | None,
        group_id: str | None,
        group_id_set: bool,
        time_of_day: str | None,
        enabled: bool | None,
    ) -> MoodSchedule | None:
        with self._condition:
            schedule = self._schedules_by_id.get(schedule_id)
            if schedule is None:
                return None

            update_fields: dict[str, str | bool | None] = {}
            if mood_name is not None:
                update_fields["moodName"] = mood_name
            if group_id_set:
                update_fields["groupId"] = group_id
            if time_of_day is not None:
                update_fields["timeOfDay"] = _validate_time_of_day_value(time_of_day)
            if enabled is not None:
                update_fields["enabled"] = enabled

            updated_schedule = schedule.model_copy(update=update_fields)
            now = int(time.time())
            updated_schedule = updated_schedule.model_copy(update={"updatedAt": now})
            self._schedules_by_id[schedule_id] = updated_schedule

            self._rebuild_heap_locked()
            self._persist_locked()
            self._condition.notify_all()
            return _with_next_run(updated_schedule, now=now)

    def delete_schedule(self, schedule_id: str) -> bool:
        with self._condition:
            if schedule_id not in self._schedules_by_id:
                return False
            del self._schedules_by_id[schedule_id]
            self._rebuild_heap_locked()
            self._persist_locked()
            # No need to notify here. If anything next wake will not run anything.
            return True

    def _run_loop(self) -> None:
        while True:
            due_schedules: list[MoodSchedule] = []
            with self._condition:
                if self._stopped:
                    return

                now = int(time.time())
                while self._heap and self._heap[0][0] <= now:
                    _, schedule_id = heapq.heappop(self._heap)
                    schedule = self._schedules_by_id.get(schedule_id)
                    if schedule is None or not schedule.enabled:
                        continue

                    next_run_at = _compute_next_run_at(
                        time_of_day=schedule.timeOfDay,
                        now=now,
                    )
                    due_schedules.append(
                        _with_next_run(schedule, next_run_at=next_run_at)
                    )
                    heapq.heappush(self._heap, (next_run_at, schedule_id))

                if not due_schedules:
                    timeout: float | None = None
                    if self._heap:
                        timeout = max(0.0, self._heap[0][0] - time.time())
                    self._condition.wait(timeout=timeout)
                    continue

            for due_schedule in due_schedules:
                report = self._run_schedule(due_schedule)
                completed_at = int(time.time())
                with self._condition:
                    current = self._schedules_by_id.get(due_schedule.id)
                    if current is None:
                        continue
                    self._schedules_by_id[due_schedule.id] = current.model_copy(
                        update={
                            "lastRunAt": completed_at,
                            "lastResult": report,
                            "updatedAt": completed_at,
                        }
                    )
                    self._persist_locked()

    def _run_schedule(self, schedule: MoodSchedule) -> ApplyReport:
        try:
            return self._runner(schedule)
        except Exception as exc:
            return ApplyReport(successCount=0, failureCount=1, failures=[str(exc)])

    def _load_locked(self) -> None:
        self._schedules_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            payload: list = json.loads(self._schedules_file.read_text())
        except Exception:
            payload = []

        loaded: dict[str, _StoredMoodSchedule] = {}
        changed = False
        for item in payload:
            try:
                parsed = _StoredMoodSchedule.model_validate(item)
            except Exception:
                changed = True
                continue
            if (
                isinstance(item, dict)
                and set(item.keys()).difference(_STORED_SCHEDULE_FIELDS)
            ):
                changed = True
            loaded[parsed.id] = parsed

        self._schedules_by_id = loaded
        self._rebuild_heap_locked()
        if changed:
            self._persist_locked()

    def _persist_locked(self) -> None:
        payload = [
            schedule.model_dump(mode="json")
            for schedule in sorted(
                self._schedules_by_id.values(),
                key=lambda schedule: (schedule.createdAt, schedule.id),
            )
        ]
        self._schedules_file.write_text(json.dumps(payload, indent=2))

    def _rebuild_heap_locked(self) -> None:
        now = int(time.time())
        self._heap = [
            (
                _compute_next_run_at(time_of_day=schedule.timeOfDay, now=now),
                schedule.id,
            )
            for schedule in self._schedules_by_id.values()
            if schedule.enabled
        ]
        heapq.heapify(self._heap)
