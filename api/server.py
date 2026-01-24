import pathlib
import socket
import subprocess
import threading

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf

THIS_DIR = pathlib.Path(__file__).parent
app = FastAPI()

# -----------------------------
# mDNS discovery
# -----------------------------


SERVICES: list[tuple[str, str]] = []


class MDNSListener(ServiceListener):
    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        if not name.startswith("pirled-controller.") or (type_, name) in SERVICES:
            return
        SERVICES.append((type_, name))

    def remove_service(self, zc, type_, name):
        pass

    def update_service(self, zc, type_, name):
        pass


zc = Zeroconf()


def start_mdns():
    ServiceBrowser(zc, "_http._tcp.local.", MDNSListener())


threading.Thread(target=start_mdns, daemon=True).start()


def ping(ip: str) -> str:
    if (ret := subprocess.call(("ping", "-c", "1", ip))) != 0:
        raise socket.gaierror(f"Ping failed: {ret}")
    return ip


# -----------------------------
# API
# -----------------------------


@app.get("/api/devices")
def get_devices():
    devs = []
    failed = []

    # Go through and resolve hostname + ping (remove failed ones).
    # JS app is chatty, so it should only use IP.
    for type_, name in SERVICES:
        info = zc.get_service_info(type_, name)
        if info and info.server and info.port:
            try:
                ip = ping(socket.gethostbyname(info.server))
                devs.append({"host": ip, "port": info.port, "name": name})
            except socket.gaierror:  # Failed to resolve.
                failed.append((type_, name))
                continue

    for failure in failed:
        SERVICES.remove(failure)

    return JSONResponse(devs)


app.mount("/", StaticFiles(directory=THIS_DIR / "static", html=True), name="static")

if __name__ == "__main__":
    import sys

    import uvicorn

    port = int(sys.argv[1]) if len(sys.argv) == 2 else 8000

    uvicorn.run(app, port=port)
