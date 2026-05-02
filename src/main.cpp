#include <pins.h>

#include <cstring>

#include "AppState.h"
#include "Led.h"
#include "Logger.h"
#include "PortalServer.h"
#include "ResetTap.h"
#include "debug.h"

namespace {
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
