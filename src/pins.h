#define D0 16  // Wakes from deep sleep; can be used as general I/O after boot.
#define D1 5
#define D2 4
#define D3 0  // Pulled HIGH at boot; pulling LOW prevents boot
#define D4 2  // Pulled HIGH at boot (connected to on-board LED); pulls LOW at boot to flash.
#define D5 14
#define D6 12
#define D7 13
#define D8 15  // Pulled LOW at boot (SPI SS pin); pulling HIGH prevents boot.
