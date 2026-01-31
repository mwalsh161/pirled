#pragma once

#include <ESP8266WiFi.h>

#include <cstring>
#include <random>

#include "debug.h"

#define WIFI_TIMEOUT_MS 20000
#define WARM_RETRY_INTERVAL_MS 3000
#define COLD_RETRY_INITIAL_BACKOFF_MS 2000
#define COLD_RETRY_MAX_BACKOFF_MS 300000  // 5 minutes
#define WARM_RETRY_COUNT 3
#define BACKOFF_JITTER_RATIO 0.1  // 10% jitter

class WiFiManager {
   public:
    enum WiFiState { WIFI_IDLE, WIFI_WARM_RETRY, WIFI_COLD_RETRY, WIFI_BACKOFF, WIFI_CONNECTED };

    using ConnectedCB = void (*)(const char*);
    using DisconnectedCB = void (*)();

    void setup(const char* prefix) {
        uint8_t mac[6];
        WiFi.macAddress(mac);
        snprintf(m_hostname, sizeof(m_hostname), "%s%02X%02X%02X", prefix, mac[3], mac[4], mac[5]);

        WiFi.setHostname(m_hostname);
        WiFi.persistent(false);  // We already read stored config, don't rewrite it.
        WiFi.setAutoConnect(false);
        WiFi.setAutoReconnect(false);  // We will manage to reliably restart services.

        D_PRINTF("MAC: %02X:%02X:%02X:%02X:%02X:%02X\n", mac[0], mac[1], mac[2], mac[3], mac[4],
                 mac[5]);
        D_PRINTF("WiFi hostname set to: %s\n", m_hostname);
        m_state = WIFI_COLD_RETRY;
    }

    bool subscribe(ConnectedCB cb, DisconnectedCB disCB) {
        if (m_listenerCount < MAX_LISTENERS) {
            m_connectedListeners[m_listenerCount] = cb;
            m_disconnectedListeners[m_listenerCount] = disCB;
            m_listenerCount++;
            return true;
        }
        return false;
    }

    bool hasCredentials() {
        station_config conf;
        wifi_station_get_config(&conf);
        size_t ssid_len = strnlen((char*)conf.ssid, sizeof(conf.ssid));
        return ssid_len > 0 && ssid_len < sizeof(conf.ssid);
    }

    bool update(unsigned long now) {
        if (WiFi.status() == WL_CONNECTED) {
            auto ip = WiFi.localIP();
            if (!isLinkLocal(ip)) {
                if (m_state != WIFI_CONNECTED) {
                    // Transitioned to connected
                    m_state = WIFI_CONNECTED;
                    m_warmRetryCount = 0;
                    m_coldRetryBackoff = COLD_RETRY_INITIAL_BACKOFF_MS;
                    notifyConnected(ip);
                }
                return true;
            }
        }

        // Disconnected - handle state machine
        if (m_state == WIFI_CONNECTED) {
            // Lost connection after being connected
            D_PRINTLN("WiFi: Lost connection, starting warm retries");
            m_state = WIFI_IDLE;  // Reset to idle to restart from warm retries
            notifyDisconnected();
        }

        switch (m_state) {
            case WIFI_IDLE:
                // Not yet started or lost connection, move to warm retry
                D_PRINTLN("WiFi: Starting warm retries");
                m_state = WIFI_WARM_RETRY;
                m_warmRetryCount = 0;
                m_lastRetryTime = now;
                break;

            case WIFI_WARM_RETRY:
                if (now - m_lastRetryTime >= WARM_RETRY_INTERVAL_MS) {
                    D_PRINTF("WiFi: Warm retry attempt %d\n", m_warmRetryCount + 1);
                    WiFi.begin();  // Warm retry with cached config
                    m_warmRetryCount++;
                    m_lastRetryTime = now;

                    if (m_warmRetryCount >= WARM_RETRY_COUNT) {
                        D_PRINTLN("WiFi: Warm retries exhausted, moving to cold retry");
                        m_state = WIFI_COLD_RETRY;
                    }
                }
                break;

            case WIFI_COLD_RETRY:
                D_PRINTLN("WiFi: Attempting cold retry");
                powerCycleAndConnect();
                m_state = WIFI_BACKOFF;
                m_lastRetryTime = now;
                break;

            case WIFI_BACKOFF:
                if (now - m_lastRetryTime >= m_coldRetryBackoff) {
                    D_PRINTF(
                        "WiFi: Backoff complete, attempting cold retry (next backoff: %lu "
                        "ms)\n",
                        m_coldRetryBackoff);
                    powerCycleAndConnect();

                    // Update backoff for next time (exponential with ceiling and jitter)
                    unsigned long newBackoff =
                        min(m_coldRetryBackoff * 2, (unsigned long)COLD_RETRY_MAX_BACKOFF_MS);
                    m_coldRetryBackoff = applyJitter(newBackoff);

                    m_lastRetryTime = now;
                }
                break;

            case WIFI_CONNECTED:
                // Shouldn't reach here (handled at top), but just in case
                break;
        }
        return false;
    }

   private:
    static const int MAX_LISTENERS = 8;
    ConnectedCB m_connectedListeners[MAX_LISTENERS];
    DisconnectedCB m_disconnectedListeners[MAX_LISTENERS];
    int m_listenerCount = 0;
    char m_hostname[32];
    WiFiState m_state = WIFI_IDLE;
    int m_warmRetryCount = 0;
    unsigned long m_coldRetryBackoff = COLD_RETRY_INITIAL_BACKOFF_MS;
    unsigned long m_lastRetryTime = 0;

    bool powerCycleAndConnect() {
        station_config conf;
        wifi_station_get_config(&conf);
        const char* ssid = reinterpret_cast<const char*>(conf.ssid);
        const char* password = reinterpret_cast<const char*>(conf.password);
        size_t ssid_len = strnlen((char*)conf.ssid, sizeof(conf.ssid));

        if (ssid_len == 0 || ssid_len == sizeof(conf.ssid)) return false;

        WiFi.mode(WIFI_STA);
        D_PRINTF("Calling WiFi.begin(\"%s\", \"%c**%c\")\n", ssid, password[0],
                 password[strlen(password) - 1]);
        WiFi.begin(ssid, password);
        WiFi.status();
        return true;
    }

    void notifyConnected(IPAddress ip) {
        D_PRINTF("WiFi connected: %s (%s)\n", m_hostname, ip.toString().c_str());
        for (int i = 0; i < m_listenerCount; i++) {
            m_connectedListeners[i](m_hostname);
        }
    }
    void notifyDisconnected() {
        D_PRINTLN("WiFi disconnected");
        for (int i = 0; i < m_listenerCount; i++) {
            m_disconnectedListeners[i]();
        }
    }

    unsigned long applyJitter(unsigned long baseValue) {
        // Apply jitter: baseValue ± (baseValue * BACKOFF_JITTER_RATIO)
        unsigned long jitterRange = (unsigned long)(baseValue * BACKOFF_JITTER_RATIO);
        // Random value between -jitterRange and +jitterRange
        long jitterAmount = (random(2 * jitterRange + 1)) - jitterRange;
        long result = (long)baseValue + jitterAmount;
        // Ensure result is positive
        return max(1UL, (unsigned long)result);
    }

    bool isLinkLocal(IPAddress ip) {
        // Link-local addresses are in 169.254.0.0/16 range
        // These indicate DHCP failed but device got an auto-assigned address
        return ip[0] == 169 && ip[1] == 254;
    }
};
