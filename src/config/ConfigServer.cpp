#include <Arduino.h>
#include <BearSSLHelpers.h>
#include <ctype.h>
#include <ESP8266mDNS.h>
#include <errno.h>
#include <limits.h>
#include <string.h>

#include "config/ConfigServer.h"
#include "config/RemoteHostValidation.h"
#include "config/ConfigStore.h"
#include "config/WireProtocol.h"
#include "debug.h"
#include "ota_public_key.h"
#include "system/Logger.h"

#ifndef FIRMWARE_VERSION
#error "FIRMWARE_VERSION not set. Define via PlatformIO build (see scripts/set_firmware_version.py)"
#endif

namespace {
const char FIRMWARE_VERSION_STR[] PROGMEM = FIRMWARE_VERSION;
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
constexpr PirStates PIR_OVERRIDE_MASK = 0x00FF;

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

bool parseBoolStrict(const String& value, bool& out) {
    if (value == "1" || value.equalsIgnoreCase("true")) {
        out = true;
        return true;
    }
    if (value == "0" || value.equalsIgnoreCase("false")) {
        out = false;
        return true;
    }
    return false;
}

bool parseIndexArg(ESP8266WebServer& server, size_t maxSize, size_t& out) {
    int32_t index = 0;
    if (!server.hasArg("index") || !parseInt32Strict(server.arg("index"), index)) return false;
    if (index < 0 || static_cast<size_t>(index) >= maxSize) return false;
    out = static_cast<size_t>(index);
    return true;
}

bool copyRemoteHost(const String& value, char* out, size_t outSize) {
    if (value.length() >= outSize) return false;
    for (size_t i = 0; i < value.length(); i++) {
        if (!isRemoteHostChar(value.charAt(i))) return false;
    }
    value.toCharArray(out, outSize);
    return true;
}

void appendRemoteHost(String& json, const char* host) {
    json += "\"";
    json += host;
    json += "\"";
}

void sendRemoteSharingJson(ESP8266WebServer& server) {
    const Config& config = getConfig();
    String json;
    json.reserve(1024);
    json += "{\"eventDestinations\":[";
    for (size_t i = 0; i < config.eventDestinations.size(); i++) {
        if (i > 0) json += ",";
        const auto& destination = config.eventDestinations[i];
        json += "{\"host\":";
        appendRemoteHost(json, destination.host);
        json += ",\"enabled\":";
        json += destination.enabled ? "true" : "false";
        json += "}";
    }
    json += "],\"remotePirs\":[";
    for (size_t i = 0; i < config.remotePirs.size(); i++) {
        if (i > 0) json += ",";
        const auto& remotePir = config.remotePirs[i];
        json += "{\"sourceHost\":";
        appendRemoteHost(json, remotePir.sourceHost);
        json += ",\"sourcePirIndex\":";
        json += static_cast<unsigned int>(remotePir.sourcePirIndex);
        json += ",\"leaseMs\":";
        json += static_cast<unsigned long>(remotePir.leaseMs);
        json += ",\"enabled\":";
        json += remotePir.enabled ? "true" : "false";
        json += "}";
    }
    json += "]}";
    addCors(server);
    server.send(200, "application/json", json);
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
            ledCfg.pirMaskOn = static_cast<PirStates>(constrain(value, 0, int(UINT16_MAX)));
        }
        if (m_server.hasArg("pirMaskOff")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("pirMaskOff"), value)) {
                sendInvalidArg(m_server, "pirMaskOff");
                return;
            }
            ledCfg.pirMaskOff = static_cast<PirStates>(constrain(value, 0, int(UINT16_MAX)));
        }
        sendWireData(m_server);
    });
    m_server.on("/config/led", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/remote_sharing", HTTP_GET, [&]() { sendRemoteSharingJson(m_server); });
    m_server.on("/config/remote_sharing", HTTP_OPTIONS, handleOptions);

    // Remote sharing writes are intentionally simple per-slot updates.
    // We currently accept last-write-wins behavior rather than adding
    // optimistic concurrency or multi-slot atomicity on the device.
    m_server.on("/config/pir_destination", HTTP_POST, [&]() {
        addCors(m_server);

        size_t i = 0;
        if (!parseIndexArg(m_server, getConfig().eventDestinations.size(), i)) {
            sendInvalidArg(m_server, "index");
            return;
        }

        PirEventDestinationConfig next = getPirEventDestinationConfig(i);
        if (m_server.hasArg("host") &&
            !copyRemoteHost(m_server.arg("host"), next.host, sizeof(next.host))) {
            sendInvalidArg(m_server, "host");
            return;
        }
        if (m_server.hasArg("enabled") && !parseBoolStrict(m_server.arg("enabled"), next.enabled)) {
            sendInvalidArg(m_server, "enabled");
            return;
        }
        if (next.enabled && next.host[0] == '\0') {
            sendInvalidArg(m_server, "host");
            return;
        }

        getPirEventDestinationConfig(i) = next;
        sendRemoteSharingJson(m_server);
    });
    m_server.on("/config/pir_destination", HTTP_OPTIONS, handleOptions);

    m_server.on("/config/remote_pir", HTTP_POST, [&]() {
        addCors(m_server);

        size_t i = 0;
        if (!parseIndexArg(m_server, getConfig().remotePirs.size(), i)) {
            sendInvalidArg(m_server, "index");
            return;
        }

        RemotePirConfig next = getRemotePirConfig(i);
        if (m_server.hasArg("sourceHost") &&
            !copyRemoteHost(m_server.arg("sourceHost"), next.sourceHost, sizeof(next.sourceHost))) {
            sendInvalidArg(m_server, "sourceHost");
            return;
        }
        if (m_server.hasArg("sourcePirIndex")) {
            int32_t value = 0;
            if (!parseInt32Strict(m_server.arg("sourcePirIndex"), value) || value < 0 ||
                value >= 4) {
                sendInvalidArg(m_server, "sourcePirIndex");
                return;
            }
            next.sourcePirIndex = static_cast<uint8_t>(value);
        }
        if (m_server.hasArg("leaseMs")) {
            int64_t value = 0;
            if (!parseInt64Strict(m_server.arg("leaseMs"), value) || value <= 0 ||
                value > int64_t(UINT32_MAX)) {
                sendInvalidArg(m_server, "leaseMs");
                return;
            }
            next.leaseMs = static_cast<uint32_t>(value);
        }
        if (m_server.hasArg("enabled") && !parseBoolStrict(m_server.arg("enabled"), next.enabled)) {
            sendInvalidArg(m_server, "enabled");
            return;
        }
        if (next.enabled && next.sourceHost[0] == '\0') {
            sendInvalidArg(m_server, "sourceHost");
            return;
        }

        getRemotePirConfig(i) = next;
        sendRemoteSharingJson(m_server);
    });
    m_server.on("/config/remote_pir", HTTP_OPTIONS, handleOptions);

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
        // In general, best practice is to only set bits 4..7 for the virtual PIRs.
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
        setPirOverrides(static_cast<PirStates>(constrain(overrideMask, 0, int(PIR_OVERRIDE_MASK))));
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
        const size_t startIndex = logEntryCount == LOG_ENTRY_COUNT ? logWriteIndex : 0;
        for (size_t i = 0; i < logEntryCount; i++) {
            const LogEntry& entry = logEntries[(startIndex + i) % LOG_ENTRY_COUNT];
            char line[48];
            snprintf(line, sizeof(line), "%lu,%s\n", static_cast<unsigned long>(entry.timestampMs),
                     entry.message);
            m_server.sendContent(line);
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
    logAt(millis(), ">WiFi");
    D_PRINTLN("starting ConfigServer, MDNS, OTA");
    m_server.begin();
    MDNS.begin(hostname);
    MDNS.addService(0, "http", "tcp", 80);  // Use hostname.
    Update.installSignature(&hash, &sign);
    m_ota.begin(false);  // We manage MDNS ourselves.
}

void ConfigServer::onWiFiDisconnected() {
    logAt(millis(), "<WiFi");
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
