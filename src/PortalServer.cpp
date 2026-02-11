#include "PortalServer.h"

#include <Config.h>
#include <ESP8266WiFi.h>

#define DNS_PORT 53

namespace {
#ifndef __INTELLISENSE__
// clang-format off
const char SPLASH_HTML[] PROGMEM =
#include "static/splash.html"
;
// clang-format on
#else
const char SPLASH_HTML[] PROGMEM = "";
#endif

bool safeCopyString(const String& src, char* dest, size_t destSize) {
    if (src.length() >= destSize) return false;  // too long
    src.toCharArray(dest, destSize);             // copies + null terminator
    return true;
}

bool validateArg(ESP8266WebServer& server, const char* name, char* dest, size_t destSize) {
    if (!server.hasArg(name) || server.arg(name).length() == 0) {
        server.send(400, "text/html", String("<h2>Missing or empty field: ") + name + "</h2>");
        return false;
    }
    if (!safeCopyString(server.arg(name), dest, destSize)) {
        server.send(400, "text/html", String("<h2>Field too long: ") + name + "</h2>");
        return false;
    }
    return true;
}
}  // namespace

PortalServer::PortalServer() : m_server(80) {
    WiFi.mode(WIFI_AP);
    delay(100);
    WiFi.softAP("PIRLED-SETUP");
    m_dns.start(DNS_PORT, "*", WiFi.softAPIP());

    m_server.on("/save", HTTP_POST, [this]() {
        char ssid[32];
        char password[64];
        if (!validateArg(m_server, "ssid", ssid, sizeof(ssid)) ||
            !validateArg(m_server, "pass", password, sizeof(password))) {
            return;  // error already sent
        }
        WiFi.persistent(true);
        WiFi.begin(ssid, password);

        m_server.send(200, "text/html", "<h2>Saved. Rebooting...</h2>");
        m_server.client().flush();
        delay(500);

        WiFi.mode(WIFI_STA);  // Don't boot to AP mode again.
        ESP.restart();
    });

    m_server.onNotFound([this]() {
        m_server.send_P(200, "text/html", SPLASH_HTML);  // _P reads from PROGMEM
    });

    m_server.begin();
}

PortalServer::~PortalServer() {
    m_dns.stop();
    m_server.stop();
}

void PortalServer::handle() {
    m_dns.processNextRequest();
    m_server.handleClient();
}
