#include <Arduino.h>
#include <BearSSLHelpers.h>
#include "config/Config.h"
#include <EEPROM.h>
#include <ESP8266mDNS.h>
#include <ErriezCRC32.h>
#include <errno.h>
#include <limits.h>

#include "config/WireProtocol.h"
#include "system/Logger.h"
#include "debug.h"
#include "ota_public_key.h"

#ifndef FIRMWARE_VERSION
#error "FIRMWARE_VERSION not set. Define via PlatformIO build (see scripts/set_firmware_version.py)"
#endif

// Stringify macros to convert FIRMWARE_VERSION define to string literal
#define STRINGIFY(x) #x
#define STRINGIFY_EXPANSION(x) STRINGIFY(x)

#define VIRTUAL_PIR 4

namespace {
constexpr uint32_t CONFIG_MAGIC = 0x5049524C;  // "PIRL"
constexpr uint16_t CONFIG_VERSION = 4;
const char FIRMWARE_VERSION_STR[] PROGMEM = STRINGIFY_EXPANSION(FIRMWARE_VERSION);
Config s_config;

constexpr uint8_t CFG_BOOT_SOURCE_STORED = 0;
constexpr uint8_t CFG_BOOT_SOURCE_DEFAULTS = 1;
constexpr uint8_t CFG_SAVE_NO_CHANGE = 0;
constexpr uint8_t CFG_SAVE_COMMITTED = 1;
constexpr uint8_t CFG_SAVE_COMMIT_FAILED = 2;
}  // namespace

const Config& getConfig() { return s_config; }
LedConfig& getLedConfig(size_t index) { return s_config.ledConfig[index]; }

BearSSL::PublicKey signPubKey(publicKey);
BearSSL::HashSHA256 hash;
BearSSL::SigningVerifier sign(&signPubKey);

uint32_t computeCrc(const Config& cfg) {
    return crc32Buffer(reinterpret_cast<const uint8_t*>(&cfg), offsetof(Config, crc));
}

void setConfigDefaults() {
    memset(&s_config, 0, sizeof(s_config));

    s_config.magic = CONFIG_MAGIC;
    s_config.version = CONFIG_VERSION;

    for (size_t i = 0; i < s_config.ledConfig.size(); i++) {
        uint8_t pirMask = (1 << i) | (1 << (i + VIRTUAL_PIR));
        s_config.ledConfig[i] = {.brightness = 1023,
                               .rampOnMs = 1000,
                               .holdOnMs = 10000,
                               .rampOffMs = 1000,
                               .waitOnMs = 0,
                               .pirMaskOn = pirMask,
                               .pirMaskOff = pirMask};
    }

    s_config.crc = computeCrc(s_config);
}

bool initConfig() {
    EEPROM.begin(sizeof(Config));
    EEPROM.get(0, s_config);

    uint32_t storedMagic = s_config.magic;
    uint16_t storedVersion = s_config.version;
    uint32_t storedCrc = s_config.crc;
    uint32_t computedCrc = computeCrc(s_config);
    bool magicValid = s_config.magic == CONFIG_MAGIC;
    bool versionValid = s_config.version == CONFIG_VERSION;
    bool crcValid = s_config.crc == computedCrc;
    bool valid = magicValid && versionValid && crcValid;
    uint8_t bootSource = CFG_BOOT_SOURCE_STORED;

    if (!valid) {
        D_PRINTLN("Stored config invalid, loading defaults");
        setConfigDefaults();
        bootSource = CFG_BOOT_SOURCE_DEFAULTS;
    }

    // cb,<boot_source>,<valid>,<magic_ok>,<version_ok>,<crc_ok>,<stored_magic>,<stored_version>,<stored_crc>,<computed_crc>
    char status[128] = "";
    snprintf(status, sizeof(status), "cb,%u,%u,%u,%u,%u,%lu,%u,%lu,%lu", bootSource, valid, magicValid,
             versionValid, crcValid, static_cast<unsigned long>(storedMagic), storedVersion,
             static_cast<unsigned long>(storedCrc), static_cast<unsigned long>(computedCrc));
    log(status);
    D_PRINTLN(status);

    return valid;
}

bool saveConfig() {
    s_config.crc = computeCrc(s_config);

    Config stored;
    EEPROM.get(0, stored);
    char saveStatus[8] = "";
    if (memcmp(&stored, &s_config, sizeof(Config)) == 0) {
        snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_NO_CHANGE);
        log(saveStatus);
        D_PRINTLN(saveStatus);
        return true;
    }

    EEPROM.put(0, s_config);
    if (!EEPROM.commit()) {
        snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_COMMIT_FAILED);
        log(saveStatus);
        D_PRINTLN(saveStatus);
        return false;
    }
    snprintf(saveStatus, sizeof(saveStatus), "cs,%u", CFG_SAVE_COMMITTED);
    log(saveStatus);
    D_PRINTLN(saveStatus);
    return true;
}

void addCors(ESP8266WebServer& server) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
};

