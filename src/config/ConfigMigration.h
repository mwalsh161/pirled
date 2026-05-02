#pragma once

#include <stdint.h>

#include "config/ConfigStore.h"

bool migrateStoredConfig(uint16_t storedVersion, Config& targetConfig);
