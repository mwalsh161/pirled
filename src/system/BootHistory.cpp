#include "system/BootHistory.h"

#include <Arduino.h>
#include <EEPROM.h>
#include <string.h>

#include "system/PersistentStorage.h"

namespace {
constexpr uint32_t BOOT_HISTORY_MAGIC = 0x42544831;  // "BTH1"
constexpr uint16_t BOOT_HISTORY_VERSION = 1;

struct BootHistoryHeader {
    uint32_t magic;
    uint16_t version;
    uint16_t nextIndex;
    uint16_t count;
    uint16_t reserved;
    uint32_t bootCounter;
};

size_t bootHistoryHeaderOffset() { return persistentBootHistoryOffset(); }

size_t bootHistoryRecordsOffset() { return bootHistoryHeaderOffset() + sizeof(BootHistoryHeader); }

size_t bootHistoryRecordOffset(size_t index) {
    return bootHistoryRecordsOffset() + (index * sizeof(BootHistoryRecord));
}

BootHistoryHeader s_header{};
BootHistoryRecord s_currentRecord{};
size_t s_currentIndex = 0;
bool s_currentRecordValid = false;

bool commitHeaderAndCurrentRecord() {
    if (!beginPersistentStorage()) return false;
    EEPROM.put(bootHistoryHeaderOffset(), s_header);
    if (s_currentRecordValid) {
        EEPROM.put(bootHistoryRecordOffset(s_currentIndex), s_currentRecord);
    }
    return EEPROM.commit();
}

bool commitCurrentRecordIfChanged(const BootHistoryRecord& previousRecord) {
    if (!s_currentRecordValid) return false;
    if (memcmp(&previousRecord, &s_currentRecord, sizeof(s_currentRecord)) == 0) return true;
    return commitHeaderAndCurrentRecord();
}

void initializeStorageIfNeeded() {
    if (!beginPersistentStorage()) return;

    EEPROM.get(bootHistoryHeaderOffset(), s_header);
    if (s_header.magic == BOOT_HISTORY_MAGIC && s_header.version == BOOT_HISTORY_VERSION &&
        s_header.nextIndex < BOOT_HISTORY_MAX_RECORDS &&
        s_header.count <= BOOT_HISTORY_MAX_RECORDS) {
        return;
    }

    memset(&s_header, 0, sizeof(s_header));
    s_header.magic = BOOT_HISTORY_MAGIC;
    s_header.version = BOOT_HISTORY_VERSION;

    for (size_t i = 0; i < BOOT_HISTORY_MAX_RECORDS; i++) {
        BootHistoryRecord empty{};
        EEPROM.put(bootHistoryRecordOffset(i), empty);
    }
    EEPROM.put(bootHistoryHeaderOffset(), s_header);
    EEPROM.commit();
}

void setFlag(uint16_t flag, bool enabled) {
    if (enabled) {
        s_currentRecord.flags |= flag;
    } else {
        s_currentRecord.flags &= static_cast<uint16_t>(~flag);
    }
}
}  // namespace

void initBootHistory(uint32_t resetReason, uint32_t tapCountCandidate) {
    initializeStorageIfNeeded();

    s_currentIndex = s_header.nextIndex;
    memset(&s_currentRecord, 0, sizeof(s_currentRecord));
    s_currentRecord.bootNumber = s_header.bootCounter + 1;
    s_currentRecord.resetReason = resetReason;
    s_currentRecord.currentVersion = CURRENT_CONFIG_VERSION;
    s_currentRecord.tapCountCandidate =
        static_cast<uint8_t>(min(tapCountCandidate, static_cast<uint32_t>(255)));
    s_currentRecord.tapCountFinal = s_currentRecord.tapCountCandidate;
    s_currentRecord.bootSource = CFG_BOOT_SOURCE_STORED;

    s_header.bootCounter = s_currentRecord.bootNumber;
    s_header.nextIndex = static_cast<uint16_t>((s_currentIndex + 1) % BOOT_HISTORY_MAX_RECORDS);
    if (s_header.count < BOOT_HISTORY_MAX_RECORDS) s_header.count++;
    s_currentRecordValid = true;
    commitHeaderAndCurrentRecord();
}

void setBootHistoryTapCountFinal(uint32_t tapCountFinal) {
    if (!s_currentRecordValid) return;
    BootHistoryRecord previousRecord = s_currentRecord;
    s_currentRecord.tapCountFinal =
        static_cast<uint8_t>(min(tapCountFinal, static_cast<uint32_t>(255)));
    commitCurrentRecordIfChanged(previousRecord);
}

void setBootHistoryConfigLoad(uint8_t bootSource, bool magicValid, bool versionValid, bool crcValid,
                              uint16_t storedVersion, uint16_t currentVersion, uint32_t storedCrc,
                              uint32_t computedCrc, bool migrationAttempted,
                              bool migrationSucceeded, bool migrationSaveSucceeded) {
    if (!s_currentRecordValid) return;
    BootHistoryRecord previousRecord = s_currentRecord;
    s_currentRecord.bootSource = bootSource;
    s_currentRecord.storedVersion = storedVersion;
    s_currentRecord.currentVersion = currentVersion;
    s_currentRecord.storedCrc = storedCrc;
    s_currentRecord.computedCrc = computedCrc;
    setFlag(BOOT_FLAG_MAGIC_VALID, magicValid);
    setFlag(BOOT_FLAG_VERSION_VALID, versionValid);
    setFlag(BOOT_FLAG_CRC_VALID, crcValid);
    setFlag(BOOT_FLAG_MIGRATION_ATTEMPTED, migrationAttempted);
    setFlag(BOOT_FLAG_MIGRATION_SUCCEEDED, migrationSucceeded);
    setFlag(BOOT_FLAG_MIGRATION_SAVE_SUCCEEDED, migrationSaveSucceeded);
    commitCurrentRecordIfChanged(previousRecord);
}

void setBootHistoryWiFiCredentialsPresent(bool present) {
    if (!s_currentRecordValid) return;
    BootHistoryRecord previousRecord = s_currentRecord;
    setFlag(BOOT_FLAG_WIFI_CREDS_PRESENT, present);
    commitCurrentRecordIfChanged(previousRecord);
}

void setBootHistoryStaticNetworkPresent(bool present) {
    if (!s_currentRecordValid) return;
    BootHistoryRecord previousRecord = s_currentRecord;
    setFlag(BOOT_FLAG_STATIC_NETWORK_PRESENT, present);
    commitCurrentRecordIfChanged(previousRecord);
}

void markBootHistoryWiFiWipe(bool success) {
    if (!s_currentRecordValid) return;
    BootHistoryRecord previousRecord = s_currentRecord;
    setFlag(BOOT_FLAG_WIFI_WIPE_ATTEMPTED, true);
    setFlag(BOOT_FLAG_WIFI_WIPE_SUCCEEDED, success);
    commitCurrentRecordIfChanged(previousRecord);
}

size_t readBootHistoryRecords(BootHistoryRecord* records, size_t maxRecords) {
    if (!records || maxRecords == 0) return 0;

    initializeStorageIfNeeded();

    size_t count = min(static_cast<size_t>(s_header.count), maxRecords);
    size_t startIndex = (s_header.count == BOOT_HISTORY_MAX_RECORDS) ? s_header.nextIndex : 0;

    for (size_t i = 0; i < count; i++) {
        size_t recordIndex = (startIndex + i) % BOOT_HISTORY_MAX_RECORDS;
        EEPROM.get(bootHistoryRecordOffset(recordIndex), records[i]);
    }
    return count;
}
