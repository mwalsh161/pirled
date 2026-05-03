#pragma once

#include <stddef.h>

#include "config/ConfigStore.h"

constexpr size_t CONFIG_EEPROM_OFFSET = 0;
// Reserve enough space for the largest legacy config layout before any newer metadata.
constexpr size_t LEGACY_CONFIG_STORAGE_BYTES = 768;
constexpr size_t BOOT_HISTORY_STORAGE_BYTES = 256;
constexpr size_t STATIC_NETWORK_CONFIG_STORAGE_BYTES = 32;

static_assert(sizeof(Config) <= LEGACY_CONFIG_STORAGE_BYTES,
              "Current config must fit before boot-history storage.");

size_t persistentBootHistoryOffset();
size_t persistentStaticNetworkConfigOffset();
size_t persistentStorageSize();
bool beginPersistentStorage();
