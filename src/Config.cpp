#include <Arduino.h>
#include <BearSSLHelpers.h>
#include <Config.h>
#include <EEPROM.h>
#include <ESP8266mDNS.h>
#include <ErriezCRC32.h>

#include "ota_public_key.h"

#define VIRTUAL_PIR 4

static constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
static constexpr uint16_t CONFIG_VERSION = 1;

Config g_config;  // Externally visible config instance.

BearSSL::PublicKey signPubKey(publicKey);
BearSSL::HashSHA256 hash;
BearSSL::SigningVerifier sign(&signPubKey);

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
        uint8_t pirMask = (1 << i) | (1 << (i + VIRTUAL_PIR));
        g_config.ledConfig[i] = {
            .brightness = 1023, .onTimeMs = 10000, .fadeFreq = 0.3f, .pirMask = pirMask};
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
void addCors(ESP8266WebServer& server) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
};

ConfigServer::ConfigServer(const char* serviceName) : m_server(80), m_serviceName(serviceName) {
    m_storedConfigValid = initConfig();

    Update.installSignature(&hash, &sign);

    // Handle preflight OPTIONS requests
    auto handleOptions = [&]() {
        addCors(m_server);
        m_server.send(204);  // No Content
    };

    m_server.on("/save", HTTP_POST, [&]() {
        m_saveRequested = true;
        m_lastRequestTime = millis();

        addCors(m_server);
        m_server.send(200);
    });
    m_server.on("/save", HTTP_OPTIONS, handleOptions);

    m_server.on("/save_debounce", HTTP_POST, [&]() {
        m_saveDebounceTimeMs = m_server.arg("val").toInt();
        addCors(m_server);
        m_server.send(200);
    });
    m_server.on("/save_debounce", HTTP_GET, [&]() {
        addCors(m_server);
        m_server.send(200, "application/json", String(m_saveDebounceTimeMs));
    });
    m_server.on("/save_debounce", HTTP_OPTIONS, handleOptions);

    m_server.on("/config", HTTP_GET, [&]() {
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

        addCors(m_server);
        m_server.send(200, "application/json", json);
    });
    m_server.on("/config", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/network", HTTP_POST, [&]() {
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
        m_lastRequestTime = millis();
        addCors(m_server);
        m_server.send(200);
    });
    m_server.on("/config/network", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/led", HTTP_POST, [&]() {
        addCors(m_server);

        size_t i = m_server.arg("index").toInt();
        if (i >= g_config.ledConfig.size()) {
            m_server.send(400, "text/html", "Invalid LED index");
            return;
        }

        if (m_server.hasArg("brightness")) {
            g_config.ledConfig[i].brightness =
                max(min((int)m_server.arg("brightness").toInt(), 1023), 0);
        }
        if (m_server.hasArg("onTimeMs")) {
            g_config.ledConfig[i].onTimeMs = m_server.arg("onTimeMs").toInt();
        }
        if (m_server.hasArg("fadeFreq")) {
            g_config.ledConfig[i].fadeFreq = max(m_server.arg("fadeFreq").toFloat(), 0.0f);
        }
        if (m_server.hasArg("pirMask")) {
            g_config.ledConfig[i].pirMask = static_cast<uint8_t>(m_server.arg("pirMask").toInt());
        }
        m_lastRequestTime = millis();
        m_server.send(200);
    });
    m_server.on("/config/led", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/save", HTTP_POST, [&]() {
        m_lastRequestTime = millis();
        m_saveRequested = true;

        addCors(m_server);
        m_server.send(200);
    });
    m_server.on("/config/save", HTTP_OPTIONS, handleOptions);

    m_server.on("/pir_override", HTTP_POST, [&]() {
        // This gets ORed with what pins read.
        // In general, best practice is to only set the 4 MSBs for the virtual PIRs.
        addCors(m_server);
        if (!m_server.hasArg("val")) {
            m_server.send(400, "text/html", "Missing val parameter");
            return;
        }
        m_pirOverrides = static_cast<PirStates>(m_server.arg("val").toInt());
        m_server.send(200);
    });
    m_server.on("/pir_override", HTTP_GET, [&]() {
        addCors(m_server);
        m_server.send(200, "application/json", String(m_pirOverrides));
    });
    m_server.on("/pir_override", HTTP_OPTIONS, handleOptions);

    m_server.on("/status", HTTP_GET, [&]() {
        String json = "{";
        json += "\"pir\":" + String(m_pirStates) + ",";
        json += "\"leds\":[";
        for (size_t i = 0; i < m_ledStates.size(); i++) {
            if (i > 0) json += ",";
            json += String(m_ledStates[i]);
        }
        json += "]";
        json += "}";
        addCors(m_server);
        m_server.send(200, "application/json", json);
    });
    m_server.on("/status", HTTP_OPTIONS, handleOptions);
}

void ConfigServer::begin() {
    m_server.begin();
    MDNS.begin(g_config.hostname);
    MDNS.addService(m_serviceName, "http", "tcp", 80);
    m_ota.begin(false);  // We manage MDNS ourselves.
}

void ConfigServer::handle(unsigned long now) {
    if (m_saveRequested && (now - m_lastRequestTime >= m_saveDebounceTimeMs)) {
        if (saveConfig()) {
            m_configSaves++;
        }
        m_saveRequested = false;
    }

    // This has to come last since it may call millis (now has already been grabbed for this loop).
    MDNS.update();
    m_server.handleClient();
    m_ota.handle();
}