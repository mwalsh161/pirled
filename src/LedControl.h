#pragma once

#include <Arduino.h>

class LedControl {
   public:
    enum class Mode { OFF, FADE, BLINK, FADE_ON, FADE_OFF };

    void begin(uint8_t pin, bool inv, int maxValue = 1023);
    void update(unsigned long now);

    void setFreq(float freq) { m_freq = freq; };
    void setMode(Mode mode) { m_mode = mode; };
    Mode getMode() const { return m_mode; }

   private:
    void applyOutput();

    uint8_t m_ledPin = 0;
    int m_ledMax = 1023;
    float m_freq = 2;
    int m_fadeDirection = 1;
    bool m_inv = true;

    unsigned long m_lastUpdate = 0;
    int m_lastWritten = 0;
    Mode m_mode = Mode::OFF;
    int m_brightness = 0;
};
