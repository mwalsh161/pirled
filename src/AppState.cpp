#include <AppState.h>
#include <pins.h>

namespace {
Controller makeController(uint8_t pin, LedConfig& ledCfg) {
    return {pin,
            ledCfg.brightness,
            ledCfg.rampOnMs,
            ledCfg.holdOnMs,
            ledCfg.rampOffMs,
            ledCfg.waitOnMs,
            ledCfg.pirMaskOn,
            ledCfg.pirMaskOff};
}
}  // namespace

std::array<Controller, 4> LEDS = {{
    makeController(D4, getLedConfig(0)),  // oof D4...epileptic on reset.
    makeController(D8, getLedConfig(1)),
    makeController(D5, getLedConfig(2)),
    makeController(D3, getLedConfig(3)),
}};
std::array<uint8_t, 4> PIR_PINS{D6, D7, D1, D2};
PirStates PIR_STATES = 0;

WiFiManager WIFI_MGR;
ConfigServer CONFIG_SERVER;
