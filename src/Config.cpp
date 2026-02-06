#include <Arduino.h>
#include <BearSSLHelpers.h>
#include <Config.h>
#include <EEPROM.h>
#include <ESP8266mDNS.h>
#include <ErriezCRC32.h>

#include "Logger.h"
#include "WireProtocol.h"
#include "debug.h"
#include "ota_public_key.h"

#ifndef FIRMWARE_VERSION
#error "FIRMWARE_VERSION not set. Define via PlatformIO build (see scripts/set_firmware_version.py)"
#endif

// Stringify macros to convert FIRMWARE_VERSION define to string literal
#define STRINGIFY(x) #x
#define STRINGIFY_EXPANSION(x) STRINGIFY(x)

#define VIRTUAL_PIR 4

static constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
static constexpr uint16_t CONFIG_VERSION = 4;
static const char FIRMWARE_VERSION_STR[] PROGMEM = STRINGIFY_EXPANSION(FIRMWARE_VERSION);

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

    for (size_t i = 0; i < CONFIG.ledConfig.size(); i++) {
        uint8_t pirMask = (1 << i) | (1 << (i + VIRTUAL_PIR));
        CONFIG.ledConfig[i] = {.brightness = 1023,
                               .rampOnMs = 1000,
                               .holdOnMs = 10000,
                               .rampOffMs = 1000,
                               .waitOnMs = 0,
                               .pirMaskOn = pirMask,
                               .pirMaskOff = pirMask};
    }

    CONFIG.crc = computeCrc(CONFIG);
}

bool initConfig() {
    EEPROM.begin(sizeof(Config));
    EEPROM.get(0, CONFIG);

    bool valid = CONFIG.magic == CONFIG_MAGIC && CONFIG.version == CONFIG_VERSION &&
                 CONFIG.crc == computeCrc(CONFIG);

    if (!valid) {
        D_PRINTLN("Stored config invalid, loading defaults");
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

ConfigServer::ConfigServer() : m_server(80) {
    m_storedConfigValid = initConfig();

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
        if (m_server.hasArg("waitOnMs")) {
            CONFIG.ledConfig[i].waitOnMs = max(m_server.arg("waitOnMs").toFloat(), 0.0f);
        }
        if (m_server.hasArg("pirMaskOn")) {
            CONFIG.ledConfig[i].pirMaskOn = static_cast<uint8_t>(m_server.arg("pirMaskOn").toInt());
        }
        if (m_server.hasArg("pirMaskOff")) {
            CONFIG.ledConfig[i].pirMaskOff =
                static_cast<uint8_t>(m_server.arg("pirMaskOff").toInt());
        }
        m_lastRequestTime = millis();
        sendWireData(m_server);
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
        sendWireData(m_server);
    });
    m_server.on("/pir_override", HTTP_OPTIONS, handleOptions);

    m_server.on("/combined.schema", HTTP_GET, [&]() {
        addCors(m_server);
        sendWireSchema(m_server);
    });
    m_server.on("/combined.schema", HTTP_OPTIONS, handleOptions);
    m_server.on("/combined.bin", HTTP_GET, [&]() {
        addCors(m_server);
        sendWireData(m_server);
    });
    m_server.on("/combined.bin", HTTP_OPTIONS, handleOptions);

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

    m_server.on("/firmware_version", HTTP_GET, [&]() {
        addCors(m_server);
        String version = String((__FlashStringHelper*)FIRMWARE_VERSION_STR);
        m_server.send(200, "application/json", "{\"version\":\"" + version + "\"}");
    });
    m_server.on("/firmware_version", HTTP_OPTIONS, handleOptions);
}

void ConfigServer::onWiFiConnected(const char* hostname) {
    log(">WiFi");
    D_PRINTLN("starting ConfigServer, MDNS, OTA");
    m_server.begin();
    MDNS.begin(hostname);
    MDNS.addService(0, "http", "tcp", 80);  // Use hostname.
    Update.installSignature(&hash, &sign);
    m_ota.begin(false);  // We manage MDNS ourselves.
}

void ConfigServer::onWiFiDisconnected() {
    log("<WiFi");
    D_PRINTLN("stopping ConfigServer, MDNS, OTA");
    m_server.close();
    MDNS.close();
    m_ota.end();
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