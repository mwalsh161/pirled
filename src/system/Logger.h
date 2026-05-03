#pragma once

#include <stddef.h>
#include <stdint.h>

constexpr size_t LOG_ENTRY_COUNT = 128;
constexpr size_t LOG_MESSAGE_SIZE = 28;

struct LogEntry {
    uint32_t timestampMs;
    char message[LOG_MESSAGE_SIZE];
};

extern LogEntry logEntries[LOG_ENTRY_COUNT];
extern size_t logWriteIndex;
extern size_t logEntryCount;

void logAt(uint32_t timestampMs, const char* msg);
