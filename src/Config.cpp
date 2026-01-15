#include <Arduino.h>
#include <Config.h>
#include <EEPROM.h>
#include <ESP8266mDNS.h>
#include <ErriezCRC32.h>

static constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
static constexpr uint16_t CONFIG_VERSION = 1;

Config g_config;  // Externally visible config instance.

uint32_t computeCrc(const Config& cfg) {
    return crc32Buffer(reinterpret_cast<const uint8_t*>(&cfg), offsetof(Config, crc));
}

void cpstr(char* dest, const char* src, size_t destSize) {
    strncpy(dest, src, destSize);
    dest[destSize - 1] = '\0';
}

void setConfigDefaults() {
    memset(&g_config, 0, sizeof(g_config));

    g_config.magic = CONFIG_MAGIC;
    g_config.version = CONFIG_VERSION;

    cpstr(g_config.hostname, "", sizeof(g_config.hostname));
    cpstr(g_config.wifiSsid, "", sizeof(g_config.wifiSsid));
    cpstr(g_config.wifiPassword, "", sizeof(g_config.wifiPassword));

    for (size_t i = 0; i < g_config.ledConfig.size(); i++) {
        g_config.ledConfig[i] = {.brightness = 1023,
                                 .onTimeMs = 10000,
                                 .fadeFreq = 0.3f,
                                 .pirMask = static_cast<uint8_t>(1 << i)};
    }

    g_config.crc = computeCrc(g_config);
}

bool initConfig() {
    EEPROM.begin(sizeof(Config));
    EEPROM.get(0, g_config);

    bool valid = g_config.magic == CONFIG_MAGIC && g_config.version == CONFIG_VERSION &&
                 g_config.crc == computeCrc(g_config);

    if (!valid) {
        setConfigDefaults();
    }
    return valid;
}

bool saveConfig() {
    Config stored;
    EEPROM.get(0, stored);
    if (memcmp(&stored, &g_config, sizeof(Config)) == 0) {
        return false;
    }

    g_config.crc = computeCrc(g_config);
    EEPROM.put(0, g_config);
    EEPROM.commit();
    return true;
}

ConfigServer::ConfigServer(const char* serviceName) : m_server(80), m_serviceName(serviceName) {
    m_storedConfigValid = initConfig();

    m_server.on("/save", HTTP_POST, [this]() {
        m_saveRequested = true;
        m_lastRequestTime = millis();

        m_server.send(200);
    });

    m_server.on("/save_debounce", HTTP_POST, [this]() {
        m_saveDebounceTimeMs = m_server.arg("debounce").toInt();
        m_server.send(200);
    });
    m_server.on("/save_debounce", HTTP_GET,
                [this]() { m_server.send(200, "application/json", String(m_saveDebounceTimeMs)); });
    m_server.on("/config", HTTP_GET, [this]() {
        String json = "{";
        json += "\"saves\":" + String(m_configSaves) + ",";
        json += "\"storedValid\":" + String(m_storedConfigValid ? "true" : "false") + ",";
        json += "\"hostname\":\"" + String(g_config.hostname) + "\",";
        json += "\"ledConfig\":[";
        for (size_t i = 0; i < g_config.ledConfig.size(); i++) {
            if (i > 0) json += ",";
            json += "{";
            json += "\"brightness\":" + String(g_config.ledConfig[i].brightness) + ",";
            json += "\"onTimeMs\":" + String(g_config.ledConfig[i].onTimeMs) + ",";
            json += "\"fadeFreq\":" + String(g_config.ledConfig[i].fadeFreq, 3) + ",";
            json += "\"pirMask\":" + String(g_config.ledConfig[i].pirMask);
            json += "}";
        }
        json += "]";
        json += "}";

        m_server.send(200, "application/json", json);
    });
    m_server.on("/config/network", HTTP_POST, [this]() {
        if (m_server.hasArg("hostname")) {
            cpstr(g_config.hostname, m_server.arg("hostname").c_str(), sizeof(g_config.hostname));
        }
        if (m_server.hasArg("wifiSsid")) {
            cpstr(g_config.wifiSsid, m_server.arg("wifiSsid").c_str(), sizeof(g_config.wifiSsid));
        }
        if (m_server.hasArg("wifiPassword")) {
            cpstr(g_config.wifiPassword, m_server.arg("wifiPassword").c_str(),
                  sizeof(g_config.wifiPassword));
        }
        m_server.send(200);
    });
    m_server.on("/config/led", HTTP_POST, [this]() {
        size_t i = m_server.arg("index").toInt();
        if (i >= g_config.ledConfig.size()) {
            m_server.send(400, "text/html", "Invalid LED index");
            return;
        }

        if (m_server.hasArg("brightness")) {
            g_config.ledConfig[i].brightness = m_server.arg("brightness").toInt();
        }
        if (m_server.hasArg("onTimeMs")) {
            g_config.ledConfig[i].onTimeMs = m_server.arg("onTimeMs").toInt();
        }
        if (m_server.hasArg("fadeFreq")) {
            g_config.ledConfig[i].fadeFreq = m_server.arg("fadeFreq").toFloat();
        }
        if (m_server.hasArg("pirMask")) {
            g_config.ledConfig[i].pirMask = static_cast<uint8_t>(m_server.arg("pirMask").toInt());
        }
        m_server.send(200);
    });

    m_server.on("/config/save", HTTP_POST, [this]() {
        m_saveRequested = true;
        m_lastRequestTime = millis();

        m_server.send(200);
    });
}

void ConfigServer::begin() {
    m_server.begin();
    MDNS.begin(g_config.hostname);
    MDNS.addService("http", "tcp", 80);
    MDNS.addServiceTxt("http", "tcp", "role", m_serviceName);
}

void ConfigServer::handle(unsigned long now) {
    m_server.handleClient();
    MDNS.update();

    if (m_saveRequested && (now - m_lastRequestTime >= m_saveDebounceTimeMs)) {
        if (saveConfig()) {
            m_configSaves++;
        }
        m_saveRequested = false;
    }
}