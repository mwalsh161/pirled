#include "system/PersistentStorage.h"

#include <EEPROM.h>

namespace {
bool s_initialized = false;
}

size_t persistentBootHistoryOffset() { return CONFIG_EEPROM_OFFSET + LEGACY_CONFIG_STORAGE_BYTES; }

size_t persistentStorageSize() {
    return persistentBootHistoryOffset() + BOOT_HISTORY_STORAGE_BYTES;
}

bool beginPersistentStorage() {
    if (s_initialized) return true;
    EEPROM.begin(persistentStorageSize());
    s_initialized = true;
    return s_initialized;
}
