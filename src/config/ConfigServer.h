#pragma once

#include <ArduinoOTA.h>
#include <ESP8266WebServer.h>

#include "config/ConfigStore.h"

class ConfigServer {
   public:
    ConfigServer();
    bool setup();
    PirStates pirOverrides() const { return m_pirOverrides; }
    void setPirOverrides(PirStates overrides) { m_pirOverrides = overrides; }

    void onWiFiConnected(const char* hostname);
    void onWiFiDisconnected();

    ~ConfigServer() { m_server.stop(); }
    void handle();

   private:
    ESP8266WebServer m_server;
    ArduinoOTAClass m_ota;
    bool m_storedConfigValid = false;
    bool m_initialized = false;
    PirStates m_pirOverrides = 0;
};
