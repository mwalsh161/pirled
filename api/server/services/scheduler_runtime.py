from __future__ import annotations

from ..config import MOOD_SCHEDULES_FILE
from ..scheduler import MoodScheduler
from .mood_apply import run_scheduled_mood_apply

MOOD_SCHEDULER = MoodScheduler(MOOD_SCHEDULES_FILE, run_scheduled_mood_apply)
