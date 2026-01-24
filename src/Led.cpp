#include <Arduino.h>
#include <Led.h>

#include "Logger.h"
#include "debug.h"

static constexpr int32_t LED_MAX = 1023;  // analogWriteResolution (2^10)

void Led::setTarget(int16_t* brightnessPtr, int16_t* slew_msPtr, unsigned long now) {
    if (!brightnessPtr || !slew_msPtr) return;  // safety check

    m_brightnessTargetPtr = brightnessPtr;
    m_slew_msPtr = slew_msPtr;

    // Update all values (including config) to be in bounds
    *m_brightnessTargetPtr = min(max(*brightnessPtr, int16_t(0)), (int16_t)LED_MAX);
    *m_slew_msPtr = max(*slew_msPtr, int16_t(0));

    m_lastUpdate = now;  // reset timer to avoid large jumps
}

void Led::update(unsigned long now) {
    if (!m_brightnessTargetPtr || !m_slew_msPtr) return;  // safety check
    auto target = *m_brightnessTargetPtr;
    auto slew = *m_slew_msPtr;

    if (m_brightness == target) {
        m_lastUpdate = now;
        return;
    }

    D_PRINT("LED pin" + String(m_ledPin) + ": ");
    logPartial(m_ledPin);

    if (slew == 0) {
        m_brightness = target;
    } else {
        uint32_t u_slew = (slew > 0) ? (uint32_t)slew : 0;
        uint32_t elapsed_u = now - m_lastUpdate;
        elapsed_u = min(elapsed_u, u_slew);
        int32_t elapsed_ms = (int32_t)elapsed_u;

        int32_t delta = LED_MAX * elapsed_ms / slew;

        logPartial(elapsed_ms);
        logPartial(delta);
        D_PRINT("Elapsed: " + String(elapsed_ms) + ", ");
        D_PRINT("Delta: " + String(delta) + ", ");
        if (delta == 0) {  // elapsed too small to matter
            log("");
            return;
        }

        int32_t diff = target - m_brightness;
        delta = min(delta, abs(diff));  // prevent overshoot
        m_brightness += (diff > 0) ? delta : -delta;
    }

    D_PRINTLN("Brightness: " + String(m_brightness));
    logPartial(m_brightness);
    log("");

    m_brightness = constrain(m_brightness, 0, LED_MAX);  // Just in case
    m_lastUpdate = now;

    // Apply output.
    int pwmValue = m_inv ? LED_MAX - m_brightness : m_brightness;
    analogWrite(m_ledPin, pwmValue);
}