namespace {
bool parseInt32Strict(const String& value, int32_t& out) {
    if (value.length() == 0) return false;
    errno = 0;
    char* end = nullptr;
    long parsed = strtol(value.c_str(), &end, 10);
    if (errno == ERANGE || end == value.c_str() || *end != '\0') return false;
    out = static_cast<int32_t>(parsed);
    return true;
}

bool parseInt64Strict(const String& value, int64_t& out) {
    if (value.length() == 0) return false;
    errno = 0;
    char* end = nullptr;
    long long parsed = strtoll(value.c_str(), &end, 10);
    if (errno == ERANGE || end == value.c_str() || *end != '\0') return false;
    out = static_cast<int64_t>(parsed);
    return true;
}

void sendInvalidArg(ESP8266WebServer& server, const char* name) {
    addCors(server);
    server.send(400, "text/html", String("Invalid parameter: ") + name);
}
}  // namespace

ConfigServer::ConfigServer() : m_server(80) {
    // Handle preflight OPTIONS requests
    auto handleOptions = [&]() {
        addCors(m_server);
        m_server.send(204);  // No Content
    };

    m_server.on("/config/led", HTTP_POST, [&]() {
        addCors(m_server);

        int32_t index = 0;
        if (!m_server.hasArg("index") || !parseInt32Strict(m_server.arg("index"), index)) {
            sendInvalidArg(m_server, "index");
            return;
        }
        if (index < 0 || static_cast<size_t>(index) >= s_config.ledConfig.size()) {
            m_server.send(400, "text/html", "Invalid LED index");
            return;
        }
        size_t i = static_cast<size_t>(index);

        if (m_server.hasArg("brightness")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("brightness"), value)) {
                sendInvalidArg(m_server, "brightness");
                return;
            }
            s_config.ledConfig[i].brightness = static_cast<int16_t>(constrain(value, 0, 1023));
        }
        if (m_server.hasArg("rampOnMs")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("rampOnMs"), value)) {
                sendInvalidArg(m_server, "rampOnMs");
                return;
            }
            s_config.ledConfig[i].rampOnMs = static_cast<int16_t>(constrain(value, 0, INT16_MAX));
        }
        if (m_server.hasArg("holdOnMs")) {
            int64_t value = 0;
            if (!parseInt64Strict(m_server.arg("holdOnMs"), value)) {
                sendInvalidArg(m_server, "holdOnMs");
                return;
            }
            s_config.ledConfig[i].holdOnMs =
                static_cast<uint32_t>(constrain(value, int64_t(0), int64_t(UINT32_MAX)));
        }
        if (m_server.hasArg("rampOffMs")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("rampOffMs"), value)) {
                sendInvalidArg(m_server, "rampOffMs");
                return;
            }
            s_config.ledConfig[i].rampOffMs = static_cast<int16_t>(constrain(value, 0, INT16_MAX));
        }
        if (m_server.hasArg("waitOnMs")) {
            int64_t value = 0;
            if (!parseInt64Strict(m_server.arg("waitOnMs"), value)) {
                sendInvalidArg(m_server, "waitOnMs");
                return;
            }
            s_config.ledConfig[i].waitOnMs =
                static_cast<uint32_t>(constrain(value, int64_t(0), int64_t(UINT32_MAX)));
        }
        if (m_server.hasArg("pirMaskOn")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("pirMaskOn"), value)) {
                sendInvalidArg(m_server, "pirMaskOn");
                return;
            }
            s_config.ledConfig[i].pirMaskOn = static_cast<uint8_t>(constrain(value, 0, int(UINT8_MAX)));
        }
        if (m_server.hasArg("pirMaskOff")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("pirMaskOff"), value)) {
                sendInvalidArg(m_server, "pirMaskOff");
                return;
            }
            s_config.ledConfig[i].pirMaskOff = static_cast<uint8_t>(constrain(value, 0, int(UINT8_MAX)));
        }
        sendWireData(m_server);
    });
    m_server.on("/config/led", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/save", HTTP_POST, [&]() {
        int64_t timestamp = 0;
        if (!m_server.hasArg("timestamp") || !parseInt64Strict(m_server.arg("timestamp"), timestamp)) {
            sendInvalidArg(m_server, "timestamp");
            return;
        }
        s_config.timestamp = timestamp;
        addCors(m_server);
        if (!saveConfig()) {
            m_server.send(500, "text/plain", "Save failed");
            return;
        }
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
        int32_t overrideMask = 0;
        if (!parseInt32Strict(m_server.arg("val"), overrideMask)) {
            sendInvalidArg(m_server, "val");
            return;
        }
        setPirOverrides(static_cast<PirStates>(constrain(overrideMask, 0, int(UINT8_MAX))));
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

bool ConfigServer::setup() {
    if (m_initialized) {
        D_PRINTLN("ConfigServer::setup called again; ignoring repeated call");
        return m_storedConfigValid;
    }
    m_storedConfigValid = initConfig();
    m_initialized = true;
    return m_storedConfigValid;
}

void ConfigServer::onWiFiConnected(const char* hostname) {
    if (!m_initialized) {
        D_PRINTLN("ConfigServer lazy init from onWiFiConnected; explicit setup was not called");
        setup();
    }
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

void ConfigServer::handle() {
    if (!m_initialized) {
        D_PRINTLN("ConfigServer lazy init from handle; explicit setup was not called");
        setup();
    }

    // This has to come last since handlers may call millis.
    MDNS.update();
    m_server.handleClient();
    m_ota.handle();
}
