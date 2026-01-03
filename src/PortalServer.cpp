#include "PortalServer.h"

#include <DNSServer.h>
#include <ESP8266WebServer.h>
#include <ESP8266WiFi.h>

#include "WifiCreds.h"

#define DNS_PORT 53

namespace PortalServer {

static ESP8266WebServer server(80);
static DNSServer dns;

const static char SPLASH_HTML[] PROGMEM =
#include "static/splash.html"
    ;

void begin(const IPAddress& apIP, const CredsCallback& credsCB) {
    dns.start(DNS_PORT, "*", apIP);

    server.on("/", HTTP_GET, []() {
        server.send_P(200, "text/html", SPLASH_HTML);  // _P reads from PROGMEM
    });

    server.on("/save", HTTP_POST, [credsCB]() {
        WifiCreds creds{};
        strncpy(creds.ssid, server.arg("ssid").c_str(), sizeof(creds.ssid) - 1);
        strncpy(creds.pass, server.arg("pass").c_str(), sizeof(creds.pass) - 1);

        credsCB(creds);

        server.send(200, "text/html", "<h2>Saved. Rebooting...</h2>");
        ESP.restart();
    });

    // mac-specific captive portal
    server.on("/hotspot-detect.html", HTTP_GET, []() {
        server.send(200, "text/html", "<HTML><BODY>Success</BODY></HTML>");
    });

    server.on("/library/test/success.html", HTTP_GET,
              []() { server.send(200, "text/html", "Success"); });

    server.onNotFound([]() {
        server.sendHeader("Location", "/", true);
        server.send(302, "text/plain", "");
    });

    server.begin();
}

void handle() {
    dns.processNextRequest();
    server.handleClient();
}

void stop() {
    dns.stop();
    server.stop();
}

}  // namespace PortalServer
