#include <ESP8266WiFi.h>

#include "LedControl.h"
#include "PortalServer.h"

#define MAIN_LED_PIN 5
#define STATUS_LED_PIN 2
#define LED_MAX 1023  // ESP8266 PWM resolution
#define WIFI_TIMEOUT_MS 10000

LedControl statusLed;
LedControl mainLed;

/* ---------------- Arduino ---------------- */

bool tryConnectStoredWiFi() {
    if (WiFi.SSID() == "") return false;

    WiFi.begin();
    statusLed.setMode(LedControl::Mode::BLINK);

    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
        statusLed.update();
        delay(10);
    }

    return WiFi.status() == WL_CONNECTED;
}

void runPortalBlocking() {
    statusLed.setMode(LedControl::Mode::FADE);

    PortalServer server;
    while (true) {
        statusLed.update();
        server.handle();  // Eventually will restart ESP.
    }
}

void setup() {
    Serial.begin(115200);
    statusLed.begin(STATUS_LED_PIN, LED_MAX);
    mainLed.begin(MAIN_LED_PIN, LED_MAX);

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);

    if (!tryConnectStoredWiFi()) {
        runPortalBlocking();
    }
    statusLed.setMode(LedControl::Mode::OFF);
    mainLed.setMode(LedControl::Mode::FADE);
}

void loop() {
    delay(10);
    statusLed.update();
    mainLed.update();
}
