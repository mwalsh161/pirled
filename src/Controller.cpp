#include "Controller.h"

#define TIMEOFF_WAIT 10000

void Controller::update(unsigned long now) {
    bool pirActive = (digitalRead(m_sensePin) == HIGH);

    switch (m_state) {
        case Controller::State::OFF:
            if (pirActive) {
                Serial.println("ON");
                m_led.setMode(Led::Mode::FADE_ON);
                m_state = Controller::State::ON;
            }
            break;

        case Controller::State::ON:
            if (!pirActive) {
                Serial.println("OFF SCHEDULED");
                m_offRequested = now;
                m_state = Controller::State::WAITING_OFF;
            }
            break;

        case Controller::State::WAITING_OFF:
            if (pirActive) {
                Serial.println("OFF CANCELED");
                m_state = Controller::State::ON;
            } else if ((long)(now - m_offRequested) >= TIMEOFF_WAIT) {
                Serial.println("OFF");
                m_led.setMode(Led::Mode::FADE_OFF);
                m_state = Controller::State::OFF;
            }
            break;
    }

    m_led.update(now);
}
