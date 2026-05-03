#include "net/WiFiManager.h"

#include <Arduino.h>
#include <cstring>

#include "net/StoredWiFiCredentials.h"
#include "debug.h"
#include "system/StaticNetworkConfig.h"

namespace {
constexpr unsigned long RECONNECT_INTERVAL_MS = 10000;

bool hasNetworkConfigForConnect() {
    StaticNetworkConfig config{};
    return loadStaticNetworkConfig(config) && config.enabled;
}

bool applyNetworkConfigForConnect() {
    StaticNetworkConfig config{};
    if (loadStaticNetworkConfig(config) && config.enabled) {
        D_PRINTF("WiFi: Using static IP %s\n", config.ip.toString().c_str());
        WiFi.config(config.ip, config.gateway, config.subnet, config.dns);
        return true;
    }

    D_PRINTLN("WiFi: No static network config; staying offline until portal setup");
    return false;
}
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
    if (!hasNetworkConfigForConnect()) {
        D_PRINTLN("WiFi: No static network config; staying offline until portal setup");
        m_state = WIFI_DISABLED;
        return;
    }
    m_state = WIFI_IDLE;
    m_lastRetryTime = millis() - RECONNECT_INTERVAL_MS;
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
        if (m_state != WIFI_CONNECTED) {
            // Transitioned to connected.
            m_state = WIFI_CONNECTED;
            notifyConnected(ip);
        }
        return true;
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
        D_PRINTLN("WiFi: Lost connection, returning to idle");
        m_state = WIFI_IDLE;
        notifyDisconnected();
    }

    if (m_state == WIFI_IDLE && now - m_lastRetryTime >= RECONNECT_INTERVAL_MS) {
        D_PRINTLN("WiFi: Attempting reconnect");
        if (beginWithStoredCredentials()) {
            m_lastRetryTime = now;
        }
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
    WiFi.mode(WIFI_STA);
    WiFi.setHostname(m_hostname);
    if (!applyNetworkConfigForConnect()) return false;
    WiFi.begin(ssid, password);
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
