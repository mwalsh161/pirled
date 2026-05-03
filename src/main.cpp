#include "board/BoardPins.h"

#include <Arduino.h>
#include "board/RuntimeState.h"
#include "net/PortalServer.h"
#include "net/StoredWiFiCredentials.h"
#include "system/BootHistory.h"
#include "system/Logger.h"
#include "system/ResetTap.h"
#include "system/StaticNetworkConfig.h"
#include "debug.h"

namespace {
bool s_warningBlinkOn = false;
unsigned long s_warningBlinkLastToggle = 0;

void wipeWiFiCredentials() {
    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);
    bool ok = WiFi.disconnect(true, true);  // disable STA + erase stored credentials
    WiFi.persistent(false);
    ok = clearStaticNetworkConfig() && ok;
    logAt(millis(), ok ? "dr,6" : "dr,7");  // 6=wipe ok, 7=wipe failed
    markBootHistoryWiFiWipe(ok);
}

void setupWarningBlink() {
    s_warningBlinkOn = false;
    s_warningBlinkLastToggle = 0;
    for (auto& ledController : LEDS) {
        ledController.setup();
    }
}

void updateWarningBlink() {
    unsigned long now = millis();
    if (now - s_warningBlinkLastToggle < 250) return;

    s_warningBlinkOn = !s_warningBlinkOn;
    s_warningBlinkLastToggle = now;
    for (auto& ledController : LEDS) {
        analogWrite(ledController.led().pin(), s_warningBlinkOn ? 1023 : 0);
    }
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
    initBootHistory(getResetReasonCode(), resetTapCount);
    D_PRINTF("Reset reason: %lu\n", static_cast<unsigned long>(getResetReasonCode()));
    D_PRINTF("Tap candidate: %lu\n", static_cast<unsigned long>(resetTapCount));
    if (resetTapCount == RESET_TAP_WIPE_ARM) {
        D_PRINTLN("RESET_TAP_WIPE_ARM");
        analogWriteResolution(10);
        setupWarningBlink();
        resetTapCount = finalizeResetTapCountAfterWindow(updateWarningBlink);
    } else {
        resetTapCount = finalizeResetTapCountAfterWindow();
    }
    setBootHistoryTapCountFinal(resetTapCount);
    setBootHistoryWiFiCredentialsPresent(hasStoredWiFiCredentials());
    StaticNetworkConfig staticNetworkConfig{};
    setBootHistoryStaticNetworkPresent(
        loadStaticNetworkConfig(staticNetworkConfig) && staticNetworkConfig.enabled);
    D_PRINTF("Tap final: %lu\n", static_cast<unsigned long>(resetTapCount));
    if (resetTapCount == RESET_TAP_PORTAL) {
        D_PRINTLN("RESET_TAP_PORTAL");
        runPortalBlocking();
        D_PRINTLN("Not reachable");
        ESP.restart();  // Not reachable.
    } else if (resetTapCount == RESET_TAP_WIPE_ARM) {
        D_PRINTLN("RESET_TAP_WIPE_ARM_EXPIRED");
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
