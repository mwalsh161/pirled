#pragma once

#include <WifiCreds.h>

#include <IPAddress.h>

namespace PortalServer {
    using CredsCallback = void (*)(const WifiCreds&);

    void begin(const IPAddress& apIP, const CredsCallback& credsCB);
    void handle();
    void stop();
}
