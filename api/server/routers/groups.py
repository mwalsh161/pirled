from __future__ import annotations

import time
import uuid

from fastapi import APIRouter, HTTPException

from ..schemas import (
    CreateGroupRequest,
    DeleteGroupResponse,
    LogicalGroupModel,
)
from ..stores.groups_store import load_groups, save_groups

router = APIRouter()


@router.get("/groups", response_model=list[LogicalGroupModel])
def list_groups() -> list[LogicalGroupModel]:
    groups = load_groups()
    return sorted(groups, key=lambda group: group.name.lower())


@router.post("/groups", response_model=LogicalGroupModel)
def create_group(payload: CreateGroupRequest) -> LogicalGroupModel:
    next_group = LogicalGroupModel(
        id=f"{int(time.time() * 1000):x}_{uuid.uuid4().hex[:6]}",
        name=payload.name,
        labels=payload.labels,
    )

    groups = load_groups()
    groups.append(next_group)
    save_groups(sorted(groups, key=lambda group: group.name.lower()))
    return next_group


@router.delete("/groups/{group_id}", response_model=DeleteGroupResponse)
def delete_group(group_id: str) -> DeleteGroupResponse:
    groups = load_groups()
    filtered = [group for group in groups if group.id != group_id]
    if len(filtered) == len(groups):
        raise HTTPException(status_code=404, detail="Group not found")
    save_groups(sorted(filtered, key=lambda group: group.name.lower()))
    return DeleteGroupResponse(status="deleted", id=group_id)
