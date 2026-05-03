#include "net/WiFiManager.h"

#include <Arduino.h>
#include <cstring>

#include "net/StoredWiFiCredentials.h"
#include "debug.h"

namespace {
constexpr unsigned long WARM_RETRY_INTERVAL_MS = 8000;
constexpr unsigned long COLD_RETRY_INITIAL_BACKOFF_MS = 10000;
constexpr unsigned long COLD_RETRY_MAX_BACKOFF_MS = 300000;  // 5 minutes
constexpr int WARM_RETRY_COUNT = 3;
constexpr float BACKOFF_JITTER_RATIO = 0.1;  // 10% jitter
}  // namespace

void WiFiManager::setup(const char* prefix) {
    WiFi.persistent(false);  // Do not rewrite SDK flash config during normal boots/retries.
    WiFi.setAutoConnect(false);
    WiFi.setAutoReconnect(false);  // We will manage this so dependent services restart cleanly.
    WiFi.mode(WIFI_STA);

    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(m_hostname, sizeof(m_hostname), "%s%02X%02X%02X", prefix, mac[3], mac[4], mac[5]);

    WiFi.setHostname(m_hostname);

    D_PRINTF("MAC: %02X:%02X:%02X:%02X:%02X:%02X\n", mac[0], mac[1], mac[2], mac[3], mac[4],
             mac[5]);
    D_PRINTF("WiFi hostname set to: %s\n", m_hostname);
    if (!hasStoredWiFiCredentials()) {
        D_PRINTLN("WiFi: No stored credentials; staying offline until next boot/configuration");
        m_state = WIFI_DISABLED;
        return;
    }
    m_state = WIFI_COLD_RETRY;
}

bool WiFiManager::subscribe(ConnectedCB cb, DisconnectedCB disCB) {
    if (m_listenerCount < MAX_LISTENERS) {
        m_connectedListeners[m_listenerCount] = cb;
        m_disconnectedListeners[m_listenerCount] = disCB;
        m_listenerCount++;
        return true;
    }
    return false;
}

bool WiFiManager::update(unsigned long now) {
    if (m_state == WIFI_DISABLED) return false;

    // `linkStatus` is the instantaneous SDK-reported WiFi link status.
    // `m_state` is this manager's retry/backoff state machine state.
    wl_status_t linkStatus = WiFi.status();
    if (linkStatus == WL_CONNECTED) {
        auto ip = WiFi.localIP();
        if (!isLinkLocal(ip)) {
            if (m_state != WIFI_CONNECTED) {
                // Transitioned to connected
                m_state = WIFI_CONNECTED;
                m_warmRetryCount = 0;
                m_coldRetryBackoff = COLD_RETRY_INITIAL_BACKOFF_MS;
                m_coldRetryAttempts = 0;
                notifyConnected(ip);
            }
            return true;
        }
    } else if (linkStatus == WL_WRONG_PASSWORD) {
        if (m_state == WIFI_CONNECTED) {
            D_PRINTLN("WiFi: Lost connection, wrong password");
            notifyDisconnected();
        }
        if (m_state != WIFI_DISABLED) {
            D_PRINTLN("WiFi: Wrong password; suppressing retries until reboot");
        }
        m_state = WIFI_DISABLED;
        return false;
    }

    // Disconnected - handle state machine
    if (m_state == WIFI_CONNECTED) {
        // Lost connection after being connected
        D_PRINTLN("WiFi: Lost connection, starting warm retries");
        m_state = WIFI_IDLE;  // Reset to idle to restart from warm retries
        notifyDisconnected();
    }

    switch (m_state) {
        case WIFI_DISABLED:
            break;

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
            if (!attemptColdRetry()) {
                break;
            }
            m_state = WIFI_BACKOFF;
            m_lastRetryTime = now;
            break;

        case WIFI_BACKOFF:
            if (now - m_lastRetryTime >= m_coldRetryBackoff) {
                D_PRINTF(
                    "WiFi: Backoff complete, attempting cold retry (next backoff: %lu "
                    "ms)\n",
                    m_coldRetryBackoff);
                if (!attemptColdRetry()) {
                    break;
                }

                // Update backoff for next time (exponential with ceiling and jitter)
                unsigned long newBackoff = min(m_coldRetryBackoff * 2, COLD_RETRY_MAX_BACKOFF_MS);
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

bool WiFiManager::beginWithStoredCredentials() {
    char ssid[33] = "";
    char password[65] = "";
    if (!readStoredWiFiCredentials(ssid, sizeof(ssid), password, sizeof(password))) return false;

#if DEBUG
    size_t password_len = strlen(password);
    D_PRINTF("Calling WiFi.begin(\"%s\", \"%c**%c\")\n", ssid, password[0],
             password[password_len - 1]);
#endif
    WiFi.disconnect(true, false);  // Cold retry: restart STA without erasing stored credentials.
    delay(200);
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(m_hostname);
    WiFi.begin(ssid, password);
    return true;
}

bool WiFiManager::attemptColdRetry() {
    m_coldRetryAttempts++;
    D_PRINTF("WiFi: Cold retry attempt %u\n", m_coldRetryAttempts);
    return beginWithStoredCredentials();
}

void WiFiManager::notifyConnected(IPAddress ip) {
    D_PRINTF("WiFi connected: %s (%s)\n", m_hostname, ip.toString().c_str());
    for (int i = 0; i < m_listenerCount; i++) {
        m_connectedListeners[i](m_hostname);
    }
}

void WiFiManager::notifyDisconnected() {
    D_PRINTLN("WiFi disconnected");
    for (int i = 0; i < m_listenerCount; i++) {
        m_disconnectedListeners[i]();
    }
}

unsigned long WiFiManager::applyJitter(unsigned long baseValue) {
    // Apply jitter: baseValue +/- (baseValue * BACKOFF_JITTER_RATIO)
    unsigned long jitterRange = (unsigned long)(baseValue * BACKOFF_JITTER_RATIO);
    // Random value between -jitterRange and +jitterRange
    long jitterAmount = (random(2 * jitterRange + 1)) - jitterRange;
    long result = (long)baseValue + jitterAmount;
    // Ensure result is positive
    return max(1UL, (unsigned long)result);
}

bool WiFiManager::isLinkLocal(IPAddress ip) {
    // Link-local addresses are in 169.254.0.0/16 range.
    // These indicate DHCP failed but device got an auto-assigned address.
    return ip[0] == 169 && ip[1] == 254;
}
