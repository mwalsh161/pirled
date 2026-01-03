#include <ESP8266WiFi.h>
#include <LedControl.h>

void LedControl::begin(uint8_t pin, int maxValue) {
    m_ledPin = pin;
    m_ledMax = maxValue;
    pinMode(m_ledPin, OUTPUT);
    analogWriteRange(m_ledMax);
    setMode(Mode::OFF);
}

void LedControl::setMode(Mode m) {
    m_mode = m;
    update();
}

void LedControl::update() {
    unsigned long now = millis();

    switch (m_mode) {
        case Mode::OFF:
            if (m_brightness != 0) {
                m_brightness = 0;
                applyOutput();
            }
            break;

        case Mode::FADE:
            if (now - m_lastUpdate >= 20) {
                m_brightness += m_delta;
                if (m_brightness <= 0 || m_brightness >= m_ledMax) {
                    m_delta = -m_delta;
                    m_brightness = constrain(m_brightness, 0, m_ledMax);
                }
                m_lastUpdate = now;
                applyOutput();
            }
            break;

        case Mode::BLINK:
            if (now - m_lastUpdate >= 150) {
                m_brightness = (m_brightness == 0) ? m_ledMax : 0;
                m_lastUpdate = now;
                applyOutput();
            }
            break;
    }
}

void LedControl::applyOutput() { analogWrite(m_ledPin, m_ledMax - m_brightness); }