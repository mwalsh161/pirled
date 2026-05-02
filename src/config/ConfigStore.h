#pragma once

#include <stddef.h>
#include <stdint.h>

#include <array>

typedef uint16_t PirStates;

struct LedConfig {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint32_t waitOnMs;
    PirStates pirMaskOn;
    PirStates pirMaskOff;
};

struct Config {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfig, 4> ledConfig;

    uint32_t crc;
};

const Config& getConfig();
LedConfig& getLedConfig(size_t index);
void setConfigTimestamp(int64_t timestamp);

bool initConfig();
bool saveConfig();  // Use with care to avoid eeprom wear.
