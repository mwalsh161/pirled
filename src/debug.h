#if DEBUG
#define D_PRINT(...) Serial.print(__VA_ARGS__)
#define D_PRINTLN(...) Serial.println(__VA_ARGS__)
#define D_BEGIN(...) Serial.begin(__VA_ARGS__)
#else
#define D_PRINT(...)
#define D_PRINTLN(...)
#define D_BEGIN(...)
#endif