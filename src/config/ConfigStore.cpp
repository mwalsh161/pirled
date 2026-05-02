#include "config/ConfigStore.h"

#include <Arduino.h>
#include <EEPROM.h>
#include <ErriezCRC32.h>
#include <stddef.h>

#include "debug.h"
#include "system/Logger.h"

#define VIRTUAL_PIR 4

namespace {
constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
constexpr uint16_t CONFIG_VERSION = 5;
Config s_config;

constexpr uint8_t CFG_BOOT_SOURCE_STORED = 0;
constexpr uint8_t CFG_BOOT_SOURCE_DEFAULTS = 1;
constexpr uint8_t CFG_SAVE_NO_CHANGE = 0;
constexpr uint8_t CFG_SAVE_COMMITTED = 1;
constexpr uint8_t CFG_SAVE_COMMIT_FAILED = 2;

uint32_t computeCrc(const Config& cfg) {
    return crc32Buffer(reinterpret_cast<const uint8_t*>(&cfg), offsetof(Config, crc));
}

void setConfigDefaults() {
    memset(&s_config, 0, sizeof(s_config));

    s_config.magic = CONFIG_MAGIC;
    s_config.version = CONFIG_VERSION;

    for (size_t i = 0; i < s_config.ledConfig.size(); i++) {
        PirStates pirMask = static_cast<PirStates>((1U << i) | (1U << (i + VIRTUAL_PIR)));
        s_config.ledConfig[i] = {.brightness = 1023,
                                 .rampOnMs = 1000,
                                 .holdOnMs = 10000,
                                 .rampOffMs = 1000,
                                 .waitOnMs = 0,
                                 .pirMaskOn = pirMask,
                                 .pirMaskOff = pirMask};
    }

    s_config.crc = computeCrc(s_config);
}
}  // namespace

const Config& getConfig() { return s_config; }
LedConfig& getLedConfig(size_t index) { return s_config.ledConfig[index]; }
void setConfigTimestamp(int64_t timestamp) { s_config.timestamp = timestamp; }

bool initConfig() {
    EEPROM.begin(sizeof(Config));
    EEPROM.get(0, s_config);

    uint32_t storedMagic = s_config.magic;
    uint16_t storedVersion = s_config.version;
    uint32_t storedCrc = s_config.crc;
    uint32_t computedCrc = computeCrc(s_config);
    bool magicValid = s_config.magic == CONFIG_MAGIC;
    bool versionValid = s_config.version == CONFIG_VERSION;
    bool crcValid = s_config.crc == computedCrc;
    bool valid = magicValid && versionValid && crcValid;
    uint8_t bootSource = CFG_BOOT_SOURCE_STORED;

    if (!valid) {
        D_PRINTLN("Stored config invalid, loading defaults");
        setConfigDefaults();
        bootSource = CFG_BOOT_SOURCE_DEFAULTS;
    }

    // cb,<boot_source>,<valid>,<magic_ok>,<version_ok>,<crc_ok>,<stored_magic>,<stored_version>,<stored_crc>,<computed_crc>
    char status[128] = "";
    snprintf(status, sizeof(status), "cb,%u,%u,%u,%u,%u,%lu,%u,%lu,%lu", bootSource, valid, magicValid,
             versionValid, crcValid, static_cast<unsigned long>(storedMagic), storedVersion,
             static_cast<unsigned long>(storedCrc), static_cast<unsigned long>(computedCrc));
    log(status);
    D_PRINTLN(status);

    return valid;
}

bool saveConfig() {
    s_config.crc = computeCrc(s_config);

    Config stored;
    EEPROM.get(0, stored);
    char saveStatus[8] = "";
    if (memcmp(&stored, &s_config, sizeof(Config)) == 0) {
        snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_NO_CHANGE);
        log(saveStatus);
        D_PRINTLN(saveStatus);
        return true;
    }

    EEPROM.put(0, s_config);
    if (!EEPROM.commit()) {
        snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_COMMIT_FAILED);
        log(saveStatus);
        D_PRINTLN(saveStatus);
        return false;
    }
    snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_COMMITTED);
    log(saveStatus);
    D_PRINTLN(saveStatus);
    return true;
}
