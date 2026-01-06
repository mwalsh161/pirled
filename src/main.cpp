#include <Controller.h>
#include <ESP8266WiFi.h>
#include <limits.h>
#include <pins.h>

#include "Led.h"
#include "PortalServer.h"

#define WIFI_TIMEOUT_MS 10000

Led statusLed = Led(D4, true, 2);
Controller controller = Controller(Led(D1, false, 0.3), D2);

/* ---------------- Arduino ---------------- */

bool waitForWiFi() {
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        unsigned long now = millis();
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
    controller.setup();

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);

    if (!tryConnectStoredWiFi()) {
        runPortalBlocking();
    }
    statusLed.setMode(Led::Mode::OFF);

    unsigned long now = millis();
    statusLed.update(now);
}

void loop() {
    unsigned long now = millis();
    controller.update(now);
}
