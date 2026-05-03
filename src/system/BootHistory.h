#pragma once

#include <stddef.h>
#include <stdint.h>

struct BootHistoryRecord {
    uint32_t bootNumber;
    uint32_t resetReason;
    uint32_t storedCrc;
    uint32_t computedCrc;
    uint16_t storedVersion;
    uint16_t currentVersion;
    uint16_t flags;
    uint8_t tapCountCandidate;
    uint8_t tapCountFinal;
    uint8_t bootSource;
    uint8_t reserved;
};

constexpr size_t BOOT_HISTORY_MAX_RECORDS = 8;

enum BootHistoryFlags : uint16_t {
    BOOT_FLAG_MAGIC_VALID = 1U << 0,
    BOOT_FLAG_VERSION_VALID = 1U << 1,
    BOOT_FLAG_CRC_VALID = 1U << 2,
    BOOT_FLAG_MIGRATION_ATTEMPTED = 1U << 3,
    BOOT_FLAG_MIGRATION_SUCCEEDED = 1U << 4,
    BOOT_FLAG_MIGRATION_SAVE_SUCCEEDED = 1U << 5,
    BOOT_FLAG_WIFI_CREDS_PRESENT = 1U << 6,
    BOOT_FLAG_WIFI_WIPE_ATTEMPTED = 1U << 7,
    BOOT_FLAG_WIFI_WIPE_SUCCEEDED = 1U << 8,
    // Bits 9-12 were previously auto-reseed flags. Leave them unused so older
    // boot-history records do not get mislabeled after the static-IP transition.
    BOOT_FLAG_STATIC_NETWORK_PRESENT = 1U << 13,
};

void initBootHistory(uint32_t resetReason, uint32_t tapCountCandidate);
void setBootHistoryTapCountFinal(uint32_t tapCountFinal);
void setBootHistoryConfigLoad(uint8_t bootSource, bool magicValid, bool versionValid, bool crcValid,
                              uint16_t storedVersion, uint16_t currentVersion, uint32_t storedCrc,
                              uint32_t computedCrc, bool migrationAttempted,
                              bool migrationSucceeded, bool migrationSaveSucceeded);
void setBootHistoryWiFiCredentialsPresent(bool present);
void setBootHistoryStaticNetworkPresent(bool present);
void markBootHistoryWiFiWipe(bool success);

size_t readBootHistoryRecords(BootHistoryRecord* records, size_t maxRecords);
