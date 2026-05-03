from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from .config import LED_COUNT, PIR_COUNT
from .scheduler import ApplyReport, MIN_INTERVAL_SECONDS, MoodSchedule
from .validation import (
    clean_device_alias,
    clean_led_label,
    clean_mood_assignment_label,
    normalize_label,
)


class FrozenModel(BaseModel):
    model_config = ConfigDict(frozen=True)


class MoodApplyRequest(FrozenModel):
    groupId: str | None = None


class MoodApplyStatusEntry(FrozenModel):
    appliedAt: int
    source: Literal["manual", "scheduled"]
    moodName: str
    groupId: str | None = None
    scheduleId: str | None = None
    successCount: int
    failureCount: int
    failures: list[str] = Field(default_factory=list)


class MoodApplyStatusResponse(FrozenModel):
    lastApply: MoodApplyStatusEntry | None = None


class MoodScheduleCreateRequest(FrozenModel):
    moodName: str
    groupId: str | None = None
    intervalSeconds: int = Field(ge=MIN_INTERVAL_SECONDS)
    firstRunAt: int | None = None
    enabled: bool = True


class MoodScheduleUpdateRequest(FrozenModel):
    moodName: str | None = None
    groupId: str | None = None
    intervalSeconds: int | None = Field(default=None, ge=MIN_INTERVAL_SECONDS)
    nextRunAt: int | None = None
    enabled: bool | None = None


class DeleteScheduleResponse(FrozenModel):
    status: Literal["deleted"]
    id: str


class KnownDeviceResponse(FrozenModel):
    name: str
    alias: str
    fromConfig: bool
    discovered: bool
    resolved: bool


class ResolveFailureResponse(FrozenModel):
    name: str
    error: str


class ResolvedDeviceResponse(FrozenModel):
    name: str
    alias: str
    host: str
    port: int


class DeviceCacheResponse(FrozenModel):
    known: list[KnownDeviceResponse]
    resolved: list[ResolvedDeviceResponse]
    failed: list[ResolveFailureResponse]
    refreshedAt: StrictInt | None = None


