#include "WireProtocol.h"

#include <array>

#include "AppState.h"
#include "Config.h"

#define CHAR_PTR(X) reinterpret_cast<const char*>(&X)

const size_t PAYLOAD_SIZE = 66;
constexpr char WIRE_SCHEMA_JSON[] PROGMEM = R"json(
[
{"name": "timestamp", "size": 8, "type": "int"},
{"name": "pirState", "size": 1, "type": "uint"},
{"name": "pirOverride", "size": 1, "type": "uint"},
{"name": "ledConfigs","arrayLen": 4,"sub": [
 {"name": "brightness", "size": 2, "type": "int"},
 {"name": "rampOnMs", "size": 2, "type": "int"},
 {"name": "holdOnMs", "size": 4, "type": "int"},
 {"name": "rampOffMs", "size": 2, "type": "int"},
 {"name": "pirMask", "size": 1, "type": "uint"}
]},
{"name": "ledStates","arrayLen": 4,"sub": [
 {"name": "brightness", "size": 2, "type": "int"},
 {"name": "state", "size": 1, "type": "uint"}
]}])json";

void sendWireData(ESP8266WebServer& server) {
    server.setContentLength(PAYLOAD_SIZE);
    server.send(200, "application/octet-stream");

    server.sendContent(CHAR_PTR(CONFIG.timestamp), sizeof(CONFIG.timestamp));
    static_assert(sizeof(CONFIG.timestamp) == 8);
    server.sendContent(CHAR_PTR(PIR_STATES), sizeof(PIR_STATES));
    static_assert(sizeof(PIR_STATES) == 1);
    server.sendContent(CHAR_PTR(CONFIG_SERVER.m_pirOverrides),
                       sizeof(CONFIG_SERVER.m_pirOverrides));
    static_assert(sizeof(CONFIG_SERVER.m_pirOverrides) == 1);
    for (auto ledConf : CONFIG.ledConfig) {
        server.sendContent(CHAR_PTR(ledConf.brightness), sizeof(ledConf.brightness));
        static_assert(sizeof(ledConf.brightness) == 2);
        server.sendContent(CHAR_PTR(ledConf.rampOnMs), sizeof(ledConf.rampOnMs));
        static_assert(sizeof(ledConf.rampOnMs) == 2);
        server.sendContent(CHAR_PTR(ledConf.holdOnMs), sizeof(ledConf.holdOnMs));
        static_assert(sizeof(ledConf.holdOnMs) == 4);
        server.sendContent(CHAR_PTR(ledConf.rampOffMs), sizeof(ledConf.rampOffMs));
        static_assert(sizeof(ledConf.rampOffMs) == 2);
        server.sendContent(CHAR_PTR(ledConf.pirMask), sizeof(ledConf.pirMask));
        static_assert(sizeof(ledConf.pirMask) == 1);
    }
    for (auto ledState : LEDS) {
        auto& brightness = ledState.m_led.m_brightness;
        auto& state = ledState.m_state;
        server.sendContent(CHAR_PTR(brightness), sizeof(brightness));
        static_assert(sizeof(brightness) == 2);
        server.sendContent(CHAR_PTR(state), sizeof(state));
        static_assert(sizeof(state) == 1);
    }
}
void sendWireSchema(ESP8266WebServer& server) {
    server.send_P(200, "application/json", WIRE_SCHEMA_JSON);
}
