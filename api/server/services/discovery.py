from __future__ import annotations

import socket
import threading
import time

from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

from ..config import DEVICE_NAME_PREFIX, MDNS_SERVICE_TYPE
from ..schemas import (
    DeviceCacheResponse,
    KnownDeviceResponse,
    ResolvedDeviceResponse,
    ResolveFailureResponse,
)
from ..stores.metadata_store import load_metadata, metadata_alias_value

DISCOVERED_SERVICES: set[tuple[str, str]] = {
    ("_http._tcp.local.", "pirled-7BF498._http._tcp.local."),
    ("_http._tcp.local.", "pirled-5EE086._http._tcp.local."),
}
SERVICE_BY_DEVICE_NAME: dict[str, tuple[str, str]] = {}
RESOLVED_DEVICE_BY_NAME: dict[str, dict[str, object]] = {}
RESOLVE_FAILURE_BY_NAME: dict[str, str] = {}
DEVICE_CACHE_REFRESHED_AT: int | None = None
DISCOVERY_STATE_LOCK = threading.Lock()
DISCOVERY_START_LOCK = threading.Lock()
MDNS_BROWSER: ServiceBrowser | None = None
zc: Zeroconf | None = None


class _MDNSListener(ServiceListener):
    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        _register_discovered_service(type_, name)

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        _unregister_discovered_service(type_, name)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        _register_discovered_service(type_, name)


def _device_name_from_service_name(service_name: str) -> str:
    return service_name.split(".", maxsplit=1)[0]


def _register_discovered_service(type_: str, service_name: str) -> str | None:
    if not service_name.startswith(DEVICE_NAME_PREFIX):
        return None
    device_name = _device_name_from_service_name(service_name)
    with DISCOVERY_STATE_LOCK:
        DISCOVERED_SERVICES.add((type_, service_name))
        SERVICE_BY_DEVICE_NAME[device_name] = (type_, service_name)
    return device_name


def _unregister_discovered_service(type_: str, service_name: str) -> None:
    device_name = _device_name_from_service_name(service_name)
    with DISCOVERY_STATE_LOCK:
        DISCOVERED_SERVICES.discard((type_, service_name))
        mapped_service = SERVICE_BY_DEVICE_NAME.get(device_name)
        if mapped_service == (type_, service_name):
            del SERVICE_BY_DEVICE_NAME[device_name]
            RESOLVED_DEVICE_BY_NAME.pop(device_name, None)


def sync_device_name_index_from_discovery() -> list[str]:
    with DISCOVERY_STATE_LOCK:
        service_snapshot = sorted(DISCOVERED_SERVICES)

    discovered_names: set[str] = set()
    for type_, service_name in service_snapshot:
        registered_name = _register_discovered_service(type_, service_name)
        if registered_name is not None:
            discovered_names.add(registered_name)
    return sorted(discovered_names)


def _pick_host_address(
    type_: str, service_name: str
) -> tuple[str | None, int | None, str | None]:
    if zc is None:
        return None, None, "mDNS is not initialized"
    info = zc.get_service_info(type_, service_name)
    if info is None:
        return None, None, "No mDNS service info"
    if not info.port:
        return None, None, "mDNS service missing port"

    addresses = info.parsed_addresses()
    for address in addresses:
        if ":" not in address:
            return address, int(info.port), None

    if info.server:
        try:
            return socket.gethostbyname(info.server), int(info.port), None
        except socket.gaierror:
            pass

    return None, None, "No IPv4 address found"


def _resolve_device_name(
    device_name: str,
) -> tuple[dict[str, object] | None, str | None]:
    with DISCOVERY_STATE_LOCK:
        service = SERVICE_BY_DEVICE_NAME.get(device_name)

    if service is None:
        with DISCOVERY_STATE_LOCK:
            RESOLVED_DEVICE_BY_NAME.pop(device_name, None)
        return None, "No discovered mDNS service"

    type_, service_name = service
    host, port, error = _pick_host_address(type_, service_name)
    if error is not None or host is None or port is None:
        with DISCOVERY_STATE_LOCK:
            RESOLVED_DEVICE_BY_NAME.pop(device_name, None)
        return None, error or "Unknown resolve error"

    payload: dict[str, object] = {"name": device_name, "host": host, "port": port}
    with DISCOVERY_STATE_LOCK:
        RESOLVED_DEVICE_BY_NAME[device_name] = payload
    return payload, None


def _known_device_names_from_metadata() -> set[str]:
    metadata = load_metadata()
    return {key for key in metadata.keys() if isinstance(key, str) and key.strip()}


def _resolve_target_names() -> list[str]:
    config_device_names = _known_device_names_from_metadata()
    with DISCOVERY_STATE_LOCK:
        discovered_device_names = set(SERVICE_BY_DEVICE_NAME.keys())
    return sorted(config_device_names | discovered_device_names)


