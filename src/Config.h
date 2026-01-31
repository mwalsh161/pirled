#pragma once

#include <ArduinoOTA.h>
#include <ESP8266WebServer.h>
#include <stdint.h>

#include <array>

typedef uint8_t PirStates;

struct LedConfig {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint32_t waitOnMs;
    uint8_t pirMaskOn;
    uint8_t pirMaskOff;
};

struct Config {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfig, 4> ledConfig;

    uint32_t crc;
};

extern Config CONFIG;

bool saveConfig();  // Use with care to avoid eeprom wear.

class ConfigServer {
   public:
    PirStates m_pirOverrides = 0;

    ConfigServer();

    void onWiFiConnected(const char* hostname);
    void onWiFiDisconnected();

    ~ConfigServer() { m_server.stop(); }
    void handle(unsigned long now);

   private:
    ESP8266WebServer m_server;
    ArduinoOTAClass m_ota;
    unsigned long m_saveDebounceTimeMs = 60000;
    unsigned long m_lastRequestTime = 0;
    bool m_saveRequested = false;
    bool m_storedConfigValid = false;
    uint32_t m_configSaves = 0;

    const PirStates* m_pirStatesPtr = nullptr;
    std::array<const uint8_t*, 4> m_ledStatesPtrs = {nullptr, nullptr, nullptr, nullptr};
    std::array<const int16_t*, 4> m_brightnessPtrs = {nullptr, nullptr, nullptr, nullptr};
};