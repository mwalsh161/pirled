#include "config/ConfigStore.h"

#include <Arduino.h>
#include <EEPROM.h>
#include <ErriezCRC32.h>
#include <stddef.h>

#include "config/ConfigMigration.h"
#include "debug.h"
#include "system/BootHistory.h"
#include "system/Logger.h"
#include "system/PersistentStorage.h"

#define VIRTUAL_PIR 4

namespace {
constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
constexpr uint16_t CONFIG_VERSION = CURRENT_CONFIG_VERSION;
Config s_config;
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

    for (auto& destination : s_config.eventDestinations) {
        destination.host[0] = '\0';
        destination.enabled = false;
    }

    for (auto& remotePir : s_config.remotePirs) {
        remotePir.sourceHost[0] = '\0';
        remotePir.sourcePirIndex = 0;
        remotePir.leaseMs = REMOTE_PIR_DEFAULT_LEASE_MS;
        remotePir.enabled = false;
    }

    s_config.crc = computeCrc(s_config);
}
}  // namespace

const Config& getConfig() { return s_config; }
LedConfig& getLedConfig(size_t index) { return s_config.ledConfig[index]; }
PirEventDestinationConfig& getPirEventDestinationConfig(size_t index) {
    return s_config.eventDestinations[index];
}
RemotePirConfig& getRemotePirConfig(size_t index) { return s_config.remotePirs[index]; }
void setConfigTimestamp(int64_t timestamp) { s_config.timestamp = timestamp; }

bool initConfig() {
    beginPersistentStorage();
    EEPROM.get(0, s_config);

    uint16_t storedVersion = s_config.version;
    uint32_t storedCrc = s_config.crc;
    uint32_t computedCrc = computeCrc(s_config);
    bool magicValid = s_config.magic == CONFIG_MAGIC;
    bool versionValid = s_config.version == CONFIG_VERSION;
    bool crcValid = s_config.crc == computedCrc;
    bool valid = magicValid && versionValid && crcValid;
    bool recoveredStoredConfig = valid;
    uint8_t bootSource = CFG_BOOT_SOURCE_STORED;
    bool migrationAttempted = false;
    bool migrationSucceeded = false;
    bool migrationSaveSucceeded = false;

    if (!valid) {
        if (magicValid) {
            setConfigDefaults();
        }
        migrationAttempted = magicValid;
        if (magicValid && migrateStoredConfig(storedVersion, s_config)) {
            char migrationStatus[16] = "";
            snprintf(migrationStatus, sizeof(migrationStatus), "cm,%u,%u", storedVersion, CONFIG_VERSION);
            logAt(millis(), migrationStatus);
            D_PRINTLN(migrationStatus);
            D_PRINTLN("Stored config migrated");
            bootSource = CFG_BOOT_SOURCE_MIGRATED;
            recoveredStoredConfig = true;
            migrationSucceeded = true;
            migrationSaveSucceeded = saveConfig();
        } else {
            D_PRINTLN("Stored config invalid, loading defaults");
            if (!magicValid) {
                setConfigDefaults();
            }
            bootSource = CFG_BOOT_SOURCE_DEFAULTS;
        }
    }

    setBootHistoryConfigLoad(bootSource, magicValid, versionValid, crcValid, storedVersion,
                             CONFIG_VERSION, storedCrc, computedCrc, migrationAttempted,
                             migrationSucceeded, migrationSaveSucceeded);

    // cb,<boot_source>,<valid>,<magic_ok>,<version_ok>,<crc_ok>,<stored_version>
    char bootStatus[24] = "";
    snprintf(bootStatus, sizeof(bootStatus), "cb,%u,%u,%u,%u,%u,%u", bootSource, valid,
             magicValid, versionValid, crcValid, storedVersion);
    logAt(millis(), bootStatus);
    D_PRINTLN(bootStatus);

    // cc,<stored_crc_hex>,<computed_crc_hex>
    char crcStatus[24] = "";
    snprintf(crcStatus, sizeof(crcStatus), "cc,%08lX,%08lX",
             static_cast<unsigned long>(storedCrc), static_cast<unsigned long>(computedCrc));
    logAt(millis(), crcStatus);
    D_PRINTLN(crcStatus);

    return recoveredStoredConfig;
}

bool saveConfig() {
    s_config.crc = computeCrc(s_config);

    Config stored;
    EEPROM.get(0, stored);
    char saveStatus[8] = "";
    if (memcmp(&stored, &s_config, sizeof(Config)) == 0) {
        snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_NO_CHANGE);
        logAt(millis(), saveStatus);
        D_PRINTLN(saveStatus);
        return true;
    }

    EEPROM.put(0, s_config);
    if (!EEPROM.commit()) {
        snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_COMMIT_FAILED);
        logAt(millis(), saveStatus);
        D_PRINTLN(saveStatus);
        return false;
    }
    snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_COMMITTED);
    logAt(millis(), saveStatus);
    D_PRINTLN(saveStatus);
    return true;
}
