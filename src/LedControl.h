#pragma once

#include <Arduino.h>

class LedControl {
   public:
    enum class Mode { OFF, FADE, BLINK };

    void begin(uint8_t pin, int maxValue = 1023);
    void setMode(Mode mode);
    void update();

    Mode getMode() const { return m_mode; }

   private:
    void applyOutput();

    uint8_t m_ledPin = 0;
    int m_ledMax = 1023;
    int m_delta = 16;

    unsigned long m_lastUpdate = 0;
    Mode m_mode = Mode::OFF;
    int m_brightness = 0;
};
