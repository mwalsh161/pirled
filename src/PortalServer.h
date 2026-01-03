#pragma once

#include <IPAddress.h>
#include <WifiCreds.h>

namespace PortalServer {
using CredsCallback = void (*)(const WifiCreds&);

void begin(const IPAddress& apIP, const CredsCallback& credsCB);
void handle();
void stop();
}  // namespace PortalServer
