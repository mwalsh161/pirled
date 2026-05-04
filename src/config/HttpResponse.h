#pragma once

#include <Arduino.h>
#include <ESP8266WebServer.h>

inline void addCors(ESP8266WebServer& server) {
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

inline void sendTextResponse(ESP8266WebServer& server, int statusCode, const char* contentType,
                             const String& body) {
    addCors(server);
    server.send(statusCode, contentType, body);
}

inline void sendJsonResponse(ESP8266WebServer& server, int statusCode, const String& body) {
    sendTextResponse(server, statusCode, "application/json", body);
}

inline void sendJsonProgmemResponse(ESP8266WebServer& server, int statusCode,
                                    PGM_P body) {
    addCors(server);
    server.send_P(statusCode, "application/json", body);
}

inline void sendEmptyResponse(ESP8266WebServer& server, int statusCode) {
    addCors(server);
    server.send(statusCode);
}

inline void beginStreamingTextResponse(ESP8266WebServer& server, int statusCode,
                                       const char* contentType) {
    server.setContentLength(CONTENT_LENGTH_UNKNOWN);
    addCors(server);
    server.send(statusCode, contentType, "");
}

inline void beginFixedBinaryResponse(ESP8266WebServer& server, int statusCode,
                                     const char* contentType, size_t contentLength) {
    server.setContentLength(contentLength);
    addCors(server);
    server.send(statusCode, contentType);
}
