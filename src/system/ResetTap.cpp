#include "ResetTap.h"

#include <Arduino.h>
#include <limits.h>

extern "C" {
#include <user_interface.h>
}

#include "system/Logger.h"

namespace {
constexpr uint32_t RESET_TAP_RTC_SLOT =
    96;  // Keep clear of low RTC words used by OTA bootloader data.
constexpr uint32_t RESET_TAP_MAGIC = 0x44524431;  // "DRD1"
constexpr unsigned long RESET_TAP_WINDOW_MS = 5000;

struct ResetTapState {
    uint32_t magic;
    uint32_t tapCount;
};

bool s_resetTapActiveThisBoot = false;
unsigned long s_resetTapStartedAtMs = 0;

void writeResetTapState(uint32_t tapCount) {
    ResetTapState state{.magic = RESET_TAP_MAGIC, .tapCount = tapCount};
    if (!ESP.rtcUserMemoryWrite(RESET_TAP_RTC_SLOT, reinterpret_cast<uint32_t*>(&state),
                                sizeof(state))) {
        log("dr,8");  // rtc write failed
    }
}

bool readResetTapState(ResetTapState& state) {
    if (!ESP.rtcUserMemoryRead(RESET_TAP_RTC_SLOT, reinterpret_cast<uint32_t*>(&state),
                               sizeof(state))) {
        return false;
    }
    return state.magic == RESET_TAP_MAGIC;
}

bool isTapReset() {
    uint32_t reason = getResetReasonCode();
    // Some boards report pressing RESET as DEFAULT_RST instead of EXT_SYS_RST.
    return reason == REASON_EXT_SYS_RST || reason == REASON_DEFAULT_RST;
}
}  // namespace

void clearResetTapState() {
    writeResetTapState(0);
    s_resetTapActiveThisBoot = false;
}

void updateResetTapWindow() {
    if (!s_resetTapActiveThisBoot) return;
    if (millis() - s_resetTapStartedAtMs < RESET_TAP_WINDOW_MS) return;
    clearResetTapState();
}

uint32_t getResetReasonCode() {
    const rst_info* reset = ESP.getResetInfoPtr();
    return reset ? static_cast<uint32_t>(reset->reason) : UINT_MAX;
}

uint32_t readResetTapCountForBoot() {
    if (!isTapReset()) {
        clearResetTapState();
        return 0;
    }

    ResetTapState state{};
    uint32_t previousTapCount = 0;
    if (readResetTapState(state) && state.tapCount <= RESET_TAP_WIPE) {
        previousTapCount = state.tapCount;
    }

    uint32_t currentTapCount = (previousTapCount >= RESET_TAP_WIPE) ? 1 : previousTapCount + 1;
    writeResetTapState(currentTapCount);
    s_resetTapActiveThisBoot = true;
    s_resetTapStartedAtMs = millis();

    char tapLog[16] = "";
    snprintf(tapLog, sizeof(tapLog), "dr,%lu", static_cast<unsigned long>(currentTapCount));
    log(tapLog);
    return currentTapCount;
}

uint32_t finalizeResetTapCountAfterWindow() {
    if (!s_resetTapActiveThisBoot) return 0;

    while (millis() - s_resetTapStartedAtMs < RESET_TAP_WINDOW_MS) {
        delay(10);
    }

    ResetTapState state{};
    uint32_t finalTapCount = 0;
    if (readResetTapState(state) && state.tapCount <= RESET_TAP_WIPE) {
        finalTapCount = state.tapCount;
    }

    clearResetTapState();
    return finalTapCount;
}
