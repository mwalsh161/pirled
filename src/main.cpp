#include "PortalServer.h"
#include "WifiCreds.h"
#include "StatusLed.h"

#include <ESP8266WiFi.h>
#include <EEPROM.h>

/* ---------------- Configuration ---------------- */

#define LED_PIN 2          // Most ESP8266 boards (active LOW)
#define LED_MAX 1023       // ESP8266 PWM resolution

/* ---------------- Globals ---------------- */

StatusLed statusLed;

/* ---------------- WiFi ---------------- */

bool connectWifi(const WifiCreds& creds) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(creds.ssid, creds.pass);
    
    unsigned long start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        statusLed.update();
        delay(10);
        
        if (millis() - start > 10000) {
            statusLed.setMode(StatusLed::Mode::ERROR);
            return false;
        }
    }
    
    statusLed.setMode(StatusLed::Mode::OFF);
    return true;
}

/* ---------------- Arduino ---------------- */

void setup() {
    WifiCreds creds; // No need to initialize here; loadCreds will.
    
    statusLed.begin(LED_PIN, LED_MAX);
    Serial.begin(115200);
    
    if (!loadCreds(creds) || !connectWifi(creds)) {
        statusLed.setMode(StatusLed::Mode::FADE);
    
        WiFi.mode(WIFI_AP);
        WiFi.softAP("Motion LED Setup");
        
        PortalServer::begin(WiFi.softAPIP(), saveCreds);
    }
}

void loop() {
    statusLed.update();
    PortalServer::handle();
}
