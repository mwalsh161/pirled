#pragma once
#include <Arduino.h>
#include <stdint.h>

class Led {
   public:
    int16_t m_brightness = 0;
    Led(uint8_t pin, bool inv = false) : m_ledPin(pin), m_inv(inv) {}

    void setup() {
        pinMode(m_ledPin, OUTPUT);
        analogWrite(m_ledPin, 0);
    }

    void update(unsigned long now);

    void setTarget(int16_t* brightness, int16_t* slew_ms, unsigned long now);

   private:
    const uint8_t m_ledPin;
    bool m_inv;
    int16_t* m_slew_msPtr = nullptr;

    unsigned long m_lastUpdate = 0;
    int16_t* m_brightnessTargetPtr = nullptr;
};
