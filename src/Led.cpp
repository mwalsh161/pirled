#include <ESP8266WiFi.h>
#include <Led.h>

void Led::setup() {
    pinMode(m_ledPin, OUTPUT);
    analogWriteRange(m_ledMax);
    setMode(Mode::OFF);
}

void Led::update(unsigned long now) {
    float elapsedSec;
    float deltaBrightness;

    switch (m_mode) {
        case Mode::OFF:
            m_brightness = 0;
            m_lastUpdate = now;
            break;

        case Mode::FADE_OFF:
            if (m_lastUpdate == 0) {
                m_brightness = m_ledMax;
                m_lastUpdate = now;
                break;
            }
            elapsedSec = (now - m_lastUpdate) / 1000.0f;  // convert ms to seconds
            deltaBrightness = m_freq * 2.0f * m_ledMax * elapsedSec;

            if (deltaBrightness >= 1) {
                m_brightness = max(0, m_brightness - m_fadeDirection * (int)deltaBrightness);
                m_lastUpdate = now;
            }
            break;

        case Mode::FADE_ON:
            if (m_lastUpdate == 0) {
                m_brightness = 0;
                m_lastUpdate = now;
                break;
            }
            elapsedSec = (now - m_lastUpdate) / 1000.0f;  // convert ms to seconds
            deltaBrightness = m_freq * 2.0f * m_ledMax * elapsedSec;

            if (deltaBrightness >= 1) {
                m_brightness = min(m_ledMax, m_brightness + m_fadeDirection * (int)deltaBrightness);
                m_lastUpdate = now;
            }
            break;

        case Mode::FADE:
            elapsedSec = (now - m_lastUpdate) / 1000.0f;  // convert ms to seconds
            deltaBrightness = m_freq * 2.0f * m_ledMax * elapsedSec;

            if (deltaBrightness >= 1) {
                m_brightness += m_fadeDirection * (int)deltaBrightness;

                // Bounce at the bounds
                if (m_brightness <= 0) {
                    m_brightness = 0;
                    m_fadeDirection = 1;  // switch direction
                } else if (m_brightness >= m_ledMax) {
                    m_brightness = m_ledMax;
                    m_fadeDirection = -1;  // switch direction
                }

                m_lastUpdate = now;
            }
            break;

        case Mode::BLINK:
            if (now - m_lastUpdate >= 150) {
                m_brightness = (m_brightness == 0) ? m_ledMax : 0;
                m_lastUpdate = now;
            }
            break;
    }
    applyOutput();
}

void Led::applyOutput() {
    int pwmValue = m_brightness;
    if (m_inv) {
        pwmValue = m_ledMax - pwmValue;
    }
    if (pwmValue != m_lastWritten) {
        analogWrite(m_ledPin, pwmValue);
        m_lastWritten = pwmValue;
    }
}