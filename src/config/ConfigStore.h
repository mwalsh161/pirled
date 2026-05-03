#pragma once

#include <stddef.h>
#include <stdint.h>

#include <array>

typedef uint16_t PirStates;

constexpr size_t PIR_EVENT_DESTINATION_COUNT = 4;
constexpr size_t REMOTE_PIR_SLOT_COUNT = 8;
constexpr size_t REMOTE_PIR_HOST_SIZE = 32;
constexpr uint16_t REMOTE_PIR_DEFAULT_PORT = 4210;
constexpr uint32_t REMOTE_PIR_DEFAULT_LEASE_MS = 9000;

struct LedConfig {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint32_t waitOnMs;
    PirStates pirMaskOn;
    PirStates pirMaskOff;
};

struct PirEventDestinationConfig {
    char host[REMOTE_PIR_HOST_SIZE];
    bool enabled;
};

struct RemotePirConfig {
    char sourceHost[REMOTE_PIR_HOST_SIZE];
    uint8_t sourcePirIndex;
    uint32_t leaseMs;
    bool enabled;
};

struct Config {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfig, 4> ledConfig;
    std::array<PirEventDestinationConfig, PIR_EVENT_DESTINATION_COUNT> eventDestinations;
    std::array<RemotePirConfig, REMOTE_PIR_SLOT_COUNT> remotePirs;

    uint32_t crc;
};

const Config& getConfig();
LedConfig& getLedConfig(size_t index);
PirEventDestinationConfig& getPirEventDestinationConfig(size_t index);
RemotePirConfig& getRemotePirConfig(size_t index);
void setConfigTimestamp(int64_t timestamp);

bool initConfig();
bool saveConfig();  // Use with care to avoid eeprom wear.
