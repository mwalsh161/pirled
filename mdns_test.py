import time
from zeroconf import ServiceBrowser, ServiceListener, Zeroconf


class Listener(ServiceListener):
    def add_service(self, zeroconf, service_type, name):
        info = zeroconf.get_service_info(service_type, name)
        if info:
            print("FOUND:", name)
            print("  Address:", ".".join(map(str, info.addresses[0])))
            print("  Port:", info.port)
            print("  TXT:", info.properties)

    def remove_service(self, zeroconf, service_type, name):
        print("REMOVED:", name)

    def update_service(self, zeroconf, service_type, name):
        pass


zeroconf = Zeroconf()
browser = ServiceBrowser(zeroconf, "_http._tcp.local.", Listener())

try:
    time.sleep(10)
finally:
    zeroconf.close()
