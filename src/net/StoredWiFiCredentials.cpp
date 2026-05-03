#include "net/StoredWiFiCredentials.h"

#include <cstring>

extern "C" {
#include <user_interface.h>
}

namespace {
bool readStoredStationConfig(station_config& conf) {
    memset(&conf, 0, sizeof(conf));
    if (wifi_station_get_config_default(&conf)) return true;
    return wifi_station_get_config(&conf);
}
}  // namespace

bool readStoredWiFiCredentials(char* ssid, size_t ssidSize, char* password, size_t passwordSize) {
    station_config conf;
    if (!readStoredStationConfig(conf)) return false;

    size_t ssidLen = strnlen(reinterpret_cast<const char*>(conf.ssid), sizeof(conf.ssid));
    size_t passwordLen =
        strnlen(reinterpret_cast<const char*>(conf.password), sizeof(conf.password));
    if (ssidLen == 0 || ssidLen >= ssidSize || passwordLen == 0 || passwordLen >= passwordSize) {
        return false;
    }

    memcpy(ssid, conf.ssid, ssidLen);
    ssid[ssidLen] = '\0';
    memcpy(password, conf.password, passwordLen);
    password[passwordLen] = '\0';
    return true;
}

bool hasStoredWiFiCredentials() {
    char ssid[33] = "";
    char password[65] = "";
    return readStoredWiFiCredentials(ssid, sizeof(ssid), password, sizeof(password));
}
