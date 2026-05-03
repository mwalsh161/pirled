#pragma once

#include <stddef.h>

bool readStoredWiFiCredentials(char* ssid, size_t ssidSize, char* password, size_t passwordSize);
bool hasStoredWiFiCredentials();
