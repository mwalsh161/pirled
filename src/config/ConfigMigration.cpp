#include "config/ConfigMigration.h"

#include <Arduino.h>
#include <EEPROM.h>
#include <ErriezCRC32.h>
#include <stddef.h>
#include <string.h>

#include "system/PersistentStorage.h"

namespace {
constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
constexpr uint16_t CONFIG_VERSION_V1 = 1;
constexpr uint16_t CONFIG_VERSION_V2 = 2;
constexpr uint16_t CONFIG_VERSION_V3 = 3;
constexpr uint16_t CONFIG_VERSION_V4 = 4;
constexpr uint16_t CONFIG_VERSION_V5 = 5;
constexpr uint16_t CONFIG_VERSION_V6 = 6;
constexpr uint16_t CONFIG_VERSION_V7 = 7;

constexpr size_t LED_CONFIG_COUNT_V6 = 4;
constexpr size_t PIR_EVENT_DESTINATION_COUNT_V6 = 4;
constexpr size_t REMOTE_PIR_SLOT_COUNT_V6 = 8;
constexpr size_t REMOTE_PIR_HOST_SIZE_V6 = 32;
constexpr uint16_t REMOTE_PIR_DEFAULT_PORT_V6 = 4210;
constexpr uint32_t REMOTE_PIR_DEFAULT_LEASE_MS_V6 = 9000;
constexpr uint8_t VIRTUAL_PIR_V6 = 4;
constexpr size_t LED_CONFIG_COUNT_V7 = 4;
constexpr size_t PIR_EVENT_DESTINATION_COUNT_V7 = 4;
constexpr size_t REMOTE_PIR_SLOT_COUNT_V7 = 8;
constexpr size_t REMOTE_PIR_HOST_SIZE_V7 = 32;
constexpr uint32_t REMOTE_PIR_DEFAULT_LEASE_MS_V7 = 9000;
constexpr uint8_t VIRTUAL_PIR_V7 = 4;

struct LedConfigV1 {
    int brightness;
    uint32_t onTimeMs;
    float fadeFreq;
    uint8_t pirMask;
};

struct ConfigV1 {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
    std::array<LedConfigV1, 4> ledConfig;

    uint32_t crc;
};

struct LedConfigV2 {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint8_t pirMask;
};

struct ConfigV2 {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
    int64_t timestamp;
    std::array<LedConfigV2, 4> ledConfig;

    uint32_t crc;
};

struct LedConfigV3 {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint32_t waitOnMs;
    uint8_t pirMaskOn;
    uint8_t pirMaskOff;
};

struct LedConfigV3SingleMask {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint32_t waitOnMs;
    uint8_t pirMask;
};

struct SensorBindingV3 {
    uint8_t sensorId;
    uint32_t delayMs;
};

struct LedConfigV3SensorBinding {
    int16_t brightness;
    int16_t rampOnMs;
    int16_t rampOffMs;
    std::array<SensorBindingV3, 4> sensorOnBindings;
    std::array<SensorBindingV3, 4> sensorOffBindings;
    uint8_t numOnBindings;
    uint8_t numOffBindings;
};

struct ConfigV3 {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
    int64_t timestamp;
    std::array<LedConfigV3, 4> ledConfig;

    uint32_t crc;
};

struct ConfigV3SingleMask {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
    int64_t timestamp;
    std::array<LedConfigV3SingleMask, 4> ledConfig;

    uint32_t crc;
};

struct ConfigV3SensorBinding {
    uint32_t magic;
    uint16_t version;

    char hostname[32];
    char wifiSsid[32];
    char wifiPassword[32];
    int64_t timestamp;
    std::array<LedConfigV3SensorBinding, 4> ledConfig;

    uint32_t crc;
};

struct ConfigV4 {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfigV3, 4> ledConfig;

    uint32_t crc;
};

struct LedConfigV5 {
    int16_t brightness;
    int16_t rampOnMs;
    uint32_t holdOnMs;
    int16_t rampOffMs;
    uint32_t waitOnMs;
    uint16_t pirMaskOn;
    uint16_t pirMaskOff;
};

struct ConfigV5 {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfigV5, 4> ledConfig;

    uint32_t crc;
};

struct PirEventDestinationConfigV6 {
    char host[REMOTE_PIR_HOST_SIZE_V6];
    uint16_t port;
    bool enabled;
};

struct RemotePirConfigV6 {
    char sourceHost[REMOTE_PIR_HOST_SIZE_V6];
    uint8_t sourcePirIndex;
    uint32_t leaseMs;
    bool enabled;
};

struct ConfigV6 {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfigV5, LED_CONFIG_COUNT_V6> ledConfig;
    std::array<PirEventDestinationConfigV6, PIR_EVENT_DESTINATION_COUNT_V6> eventDestinations;
    std::array<RemotePirConfigV6, REMOTE_PIR_SLOT_COUNT_V6> remotePirs;

