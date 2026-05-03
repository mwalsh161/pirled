#pragma once

#include <ESP8266WiFi.h>

class WiFiManager {
   public:
    enum WiFiState { WIFI_DISABLED, WIFI_IDLE, WIFI_CONNECTED };

    using ConnectedCB = void (*)(const char*);
    using DisconnectedCB = void (*)();

    void setup(const char* prefix);
    bool subscribe(ConnectedCB cb, DisconnectedCB disCB);
    bool update(unsigned long now);

   private:
    static const int MAX_LISTENERS = 8;
    ConnectedCB m_connectedListeners[MAX_LISTENERS];
    DisconnectedCB m_disconnectedListeners[MAX_LISTENERS];
    int m_listenerCount = 0;
    char m_hostname[32];
    WiFiState m_state = WIFI_IDLE;
    unsigned long m_lastRetryTime = 0;

    bool beginWithStoredCredentials();
    void notifyConnected(IPAddress ip);
    void notifyDisconnected();
};
