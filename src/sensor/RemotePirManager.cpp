#include "sensor/RemotePirManager.h"

#include <Arduino.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "config/RemoteHostValidation.h"
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

void logRemotePirCode(uint32_t now, uint8_t code) {
    char message[8] = "";
    snprintf(message, sizeof(message), "rp,%u", code);
    logAt(now, message);
}

void logRemotePirMismatch(uint32_t now, uint8_t code, uint8_t pir, bool sawHostMatch,
                          bool sawPirMatch, bool sawEnabledSlot) {
    char message[20] = "";
    snprintf(message, sizeof(message), "rp,%u,p%u,h%u,i%u,e%u", code,
             static_cast<unsigned int>(pir), sawHostMatch ? 1U : 0U, sawPirMatch ? 1U : 0U,
             sawEnabledSlot ? 1U : 0U);
    logAt(now, message);
}

void logRemotePirMatched(uint32_t now, size_t slot, uint8_t pir, bool active) {
    char message[18] = "";
    snprintf(message, sizeof(message), "rp,6,s%u,p%u,a%u", static_cast<unsigned int>(slot),
             static_cast<unsigned int>(pir), active ? 1U : 0U);
    logAt(now, message);
}

void logRemotePirSendCode(uint8_t code) {
    char message[8] = "";
    snprintf(message, sizeof(message), "rs,%u", code);
    logAt(millis(), message);
}

void logRemotePirSendDetail(uint8_t code, size_t pirIndex, bool active, size_t destinationIndex) {
    char message[18] = "";
    snprintf(message, sizeof(message), "rs,%u,p%u,a%u,d%u", code,
             static_cast<unsigned int>(pirIndex), active ? 1U : 0U,
             static_cast<unsigned int>(destinationIndex));
    logAt(millis(), message);
}
}  // namespace

void RemotePirManager::update(uint32_t now, PirStates localPhysicalPirStates) {
    localPhysicalPirStates &= LOCAL_PHYSICAL_PIR_MASK;
    receivePackets(now);
    sendLocalPirEvents(now, localPhysicalPirStates);
    m_previousLocalPirStates = localPhysicalPirStates;
    expireSlots(now);
}

void RemotePirManager::onWiFiConnected(const char* hostname) {
    if (hostname) {
        strncpy(m_hostname, hostname, sizeof(m_hostname) - 1);
        m_hostname[sizeof(m_hostname) - 1] = '\0';
    }
    if (m_udpListening) return;

    if (m_udp.begin(REMOTE_PIR_DEFAULT_PORT) == 1) {
        m_udpListening = true;
        logAt(millis(), "ru,1");
        return;
    }

    logAt(millis(), "ru,2");
}

void RemotePirManager::onWiFiDisconnected() {
    if (!m_udpListening) return;

    m_udp.stop();
    m_udpListening = false;
    m_hostname[0] = '\0';
    for (auto& sendState : m_localSendStates) {
        sendState.pendingRepeats = 0;
        sendState.hasSentActive = false;
    }
    clearAllRemotePirSlots();
    logAt(millis(), "ru,3");
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
            logRemotePirCode(now, 1);  // malformed
            continue;
        }
        packet[readSize] = '\0';

        RemotePirEvent event;
        if (!parseRemotePirEvent(packet, event)) {
            logRemotePirCode(now, 1);  // malformed
            continue;
        }

        bool matched = false;
        bool sawEnabledSlot = false;
        bool sawHostMatch = false;
        bool sawPirMatch = false;
        const auto& remotePirs = getConfig().remotePirs;
        for (size_t slot = 0; slot < remotePirs.size(); slot++) {
            const auto& slotConfig = remotePirs[slot];
            if (!slotConfig.enabled) continue;
            sawEnabledSlot = true;
            if (strcmp(slotConfig.sourceHost, event.source) == 0) {
                sawHostMatch = true;
            }
            if (slotConfig.sourcePirIndex == event.pir) {
                sawPirMatch = true;
            }
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
            logRemotePirMatched(now, slot, event.pir, event.active);
        }

        if (!matched) {
            uint8_t code = 2;  // no configured slot matched
            if (sawHostMatch && !sawPirMatch) {
                code = 3;  // host matched, PIR index did not
            } else if (!sawHostMatch && sawPirMatch) {
                code = 4;  // PIR index matched, host did not
            } else if (sawHostMatch && sawPirMatch) {
                code = 5;  // matching host and PIR seen, but not in same enabled slot
            }
            logRemotePirMismatch(now, code, event.pir, sawHostMatch, sawPirMatch, sawEnabledSlot);
        }
    }
}