def _record_resolve_result(device_name: str, error: str | None) -> None:
    with DISCOVERY_STATE_LOCK:
        if error is None:
            RESOLVE_FAILURE_BY_NAME.pop(device_name, None)
        else:
            RESOLVE_FAILURE_BY_NAME[device_name] = error


def _mark_device_cache_refreshed() -> None:
    global DEVICE_CACHE_REFRESHED_AT
    with DISCOVERY_STATE_LOCK:
        DEVICE_CACHE_REFRESHED_AT = int(time.time() * 1000)


def resolve_devices_now() -> tuple[list[dict[str, object]], list[dict[str, str]]]:
    sync_device_name_index_from_discovery()
    target_names = _resolve_target_names()
    resolved: list[dict[str, object]] = []
    failed: list[dict[str, str]] = []
    for device_name in target_names:
        payload, error = _resolve_device_name(device_name)
        if payload is not None:
            resolved.append(payload)
            _record_resolve_result(device_name, None)
        else:
            message = error or "Resolve failed"
            failed.append({"name": device_name, "error": message})
            _record_resolve_result(device_name, message)
    _mark_device_cache_refreshed()
    return resolved, failed


def resolve_device_now(device_name: str) -> tuple[dict[str, object] | None, str | None]:
    sync_device_name_index_from_discovery()
    payload, error = _resolve_device_name(device_name)
    _record_resolve_result(device_name, error)
    _mark_device_cache_refreshed()
    return payload, error


def list_resolved_devices() -> list[ResolvedDeviceResponse]:
    metadata = load_metadata()
    with DISCOVERY_STATE_LOCK:
        resolved_snapshot = [dict(entry) for entry in RESOLVED_DEVICE_BY_NAME.values()]
    resolved_payload: list[ResolvedDeviceResponse] = []
    for device in resolved_snapshot:
        device_name = device.get("name")
        host = device.get("host")
        port = device.get("port")
        if (
            not isinstance(device_name, str)
            or not isinstance(host, str)
            or not isinstance(port, int)
        ):
            continue
        alias = metadata_alias_value(metadata, device_name)
        resolved_payload.append(
            ResolvedDeviceResponse(name=device_name, alias=alias, host=host, port=port)
        )
    return sorted(
        resolved_payload,
        key=lambda device: device.name.lower(),
    )


def list_resolve_failures() -> list[ResolveFailureResponse]:
    known_names = _known_device_names_from_metadata()
    with DISCOVERY_STATE_LOCK:
        known_names.update(SERVICE_BY_DEVICE_NAME.keys())
        failures = dict(RESOLVE_FAILURE_BY_NAME)
    return [
        ResolveFailureResponse(name=name, error=error)
        for name, error in sorted(failures.items(), key=lambda item: item[0].lower())
        if name in known_names
    ]


def get_device_cache_refreshed_at() -> int | None:
    with DISCOVERY_STATE_LOCK:
        return DEVICE_CACHE_REFRESHED_AT


def list_known_devices() -> list[KnownDeviceResponse]:
    metadata = load_metadata()
    config_device_names = {
        key for key in metadata.keys() if isinstance(key, str) and key.strip()
    }
    with DISCOVERY_STATE_LOCK:
        discovered_device_names = set(SERVICE_BY_DEVICE_NAME.keys())
        resolved_snapshot = {
            name: dict(payload) for name, payload in RESOLVED_DEVICE_BY_NAME.items()
        }

    known_device_names = sorted(config_device_names | discovered_device_names)
    payload: list[KnownDeviceResponse] = []
    for device_name in known_device_names:
        payload.append(
            KnownDeviceResponse(
                name=device_name,
                alias=metadata_alias_value(metadata, device_name),
                fromConfig=device_name in config_device_names,
                discovered=device_name in discovered_device_names,
                resolved=device_name in resolved_snapshot,
            )
        )
    return payload


def get_device_cache() -> DeviceCacheResponse:
    return DeviceCacheResponse(
        known=list_known_devices(),
        resolved=list_resolved_devices(),
        failed=list_resolve_failures(),
        refreshedAt=get_device_cache_refreshed_at(),
    )


def start_mdns() -> None:
    global MDNS_BROWSER, zc
    with DISCOVERY_START_LOCK:
        if MDNS_BROWSER is not None:
            return
        if zc is None:
            zc = Zeroconf()
        MDNS_BROWSER = ServiceBrowser(zc, MDNS_SERVICE_TYPE, _MDNSListener())


def start_background_discovery() -> None:
    with DISCOVERY_START_LOCK:
        if MDNS_BROWSER is not None:
            return
    threading.Thread(target=start_mdns, daemon=True).start()
    sync_device_name_index_from_discovery()


def stop_background_discovery() -> None:
    global MDNS_BROWSER, zc
    with DISCOVERY_START_LOCK:
        if zc is not None:
            try:
                zc.close()
            except Exception:
                pass
        zc = None
        MDNS_BROWSER = None
