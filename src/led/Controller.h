#pragma once

#include <utility>

#include "config/ConfigStore.h"
#include "led/Led.h"

class Controller {
   public:
    enum class State : uint8_t { OFF, WAITING_ON, ON, WAITING_OFF };

    Controller(uint8_t pin, int16_t& brightness, int16_t& rampOn_ms, uint32_t& holdOn_ms,
               int16_t& rampOff_ms, uint32_t& waitOn_ms, PirStates& pirMaskOn,
               PirStates& pirMaskOff)
        : m_led(pin),
          m_brightness(brightness),
          m_rampOn_ms(rampOn_ms),
          m_holdOn_ms(holdOn_ms),
          m_rampOff_ms(rampOff_ms),
          m_waitOn_ms(waitOn_ms),
          m_pirMaskOn(pirMaskOn),
          m_pirMaskOff(pirMaskOff) {}

    void setup() { m_led.setup(); }

    void update(unsigned long now, PirStates pirStates);

    const Led& led() const { return m_led; }
    State state() const { return m_state; }

   private:
    Led m_led;
    State m_state = State::OFF;

    int16_t& m_brightness;
    int16_t& m_rampOn_ms;
    uint32_t& m_holdOn_ms;
    int16_t& m_rampOff_ms;
    uint32_t& m_waitOn_ms;
    PirStates& m_pirMaskOn;
    PirStates& m_pirMaskOff;

    unsigned long m_offRequested = 0;
    unsigned long m_onRequested = 0;

    bool isPirActiveForOn(PirStates pirStates) const { return (pirStates & m_pirMaskOn) != 0; }

    bool isPirActiveForOff(PirStates pirStates) const { return (pirStates & m_pirMaskOff) != 0; }
};