    uint32_t crc;
};

struct PirEventDestinationConfigV7 {
    char host[REMOTE_PIR_HOST_SIZE_V7];
    bool enabled;
};

struct RemotePirConfigV7 {
    char sourceHost[REMOTE_PIR_HOST_SIZE_V7];
    uint8_t sourcePirIndex;
    uint32_t leaseMs;
    bool enabled;
};

struct ConfigV7 {
    uint32_t magic;
    uint16_t version;

    int64_t timestamp;
    std::array<LedConfigV5, LED_CONFIG_COUNT_V7> ledConfig;
    std::array<PirEventDestinationConfigV7, PIR_EVENT_DESTINATION_COUNT_V7> eventDestinations;
    std::array<RemotePirConfigV7, REMOTE_PIR_SLOT_COUNT_V7> remotePirs;

    uint32_t crc;
};

static_assert(sizeof(ConfigV1) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV1 exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV2) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV2 exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV3) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV3 exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV3SingleMask) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV3SingleMask exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV3SensorBinding) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV3SensorBinding exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV4) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV4 exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV5) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV5 exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV6) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV6 exceeds reserved legacy config storage.");
static_assert(sizeof(ConfigV7) <= LEGACY_CONFIG_STORAGE_BYTES,
              "ConfigV7 exceeds reserved legacy config storage.");

template <typename T>
uint32_t computeLegacyCrc(const T& cfg) {
    return crc32Buffer(reinterpret_cast<const uint8_t*>(&cfg), offsetof(T, crc));
}

template <typename T>
bool hasValidHeaderAndCrc(const T& cfg, uint16_t version) {
    return cfg.magic == CONFIG_MAGIC && cfg.version == version && cfg.crc == computeLegacyCrc(cfg);
}

void copyFixedString(char* dest, size_t destSize, const char* src, size_t srcSize) {
    memset(dest, 0, destSize);
    size_t copySize = min(destSize, srcSize);
    memcpy(dest, src, copySize);
    dest[destSize - 1] = '\0';
}

void setConfigV6Defaults(ConfigV6& config) {
    memset(&config, 0, sizeof(config));
    config.magic = CONFIG_MAGIC;
    config.version = CONFIG_VERSION_V6;

    for (size_t i = 0; i < config.ledConfig.size(); i++) {
        uint16_t pirMask = static_cast<uint16_t>((1U << i) | (1U << (i + VIRTUAL_PIR_V6)));
        config.ledConfig[i] = {.brightness = 1023,
                               .rampOnMs = 1000,
                               .holdOnMs = 10000,
                               .rampOffMs = 1000,
                               .waitOnMs = 0,
                               .pirMaskOn = pirMask,
                               .pirMaskOff = pirMask};
    }

    for (auto& destination : config.eventDestinations) {
        destination.host[0] = '\0';
        destination.port = REMOTE_PIR_DEFAULT_PORT_V6;
        destination.enabled = false;
    }

    for (auto& remotePir : config.remotePirs) {
        remotePir.sourceHost[0] = '\0';
        remotePir.sourcePirIndex = 0;
        remotePir.leaseMs = REMOTE_PIR_DEFAULT_LEASE_MS_V6;
        remotePir.enabled = false;
    }
}

void setConfigV7Defaults(ConfigV7& config) {
    memset(&config, 0, sizeof(config));
    config.magic = CONFIG_MAGIC;
    config.version = CONFIG_VERSION_V7;

    for (size_t i = 0; i < config.ledConfig.size(); i++) {
        uint16_t pirMask = static_cast<uint16_t>((1U << i) | (1U << (i + VIRTUAL_PIR_V7)));
        config.ledConfig[i] = {.brightness = 1023,
                               .rampOnMs = 1000,
                               .holdOnMs = 10000,
                               .rampOffMs = 1000,
                               .waitOnMs = 0,
                               .pirMaskOn = pirMask,
                               .pirMaskOff = pirMask};
    }

    for (auto& destination : config.eventDestinations) {
        destination.host[0] = '\0';
        destination.enabled = false;
    }

    for (auto& remotePir : config.remotePirs) {
        remotePir.sourceHost[0] = '\0';
        remotePir.sourcePirIndex = 0;
        remotePir.leaseMs = REMOTE_PIR_DEFAULT_LEASE_MS_V7;
        remotePir.enabled = false;
    }
}

