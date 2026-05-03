#pragma once

#include <ESP8266WiFi.h>

// ESP8266 note:
// This project prefers static IP configuration on this hardware because extensive testing showed
// intermittent failures in the ESP8266 SDK DHCP client path. The device could associate, emit
// DHCPDISCOVER, and receive DHCPOFFER, but would sometimes fail to continue with DHCPREQUEST.
// Static IP configuration succeeded reliably under the same conditions. If the project moves to a
// newer board or Wi-Fi stack later, DHCP is worth revisiting.

struct StaticNetworkConfig {
    bool enabled;
    IPAddress ip;
    IPAddress gateway;
    IPAddress subnet;
    IPAddress dns;
};

bool loadStaticNetworkConfig(StaticNetworkConfig& config);
bool saveStaticNetworkConfig(const StaticNetworkConfig& config);
bool clearStaticNetworkConfig();
