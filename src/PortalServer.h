#pragma once

#include <DNSServer.h>
#include <ESP8266WebServer.h>

class PortalServer {
   public:
    PortalServer();
    ~PortalServer();

    void handle();

   private:
    ESP8266WebServer m_server;
    DNSServer m_dns;
};
