#pragma once

#include <ESP8266WebServer.h>
#include <stdint.h>

#include <array>

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

void saveConfig();  // Use with care to avoid eeprom wear.

class ConfigServer {
   public:
    ConfigServer();

    void begin() { m_server.begin(); }

    ~ConfigServer() { m_server.stop(); }
    void handle(unsigned long now);

   private:
    ESP8266WebServer m_server;
};