#include <limits.h>
#include <pins.h>

#include "AppState.h"
#include "Led.h"
#include "PortalServer.h"
#include "debug.h"

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
        server.handle();  // Eventually will restart ESP.
        delay(1);
    }
}

void setup() {
    D_BEGIN(115200);
    D_PRINTLN("");

    analogWriteResolution(10);  // For Leds.
    CONFIG_SERVER.setup();

    WIFI_MGR.setup("pirled-");
    WIFI_MGR.subscribe([](const char* hostname) { CONFIG_SERVER.onWiFiConnected(hostname); },
                       []() { CONFIG_SERVER.onWiFiDisconnected(); });

    if (!WIFI_MGR.hasCredentials()) {
        runPortalBlocking();
        D_PRINTLN("Not reachable");
        ESP.restart();  // Not reachable.
    }  // Will not return unless connected (possible it could disconnect again...state machine?).

    for (const auto& pin : PIR_PINS) {
        pinMode(pin, INPUT);
    }
    for (auto& ledController : LEDS) {
        ledController.setup();
    }
}

void loop() {
    auto now = millis();

    if (WIFI_MGR.update(now)) {
        CONFIG_SERVER.handle(now);
    }

    PIR_STATES = 0;
    for (size_t i = 0; i < PIR_PINS.size(); i++) {
        PIR_STATES |= (digitalRead(PIR_PINS[i]) == HIGH) << i;
    }
    PIR_STATES |= CONFIG_SERVER.pirOverrides();

    for (size_t i = 0; i < LEDS.size(); i++) {
        LEDS[i].update(now, PIR_STATES);
    }
}
