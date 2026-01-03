#pragma once

struct WifiCreds {
    char ssid[32];
    char pass[64];
};

void saveCreds(const WifiCreds& creds);
bool loadCreds(const WifiCreds& creds);
void clearCreds();