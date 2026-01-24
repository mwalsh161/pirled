#include <Arduino.h>
#include <BearSSLHelpers.h>
#include <Config.h>
#include <EEPROM.h>
#include <ESP8266mDNS.h>
#include <ErriezCRC32.h>

#include "Logger.h"
#include "ota_public_key.h"
#define VIRTUAL_PIR 4

static constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
static constexpr uint16_t CONFIG_VERSION = 2;

Config CONFIG;  // Externally visible config instance.

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
    memset(&CONFIG, 0, sizeof(CONFIG));

    CONFIG.magic = CONFIG_MAGIC;
    CONFIG.version = CONFIG_VERSION;

    cpstr(CONFIG.hostname, "", sizeof(CONFIG.hostname));
    cpstr(CONFIG.wifiSsid, "", sizeof(CONFIG.wifiSsid));
    cpstr(CONFIG.wifiPassword, "", sizeof(CONFIG.wifiPassword));

    for (size_t i = 0; i < CONFIG.ledConfig.size(); i++) {
        uint8_t pirMask = (1 << i) | (1 << (i + VIRTUAL_PIR));
        CONFIG.ledConfig[i] = {.brightness = 1023,
                               .rampOnMs = 1000,
                               .holdOnMs = 10000,
                               .rampOffMs = 1000,
                               .pirMask = pirMask};
    }

    CONFIG.crc = computeCrc(CONFIG);
}

bool initConfig() {
    EEPROM.begin(sizeof(Config));
    EEPROM.get(0, CONFIG);

    bool valid = CONFIG.magic == CONFIG_MAGIC && CONFIG.version == CONFIG_VERSION &&
                 CONFIG.crc == computeCrc(CONFIG);

    if (!valid) {
        setConfigDefaults();
    }
    return valid;
}

bool saveConfig() {
    Config stored;
    EEPROM.get(0, stored);
    if (memcmp(&stored, &CONFIG, sizeof(Config)) == 0) {
        return false;
    }

    CONFIG.crc = computeCrc(CONFIG);
    EEPROM.put(0, CONFIG);
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

    m_server.on("/save_debounce", HTTP_POST, [&]() {
        if (!m_server.hasArg("val")) {
            m_server.send(400, "text/html", "Missing parameter");
            return;
        }
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
        json += "\"hostname\":\"" + String(CONFIG.hostname) + "\",";
        json += "\"timestamp\":" + String(CONFIG.timestamp) + ",";
        json += "\"ledConfig\":[";
        for (size_t i = 0; i < CONFIG.ledConfig.size(); i++) {
            if (i > 0) json += ",";
            json += "{";
            json += "\"brightness\":" + String(CONFIG.ledConfig[i].brightness) + ",";
            json += "\"rampOnMs\":" + String(CONFIG.ledConfig[i].rampOnMs) + ",";
            json += "\"holdOnMs\":" + String(CONFIG.ledConfig[i].holdOnMs) + ",";
            json += "\"rampOffMs\":" + String(CONFIG.ledConfig[i].rampOffMs) + ",";
            json += "\"pirMask\":" + String(CONFIG.ledConfig[i].pirMask);
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
            cpstr(CONFIG.hostname, m_server.arg("hostname").c_str(), sizeof(CONFIG.hostname));
        }
        if (m_server.hasArg("wifiSsid")) {
            cpstr(CONFIG.wifiSsid, m_server.arg("wifiSsid").c_str(), sizeof(CONFIG.wifiSsid));
        }
        if (m_server.hasArg("wifiPassword")) {
            cpstr(CONFIG.wifiPassword, m_server.arg("wifiPassword").c_str(),
                  sizeof(CONFIG.wifiPassword));
        }
        m_lastRequestTime = millis();
        addCors(m_server);
        m_server.send(200);
    });
    m_server.on("/config/network", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/led", HTTP_POST, [&]() {
        addCors(m_server);

        size_t i = m_server.arg("index").toInt();
        if (i >= CONFIG.ledConfig.size()) {
            m_server.send(400, "text/html", "Invalid LED index");
            return;
        }

        if (m_server.hasArg("brightness")) {
            CONFIG.ledConfig[i].brightness =
                max(min((int)m_server.arg("brightness").toInt(), 1023), 0);
        }
        if (m_server.hasArg("rampOnMs")) {
            CONFIG.ledConfig[i].rampOnMs = m_server.arg("rampOnMs").toInt();
        }
        if (m_server.hasArg("holdOnMs")) {
            CONFIG.ledConfig[i].holdOnMs = max(m_server.arg("holdOnMs").toFloat(), 0.0f);
        }
        if (m_server.hasArg("rampOffMs")) {
            CONFIG.ledConfig[i].rampOffMs = m_server.arg("rampOffMs").toInt();
        }
        if (m_server.hasArg("pirMask")) {
            CONFIG.ledConfig[i].pirMask = static_cast<uint8_t>(m_server.arg("pirMask").toInt());
        }
        m_lastRequestTime = millis();
        m_server.send(200);
    });
    m_server.on("/config/led", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/save", HTTP_POST, [&]() {
        if (!m_server.hasArg("timestamp")) {
            m_server.send(400, "text/html", "Missing timestamp parameter");
            return;
        }
        CONFIG.timestamp = strtoll(m_server.arg("timestamp").c_str(), nullptr, 10);
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
        json += "\"pir\":" + (m_pirStatesPtr ? String(*m_pirStatesPtr) : "null") + ",";

        json += "\"leds\":[";
        for (size_t i = 0; i < m_ledStatesPtrs.size(); i++) {
            if (i > 0) json += ",";
            json += "{";
            json +=
                "\"state\":" + (m_ledStatesPtrs[i] ? String(*m_ledStatesPtrs[i]) : "null") + ",";
            json +=
                "\"brightness\":" + (m_brightnessPtrs[i] ? String(*m_brightnessPtrs[i]) : "null");
            json += "}";
        }
        json += "]";
        json += "}";
        addCors(m_server);
        m_server.send(200, "application/json", json);
    });
    m_server.on("/status", HTTP_OPTIONS, handleOptions);

    m_server.on("/reboot", HTTP_POST, [&]() {
        addCors(m_server);
        m_server.send(200);
        ESP.restart();
    });
    m_server.on("/reboot", HTTP_OPTIONS, handleOptions);

    m_server.on("/logs", HTTP_GET, [&]() {
        m_server.setContentLength(CONTENT_LENGTH_UNKNOWN);
        addCors(m_server);
        m_server.send(200, "text/plain", "");
        if (logWrapped) {
            m_server.sendContent(logBuf + logPos, sizeof(logBuf) - logPos);
            m_server.sendContent(logBuf, logPos);
        } else {
            m_server.sendContent(logBuf, logPos);
        }
    });
    m_server.on("/logs", HTTP_OPTIONS, handleOptions);
}

void ConfigServer::begin() {
    m_server.begin();
    MDNS.begin(CONFIG.hostname);
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