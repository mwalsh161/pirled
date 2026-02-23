from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..schemas import (
    DeviceLabelMetadataModel,
    DiscoverDevicesResponse,
    KnownDeviceResponse,
    ResolveDevicesResponse,
    ResolveFailureResponse,
    UpdateDeviceLabelsResponse,
)
from ..services.discovery import (
    list_known_devices,
    list_resolved_devices,
    resolve_devices_now,
    sync_device_name_index_from_discovery,
)
from ..stores.metadata_store import (
    default_device_label_metadata,
    gather_global_labels,
    load_metadata,
    parse_stored_device_label_metadata,
    write_device_metadata,
)

router = APIRouter()


@router.get("/devices")
def get_devices() -> list[KnownDeviceResponse]:
    return list_known_devices()


@router.post("/devices/discover", response_model=DiscoverDevicesResponse)
def discover_devices() -> DiscoverDevicesResponse:
    discovered_names = sync_device_name_index_from_discovery()
    return DiscoverDevicesResponse(status="ok", discovered=discovered_names)


@router.post("/devices/resolve", response_model=ResolveDevicesResponse)
def resolve_devices() -> ResolveDevicesResponse:
    _, failed = resolve_devices_now()
    resolved = list_resolved_devices()
    return ResolveDevicesResponse(
        status="ok",
        requestedCount=len(resolved) + len(failed),
        resolved=resolved,
        failed=[ResolveFailureResponse.model_validate(item) for item in failed],
    )


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
