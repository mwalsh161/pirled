#include <limits.h>
#include <pins.h>

#include <cstring>

#include "AppState.h"
#include "Led.h"
#include "Logger.h"
#include "PortalServer.h"
#include "debug.h"

namespace {
constexpr uint32_t RESET_TAP_RTC_SLOT =
    96;  // Keep clear of low RTC words used by OTA bootloader data.
constexpr uint32_t RESET_TAP_MAGIC = 0x44524431;  // "DRD1"
constexpr unsigned long RESET_TAP_WINDOW_MS = 5000;
constexpr uint32_t RESET_TAP_RESEED = 2;
constexpr uint32_t RESET_TAP_PORTAL = 3;
constexpr uint32_t RESET_TAP_WIPE = 4;

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

bool isTapReset() {
    uint32_t reason = getResetReasonCode();
    // Some boards report pressing RESET as DEFAULT_RST instead of EXT_SYS_RST.
    return reason == REASON_EXT_SYS_RST || reason == REASON_DEFAULT_RST;
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

bool readStoredWiFiCredentials(char* ssid, size_t ssidSize, char* password, size_t passwordSize) {
    station_config conf;
    if (!wifi_station_get_config(&conf)) return false;

    size_t ssidLen = strnlen(reinterpret_cast<const char*>(conf.ssid), sizeof(conf.ssid));
    size_t passwordLen =
        strnlen(reinterpret_cast<const char*>(conf.password), sizeof(conf.password));
    if (ssidLen == 0 || ssidLen >= ssidSize || passwordLen >= passwordSize) return false;

    memcpy(ssid, conf.ssid, ssidLen);
    ssid[ssidLen] = '\0';
    memcpy(password, conf.password, passwordLen);
    password[passwordLen] = '\0';
    return true;
}

void reseedWiFiCredentials() {
    char ssid[33] = "";
    char password[65] = "";
    if (!readStoredWiFiCredentials(ssid, sizeof(ssid), password, sizeof(password))) {
        log("dr,4");  // reseed read failed
        return;
    }

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);
    WiFi.begin(ssid, password);
    WiFi.persistent(false);
    log("dr,5");  // reseed attempted
}

void wipeWiFiCredentials() {
    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);
    bool ok = WiFi.disconnect(true, true);  // disable STA + erase stored credentials
    WiFi.persistent(false);
    log(ok ? "dr,6" : "dr,7");  // 6=wipe ok, 7=wipe failed
}
}  // namespace

void runPortalBlocking() {
    D_PRINTLN("Staring portal server");
    PortalServer server;
    for (int i = 0; i < 4; i++) {
        analogWrite(D4, 1023);
        delay(100);
        analogWrite(D4, 0);
        delay(100);
    }
    while (true) {
        updateResetTapWindow();
        server.handle();  // Eventually will restart ESP.
        delay(1);
    }
}

void setup() {
    D_BEGIN(115200);
    D_PRINTLN("");

    uint32_t resetTapCount = readResetTapCountForBoot();
    D_PRINTF("Reset reason: %lu\n", getResetReasonCode());
    D_PRINTF("Tap candidate: %lu\n", static_cast<unsigned long>(resetTapCount));
    resetTapCount = finalizeResetTapCountAfterWindow();
    D_PRINTF("Tap final: %lu\n", static_cast<unsigned long>(resetTapCount));
    if (resetTapCount == RESET_TAP_RESEED) {
        D_PRINTLN("RESET_TAP_RESEED");
        reseedWiFiCredentials();
    } else if (resetTapCount == RESET_TAP_PORTAL) {
        D_PRINTLN("RESET_TAP_PORTAL");
        runPortalBlocking();
        D_PRINTLN("Not reachable");
        ESP.restart();  // Not reachable.
    } else if (resetTapCount == RESET_TAP_WIPE) {
        D_PRINTLN("RESET_TAP_WIPE");
        wipeWiFiCredentials();
        clearResetTapState();  // prevent repeated wipe loops without additional taps
    } else {
        D_PRINTLN("NO_TAP");
    }

    analogWriteResolution(10);  // For Leds.
    CONFIG_SERVER.setup();

    WIFI_MGR.setup("pirled-");
    WIFI_MGR.subscribe([](const char* hostname) { CONFIG_SERVER.onWiFiConnected(hostname); },
                       []() { CONFIG_SERVER.onWiFiDisconnected(); });

    for (const auto& pin : PIR_PINS) {
        pinMode(pin, INPUT);
    }
    for (auto& ledController : LEDS) {
        ledController.setup();
    }
}

void loop() {
    auto now = millis();
    updateResetTapWindow();

    PIR_STATES = 0;
    for (size_t i = 0; i < PIR_PINS.size(); i++) {
        PIR_STATES |= (digitalRead(PIR_PINS[i]) == HIGH) << i;
    }
    PIR_STATES |= CONFIG_SERVER.pirOverrides();

    for (size_t i = 0; i < LEDS.size(); i++) {
        LEDS[i].update(now, PIR_STATES);
    }

    if (WIFI_MGR.update(now)) {
        CONFIG_SERVER.handle();
    }
}
