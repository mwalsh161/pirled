#include "config/ConfigServer.h"
#include "config/ConfigStore.h"
#include "led/Controller.h"
#include "net/WiFiManager.h"

extern std::array<Controller, 4> LEDS;
extern std::array<uint8_t, 4> PIR_PINS;
extern PirStates PIR_STATES;

extern ConfigServer CONFIG_SERVER;
extern WiFiManager WIFI_MGR;
