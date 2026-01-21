import dataclasses
import threading

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

app = FastAPI()

# -----------------------------
# mDNS discovery
# -----------------------------


@dataclasses.dataclass(frozen=True, slots=True)
class Device:
    host: str
    port: int
    name: str


DEVICES: list[Device] = []


class MDNSListener(ServiceListener):
    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        if not name.startswith("pirled-controller."):
            return
        info = zc.get_service_info(type_, name)
        assert info and info.port

        (addr,) = info.parsed_addresses()

        dev = Device(addr, info.port, name)
        if dev not in DEVICES:
            DEVICES.append(dev)

    def remove_service(self, zc, type_, name):
        pass

    def update_service(self, zc, type_, name):
        pass


def start_mdns():
    ServiceBrowser(Zeroconf(), "_http._tcp.local.", MDNSListener())


threading.Thread(target=start_mdns, daemon=True).start()

# -----------------------------
# API
# -----------------------------


@app.get("/api/devices")
def get_devices():
    # TODO: ping to validate existing entries
    return JSONResponse(
        [{"host": d.host, "port": d.port, "name": d.name} for d in DEVICES]
    )


# -----------------------------
# Frontend
# -----------------------------


app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import sys

    import uvicorn

    port = int(sys.argv[1]) if len(sys.argv) == 2 else 8000

    uvicorn.run(app, port=port)
