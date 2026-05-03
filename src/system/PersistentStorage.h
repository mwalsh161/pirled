#pragma once

#include <stddef.h>

#include "config/ConfigStore.h"

constexpr size_t CONFIG_EEPROM_OFFSET = 0;
constexpr size_t BOOT_HISTORY_STORAGE_BYTES = 256;

size_t persistentBootHistoryOffset();
size_t persistentStorageSize();
bool beginPersistentStorage();
