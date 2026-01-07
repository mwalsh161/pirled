#include <Arduino.h>

#include "Led.h"

class Controller {
   public:
    Controller(Led&& led, uint8_t sensePin) : m_led(std::move(led)), m_sensePin(sensePin) {}

    void setup() {
        m_led.setup();
        pinMode(m_sensePin, INPUT);
    }

    void update(unsigned long now);

    void enable();
    void disable();

   private:
    enum class State {
        OFF,
        ON,          // PIR currently active
        WAITING_OFF  // PIR inactive, off timer running
    };

    Led m_led;
    uint8_t m_sensePin;
    State m_state = State::OFF;
    unsigned long m_offRequested = 0;
    bool m_enabled = true;
};
