#pragma once

#include <ctype.h>

inline bool isRemoteHostChar(char c) {
    return isalnum(static_cast<unsigned char>(c)) || c == '-' || c == '.' || c == '_';
}
