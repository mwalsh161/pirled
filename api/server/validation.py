from __future__ import annotations

import re

from .config import DISPLAY_TEXT_MAX_LENGTH

VALID_NAME_PATTERN = re.compile(r"[^a-zA-Z0-9_-]")


def clean_config_name(name: str) -> str:
    normalized = re.sub(r"\s+", "_", name.strip())
    cleaned = VALID_NAME_PATTERN.sub("", normalized)
    if not cleaned:
        raise ValueError(
            "Config name must contain at least one alphanumeric character"
        )
    return cleaned


def normalize_label(label: str) -> str:
    return label.strip()


def clean_display_text(
    value: str,
    *,
    field_name: str,
    enforce_charset: bool,
    allow_empty: bool,
) -> str:
    trimmed = value.strip()
    if len(trimmed) > DISPLAY_TEXT_MAX_LENGTH:
        raise ValueError(
            f"'{field_name}' must be at most {DISPLAY_TEXT_MAX_LENGTH} characters"
        )
    if enforce_charset and VALID_NAME_PATTERN.search(trimmed):
        raise ValueError(
            f"'{field_name}' may only contain letters, numbers, dash, and underscore"
        )
    if not allow_empty and not trimmed:
        raise ValueError(f"'{field_name}' must not be empty")
    return trimmed


def clean_device_alias(value: str) -> str:
    return clean_display_text(
        value,
        field_name="alias",
        enforce_charset=False,
        allow_empty=True,
    )


def clean_led_label(label: str) -> str:
    return clean_display_text(
        label,
        field_name="ledNames entry",
        enforce_charset=True,
        allow_empty=True,
    )


def clean_mood_assignment_label(label: str) -> str:
    return clean_display_text(
        label,
        field_name="Mood assignment label",
        enforce_charset=True,
        allow_empty=False,
    )
