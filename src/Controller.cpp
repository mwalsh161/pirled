#include "Controller.h"

#include "debug.h"

int16_t ZERO = 0;

void Controller::update(unsigned long now, bool pirActive) {
    switch (m_state) {
        case Controller::State::OFF:
            if (pirActive) {
                m_led.setTarget(&m_brightness, &m_rampOn_ms, now);
                m_state = Controller::State::ON;
                D_PRINTLN("ON");
            }
            break;

        case Controller::State::ON:
            if (!pirActive) {
                m_offRequested = now;
                m_state = Controller::State::WAITING_OFF;
                D_PRINTLN("WAITING_OFF");
            }
            break;

        case Controller::State::WAITING_OFF:
            if (pirActive) {
                m_state = Controller::State::ON;
                D_PRINTLN("NOPE, ON");
            } else if (now - m_offRequested >= m_holdOn_ms) {
                m_led.setTarget(&ZERO, &m_rampOff_ms, now);
                m_state = Controller::State::OFF;
                D_PRINTLN("OFF");
            }
            break;
    }

    m_led.update(now);
}