void migrateV1ToV2(const ConfigV1& from, ConfigV2& to) {
    memset(&to, 0, sizeof(to));
    to.magic = CONFIG_MAGIC;
    to.version = CONFIG_VERSION_V2;

    for (size_t i = 0; i < from.ledConfig.size(); i++) {
        const auto& oldLed = from.ledConfig[i];
        auto& newLed = to.ledConfig[i];
        newLed.brightness = static_cast<int16_t>(constrain(oldLed.brightness, 0, 1023));
        newLed.rampOnMs = 1000;
        newLed.holdOnMs = oldLed.onTimeMs;
        newLed.rampOffMs = 1000;
        newLed.pirMask = oldLed.pirMask;
    }
}

void migrateV2ToV3(const ConfigV2& from, ConfigV3& to) {
    memset(&to, 0, sizeof(to));
    to.magic = CONFIG_MAGIC;
    to.version = CONFIG_VERSION_V3;
    to.timestamp = from.timestamp;

    for (size_t i = 0; i < from.ledConfig.size(); i++) {
        const auto& oldLed = from.ledConfig[i];
        auto& newLed = to.ledConfig[i];
        newLed.brightness = oldLed.brightness;
        newLed.rampOnMs = oldLed.rampOnMs;
        newLed.holdOnMs = oldLed.holdOnMs;
        newLed.rampOffMs = oldLed.rampOffMs;
        newLed.waitOnMs = 0;
        newLed.pirMaskOn = oldLed.pirMask;
        newLed.pirMaskOff = oldLed.pirMask;
    }
}

void migrateV3SingleMaskToV3(const ConfigV3SingleMask& from, ConfigV3& to) {
    memset(&to, 0, sizeof(to));
    to.magic = CONFIG_MAGIC;
    to.version = CONFIG_VERSION_V3;
    to.timestamp = from.timestamp;

    for (size_t i = 0; i < from.ledConfig.size(); i++) {
        const auto& oldLed = from.ledConfig[i];
        auto& newLed = to.ledConfig[i];
        newLed.brightness = oldLed.brightness;
        newLed.rampOnMs = oldLed.rampOnMs;
        newLed.holdOnMs = oldLed.holdOnMs;
        newLed.rampOffMs = oldLed.rampOffMs;
        newLed.waitOnMs = oldLed.waitOnMs;
        newLed.pirMaskOn = oldLed.pirMask;
        newLed.pirMaskOff = oldLed.pirMask;
    }
}

uint8_t maskFromSensorBindings(const std::array<SensorBindingV3, 4>& bindings, uint8_t count) {
    uint8_t mask = 0;
    size_t bindingCount = min(static_cast<size_t>(count), bindings.size());
    for (size_t i = 0; i < bindingCount; i++) {
        if (bindings[i].sensorId < 8) {
            mask |= static_cast<uint8_t>(1U << bindings[i].sensorId);
        }
    }
    return mask;
}

uint32_t maxBindingDelayMs(const std::array<SensorBindingV3, 4>& bindings, uint8_t count) {
    uint32_t delayMs = 0;
    size_t bindingCount = min(static_cast<size_t>(count), bindings.size());
    for (size_t i = 0; i < bindingCount; i++) {
        delayMs = max(delayMs, bindings[i].delayMs);
    }
    return delayMs;
}

void migrateV3SensorBindingToV3(const ConfigV3SensorBinding& from, ConfigV3& to) {
    memset(&to, 0, sizeof(to));
    to.magic = CONFIG_MAGIC;
    to.version = CONFIG_VERSION_V3;
    to.timestamp = from.timestamp;

    for (size_t i = 0; i < from.ledConfig.size(); i++) {
        const auto& oldLed = from.ledConfig[i];
        auto& newLed = to.ledConfig[i];
        newLed.brightness = oldLed.brightness;
        newLed.rampOnMs = oldLed.rampOnMs;
        newLed.holdOnMs = 10000;
        newLed.rampOffMs = oldLed.rampOffMs;
        newLed.waitOnMs = 0;
        newLed.pirMaskOn = maskFromSensorBindings(oldLed.sensorOnBindings, oldLed.numOnBindings);
        newLed.pirMaskOff = maskFromSensorBindings(oldLed.sensorOffBindings, oldLed.numOffBindings);

        uint32_t holdOnMs = maxBindingDelayMs(oldLed.sensorOffBindings, oldLed.numOffBindings);
        if (holdOnMs > 0) {
            newLed.holdOnMs = holdOnMs;
        }
    }
}

