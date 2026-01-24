#include <AppState.h>
#include <pins.h>

ControllerConfig makeController(uint8_t pin, LedConfig& ledCfg) {
    return {{pin, ledCfg.brightness, ledCfg.rampOnMs, ledCfg.holdOnMs, ledCfg.rampOffMs},
            ledCfg.pirMask};
}

std::array<ControllerConfig, 4> LEDS = {{
    makeController(D4, CONFIG.ledConfig[0]),  // oof D4...epileptic on reset.
    makeController(D8, CONFIG.ledConfig[1]),
    makeController(D1, CONFIG.ledConfig[2]),
    makeController(D3, CONFIG.ledConfig[3]),
}};
std::array<uint8_t, 4> PIR_PINS{D6, D7, D2, D5};
PirStates PIR_STATES = 0;

ConfigServer CONFIG_SERVER{"pirled-controller"};  // TODO: use mac addr to make unique //
                                                  // WiFi.macAddress().replace(":", "");