class DeviceLabelMetadataModel(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    ledNames: list[str]
    ledByPir: list[int]
    alias: str = ""

    @field_validator("ledNames")
    @classmethod
    def validate_led_names(cls, led_names: list[str]) -> list[str]:
        if len(led_names) != LED_COUNT:
            raise ValueError(f"'ledNames' must include exactly {LED_COUNT} entries")
        cleaned_led_names: list[str] = []
        seen_labels: set[str] = set()
        for led_name in led_names:
            cleaned = clean_led_label(led_name)
            if cleaned and cleaned in seen_labels:
                raise ValueError(
                    "Duplicate non-empty labels are not allowed on a device"
                )
            if cleaned:
                seen_labels.add(cleaned)
            cleaned_led_names.append(cleaned)
        return cleaned_led_names

    @field_validator("ledByPir")
    @classmethod
    def validate_led_by_pir(cls, led_by_pir: list[int]) -> list[int]:
        if len(led_by_pir) != PIR_COUNT:
            raise ValueError(f"'ledByPir' must include exactly {PIR_COUNT} entries")
        used_led_indices: set[int] = set()
        for led_index in led_by_pir:
            if led_index < 0 or led_index >= LED_COUNT:
                raise ValueError(f"'ledByPir' values must be in range 0..{LED_COUNT - 1}")
            if led_index in used_led_indices:
                raise ValueError(
                    "Each LED can only be assigned to one physical PIR default"
                )
            used_led_indices.add(led_index)
        return led_by_pir

    @field_validator("alias")
    @classmethod
    def validate_alias(cls, alias: str) -> str:
        return clean_device_alias(alias)


class UpdateDeviceLabelsResponse(FrozenModel):
    status: Literal["updated"]
    device: str


class LogicalGroupModel(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    id: str
    name: str
    labels: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        trimmed = name.strip()
        if not trimmed:
            raise ValueError("Group name is required")
        return trimmed

    @field_validator("labels")
    @classmethod
    def validate_labels(cls, labels: list[str]) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for label in labels:
            cleaned = normalize_label(label)
            if not cleaned or cleaned in seen:
                continue
            seen.add(cleaned)
            normalized.append(cleaned)
        return normalized


class CreateGroupRequest(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    labels: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def validate_name(cls, name: str) -> str:
        trimmed = name.strip()
        if not trimmed:
            raise ValueError("Group name is required")
        return trimmed


class DeleteGroupResponse(FrozenModel):
    status: Literal["deleted"]
    id: str


class LedConfigModel(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    brightness: StrictInt
    rampOnMs: StrictInt
    holdOnMs: StrictInt
    rampOffMs: StrictInt
    waitOnMs: StrictInt
    pirMaskOn: StrictInt
    pirMaskOff: StrictInt

    def to_api_dict(self) -> dict[str, int]:
        return {
            "brightness": self.brightness,
            "rampOnMs": self.rampOnMs,
            "holdOnMs": self.holdOnMs,
            "rampOffMs": self.rampOffMs,
            "waitOnMs": self.waitOnMs,
            "pirMaskOn": self.pirMaskOn,
            "pirMaskOff": self.pirMaskOff,
        }


def normalize_assignment_map(
    assignments: dict[str, LedConfigModel],
) -> dict[str, LedConfigModel]:
    if not assignments:
        raise ValueError("Mood must include at least one assignment")
    normalized: dict[str, LedConfigModel] = {}
    for raw_label, config in assignments.items():
        cleaned_label = clean_mood_assignment_label(raw_label)
        normalized[cleaned_label] = config
    return normalized


class SaveMoodConfigRequest(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    description: str = ""
    timestamp: StrictInt | None = None
    assignments: dict[str, LedConfigModel]

    @field_validator("description")
    @classmethod
    def validate_description(cls, description: str) -> str:
        return description.strip()

    @field_validator("assignments")
    @classmethod
    def validate_assignments(
        cls, assignments: dict[str, LedConfigModel]
    ) -> dict[str, LedConfigModel]:
        return normalize_assignment_map(assignments)


class MoodConfigResponse(FrozenModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    name: str
    description: str = ""
    timestamp: StrictInt
    assignments: dict[str, LedConfigModel]

    @field_validator("assignments")
    @classmethod
    def validate_assignments(
        cls, assignments: dict[str, LedConfigModel]
    ) -> dict[str, LedConfigModel]:
        return normalize_assignment_map(assignments)


class MoodConfigSummaryResponse(FrozenModel):
    name: str
    timestamp: int | None = None
    description: str = ""


class MoodNamedStatusResponse(FrozenModel):
    status: Literal["saved", "deleted"]
    name: str


def assignments_to_api_dict(
    assignments: dict[str, LedConfigModel],
) -> dict[str, dict[str, int]]:
    return {label: config.to_api_dict() for label, config in assignments.items()}


__all__ = [
    "ApplyReport",
    "MoodSchedule",
    "MoodApplyRequest",
    "MoodApplyStatusEntry",
    "MoodApplyStatusResponse",
    "MoodScheduleCreateRequest",
    "MoodScheduleUpdateRequest",
    "DeleteScheduleResponse",
    "KnownDeviceResponse",
    "ResolveFailureResponse",
    "ResolvedDeviceResponse",
    "DeviceCacheResponse",
    "DeviceLabelMetadataModel",
    "UpdateDeviceLabelsResponse",
    "LogicalGroupModel",
    "CreateGroupRequest",
    "DeleteGroupResponse",
    "LedConfigModel",
    "SaveMoodConfigRequest",
    "MoodConfigResponse",
    "MoodConfigSummaryResponse",
    "MoodNamedStatusResponse",
    "assignments_to_api_dict",
]
