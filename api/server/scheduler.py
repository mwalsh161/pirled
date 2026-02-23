from __future__ import annotations

import heapq
import json
import pathlib
import threading
import time
import uuid
from collections.abc import Callable

from pydantic import BaseModel, ConfigDict, Field

MIN_INTERVAL_SECONDS = 60


class ApplyReport(BaseModel):
    model_config = ConfigDict(frozen=True)

    successCount: int = 0
    failureCount: int = 0
    failures: list[str] = Field(default_factory=list)


class MoodSchedule(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    moodName: str
    groupId: str | None = None
    intervalSeconds: int = Field(ge=MIN_INTERVAL_SECONDS)
    nextRunAt: int
    enabled: bool
    createdAt: int
    updatedAt: int
    lastRunAt: int | None = None
    lastResult: ApplyReport | None = None


class MoodScheduler:
    def __init__(
        self,
        schedules_file: pathlib.Path,
        runner: Callable[[MoodSchedule], ApplyReport],
    ) -> None:
        self._schedules_file = schedules_file
        self._runner = runner
        self._schedules_by_id: dict[str, MoodSchedule] = {}
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
            return [
                schedule
                for schedule in sorted(
                    self._schedules_by_id.values(),
                    key=lambda schedule: (schedule.nextRunAt, schedule.id),
                )
            ]

    def add_schedule(
        self,
        *,
        mood_name: str,
        group_id: str | None,
        interval_seconds: int,
        first_run_at: int | None,
        enabled: bool,
    ) -> MoodSchedule:
        interval_seconds = self._validate_interval_seconds(interval_seconds)
        now = int(time.time())
        next_run = first_run_at if first_run_at is not None else now + interval_seconds
        if next_run <= now:
            next_run = now + interval_seconds

        schedule = MoodSchedule(
            id=f"{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}",
            moodName=mood_name,
            groupId=group_id,
            intervalSeconds=interval_seconds,
            nextRunAt=next_run,
            enabled=enabled,
            createdAt=now,
            updatedAt=now,
        )

        with self._condition:
            self._schedules_by_id[schedule.id] = schedule
            if schedule.enabled:
                heapq.heappush(self._heap, (schedule.nextRunAt, schedule.id))
            self._persist_locked()
            self._condition.notify_all()
            return schedule

    def update_schedule(
        self,
        schedule_id: str,
        *,
        mood_name: str | None,
        group_id: str | None,
        group_id_set: bool,
        interval_seconds: int | None,
        next_run_at: int | None,
        enabled: bool | None,
    ) -> MoodSchedule | None:
        with self._condition:
            schedule = self._schedules_by_id.get(schedule_id)
            if schedule is None:
                return None

            update_fields: dict[str, str | int | bool | None] = {}
            if mood_name is not None:
                update_fields["moodName"] = mood_name
            if group_id_set:
                update_fields["groupId"] = group_id
            if interval_seconds is not None:
                update_fields["intervalSeconds"] = self._validate_interval_seconds(
                    interval_seconds
                )
            if next_run_at is not None:
                update_fields["nextRunAt"] = next_run_at
            if enabled is not None:
                update_fields["enabled"] = enabled

            updated_schedule = schedule.model_copy(update=update_fields)
            now = int(time.time())
            if updated_schedule.nextRunAt <= now:
                updated_schedule = updated_schedule.model_copy(
                    update={"nextRunAt": now + updated_schedule.intervalSeconds}
                )
            updated_schedule = updated_schedule.model_copy(update={"updatedAt": now})
            self._schedules_by_id[schedule_id] = updated_schedule

            self._rebuild_heap_locked()
            self._persist_locked()
            self._condition.notify_all()
            return updated_schedule

    def delete_schedule(self, schedule_id: str) -> bool:
        with self._condition:
            if schedule_id not in self._schedules_by_id:
                return False
            del self._schedules_by_id[schedule_id]
            self._rebuild_heap_locked()
            self._persist_locked()
            # No need to notify here. If anything next wake will not run anything.
            return True

    def _validate_interval_seconds(self, value: int) -> int:
        if value < MIN_INTERVAL_SECONDS:
            raise ValueError(f"intervalSeconds must be >= {MIN_INTERVAL_SECONDS}")
        return value

    def _run_loop(self) -> None:
        while True:
            due_schedules: list[MoodSchedule] = []
            with self._condition:
                if self._stopped:
                    return

                now = int(time.time())
                while self._heap and self._heap[0][0] <= now:
                    due_at, schedule_id = heapq.heappop(self._heap)
                    schedule = self._schedules_by_id.get(schedule_id)
                    if schedule is None or not schedule.enabled:
                        continue
                    if schedule.nextRunAt != due_at:
                        continue

                    next_run_at = self._compute_next_run(
                        due_at=due_at,
                        now=now,
                        interval_seconds=schedule.intervalSeconds,
                    )
                    updated_schedule = schedule.model_copy(
                        update={"nextRunAt": next_run_at, "updatedAt": now}
                    )
                    self._schedules_by_id[schedule_id] = updated_schedule
                    due_schedules.append(updated_schedule)
                    heapq.heappush(
                        self._heap, (updated_schedule.nextRunAt, schedule_id)
                    )

                if due_schedules:
                    self._persist_locked()
                else:
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

    def _compute_next_run(self, *, due_at: int, now: int, interval_seconds: int) -> int:
        next_run = due_at + interval_seconds
        while next_run <= now:
            next_run += interval_seconds
        return next_run

    def _load_locked(self) -> None:
        self._schedules_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            payload: list = json.loads(self._schedules_file.read_text())
        except Exception:
            payload = []

        loaded: dict[str, MoodSchedule] = {}
        for item in payload:
            try:
                parsed = MoodSchedule.model_validate(item)
            except Exception:
                continue
            loaded[parsed.id] = parsed

        self._schedules_by_id = loaded
        self._rebuild_heap_locked()

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
        self._heap = [
            (schedule.nextRunAt, schedule.id)
            for schedule in self._schedules_by_id.values()
            if schedule.enabled
        ]
        heapq.heapify(self._heap)
