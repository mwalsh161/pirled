#include <Config.h>
#include <Controller.h>
#include <ESP8266WiFi.h>
#include <limits.h>
#include <pins.h>

#include "Led.h"
#include "PortalServer.h"
#include "debug.h"

#define WIFI_TIMEOUT_MS 10000

struct ControllerConfig {
    Controller controller;
    const uint8_t& pirMask;
};

ControllerConfig makeController(uint8_t pin, LedConfig& ledCfg) {
    return {{pin, ledCfg.brightness, ledCfg.rampOnMs, ledCfg.holdOnMs, ledCfg.rampOffMs},
            ledCfg.pirMask};
}

std::array<ControllerConfig, 4> configs = {{
    makeController(D4, g_config.ledConfig[0]),  // oof D4...epileptic on reset.
    makeController(D8, g_config.ledConfig[1]),
    makeController(D1, g_config.ledConfig[2]),
    makeController(D3, g_config.ledConfig[3]),
}};
std::array<uint8_t, 4> pirPins{D6, D7, D2, D5};
PirStates pirStates = 0;

ConfigServer configServer{"pirled-controller"};  // TODO: use mac addr to make unique

/* ---------------- Arduino ---------------- */

bool waitForWiFi() {
    auto start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
        delay(10);
    }
    return WiFi.status() == WL_CONNECTED;  // I've seen this report not connected again...
}

bool tryConnectStoredWiFi() {
    if (strlen(g_config.wifiSsid) == 0) return false;

    WiFi.setHostname(g_config.hostname);
    WiFi.begin(g_config.wifiSsid, g_config.wifiPassword);

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

    for (const auto& pin : pirPins) {
        pinMode(pin, INPUT);
    }
    for (auto& config : configs) {
        config.controller.setup();
    }

    // WiFi.macAddress().replace(":", "");
    configServer.begin();

    // Link states for reporting.
    std::array<const int16_t*, 4> brightnessPtrs = {};
    std::array<const uint8_t*, 4> statePtrs = {};
    for (size_t i = 0; i < configs.size(); i++) {
        brightnessPtrs[i] = configs[i].controller.getBrightnessPtr();
        statePtrs[i] = reinterpret_cast<const uint8_t*>(configs[i].controller.getStatePtr());
    }
    configServer.linkState(&pirStates, statePtrs, brightnessPtrs);
}

void loop() {
    auto now = millis();

    configServer.handle(now);

    pirStates = 0;
    for (size_t i = 0; i < pirPins.size(); i++) {
        pirStates |= (digitalRead(pirPins[i]) == HIGH) << i;
    }
    pirStates |= configServer.getPirOverrides();

    for (size_t i = 0; i < configs.size(); i++) {
        configs[i].controller.update(now, pirStates & configs[i].pirMask);
    }
}
