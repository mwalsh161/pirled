#include <Config.h>
#include <Controller.h>
#include <ESP8266WiFi.h>
#include <limits.h>
#include <pins.h>

#include "Led.h"
#include "PortalServer.h"

#define WIFI_TIMEOUT_MS 10000

float statusFadeFreq = 2.0f;
int statusBrightness = 1023;
Led statusLed{D4, true, statusFadeFreq, statusBrightness};

struct ControllerConfig {
    Controller controller;
    uint8_t pirMask;
};

ControllerConfig makeController(uint8_t pin, const LedConfig& ledCfg) {
    return {{{pin, false, ledCfg.fadeFreq, ledCfg.brightness}, ledCfg.onTimeMs}, ledCfg.pirMask};
}

std::array<ControllerConfig, 4> configs = {{
    makeController(D4, g_config.ledConfig[0]),
    makeController(D8, g_config.ledConfig[1]),
    makeController(D1, g_config.ledConfig[2]),
    makeController(D3, g_config.ledConfig[3]),
}};
std::array<uint8_t, 4> pirPins{D6, D7, D2, D5};

ConfigServer configServer;

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
    if (strlen(g_config.wifiSsid) == 0) return false;

    WiFi.setHostname(g_config.hostname);
    WiFi.begin(g_config.wifiSsid, g_config.wifiPassword);
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
    WiFi.persistent(false);  // We manage in config separately.

    if (!tryConnectStoredWiFi()) {
        runPortalBlocking();
    }  // Will not return unless connected.

    for (auto pin : pirPins) {
        pinMode(pin, INPUT);
    }
    for (auto& config : configs) {
        config.controller.setup();
    }

    configServer.begin();
    statusLed.setMode(Led::Mode::OFF);
    statusLed.update(millis());
}

void loop() {
    uint8_t pirStates = 0;
    auto now = millis();

    // Consider setting LED state to quickly example config change.
    configServer.handle(now);

    for (size_t i = 0; i < pirPins.size(); i++) {
        pirStates |= (digitalRead(pirPins[i]) == HIGH) << i;
    }

    for (size_t i = 0; i < configs.size(); i++) {
        auto& config = configs[i];
        config.controller.update(now, pirStates & config.pirMask);
    }
}
