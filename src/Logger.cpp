#include <Logger.h>

char logBuf[4096] = "";
size_t logPos = 0;
bool logWrapped = false;

// No delim
void logPartial(const char* msg) {
    while (*msg) {
        logBuf[logPos++] = *msg++;
        if (logPos >= sizeof(logBuf)) {
            logPos = 0;
            logWrapped = true;
        }
    }
}

void log(const char* msg) {
    logPartial(msg);
    logBuf[logPos++] = '\n';
    if (logPos >= sizeof(logBuf)) {
        logPos = 0;
        logWrapped = true;
    }
}
