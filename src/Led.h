#pragma once

#include <stdint.h>

class Led {
   public:
    enum class Mode { OFF, FADE, BLINK, FADE_ON, FADE_OFF };

    Led(uint8_t pin, bool inv, const float& freq, const int& maxValue)
        : m_ledPin(pin), m_inv(inv), m_freq(freq), m_ledMax(maxValue) {}

    void setup();

    void update(unsigned long now);

    void setMode(Mode mode) {
        m_mode = mode;
        m_lastUpdate = 0;
    };
    Mode getMode() const { return m_mode; }

   private:
    void applyOutput();

    uint8_t m_ledPin;
    bool m_inv;
    const float& m_freq;  // TODO: refactor this...want different on/off ramp times.
    const int& m_ledMax;

    int m_fadeDirection = 1;

    unsigned long m_lastUpdate = 0;
    int m_lastWritten = 0;
    Mode m_mode = Mode::OFF;
    int m_brightness = 0;
};
