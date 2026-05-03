#include "board/BoardPins.h"

#include <Arduino.h>
#include "board/RuntimeState.h"
#include "net/StoredWiFiCredentials.h"
#include "net/PortalServer.h"
#include "system/Logger.h"
#include "system/ResetTap.h"
#include "debug.h"

namespace {
constexpr uint32_t WIFI_RESEED_RTC_SLOT =
    100;  // Separate from reset-tap RTC words so restart loops stay isolated.
constexpr uint32_t WIFI_RESEED_MAGIC = 0x57524631;  // "WRF1"

struct WiFiReseedState {
    uint32_t magic;
    uint32_t value;
};

bool writeWiFiReseedState(uint32_t value) {
    WiFiReseedState state{.magic = value == 0 ? 0U : WIFI_RESEED_MAGIC, .value = value};
    return ESP.rtcUserMemoryWrite(WIFI_RESEED_RTC_SLOT, reinterpret_cast<uint32_t*>(&state),
                                  sizeof(state));
}

bool readWiFiReseedState(WiFiReseedState& state) {
    if (!ESP.rtcUserMemoryRead(WIFI_RESEED_RTC_SLOT, reinterpret_cast<uint32_t*>(&state),
                               sizeof(state))) {
        return false;
    }
    return state.magic == WIFI_RESEED_MAGIC;
}

void clearWiFiReseedMarker() {
    if (!writeWiFiReseedState(0)) {
        logAt(millis(), "dr,9");  // reseed rtc clear failed
    }
}

bool reseedWiFiCredentials() {
    char ssid[33] = "";
    char password[65] = "";
    if (!readStoredWiFiCredentials(ssid, sizeof(ssid), password, sizeof(password))) {
        logAt(millis(), "dr,4");  // reseed read failed
        return false;
    }

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);
    WiFi.begin(ssid, password);
    WiFi.mode(WIFI_STA);  // Preserve STA as the SDK default mode for next boot.
    WiFi.persistent(false);
    delay(500);
    logAt(millis(), "dr,5");  // reseed attempted
    return true;
}

void wipeWiFiCredentials() {
    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);
    bool ok = WiFi.disconnect(true, true);  // disable STA + erase stored credentials
    WiFi.persistent(false);
    logAt(millis(), ok ? "dr,6" : "dr,7");  // 6=wipe ok, 7=wipe failed
}

void maybeAutoReseedWiFiCredentials(uint32_t resetTapCount) {
    if (resetTapCount == RESET_TAP_PORTAL || resetTapCount == RESET_TAP_WIPE) {
        return;
    }

    WiFiReseedState state{};
    if (readWiFiReseedState(state) && state.value == 1) {
        logAt(millis(), "dr,10");  // auto-reseed marker seen
        clearWiFiReseedMarker();
        return;
    }

    if (!hasStoredWiFiCredentials()) {
        logAt(millis(), "dr,11");  // auto-reseed skipped: no credentials
        return;
    }

    if (!writeWiFiReseedState(1)) {
        logAt(millis(), "dr,12");  // auto-reseed marker write failed
        return;
    }

    logAt(millis(), "dr,13");  // auto-reseed boot write
    if (!reseedWiFiCredentials()) {
        clearWiFiReseedMarker();
        return;
    }
    logAt(millis(), "dr,14");  // auto-reseed restart requested
    delay(100);
    ESP.restart();
}
}  // namespace

void runPortalBlocking() {
    D_PRINTLN("Starting portal server");
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
    D_PRINTF("Reset reason: %lu\n", static_cast<unsigned long>(getResetReasonCode()));
    D_PRINTF("Tap candidate: %lu\n", static_cast<unsigned long>(resetTapCount));
    resetTapCount = finalizeResetTapCountAfterWindow();
    D_PRINTF("Tap final: %lu\n", static_cast<unsigned long>(resetTapCount));
    if (resetTapCount == RESET_TAP_PORTAL) {
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

    maybeAutoReseedWiFiCredentials(resetTapCount);

    analogWriteResolution(10);  // For Leds.
    CONFIG_SERVER.setup();

    WIFI_MGR.setup("pirled-");
    WIFI_MGR.subscribe([](const char* hostname) { CONFIG_SERVER.onWiFiConnected(hostname); },
                       []() { CONFIG_SERVER.onWiFiDisconnected(); });
    WIFI_MGR.subscribe([](const char* hostname) { REMOTE_PIRS.onWiFiConnected(hostname); },
                       []() { REMOTE_PIRS.onWiFiDisconnected(); });

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

    PirStates localPirStates = 0;
    for (size_t i = 0; i < PIR_PINS.size(); i++) {
        localPirStates |= static_cast<PirStates>(digitalRead(PIR_PINS[i]) == HIGH) << i;
    }
    REMOTE_PIRS.update(now, localPirStates);
    PIR_STATES = localPirStates | CONFIG_SERVER.pirOverrides() | REMOTE_PIRS.remotePirStates();

    for (size_t i = 0; i < LEDS.size(); i++) {
        LEDS[i].update(now, PIR_STATES);
    }

    if (WIFI_MGR.update(now)) {
        CONFIG_SERVER.handle();
    }
}
