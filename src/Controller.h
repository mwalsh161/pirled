#pragma once

#include <utility>

#include "Led.h"

class Controller {
   public:
    enum class State {
        OFF,
        ON,          // PIR currently active
        WAITING_OFF  // PIR inactive, off timer running
    };

    Controller(Led&& led, const uint32_t& onTimeMs) : m_led(std::move(led)), m_onTimeMs(onTimeMs) {}

    void setup() { m_led.setup(); }

    void update(unsigned long now, bool pirActive);
    State getState() const { return m_state; }

   private:
    Led m_led;
    const uint32_t& m_onTimeMs;

    State m_state = State::OFF;
    unsigned long m_offRequested = 0;
};
