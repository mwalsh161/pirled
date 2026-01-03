#include <ESP8266WiFi.h>
#include <StatusLed.h>

void StatusLed::begin(uint8_t pin, int maxValue) {
    m_ledPin = pin;
    m_ledMax = maxValue;
    pinMode(m_ledPin, OUTPUT);
    analogWriteRange(m_ledMax);
    setMode(Mode::OFF);
}

void StatusLed::setMode(Mode m) {
    m_mode = m;
    m_lastUpdate = millis();
    m_brightness = (m_mode == Mode::FADE) ? 0 : m_ledMax;
    m_delta = 8;
    m_blinkOn = false;
    applyOutput();
}

void StatusLed::update() {
    unsigned long now = millis();

    switch (m_mode) {
        case Mode::FADE:
            if (now - m_lastUpdate >= 20) {
                m_brightness += m_delta;
                if (m_brightness <= 0 || m_brightness >= m_ledMax) {
                    m_delta = -m_delta;
                    m_brightness = constrain(m_brightness, 0, m_ledMax);
                }
                applyOutput();
                m_lastUpdate = now;
            }
            break;

        case Mode::ERROR:
            if (now - m_lastUpdate >= 150) {
                m_blinkOn = !m_blinkOn;
                applyOutput();
                m_lastUpdate = now;
            }
            break;

        case Mode::OFF:
        default:
            applyOutput();
            break;
    }
}

void StatusLed::applyOutput() {
    int output = m_ledMax;  // default off
    if (m_mode == Mode::FADE) {
        output = m_ledMax - m_brightness;
    } else if (m_mode == Mode::ERROR) {
        output = m_blinkOn ? 0 : m_ledMax;
    }
    analogWrite(m_ledPin, output);
}