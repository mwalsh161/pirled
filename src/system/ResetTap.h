#pragma once

#include <stdint.h>

constexpr unsigned long RESET_TAP_WINDOW_MS = 5000;
constexpr uint32_t RESET_TAP_PORTAL = 2;
constexpr uint32_t RESET_TAP_WIPE_ARM = 3;
constexpr uint32_t RESET_TAP_WIPE = 4;

using ResetTapWaitCallback = void (*)();

void updateResetTapWindow();
uint32_t getResetReasonCode();
uint32_t readResetTapCountForBoot();
uint32_t finalizeResetTapCountAfterWindow(ResetTapWaitCallback callback = nullptr);
void clearResetTapState();
