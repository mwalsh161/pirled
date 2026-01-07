#include <ESP8266WiFi.h>
#include <Led.h>

void Led::setup() {
    pinMode(m_ledPin, OUTPUT);
    analogWriteRange(m_ledMax);
    setMode(Mode::OFF);
}

int getDeltaBrightness(unsigned long elapsedMs, float freq, int ledMax) {
    return static_cast<int>(freq * 2.0f * ledMax * elapsedMs / 1000.0f);
}

void Led::update(unsigned long now) {
    int deltaBrightness;
    // If m_lastUpdate==0, initialize timing for the current mode here
    // We spend one update cycle purely to make sure timing is correct.
    if (m_lastUpdate == 0) {
        m_lastUpdate = now;
        return;
    }

    switch (m_mode) {
        case Mode::OFF:
            m_brightness = 0;
            break;

        case Mode::FADE_OFF:
            deltaBrightness = getDeltaBrightness(now - m_lastUpdate, m_freq, m_ledMax);
            if (deltaBrightness) {
                m_brightness = max(0, m_brightness - deltaBrightness);
                m_lastUpdate = now;
            }
            break;

        case Mode::FADE_ON:
            deltaBrightness = getDeltaBrightness(now - m_lastUpdate, m_freq, m_ledMax);
            if (deltaBrightness) {
                m_brightness = min(m_ledMax, m_brightness + deltaBrightness);
                m_lastUpdate = now;
            }
            break;

        case Mode::FADE:
            deltaBrightness = getDeltaBrightness(now - m_lastUpdate, m_freq, m_ledMax);
            if (deltaBrightness) {
                m_brightness += m_fadeDirection * deltaBrightness;

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
    auto pwmValue = m_brightness;
    if (m_inv) {
        pwmValue = m_ledMax - pwmValue;
    }
    if (pwmValue != m_lastWritten) {
        analogWrite(m_ledPin, pwmValue);
        m_lastWritten = pwmValue;
    }
}