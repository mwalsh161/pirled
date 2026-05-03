#include "led/Controller.h"

#include <stdio.h>

#include "debug.h"
#include "system/Logger.h"

namespace {
int16_t ZERO = 0;

void logLedTransition(uint32_t now, uint8_t index, const char* logName) {
    char message[LOG_MESSAGE_SIZE];
    snprintf(message, sizeof(message), "led,%u,%s", index, logName);
    logAt(now, message);
    D_PRINTLN(logName);
}
}  // namespace

void Controller::update(unsigned long now, PirStates pirStates) {
    switch (m_state) {
        case Controller::State::OFF:
            if (isPirActiveForOn(pirStates)) {
                m_onRequested = now;
                m_state = Controller::State::WAITING_ON;
                logLedTransition(now, m_index, "waiting_on");
            }
            break;

        case Controller::State::WAITING_ON:
            if (!isPirActiveForOn(pirStates)) {
                m_state = Controller::State::OFF;
                logLedTransition(now, m_index, "waiting_on_canceled");
            } else if (now - m_onRequested >= m_waitOn_ms) {
                m_led.setTarget(&m_brightness, &m_rampOn_ms, now);
                m_state = Controller::State::ON;
                logLedTransition(now, m_index, "on");
            }
            break;

        case Controller::State::ON:
            if (!isPirActiveForOff(pirStates)) {
                m_offRequested = now;
                m_state = Controller::State::WAITING_OFF;
                logLedTransition(now, m_index, "waiting_off");
            }
            break;

        case Controller::State::WAITING_OFF:
            if (isPirActiveForOff(pirStates)) {
                m_state = Controller::State::ON;
                logLedTransition(now, m_index, "waiting_off_canceled");
            } else if (now - m_offRequested >= m_holdOn_ms) {
                m_led.setTarget(&ZERO, &m_rampOff_ms, now);
                m_state = Controller::State::OFF;
                logLedTransition(now, m_index, "off");
            }
            break;
    }

    m_led.update(now);
}
