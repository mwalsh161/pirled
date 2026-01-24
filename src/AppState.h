#include <Config.h>
#include <Controller.h>

struct ControllerConfig {
    Controller controller;
    const uint8_t& pirMask;
};

extern std::array<ControllerConfig, 4> LEDS;
extern std::array<uint8_t, 4> PIR_PINS;
extern PirStates PIR_STATES;

extern ConfigServer CONFIG_SERVER;