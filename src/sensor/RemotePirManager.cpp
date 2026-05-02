#include "sensor/RemotePirManager.h"

#include <ctype.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "system/Logger.h"

namespace {
constexpr PirStates LOCAL_PHYSICAL_PIR_MASK = 0x000F;
constexpr size_t REMOTE_PIR_PACKET_BUFFER_SIZE = 128;
constexpr uint8_t REMOTE_PIR_MAX_PACKETS_PER_UPDATE = 4;

struct RemotePirEvent {
    char source[REMOTE_PIR_HOST_SIZE] = "";
    uint8_t pir = 0;
    bool active = false;
    uint32_t seq = 0;
    uint32_t leaseMs = REMOTE_PIR_DEFAULT_LEASE_MS;
};

bool hasElapsed(uint32_t now, uint32_t deadline) {
    return static_cast<int32_t>(now - deadline) >= 0;
}

bool isRemoteHostChar(char c) {
    return isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '.' || c == '_';
}

bool copyRemoteHostToken(const char* value, char* out, size_t outSize) {
    const size_t length = strlen(value);
    if (length == 0 || length >= outSize) return false;
    for (size_t i = 0; i < length; i++) {
        if (!isRemoteHostChar(value[i])) return false;
    }
    memcpy(out, value, length + 1);
    return true;
}

bool parseUint32Token(const char* value, uint32_t& out) {
    if (value[0] == '\0') return false;
    errno = 0;
    char* end = nullptr;
    unsigned long parsed = strtoul(value, &end, 10);
    if (errno == ERANGE || end == value || *end != '\0') return false;
    out = static_cast<uint32_t>(parsed);
    return true;
}

bool parseRemotePirEvent(char* packet, RemotePirEvent& out) {
    char* cursor = nullptr;
    const char* source = strtok_r(packet, ",", &cursor);
    const char* pir = strtok_r(nullptr, ",", &cursor);
    const char* active = strtok_r(nullptr, ",", &cursor);
    const char* seq = strtok_r(nullptr, ",", &cursor);
    const char* leaseMs = strtok_r(nullptr, ",", &cursor);
    const char* extra = strtok_r(nullptr, ",", &cursor);
    if (!source || !pir || !active || !seq || !leaseMs || extra) return false;
    if (!copyRemoteHostToken(source, out.source, sizeof(out.source))) return false;

    uint32_t parsedPir = 0;
    if (!parseUint32Token(pir, parsedPir) || parsedPir >= 4) return false;
    out.pir = static_cast<uint8_t>(parsedPir);

    uint32_t parsedActive = 0;
    if (!parseUint32Token(active, parsedActive) || parsedActive > 1) return false;
    out.active = parsedActive == 1;

    if (!parseUint32Token(seq, out.seq)) return false;
    if (!parseUint32Token(leaseMs, out.leaseMs) || out.leaseMs == 0) return false;
    return true;
}

uint32_t effectiveLeaseMs(const RemotePirConfig& slotConfig, const RemotePirEvent& event) {
    if (event.leaseMs < slotConfig.leaseMs) return event.leaseMs;
    return slotConfig.leaseMs;
}

void logRemotePirCode(uint8_t code) {
    char message[8] = "";
    snprintf(message, sizeof(message), "rp,%u", code);
    log(message);
}
}  // namespace

void RemotePirManager::update(uint32_t now, PirStates localPhysicalPirStates) {
    m_previousLocalPirStates = localPhysicalPirStates & LOCAL_PHYSICAL_PIR_MASK;
    receivePackets(now);
    expireSlots(now);
}

void RemotePirManager::onWiFiConnected(const char* hostname) {
    (void)hostname;
    if (m_udpListening) return;

    if (m_udp.begin(REMOTE_PIR_DEFAULT_PORT) == 1) {
        m_udpListening = true;
        log("ru,1");
        return;
    }

    log("ru,2");
}

void RemotePirManager::onWiFiDisconnected() {
    if (!m_udpListening) return;

    m_udp.stop();
    m_udpListening = false;
    clearAllRemotePirSlots();
    log("ru,3");
}

void RemotePirManager::setRemotePirSlot(size_t slot, bool active, uint32_t now, uint32_t leaseMs) {
    if (slot >= m_slots.size()) return;

    m_slots[slot].active = active;
    m_slots[slot].expiresAt = active ? now + leaseMs : 0;
    setSlotBit(slot, active);
}

void RemotePirManager::clearRemotePirSlot(size_t slot) {
    if (slot >= m_slots.size()) return;

    m_slots[slot].active = false;
    m_slots[slot].expiresAt = 0;
    setSlotBit(slot, false);
}

void RemotePirManager::clearAllRemotePirSlots() {
    for (size_t slot = 0; slot < m_slots.size(); slot++) {
        clearRemotePirSlot(slot);
    }
}

void RemotePirManager::setSlotBit(size_t slot, bool active) {
    const PirStates bit = static_cast<PirStates>(1U << (REMOTE_PIR_FIRST_BIT + slot));
    if (active) {
        m_remotePirStates |= bit;
        return;
    }

    m_remotePirStates &= static_cast<PirStates>(~bit);
}

void RemotePirManager::expireSlots(uint32_t now) {
    for (size_t slot = 0; slot < m_slots.size(); slot++) {
        if (m_slots[slot].active && hasElapsed(now, m_slots[slot].expiresAt)) {
            clearRemotePirSlot(slot);
        }
    }
}

void RemotePirManager::receivePackets(uint32_t now) {
    if (!m_udpListening) return;

    char packet[REMOTE_PIR_PACKET_BUFFER_SIZE] = "";
    for (uint8_t handled = 0; handled < REMOTE_PIR_MAX_PACKETS_PER_UPDATE; handled++) {
        const int packetSize = m_udp.parsePacket();
        if (packetSize <= 0) return;

        const int readSize = m_udp.read(packet, sizeof(packet) - 1);
        if (readSize <= 0 || packetSize >= int(sizeof(packet))) {
            logRemotePirCode(1);  // malformed
            continue;
        }
        packet[readSize] = '\0';

        RemotePirEvent event;
        if (!parseRemotePirEvent(packet, event)) {
            logRemotePirCode(1);  // malformed
            continue;
        }

        bool matched = false;
        const auto& remotePirs = getConfig().remotePirs;
        for (size_t slot = 0; slot < remotePirs.size(); slot++) {
            const auto& slotConfig = remotePirs[slot];
            if (!slotConfig.enabled) continue;
            if (slotConfig.sourcePirIndex != event.pir) continue;
            if (strcmp(slotConfig.sourceHost, event.source) != 0) continue;

            matched = true;
            auto& slotState = m_slots[slot];
            const uint32_t leaseMs = effectiveLeaseMs(slotConfig, event);
            if (slotState.hasLatestSeq && slotState.latestSeq == event.seq &&
                slotState.latestPir == event.pir &&
                strcmp(slotState.latestSource, event.source) == 0 &&
                !hasElapsed(now, slotState.latestSeqAt + leaseMs)) {
                continue;
            }

            slotState.latestSeq = event.seq;
            slotState.latestSeqAt = now;
            slotState.latestPir = event.pir;
            memcpy(slotState.latestSource, event.source, sizeof(slotState.latestSource));
            slotState.hasLatestSeq = true;
            setRemotePirSlot(slot, event.active, now, leaseMs);
        }

        if (!matched) {
            logRemotePirCode(2);  // no configured slot matched
        }
    }
}
