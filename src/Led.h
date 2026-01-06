#pragma once
#include <stdint.h>

class Led {
   public:
    enum class Mode { OFF, FADE, BLINK, FADE_ON, FADE_OFF };

    Led(uint8_t pin, bool inv, float freq, int maxValue = 1023)
        : m_ledPin(pin), m_inv(inv), m_freq(freq), m_ledMax(maxValue) {}

    void setup();

    void update(unsigned long now);

    void setFreq(float freq) { m_freq = freq; };
    void setMode(Mode mode) { m_mode = mode; };
    Mode getMode() const { return m_mode; }

   private:
    void applyOutput();

    uint8_t m_ledPin;
    bool m_inv;
    float m_freq;
    int m_ledMax;

    int m_fadeDirection = 1;

    unsigned long m_lastUpdate = 0;
    int m_lastWritten = 0;
    Mode m_mode = Mode::OFF;
    int m_brightness = 0;
};
