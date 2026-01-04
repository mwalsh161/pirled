#include <ESP8266WiFi.h>
#include <limits.h>
#include <pins.h>

#include "LedControl.h"
#include "PortalServer.h"

#define WIFI_TIMEOUT_MS 10000
#define TIMEOFF_WAIT 10000

LedControl statusLed;
LedControl mainLed;

enum class ControlState {
    OFF,
    ON,          // PIR currently active
    WAITING_OFF  // PIR inactive, off timer running
};

static ControlState state = ControlState::OFF;
static unsigned long offRequested = 0;

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
    statusLed.setMode(LedControl::Mode::BLINK);

    return waitForWiFi();
}

void runPortalBlocking() {
    statusLed.setMode(LedControl::Mode::FADE);

    PortalServer server;
    while (true) {
        statusLed.update(millis());
        server.handle();  // Eventually will restart ESP.
    }
}

void setup() {
    Serial.begin(115200);
    statusLed.begin(D4, true);
    mainLed.begin(D1, false);
    pinMode(D2, INPUT);

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);

    if (!tryConnectStoredWiFi()) {
        runPortalBlocking();
    }
    statusLed.setMode(LedControl::Mode::OFF);

    mainLed.setFreq(0.3);

    unsigned long now = millis();
    statusLed.update(now);
    mainLed.update(now);
}

void loop() {
    unsigned long now = millis();
    bool pirActive = (digitalRead(D2) == HIGH);

    switch (state) {
        case ControlState::OFF:
            if (pirActive) {
                Serial.println("ON");
                mainLed.setMode(LedControl::Mode::FADE_ON);
                state = ControlState::ON;
            }
            break;

        case ControlState::ON:
            if (!pirActive) {
                Serial.println("OFF SCHEDULED");
                offRequested = now;
                state = ControlState::WAITING_OFF;
            }
            break;

        case ControlState::WAITING_OFF:
            if (pirActive) {
                Serial.println("OFF CANCELED");
                state = ControlState::ON;
            } else if ((long)(now - offRequested) >= TIMEOFF_WAIT) {
                Serial.println("OFF");
                mainLed.setMode(LedControl::Mode::FADE_OFF);
                state = ControlState::OFF;
            }
            break;
    }

    mainLed.update(now);
}
