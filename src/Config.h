#pragma once

#include <ESP8266WebServer.h>
#include <stdint.h>

#include <array>

typedef uint8_t PirStates;

struct LedConfig {
    int brightness;
    uint32_t onTimeMs;
    float fadeFreq;
    uint8_t pirMask;
};

struct Config {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
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

    void setState(const PirStates& pirStates, const std::array<uint8_t, 4>& ledStates) {
        // Copy states for reporting.
        // Note: called from main loop, no concurrency issues expected.
        for (size_t i = 0; i < ledStates.size(); i++) {
            m_ledStates[i] = ledStates[i];
        }
        m_pirStates = pirStates;
    }

   private:
    ESP8266WebServer m_server;
    const char* m_serviceName;
    unsigned long m_saveDebounceTimeMs = 60000;
    unsigned long m_lastRequestTime = 0;
    bool m_saveRequested = false;
    bool m_storedConfigValid = false;
    uint32_t m_configSaves = 0;

    PirStates m_pirStates = 0;
    std::array<uint8_t, 4> m_ledStates;

    PirStates m_pirOverrides = 0;
};