#include "PortalServer.h"

#include <Config.h>
#include <ESP8266WiFi.h>

#define DNS_PORT 53

#ifndef __INTELLISENSE__
// clang-format off
const static char SPLASH_HTML[] PROGMEM =
#include "static/splash.html"
;
// clang-format on
#else
const static char SPLASH_HTML[] PROGMEM = "";
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

PortalServer::PortalServer() : m_server(80) {
    WiFi.mode(WIFI_AP);
    delay(100);
    WiFi.softAP("ESP8266-Setup");
    m_dns.start(DNS_PORT, "*", WiFi.softAPIP());

    m_server.on("/save", HTTP_POST, [this]() {
        if (!validateArg(m_server, "ssid", CONFIG.wifiSsid, sizeof(CONFIG.wifiSsid)) ||
            !validateArg(m_server, "pass", CONFIG.wifiPassword, sizeof(CONFIG.wifiPassword)) ||
            !validateArg(m_server, "host", CONFIG.hostname, sizeof(CONFIG.hostname))) {
            return;  // error already sent
        }
        saveConfig();  // save immediately

        m_server.send(200, "text/html", "<h2>Saved. Rebooting...</h2>");
        m_server.client().flush();
        delay(500);

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
