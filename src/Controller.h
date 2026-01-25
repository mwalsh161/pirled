#pragma once

#include <utility>

#include "Led.h"

class Controller {
   public:
    enum class State : uint8_t { OFF, ON, WAITING_OFF };
    Led m_led;
    State m_state = State::OFF;

    Controller(uint8_t pin, int16_t& brightness, int16_t& rampOn_ms, uint32_t& holdOn_ms,
               int16_t& rampOff_ms)
        : m_led(pin),
          m_brightness(brightness),
          m_rampOn_ms(rampOn_ms),
          m_holdOn_ms(holdOn_ms),
          m_rampOff_ms(rampOff_ms) {}

    void setup() { m_led.setup(); }

    void update(unsigned long now, bool pirActive);

   private:
    int16_t& m_brightness;
    int16_t& m_rampOn_ms;
    uint32_t& m_holdOn_ms;
    int16_t& m_rampOff_ms;

    unsigned long m_offRequested = 0;
};
