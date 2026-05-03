#include "system/StaticNetworkConfig.h"

#include <EEPROM.h>
#include <ErriezCRC32.h>
#include <stddef.h>
#include <string.h>

#include "debug.h"
#include "system/Logger.h"
#include "system/PersistentStorage.h"

namespace {
constexpr uint32_t STATIC_NETWORK_MAGIC = 0x53544950;  // "STIP"
constexpr uint16_t STATIC_NETWORK_VERSION = 1;

struct StoredStaticNetworkConfig {
    uint32_t magic;
    uint16_t version;
    uint8_t enabled;
    uint8_t reserved;
    uint8_t ip[4];
    uint8_t gateway[4];
    uint8_t subnet[4];
    uint8_t dns[4];
    uint32_t crc;
};

uint32_t computeCrc(const StoredStaticNetworkConfig& stored) {
    return crc32Buffer(reinterpret_cast<const uint8_t*>(&stored),
                       offsetof(StoredStaticNetworkConfig, crc));
}

void copyIpToBytes(const IPAddress& ip, uint8_t out[4]) {
    for (size_t i = 0; i < 4; i++) out[i] = ip[i];
}

IPAddress copyBytesToIp(const uint8_t in[4]) { return IPAddress(in[0], in[1], in[2], in[3]); }
}  // namespace

bool loadStaticNetworkConfig(StaticNetworkConfig& config) {
    beginPersistentStorage();

    StoredStaticNetworkConfig stored{};
    EEPROM.get(persistentStaticNetworkConfigOffset(), stored);

    if (stored.magic != STATIC_NETWORK_MAGIC || stored.version != STATIC_NETWORK_VERSION ||
        stored.crc != computeCrc(stored)) {
        config = {.enabled = false,
                  .ip = IPAddress(),
                  .gateway = IPAddress(),
                  .subnet = IPAddress(),
                  .dns = IPAddress()};
        return false;
    }

    config.enabled = stored.enabled != 0;
    config.ip = copyBytesToIp(stored.ip);
    config.gateway = copyBytesToIp(stored.gateway);
    config.subnet = copyBytesToIp(stored.subnet);
    config.dns = copyBytesToIp(stored.dns);
    return true;
}

bool saveStaticNetworkConfig(const StaticNetworkConfig& config) {
    beginPersistentStorage();

    StoredStaticNetworkConfig stored{};
    stored.magic = STATIC_NETWORK_MAGIC;
    stored.version = STATIC_NETWORK_VERSION;
    stored.enabled = config.enabled ? 1 : 0;
    copyIpToBytes(config.ip, stored.ip);
    copyIpToBytes(config.gateway, stored.gateway);
    copyIpToBytes(config.subnet, stored.subnet);
    copyIpToBytes(config.dns, stored.dns);
    stored.crc = computeCrc(stored);

    StoredStaticNetworkConfig existing{};
    EEPROM.get(persistentStaticNetworkConfigOffset(), existing);
    if (memcmp(&existing, &stored, sizeof(stored)) == 0) return true;

    EEPROM.put(persistentStaticNetworkConfigOffset(), stored);
    bool ok = EEPROM.commit();
    logAt(millis(), ok ? "sn,1" : "sn,2");
    D_PRINTLN(ok ? "sn,1" : "sn,2");
    return ok;
}

bool clearStaticNetworkConfig() {
    return saveStaticNetworkConfig(
        {.enabled = false,
         .ip = IPAddress(),
         .gateway = IPAddress(),
         .subnet = IPAddress(),
         .dns = IPAddress()});
}
