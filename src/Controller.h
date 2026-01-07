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

    Controller(Led&& led) : m_led(std::move(led)) {}

    void setup() { m_led.setup(); }

    void update(unsigned long now, bool pirActive);
    State getState() const { return m_state; }

    void enable();
    void disable();

   private:
    Led m_led;
    State m_state = State::OFF;
    unsigned long m_offRequested = 0;
};
