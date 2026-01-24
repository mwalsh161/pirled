#pragma once

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <type_traits>

extern char logBuf[4096];
extern size_t logPos;  // next write position
extern bool logWrapped;

// No delim
void logPartial(const char* msg);

// Assumes delim ","
template <typename T, typename = typename std::enable_if<std::is_integral<T>::value>::type>
void logPartial(const T value) {
    char buf[16] = "";
    int n = snprintf(buf, sizeof(buf), "%d,", value);
    if (n < 0 || static_cast<size_t>(n) >= sizeof(buf))
        logPartial("ERR,");
    else
        logPartial(buf);
}

void log(const char* msg);
