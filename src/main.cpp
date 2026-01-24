#include <ESP8266WiFi.h>
#include <limits.h>
#include <pins.h>

#include "AppState.h"
#include "Led.h"
#include "PortalServer.h"
#include "debug.h"

bool waitForWiFi() {
    auto start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < 10000) {
        delay(10);
    }
    return WiFi.status() == WL_CONNECTED;  // I've seen this report not connected again...
}

bool tryConnectStoredWiFi() {
    if (strlen(CONFIG.wifiSsid) == 0) return false;

    WiFi.setHostname(CONFIG.hostname);
    WiFi.begin(CONFIG.wifiSsid, CONFIG.wifiPassword);

    return waitForWiFi();
}

void runPortalBlocking() {
    PortalServer server;
    for (int i = 0; i < 4; i++) {
        analogWrite(D4, 1023);
        delay(100);
        analogWrite(D4, 0);
        delay(100);
    }
    while (true) {
        server.handle();  // Eventually will restart ESP.
    }
}

void setup() {
    D_BEGIN(9600);

    WiFi.mode(WIFI_STA);
    WiFi.persistent(false);     // We manage in config separately.
    analogWriteResolution(10);  // For Leds.

    if (!tryConnectStoredWiFi()) {
        runPortalBlocking();
    }  // Will not return unless connected (possible it could disconnect again...state machine?).

    for (const auto& pin : PIR_PINS) {
        pinMode(pin, INPUT);
    }
    for (auto& config : LEDS) {
        config.controller.setup();
    }

    CONFIG_SERVER.begin();

    // Link states for reporting.
    std::array<const int16_t*, 4> brightnessPtrs = {};
    std::array<const uint8_t*, 4> statePtrs = {};
    for (size_t i = 0; i < LEDS.size(); i++) {
        brightnessPtrs[i] = LEDS[i].controller.getBrightnessPtr();
        statePtrs[i] = reinterpret_cast<const uint8_t*>(LEDS[i].controller.getStatePtr());
    }
    CONFIG_SERVER.linkState(&PIR_STATES, statePtrs, brightnessPtrs);
}

void loop() {
    auto now = millis();

    CONFIG_SERVER.handle(now);

    PIR_STATES = 0;
    for (size_t i = 0; i < PIR_PINS.size(); i++) {
        PIR_STATES |= (digitalRead(PIR_PINS[i]) == HIGH) << i;
    }
    PIR_STATES |= CONFIG_SERVER.getPirOverrides();

    for (size_t i = 0; i < LEDS.size(); i++) {
        LEDS[i].controller.update(now, PIR_STATES & LEDS[i].pirMask);
    }
}