void migrateV3ToV4(const ConfigV3& from, ConfigV4& to) {
    memset(&to, 0, sizeof(to));
    to.magic = CONFIG_MAGIC;
    to.version = CONFIG_VERSION_V4;
    to.timestamp = from.timestamp;
    to.ledConfig = from.ledConfig;
}

void migrateV4ToV5(const ConfigV4& from, ConfigV5& to) {
    memset(&to, 0, sizeof(to));
    to.magic = CONFIG_MAGIC;
    to.version = CONFIG_VERSION_V5;
    to.timestamp = from.timestamp;

    for (size_t i = 0; i < from.ledConfig.size(); i++) {
        const auto& oldLed = from.ledConfig[i];
        auto& newLed = to.ledConfig[i];
        newLed.brightness = oldLed.brightness;
        newLed.rampOnMs = oldLed.rampOnMs;
        newLed.holdOnMs = oldLed.holdOnMs;
        newLed.rampOffMs = oldLed.rampOffMs;
        newLed.waitOnMs = oldLed.waitOnMs;
        newLed.pirMaskOn = oldLed.pirMaskOn;
        newLed.pirMaskOff = oldLed.pirMaskOff;
    }
}

void migrateV5ToV6(const ConfigV5& from, ConfigV6& to) {
    setConfigV6Defaults(to);
    to.timestamp = from.timestamp;
    to.ledConfig = from.ledConfig;
}

void migrateV6ToV7(const ConfigV6& from, ConfigV7& to) {
    setConfigV7Defaults(to);
    to.timestamp = from.timestamp;
    to.ledConfig = from.ledConfig;

    for (size_t i = 0; i < from.eventDestinations.size(); i++) {
        copyFixedString(to.eventDestinations[i].host, sizeof(to.eventDestinations[i].host),
                        from.eventDestinations[i].host, sizeof(from.eventDestinations[i].host));
        to.eventDestinations[i].enabled = from.eventDestinations[i].enabled;
    }

    for (size_t i = 0; i < from.remotePirs.size(); i++) {
        copyFixedString(to.remotePirs[i].sourceHost, sizeof(to.remotePirs[i].sourceHost),
                        from.remotePirs[i].sourceHost, sizeof(from.remotePirs[i].sourceHost));
        to.remotePirs[i].sourcePirIndex = from.remotePirs[i].sourcePirIndex;
        to.remotePirs[i].leaseMs = from.remotePirs[i].leaseMs;
        to.remotePirs[i].enabled = from.remotePirs[i].enabled;
    }
}

void copyV7ToCurrent(const ConfigV7& from, Config& to) {
    to.magic = from.magic;
    to.version = from.version;
    to.timestamp = from.timestamp;

    for (size_t i = 0; i < from.ledConfig.size(); i++) {
        to.ledConfig[i].brightness = from.ledConfig[i].brightness;
        to.ledConfig[i].rampOnMs = from.ledConfig[i].rampOnMs;
        to.ledConfig[i].holdOnMs = from.ledConfig[i].holdOnMs;
        to.ledConfig[i].rampOffMs = from.ledConfig[i].rampOffMs;
        to.ledConfig[i].waitOnMs = from.ledConfig[i].waitOnMs;
        to.ledConfig[i].pirMaskOn = from.ledConfig[i].pirMaskOn;
        to.ledConfig[i].pirMaskOff = from.ledConfig[i].pirMaskOff;
    }

    for (size_t i = 0; i < from.eventDestinations.size(); i++) {
        copyFixedString(to.eventDestinations[i].host, sizeof(to.eventDestinations[i].host),
                        from.eventDestinations[i].host, sizeof(from.eventDestinations[i].host));
        to.eventDestinations[i].enabled = from.eventDestinations[i].enabled;
    }

    for (size_t i = 0; i < from.remotePirs.size(); i++) {
        copyFixedString(to.remotePirs[i].sourceHost, sizeof(to.remotePirs[i].sourceHost),
                        from.remotePirs[i].sourceHost, sizeof(from.remotePirs[i].sourceHost));
        to.remotePirs[i].sourcePirIndex = from.remotePirs[i].sourcePirIndex;
        to.remotePirs[i].leaseMs = from.remotePirs[i].leaseMs;
        to.remotePirs[i].enabled = from.remotePirs[i].enabled;
    }
}

void migrateV5ChainToCurrent(const ConfigV5& configV5, Config& targetConfig) {
    ConfigV6 configV6;
    migrateV5ToV6(configV5, configV6);
    ConfigV7 configV7;
    migrateV6ToV7(configV6, configV7);
    copyV7ToCurrent(configV7, targetConfig);
}

