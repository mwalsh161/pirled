from __future__ import annotations

import json

from ..config import GROUPS_FILE
from ..schemas import LogicalGroupModel


def load_groups() -> list[LogicalGroupModel]:
    if not GROUPS_FILE.exists():
        return []
    try:
        payload = json.loads(GROUPS_FILE.read_text())
    except Exception:
        return []

    if not isinstance(payload, list):
        return []

    parsed_groups: list[LogicalGroupModel] = []
    for item in payload:
        try:
            parsed_group = LogicalGroupModel.model_validate(item)
        except Exception:
            continue
        parsed_groups.append(parsed_group)
    return parsed_groups


def save_groups(groups: list[LogicalGroupModel]) -> None:
    GROUPS_FILE.write_text(
        json.dumps(
            [group.model_dump(mode="json") for group in groups],
            indent=2,
        )
    )


def get_group_by_id(group_id: str) -> LogicalGroupModel | None:
    for group in load_groups():
        if group.id == group_id:
            return group
    return None
