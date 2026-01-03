#include "PortalServer.h"

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

PortalServer::PortalServer() : m_server(80) {
    WiFi.mode(WIFI_AP);
    delay(100);
    WiFi.softAP("ESP8266-Setup");
    m_dns.start(DNS_PORT, "*", WiFi.softAPIP());

    m_server.on("/save", HTTP_POST, [this]() {
        m_server.send(200, "text/html", "<h2>Saved. Rebooting...</h2>");
        m_server.client().flush();
        delay(500);

        // We call begin to save creds, then reoboot to actually connect.
        WiFi.begin(m_server.arg("ssid").c_str(), m_server.arg("pass").c_str());
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
