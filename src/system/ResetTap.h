#pragma once

#include <stdint.h>

constexpr uint32_t RESET_TAP_PORTAL = 2;
constexpr uint32_t RESET_TAP_WIPE = 3;

void updateResetTapWindow();
uint32_t getResetReasonCode();
uint32_t readResetTapCountForBoot();
uint32_t finalizeResetTapCountAfterWindow();
void clearResetTapState();
