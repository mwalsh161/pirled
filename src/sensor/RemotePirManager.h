#pragma once

#include <WiFiUdp.h>
#include <stddef.h>
#include <stdint.h>

#include <array>

#include "config/ConfigStore.h"

constexpr uint8_t REMOTE_PIR_FIRST_BIT = 8;
constexpr size_t LOCAL_PHYSICAL_PIR_COUNT = 4;
constexpr uint32_t REMOTE_PIR_REFRESH_MS = 3000;
constexpr uint8_t REMOTE_PIR_TRANSITION_REPEAT_COUNT = 3;
constexpr uint32_t REMOTE_PIR_TRANSITION_REPEAT_SPACING_MS = 100;

class RemotePirManager {
   public:
    void update(uint32_t now, PirStates localPhysicalPirStates);
    void onWiFiConnected(const char* hostname);
    void onWiFiDisconnected();

    PirStates remotePirStates() const { return m_remotePirStates; }

    void setRemotePirSlot(size_t slot, bool active, uint32_t now,
                          uint32_t leaseMs = REMOTE_PIR_DEFAULT_LEASE_MS);
    void clearRemotePirSlot(size_t slot);
    void clearAllRemotePirSlots();

   private:
    struct RemoteSlotState {
        bool active = false;
        uint32_t expiresAt = 0;
        uint32_t latestSeq = 0;
        uint32_t latestSeqAt = 0;
        char latestSource[REMOTE_PIR_HOST_SIZE] = "";
        uint8_t latestPir = 0;
        bool hasLatestSeq = false;
    };

    struct LocalPirSendState {
        uint32_t seq = 0;
        uint32_t lastRefreshAt = 0;
        uint32_t nextRepeatAt = 0;
        uint8_t pendingRepeats = 0;
        bool pendingActive = false;
        bool hasSentActive = false;
    };

    WiFiUDP m_udp;
    std::array<RemoteSlotState, REMOTE_PIR_SLOT_COUNT> m_slots{};
    std::array<LocalPirSendState, LOCAL_PHYSICAL_PIR_COUNT> m_localSendStates{};
    PirStates m_remotePirStates = 0;
    PirStates m_previousLocalPirStates = 0;
    bool m_udpListening = false;
    char m_hostname[REMOTE_PIR_HOST_SIZE] = "";

    void setSlotBit(size_t slot, bool active);
    void expireSlots(uint32_t now);
    void receivePackets(uint32_t now);
    void sendLocalPirEvents(uint32_t now, PirStates localPhysicalPirStates);
    void queueLocalPirTransition(size_t pirIndex, bool active, uint32_t now);
    void sendLocalPirEvent(size_t pirIndex, bool active, uint32_t seq);
};