void migrateV6ChainToCurrent(const ConfigV6& configV6, Config& targetConfig) {
    ConfigV7 configV7;
    migrateV6ToV7(configV6, configV7);
    copyV7ToCurrent(configV7, targetConfig);
}

void migrateV4ChainToCurrent(const ConfigV4& configV4, Config& targetConfig) {
    ConfigV5 configV5;
    migrateV4ToV5(configV4, configV5);
    migrateV5ChainToCurrent(configV5, targetConfig);
}

void migrateV3ChainToCurrent(const ConfigV3& configV3, Config& targetConfig) {
    ConfigV4 configV4;
    migrateV3ToV4(configV3, configV4);
    migrateV4ChainToCurrent(configV4, targetConfig);
}

void migrateV2ChainToCurrent(const ConfigV2& configV2, Config& targetConfig) {
    ConfigV3 configV3;
    migrateV2ToV3(configV2, configV3);
    migrateV3ChainToCurrent(configV3, targetConfig);
}

bool readConfigV1(ConfigV1& config) {
    EEPROM.get(0, config);
    return hasValidHeaderAndCrc(config, CONFIG_VERSION_V1);
}

bool readConfigV2(ConfigV2& config) {
    EEPROM.get(0, config);
    return hasValidHeaderAndCrc(config, CONFIG_VERSION_V2);
}

bool readConfigV3(ConfigV3& config) {
    EEPROM.get(0, config);
    if (hasValidHeaderAndCrc(config, CONFIG_VERSION_V3)) {
        return true;
    }

    ConfigV3SingleMask singleMaskConfig;
    EEPROM.get(0, singleMaskConfig);
    if (hasValidHeaderAndCrc(singleMaskConfig, CONFIG_VERSION_V3)) {
        migrateV3SingleMaskToV3(singleMaskConfig, config);
        return true;
    }

    ConfigV3SensorBinding sensorBindingConfig;
    EEPROM.get(0, sensorBindingConfig);
    if (hasValidHeaderAndCrc(sensorBindingConfig, CONFIG_VERSION_V3)) {
        migrateV3SensorBindingToV3(sensorBindingConfig, config);
        return true;
    }

    return false;
}

bool readConfigV4(ConfigV4& config) {
    EEPROM.get(0, config);
    return hasValidHeaderAndCrc(config, CONFIG_VERSION_V4);
}

bool readConfigV5(ConfigV5& config) {
    EEPROM.get(0, config);
    return hasValidHeaderAndCrc(config, CONFIG_VERSION_V5);
}

bool readConfigV6(ConfigV6& config) {
    EEPROM.get(0, config);
    return hasValidHeaderAndCrc(config, CONFIG_VERSION_V6);
}

bool migrateStoredConfigFromVersion(uint16_t version, Config& targetConfig) {
    switch (version) {
        case CONFIG_VERSION_V1: {
            ConfigV1 configV1;
            if (!readConfigV1(configV1)) return false;

            ConfigV2 configV2;
            migrateV1ToV2(configV1, configV2);
            migrateV2ChainToCurrent(configV2, targetConfig);
            return true;
        }
        case CONFIG_VERSION_V2: {
            ConfigV2 configV2;
            if (!readConfigV2(configV2)) return false;

            migrateV2ChainToCurrent(configV2, targetConfig);
            return true;
        }
        case CONFIG_VERSION_V3: {
            ConfigV3 configV3;
            if (!readConfigV3(configV3)) return false;

            migrateV3ChainToCurrent(configV3, targetConfig);
            return true;
        }
        case CONFIG_VERSION_V4: {
            ConfigV4 configV4;
            if (!readConfigV4(configV4)) return false;

            migrateV4ChainToCurrent(configV4, targetConfig);
            return true;
        }
        case CONFIG_VERSION_V5: {
            ConfigV5 configV5;
            if (!readConfigV5(configV5)) return false;

            migrateV5ChainToCurrent(configV5, targetConfig);
            return true;
        }
        case CONFIG_VERSION_V6: {
            ConfigV6 configV6;
            if (!readConfigV6(configV6)) return false;
            migrateV6ChainToCurrent(configV6, targetConfig);
            return true;
        }
        default:
            return false;
    }
}
}  // namespace

bool migrateStoredConfig(uint16_t storedVersion, Config& targetConfig) {
    uint16_t candidateVersion = min(storedVersion, CONFIG_VERSION_V6);
    while (candidateVersion >= CONFIG_VERSION_V1) {
        if (migrateStoredConfigFromVersion(candidateVersion, targetConfig)) {
            return true;
        }
        if (candidateVersion == CONFIG_VERSION_V1) {
            break;
        }
        candidateVersion--;
    }
    return false;
}
