#include "sensor/RemotePirManager.h"

namespace {
constexpr PirStates LOCAL_PHYSICAL_PIR_MASK = 0x000F;

bool hasElapsed(uint32_t now, uint32_t deadline) {
    return static_cast<int32_t>(now - deadline) >= 0;
}
}  // namespace

void RemotePirManager::update(uint32_t now, PirStates localPhysicalPirStates) {
    m_previousLocalPirStates = localPhysicalPirStates & LOCAL_PHYSICAL_PIR_MASK;
    expireSlots(now);
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
