#pragma once

#include <ESP8266WiFi.h>

class WiFiManager {
   public:
    enum WiFiState {
        WIFI_DISABLED,
        WIFI_IDLE,
        WIFI_WARM_RETRY,
        WIFI_COLD_RETRY,
        WIFI_BACKOFF,
        WIFI_CONNECTED
    };

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
    int m_warmRetryCount = 0;
    unsigned long m_coldRetryBackoff = 10000;
    unsigned long m_lastRetryTime = 0;
    uint8_t m_coldRetryAttempts = 0;

    bool beginWithStoredCredentials();
    bool attemptColdRetry();
    void notifyConnected(IPAddress ip);
    void notifyDisconnected();
    unsigned long applyJitter(unsigned long baseValue);
    bool isLinkLocal(IPAddress ip);
};
