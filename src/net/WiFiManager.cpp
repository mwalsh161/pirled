#include "net/WiFiManager.h"

#include <Arduino.h>

#include <cstring>

#include "debug.h"
#include "system/Logger.h"

namespace {
constexpr unsigned long WARM_RETRY_INTERVAL_MS = 8000;
constexpr unsigned long COLD_RETRY_INITIAL_BACKOFF_MS = 10000;
constexpr unsigned long COLD_RETRY_MAX_BACKOFF_MS = 300000;  // 5 minutes
constexpr int WARM_RETRY_COUNT = 3;
constexpr float BACKOFF_JITTER_RATIO = 0.1;  // 10% jitter
constexpr uint8_t AUTO_RESEED_AFTER_COLD_RETRIES = 3;
}  // namespace

void WiFiManager::setup(const char* prefix) {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    snprintf(m_hostname, sizeof(m_hostname), "%s%02X%02X%02X", prefix, mac[3], mac[4], mac[5]);

    WiFi.setHostname(m_hostname);
    WiFi.mode(WIFI_STA);
    WiFi.persistent(false);  // We already read stored config, don't rewrite it.
    WiFi.setAutoConnect(false);
    WiFi.setAutoReconnect(false);  // We will manage to reliably restart services.

    D_PRINTF("MAC: %02X:%02X:%02X:%02X:%02X:%02X\n", mac[0], mac[1], mac[2], mac[3], mac[4],
             mac[5]);
    D_PRINTF("WiFi hostname set to: %s\n", m_hostname);
    m_hasCredentials = hasCredentials();
    if (!m_hasCredentials) {
        D_PRINTLN("WiFi: No stored credentials; staying offline until next boot/configuration");
        m_state = WIFI_IDLE;
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

bool WiFiManager::hasCredentials() {
    station_config conf;
    if (!wifi_station_get_config(&conf)) return false;
    size_t ssid_len = strnlen((char*)conf.ssid, sizeof(conf.ssid));
    size_t password_len = strnlen((char*)conf.password, sizeof(conf.password));
    return ssid_len > 0 && ssid_len < sizeof(conf.ssid) && password_len > 0 &&
           password_len < sizeof(conf.password);
}

bool WiFiManager::update(unsigned long now) {
    if (!m_hasCredentials) return false;

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
    } else if (linkStatus == WL_CONNECT_FAILED) {
        if (m_state == WIFI_CONNECTED) {
            D_PRINTLN("WiFi: Lost connection, auth failed");
            notifyDisconnected();
        }
        if (!m_retrySuppressed) {
            D_PRINTLN("WiFi: Unrecoverable credential failure; suppressing retries until reboot");
        }
        m_retrySuppressed = true;
        m_state = WIFI_IDLE;
        return false;
    }

    if (m_retrySuppressed) return false;

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
    station_config conf;
    if (!wifi_station_get_config(&conf)) return false;
    const char* ssid = reinterpret_cast<const char*>(conf.ssid);
    const char* password = reinterpret_cast<const char*>(conf.password);
    size_t ssid_len = strnlen((char*)conf.ssid, sizeof(conf.ssid));
    size_t password_len = strnlen((char*)conf.password, sizeof(conf.password));

    if (ssid_len == 0 || ssid_len == sizeof(conf.ssid) || password_len == 0 ||
        password_len == sizeof(conf.password))
        return false;

    D_PRINTF("Calling WiFi.begin(\"%s\", \"%c**%c\")\n", ssid, password[0],
             password[password_len - 1]);
    WiFi.begin(ssid, password);
    WiFi.status();
    return true;
}

bool WiFiManager::attemptColdRetry() {
    m_coldRetryAttempts++;
    D_PRINTF("WiFi: Cold retry attempt %u\n", m_coldRetryAttempts);

    if (!m_autoReseedAttempted && m_coldRetryAttempts >= AUTO_RESEED_AFTER_COLD_RETRIES) {
        m_autoReseedAttempted = true;
        log("wa,1");  // auto-reseed trigger
        D_PRINTLN("WiFi: Auto-reseed trigger");
        attemptAutoReseed();
    }

    return beginWithStoredCredentials();
}

bool WiFiManager::attemptAutoReseed() {
    station_config conf;
    if (!wifi_station_get_config(&conf)) {
        log("wa,2");  // auto-reseed read failed
        return false;
    }

    size_t ssid_len = strnlen((char*)conf.ssid, sizeof(conf.ssid));
    size_t password_len = strnlen((char*)conf.password, sizeof(conf.password));
    if (ssid_len == 0 || ssid_len == sizeof(conf.ssid) || password_len == 0 ||
        password_len == sizeof(conf.password)) {
        log("wa,3");  // auto-reseed invalid creds
        return false;
    }

    char ssid[33] = "";
    char password[65] = "";
    memcpy(ssid, conf.ssid, ssid_len);
    ssid[ssid_len] = '\0';
    memcpy(password, conf.password, password_len);
    password[password_len] = '\0';

    WiFi.mode(WIFI_STA);
    WiFi.persistent(true);
    WiFi.begin(ssid, password);
    WiFi.persistent(false);
    log("wa,4");  // auto-reseed attempted (no reboot)
    return true;
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
