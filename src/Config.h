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
    uint8_t pirMask;
};

struct Config {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
    int64_t timestamp;
    std::array<LedConfig, 4> ledConfig;

    uint32_t crc;
};

extern Config g_config;

bool saveConfig();  // Use with care to avoid eeprom wear.

class ConfigServer {
   public:
    ConfigServer(const char* serviceName);

    void begin();

    ~ConfigServer() { m_server.stop(); }
    void handle(unsigned long now);

    PirStates getPirOverrides() { return m_pirOverrides; }

    void linkState(const PirStates* pirStatesPtr, std::array<const uint8_t*, 4> ledStatesPtr,
                   std::array<const int16_t*, 4> brightnessPtrs) {
        // Link states for reporting.
        // Note: called from main loop, no concurrency issues expected.
        m_pirStatesPtr = pirStatesPtr;

        m_ledStatesPtrs = ledStatesPtr;
        m_brightnessPtrs = brightnessPtrs;
    }

   private:
    ESP8266WebServer m_server;
    ArduinoOTAClass m_ota;
    const char* m_serviceName;
    unsigned long m_saveDebounceTimeMs = 60000;
    unsigned long m_lastRequestTime = 0;
    bool m_saveRequested = false;
    bool m_storedConfigValid = false;
    uint32_t m_configSaves = 0;

    const PirStates* m_pirStatesPtr = nullptr;
    std::array<const uint8_t*, 4> m_ledStatesPtrs = {nullptr, nullptr, nullptr, nullptr};
    std::array<const int16_t*, 4> m_brightnessPtrs = {nullptr, nullptr, nullptr, nullptr};

    PirStates m_pirOverrides = 0;
};