void RemotePirManager::sendLocalPirEvents(uint32_t now, PirStates localPhysicalPirStates) {
    if (!m_udpListening || m_hostname[0] == '\0') return;

    for (size_t pirIndex = 0; pirIndex < m_localSendStates.size(); pirIndex++) {
        const PirStates pirBit = static_cast<PirStates>(1U << pirIndex);
        const bool active = (localPhysicalPirStates & pirBit) != 0;
        const bool wasActive = (m_previousLocalPirStates & pirBit) != 0;
        auto& sendState = m_localSendStates[pirIndex];

        if (active != wasActive) {
            queueLocalPirTransition(pirIndex, active, now);
            continue;
        }

        if (sendState.pendingRepeats > 0 && hasElapsed(now, sendState.nextRepeatAt)) {
            sendLocalPirEvent(pirIndex, sendState.pendingActive, sendState.seq);
            sendState.pendingRepeats--;
            sendState.nextRepeatAt = now + REMOTE_PIR_TRANSITION_REPEAT_SPACING_MS;
        }

        if (active &&
            (!sendState.hasSentActive ||
             hasElapsed(now, sendState.lastRefreshAt + REMOTE_PIR_REFRESH_MS))) {
            sendState.seq++;
            sendLocalPirEvent(pirIndex, true, sendState.seq);
            sendState.lastRefreshAt = now;
            sendState.hasSentActive = true;
        }
    }
}

void RemotePirManager::queueLocalPirTransition(size_t pirIndex, bool active, uint32_t now) {
    auto& sendState = m_localSendStates[pirIndex];
    sendState.seq++;
    sendState.pendingActive = active;
    sendState.pendingRepeats = REMOTE_PIR_TRANSITION_REPEAT_COUNT - 1;
    sendState.nextRepeatAt = now + REMOTE_PIR_TRANSITION_REPEAT_SPACING_MS;
    if (!active) {
        sendState.hasSentActive = false;
    }

    sendLocalPirEvent(pirIndex, active, sendState.seq);
    if (active) {
        sendState.lastRefreshAt = now;
        sendState.hasSentActive = true;
    }
}

void RemotePirManager::sendLocalPirEvent(size_t pirIndex, bool active, uint32_t seq) {
    char packet[96] = "";
    const int length =
        snprintf(packet, sizeof(packet), "%s,%u,%u,%lu,%lu", m_hostname,
                 static_cast<unsigned int>(pirIndex), active ? 1U : 0U,
                 static_cast<unsigned long>(seq),
                 static_cast<unsigned long>(REMOTE_PIR_DEFAULT_LEASE_MS));
    if (length <= 0 || length >= int(sizeof(packet))) {
        logRemotePirSendCode(1);
        return;
    }

    const auto& destinations = getConfig().eventDestinations;
    for (size_t destinationIndex = 0; destinationIndex < destinations.size(); destinationIndex++) {
        const auto& destination = destinations[destinationIndex];
        if (!destination.enabled || destination.host[0] == '\0') continue;

        if (m_udp.beginPacket(destination.host, REMOTE_PIR_DEFAULT_PORT) != 1) {
            logRemotePirSendDetail(2, pirIndex, active, destinationIndex);
            continue;
        }
        m_udp.write(reinterpret_cast<const uint8_t*>(packet), static_cast<size_t>(length));
        if (m_udp.endPacket() != 1) {
            logRemotePirSendDetail(3, pirIndex, active, destinationIndex);
            continue;
        }
        logRemotePirSendDetail(4, pirIndex, active, destinationIndex);
    }
}
