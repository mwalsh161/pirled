#include "Controller.h"

void Controller::update(unsigned long now, bool pirActive) {
    switch (m_state) {
        case Controller::State::OFF:
            if (pirActive) {
                m_led.setMode(Led::Mode::FADE_ON);
                m_state = Controller::State::ON;
            }
            break;

        case Controller::State::ON:
            if (!pirActive) {
                m_offRequested = now;
                m_state = Controller::State::WAITING_OFF;
            }
            break;

        case Controller::State::WAITING_OFF:
            if (pirActive) {
                m_state = Controller::State::ON;
            } else if (now - m_offRequested >= m_onTimeMs) {
                m_led.setMode(Led::Mode::FADE_OFF);
                m_state = Controller::State::OFF;
            }
            break;
    }

    m_led.update(now);
}
