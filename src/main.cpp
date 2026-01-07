#include <Controller.h>
#include <ESP8266WiFi.h>
#include <limits.h>
#include <pins.h>

#include "Led.h"
#include "PortalServer.h"

#define WIFI_TIMEOUT_MS 10000

struct ControllerConfig {
    Controller controller;
    uint8_t pirMask;
};

Led statusLed{D4, true, 2};

std::array<u_int8_t, 4> pirPins{D2, D5, D6, D7};
std::array<ControllerConfig, 4> configs{{
    {Controller{Led{D1, false, 0.3}}, 1 << 0},
    {Controller{Led{D3, false, 0.3}}, 1 << 1},
    {Controller{Led{D4, false, 0.3}}, 1 << 2},
    {Controller{Led{D8, false, 0.3}}, 1 << 3},
}};

/* ---------------- Arduino ---------------- */

bool waitForWiFi() {
    auto start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        auto now = millis();
        statusLed.update(now);

        if (now - start >= WIFI_TIMEOUT_MS) break;
        delay(10);
    }
    return WiFi.status() == WL_CONNECTED;
}

bool tryConnectStoredWiFi() {
    if (WiFi.SSID() == "") return false;

    WiFi.begin();
    statusLed.setMode(Led::Mode::BLINK);

    return waitForWiFi();
}

void runPortalBlocking() {
    statusLed.setMode(Led::Mode::FADE);

    PortalServer server;
    while (true) {
        statusLed.update(millis());
        server.handle();  // Eventually will restart ESP.
    }
}

void setup() {
    Serial.begin(115200);
    statusLed.setup();

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);

    if (!tryConnectStoredWiFi()) {
        runPortalBlocking();
    }

    for (auto pin : pirPins) {
        pinMode(pin, INPUT);
    }
    for (auto& config : configs) {
        config.controller.setup();
    }

    statusLed.setMode(Led::Mode::OFF);

    statusLed.update(millis());
}

void loop() {
    u_int8_t pirStates = 0;
    auto now = millis();

    for (size_t i = 0; i < pirPins.size(); i++) {
        pirStates |= (digitalRead(pirPins[i]) == HIGH) << i;
    }

    for (size_t i = 0; i < configs.size(); i++) {
        auto& config = configs[i];

        auto ogState = config.controller.getState();
        config.controller.update(now, pirStates & config.pirMask);
        if (ogState != config.controller.getState()) {
            Serial.printf("%d state: %d\n", i, static_cast<int>(config.controller.getState()));
        }
    }
}
