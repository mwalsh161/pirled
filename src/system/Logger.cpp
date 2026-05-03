#include "system/Logger.h"

#include <string.h>

LogEntry logEntries[LOG_ENTRY_COUNT] = {};
size_t logWriteIndex = 0;
size_t logEntryCount = 0;

void logAt(uint32_t timestampMs, const char* msg) {
    LogEntry& entry = logEntries[logWriteIndex];
    entry.timestampMs = timestampMs;

    if (msg) {
        strncpy(entry.message, msg, sizeof(entry.message) - 1);
        entry.message[sizeof(entry.message) - 1] = '\0';
    } else {
        entry.message[0] = '\0';
    }

    logWriteIndex = (logWriteIndex + 1) % LOG_ENTRY_COUNT;
    if (logEntryCount < LOG_ENTRY_COUNT) logEntryCount++;
}
