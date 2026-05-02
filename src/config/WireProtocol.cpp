#include "WireProtocol.h"

#include <array>

#include "board/RuntimeState.h"
#include "config/ConfigStore.h"

namespace {
template <typename T>
const char* charPtr(const T& value) {
    return reinterpret_cast<const char*>(&value);
}

constexpr size_t PAYLOAD_SIZE = 86;
constexpr char WIRE_SCHEMA_JSON[] PROGMEM = R"json(
[
{"name": "timestamp", "size": 8, "type": "int"},
{"name": "pirState", "size": 1, "type": "uint"},
{"name": "pirOverride", "size": 1, "type": "uint"},
{"name": "ledConfigs","arrayLen": 4,"sub": [
 {"name": "brightness", "size": 2, "type": "int"},
 {"name": "rampOnMs", "size": 2, "type": "int"},
 {"name": "holdOnMs", "size": 4, "type": "uint"},
 {"name": "rampOffMs", "size": 2, "type": "int"},
 {"name": "waitOnMs", "size": 4, "type": "uint"},
 {"name": "pirMaskOn", "size": 1, "type": "uint"},
 {"name": "pirMaskOff", "size": 1, "type": "uint"}
]},
{"name": "ledStates","arrayLen": 4,"sub": [
 {"name": "brightness", "size": 2, "type": "int"},
 {"name": "state", "size": 1, "type": "uint"}
]}])json";
}  // namespace

void sendWireData(ESP8266WebServer& server) {
    const Config& config = getConfig();

    server.setContentLength(PAYLOAD_SIZE);
    server.send(200, "application/octet-stream");

    server.sendContent(charPtr(config.timestamp), sizeof(config.timestamp));
    static_assert(sizeof(config.timestamp) == 8);
    server.sendContent(charPtr(PIR_STATES), sizeof(PIR_STATES));
    static_assert(sizeof(PIR_STATES) == 1);
    const auto pirOverrides = CONFIG_SERVER.pirOverrides();
    server.sendContent(charPtr(pirOverrides), sizeof(pirOverrides));
    static_assert(sizeof(pirOverrides) == 1);
    for (const auto& ledConf : config.ledConfig) {
        server.sendContent(charPtr(ledConf.brightness), sizeof(ledConf.brightness));
        static_assert(sizeof(ledConf.brightness) == 2);
        server.sendContent(charPtr(ledConf.rampOnMs), sizeof(ledConf.rampOnMs));
        static_assert(sizeof(ledConf.rampOnMs) == 2);
        server.sendContent(charPtr(ledConf.holdOnMs), sizeof(ledConf.holdOnMs));
        static_assert(sizeof(ledConf.holdOnMs) == 4);
        server.sendContent(charPtr(ledConf.rampOffMs), sizeof(ledConf.rampOffMs));
        static_assert(sizeof(ledConf.rampOffMs) == 2);
        server.sendContent(charPtr(ledConf.waitOnMs), sizeof(ledConf.waitOnMs));
        static_assert(sizeof(ledConf.waitOnMs) == 4);
        server.sendContent(charPtr(ledConf.pirMaskOn), sizeof(ledConf.pirMaskOn));
        static_assert(sizeof(ledConf.pirMaskOn) == 1);
        server.sendContent(charPtr(ledConf.pirMaskOff), sizeof(ledConf.pirMaskOff));
        static_assert(sizeof(ledConf.pirMaskOff) == 1);
    }
    for (const auto& ledState : LEDS) {
        const auto& brightness = ledState.led().brightness();
        const auto state = ledState.state();
        server.sendContent(charPtr(brightness), sizeof(brightness));
        static_assert(sizeof(brightness) == 2);
        server.sendContent(charPtr(state), sizeof(state));
        static_assert(sizeof(state) == 1);
    }
}
void sendWireSchema(ESP8266WebServer& server) {
    server.send_P(200, "application/json", WIRE_SCHEMA_JSON);
}
