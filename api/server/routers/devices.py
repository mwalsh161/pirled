from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import (
    DeviceCacheResponse,
    DeviceLabelMetadataModel,
    UpdateDeviceLabelsResponse,
)
from ..services.discovery import (
    get_device_cache,
    resolve_device_now,
    resolve_devices_now,
)
from ..stores.metadata_store import (
    default_device_label_metadata,
    gather_global_labels,
    load_metadata,
    parse_stored_device_label_metadata,
    write_device_metadata,
)

router = APIRouter()


@router.get("/devices/cache", response_model=DeviceCacheResponse)
def get_devices_cache() -> DeviceCacheResponse:
    return get_device_cache()


@router.post("/devices/cache/refresh", response_model=DeviceCacheResponse)
def refresh_devices_cache() -> DeviceCacheResponse:
    resolve_devices_now()
    return get_device_cache()


@router.post("/devices/{device_name}/resolve", response_model=DeviceCacheResponse)
def resolve_device(device_name: str) -> DeviceCacheResponse:
    resolve_device_now(device_name)
    return get_device_cache()


@router.get("/devices/{device_name}/led-names", response_model=DeviceLabelMetadataModel)
def get_led_names(device_name: str) -> DeviceLabelMetadataModel:
    metadata = load_metadata()

    if device_name not in metadata:
        return default_device_label_metadata()

    parsed = parse_stored_device_label_metadata(metadata[device_name])
    if parsed is None:
        return default_device_label_metadata()

    return parsed


@router.post(
    "/devices/{device_name}/led-names", response_model=UpdateDeviceLabelsResponse
)
def update_led_names(
    device_name: str, data: DeviceLabelMetadataModel
) -> UpdateDeviceLabelsResponse:
    metadata = load_metadata()

    labels_on_other_devices = gather_global_labels(
        metadata, exclude_device_name=device_name
    )
    duplicate_global_labels = sorted(
        {label for label in data.ledNames if label and label in labels_on_other_devices}
    )
    if duplicate_global_labels:
        raise HTTPException(
            status_code=400,
            detail=(
                "Non-empty labels must be globally unique across devices. "
                f"Conflicts: {', '.join(duplicate_global_labels)}"
            ),
        )

    write_device_metadata(device_name, data)
    return UpdateDeviceLabelsResponse(status="updated", device=device_name)
