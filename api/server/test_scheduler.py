from __future__ import annotations

import json
import os
import tempfile
import threading
import time
import unittest
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from .schemas import MoodScheduleCreateRequest, MoodScheduleUpdateRequest
from .scheduler import (
    ApplyReport,
    MoodSchedule,
    MoodScheduler,
    _compute_next_run_at,
    _validate_time_of_day_value,
)


@contextmanager
def local_timezone(name: str) -> Iterator[None]:
    if not hasattr(time, "tzset"):
        raise unittest.SkipTest("time.tzset is not available")

    previous = os.environ.get("TZ")
    os.environ["TZ"] = name
    time.tzset()
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("TZ", None)
        else:
            os.environ["TZ"] = previous
        time.tzset()


def local_timestamp(
    *,
    days_from_today: int = 0,
    hour: int,
    minute: int,
    reference: datetime | None = None,
) -> int:
    base = reference or datetime.fromtimestamp(time.time())
    target = (base + timedelta(days=days_from_today)).replace(
        hour=hour,
        minute=minute,
        second=0,
        microsecond=0,
    )
    return int(target.timestamp())


class MoodSchedulerTest(unittest.TestCase):
    def test_validate_time_of_day_accepts_24_hour_time(self) -> None:
        self.assertEqual(_validate_time_of_day_value("00:00"), "00:00")
        self.assertEqual(_validate_time_of_day_value("23:59"), "23:59")

    def test_validate_time_of_day_rejects_invalid_values(self) -> None:
        for value in ["7:00", "24:00", "12:60", "12:30:00", "nope"]:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    _validate_time_of_day_value(value)

    def test_schedule_requests_reject_legacy_fields(self) -> None:
        with self.assertRaises(ValidationError):
            MoodScheduleCreateRequest(
                moodName="Evening",
                groupId=None,
                timeOfDay="19:00",
                enabled=True,
                intervalSeconds=300,
            )

        with self.assertRaises(ValidationError):
            MoodScheduleUpdateRequest(nextRunAt=1)

    def test_schedule_keeps_time_of_day_as_24_hour_time(self) -> None:
        schedule = MoodSchedule(
            id="schedule",
            moodName="Evening",
            groupId=None,
            timeOfDay="23:59",
            nextRunAt=1,
            enabled=True,
            createdAt=1,
            updatedAt=1,
        )

        self.assertEqual(schedule.timeOfDay, "23:59")
        self.assertEqual(schedule.model_dump(mode="json")["timeOfDay"], "23:59")

    def test_create_schedule_uses_today_when_time_is_future(self) -> None:
        now = local_timestamp(hour=12, minute=0)
        expected_next_run = local_timestamp(hour=13, minute=30)
        with tempfile.TemporaryDirectory() as temp_dir:
            scheduler = MoodScheduler(
                Path(temp_dir) / "schedules.json", lambda _: ApplyReport()
            )
            with patch("api.server.scheduler.time.time", return_value=now):
                schedule = scheduler.add_schedule(
                    mood_name="Evening",
                    group_id=None,
                    time_of_day="13:30",
                    enabled=True,
                )

        self.assertEqual(schedule.nextRunAt, expected_next_run)

    def test_create_schedule_uses_tomorrow_when_time_has_passed(self) -> None:
        now = local_timestamp(hour=12, minute=0)
        expected_next_run = local_timestamp(days_from_today=1, hour=8, minute=15)
        with tempfile.TemporaryDirectory() as temp_dir:
            scheduler = MoodScheduler(
                Path(temp_dir) / "schedules.json", lambda _: ApplyReport()
            )
            with patch("api.server.scheduler.time.time", return_value=now):
                schedule = scheduler.add_schedule(
                    mood_name="Morning",
                    group_id=None,
                    time_of_day="08:15",
                    enabled=True,
                )

        self.assertEqual(schedule.nextRunAt, expected_next_run)

    def test_create_schedule_does_not_persist_next_run(self) -> None:
        now = local_timestamp(hour=12, minute=0)
        with tempfile.TemporaryDirectory() as temp_dir:
            schedules_file = Path(temp_dir) / "schedules.json"
            scheduler = MoodScheduler(schedules_file, lambda _: ApplyReport())
            with patch("api.server.scheduler.time.time", return_value=now):
                scheduler.add_schedule(
                    mood_name="Evening",
                    group_id=None,
                    time_of_day="13:30",
                    enabled=True,
                )

            persisted_payload = json.loads(schedules_file.read_text())

        self.assertNotIn("nextRunAt", persisted_payload[0])

    def test_next_run_keeps_local_wall_time_across_dst_transition(self) -> None:
        with local_timezone("America/Los_Angeles"):
            now = int(datetime(2026, 3, 7, 20, 0).timestamp())
            expected_next_run = int(datetime(2026, 3, 8, 19, 0).timestamp())

            next_run = _compute_next_run_at(
                time_of_day="19:00",
                now=now,
            )

        self.assertEqual(next_run, expected_next_run)

    def test_load_computes_next_run_without_running_schedule(self) -> None:
        now = local_timestamp(hour=12, minute=0)
        expected_next_run = local_timestamp(days_from_today=1, hour=8, minute=15)
        calls: list[MoodSchedule] = []

        with tempfile.TemporaryDirectory() as temp_dir:
            schedules_file = Path(temp_dir) / "schedules.json"
            schedules_file.write_text(
                json.dumps(
                    [
                        {
                            "id": "stale",
                            "moodName": "Morning",
                            "groupId": None,
                            "timeOfDay": "08:15",
                            "enabled": True,
                            "createdAt": 1,
                            "updatedAt": 1,
                            "lastRunAt": None,
                            "lastResult": None,
                        }
                    ]
                )
            )
            scheduler = MoodScheduler(
                schedules_file,
                lambda schedule: calls.append(schedule) or ApplyReport(),
            )

            with scheduler._condition:
                with patch("api.server.scheduler.time.time", return_value=now):
                    scheduler._load_locked()

            loaded = scheduler.list_schedules()

        self.assertEqual(calls, [])
        self.assertEqual(len(loaded), 1)
        self.assertEqual(loaded[0].nextRunAt, expected_next_run)
        self.assertIsNone(loaded[0].lastRunAt)

    def test_run_loop_records_result_and_advances_to_tomorrow(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            due_at = int(datetime(2026, 1, 1, 12, 1).timestamp())
            time_of_day = datetime.fromtimestamp(due_at).strftime("%H:%M")
            expected_next_run = _compute_next_run_at(
                time_of_day=time_of_day,
                now=due_at,
            )
            schedules_file = Path(temp_dir) / "schedules.json"
            schedules_file.write_text(
                json.dumps(
                    [
                        {
                            "id": "due",
                            "moodName": "Evening",
                            "groupId": None,
                            "timeOfDay": time_of_day,
                            "enabled": True,
                            "createdAt": due_at - 10,
                            "updatedAt": due_at - 10,
                            "lastRunAt": None,
                            "lastResult": None,
                        }
                    ]
                )
            )
            ran = threading.Event()

            def run_schedule(_: MoodSchedule) -> ApplyReport:
                ran.set()
                return ApplyReport(successCount=2)

            scheduler = MoodScheduler(schedules_file, run_schedule)
            call_count = 0

            def controlled_time() -> int:
                nonlocal call_count
                call_count += 1
                if call_count <= 2:
                    return due_at - 1
                return due_at

            try:
                with patch("api.server.scheduler.time.time", side_effect=controlled_time):
                    scheduler.start()
                    self.assertTrue(ran.wait(timeout=5))

                    deadline = time.monotonic() + 2
                    while time.monotonic() < deadline:
                        updated = scheduler.list_schedules()[0]
                        if updated.lastRunAt is not None:
                            break
                        time.sleep(0.01)
                    else:
                        self.fail("Scheduler did not record run completion")
            finally:
                scheduler.stop()

        self.assertEqual(updated.nextRunAt, expected_next_run)
        self.assertIsNotNone(updated.lastRunAt)
        self.assertEqual(updated.lastResult, ApplyReport(successCount=2))


if __name__ == "__main__":
    unittest.main()
