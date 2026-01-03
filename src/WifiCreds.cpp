#include <WifiCreds.h>

#include <ESP8266WiFi.h>
#include <EEPROM.h>

// TODO: move to eeprom manager if needed.
#define EEPROM_OFFSET 0
#define EEPROM_SIZE 96 // sizeof(WifiCreds)

void saveCreds(const WifiCreds& creds) {
    EEPROM.begin(EEPROM_SIZE);
    
    // Avoid extra writes if possible to preserve EEPROM.
    WifiCreds existing;
    EEPROM.get(EEPROM_OFFSET, existing);
    if (memcmp(&existing, &creds, EEPROM_SIZE) != 0) {
        EEPROM.put(EEPROM_OFFSET, creds);
        EEPROM.commit();
    }

    EEPROM.end();
}

bool loadCreds(const WifiCreds& creds) {
    EEPROM.begin(EEPROM_SIZE);
    EEPROM.get(EEPROM_OFFSET, creds);
    EEPROM.end();
    return creds.ssid[0] != '\0';
}

void clearCreds(WifiCreds& creds) {
    EEPROM.begin(EEPROM_SIZE);
    for (int i = 0; i < EEPROM_SIZE; i++) {
        EEPROM.write(i, 0);  // write zero to each byte
    }
    EEPROM.commit(); // flush changes to flash
    creds.ssid[0] = '\0';
}
