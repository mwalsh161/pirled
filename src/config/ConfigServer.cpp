#include <Arduino.h>
#include <BearSSLHelpers.h>
#include <ESP8266mDNS.h>
#include <errno.h>
#include <limits.h>

#include "config/ConfigServer.h"
#include "config/ConfigStore.h"
#include "config/WireProtocol.h"
#include "debug.h"
#include "ota_public_key.h"
#include "system/Logger.h"

#ifndef FIRMWARE_VERSION
#error "FIRMWARE_VERSION not set. Define via PlatformIO build (see scripts/set_firmware_version.py)"
#endif

// Stringify macros to convert FIRMWARE_VERSION define to string literal
#define STRINGIFY(x) #x
#define STRINGIFY_EXPANSION(x) STRINGIFY(x)

namespace {
const char FIRMWARE_VERSION_STR[] PROGMEM = STRINGIFY_EXPANSION(FIRMWARE_VERSION);
}  // namespace

BearSSL::PublicKey signPubKey(publicKey);
BearSSL::HashSHA256 hash;
BearSSL::SigningVerifier sign(&signPubKey);

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
        if (index < 0 || static_cast<size_t>(index) >= getConfig().ledConfig.size()) {
            m_server.send(400, "text/html", "Invalid LED index");
            return;
        }
        size_t i = static_cast<size_t>(index);
        LedConfig& ledCfg = getLedConfig(i);

        if (m_server.hasArg("brightness")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("brightness"), value)) {
                sendInvalidArg(m_server, "brightness");
                return;
            }
            ledCfg.brightness = static_cast<int16_t>(constrain(value, 0, 1023));
        }
        if (m_server.hasArg("rampOnMs")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("rampOnMs"), value)) {
                sendInvalidArg(m_server, "rampOnMs");
                return;
            }
            ledCfg.rampOnMs = static_cast<int16_t>(constrain(value, 0, INT16_MAX));
        }
        if (m_server.hasArg("holdOnMs")) {
            int64_t value = 0;
            if (!parseInt64Strict(m_server.arg("holdOnMs"), value)) {
                sendInvalidArg(m_server, "holdOnMs");
                return;
            }
            ledCfg.holdOnMs =
                static_cast<uint32_t>(constrain(value, int64_t(0), int64_t(UINT32_MAX)));
        }
        if (m_server.hasArg("rampOffMs")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("rampOffMs"), value)) {
                sendInvalidArg(m_server, "rampOffMs");
                return;
            }
            ledCfg.rampOffMs = static_cast<int16_t>(constrain(value, 0, INT16_MAX));
        }
        if (m_server.hasArg("waitOnMs")) {
            int64_t value = 0;
            if (!parseInt64Strict(m_server.arg("waitOnMs"), value)) {
                sendInvalidArg(m_server, "waitOnMs");
                return;
            }
            ledCfg.waitOnMs =
                static_cast<uint32_t>(constrain(value, int64_t(0), int64_t(UINT32_MAX)));
        }
        if (m_server.hasArg("pirMaskOn")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("pirMaskOn"), value)) {
                sendInvalidArg(m_server, "pirMaskOn");
                return;
            }
            ledCfg.pirMaskOn = static_cast<uint8_t>(constrain(value, 0, int(UINT8_MAX)));
        }
        if (m_server.hasArg("pirMaskOff")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("pirMaskOff"), value)) {
                sendInvalidArg(m_server, "pirMaskOff");
                return;
            }
            ledCfg.pirMaskOff = static_cast<uint8_t>(constrain(value, 0, int(UINT8_MAX)));
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
        setConfigTimestamp(timestamp);
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
