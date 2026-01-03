#pragma once

#include <Arduino.h>

class StatusLed {
public:
    enum class Mode {
        OFF,
        FADE,
        ERROR
    };

    void begin(uint8_t pin, int maxValue = 1023);
    void setMode(Mode mode);
    void update();

    Mode getMode() const { return m_mode; }

private:
    void applyOutput();

    uint8_t m_ledPin = 0;
    int m_ledMax = 1023;
    int m_brightness = 0;
    int m_delta = 8;
    unsigned long m_lastUpdate = 0;
    bool m_blinkOn = false;
    Mode m_mode = Mode::OFF;
};
