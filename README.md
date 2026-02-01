# PIR LED Controllers

Design goals:
1. A single ESP8266 governs up to 4 LEDs + 4 PIR sensors (+4 virtual signals).
2. Any LED can trigger on/off with any grouping of PIR sensors/virtual signals.
    - Note, logical OR with each other hard-coded.
    - Each LED can have a delay associated with certain triggerers.
3. Discoverable through MDNS.
    - Service name begins with "pirled-controller"
    - Signed firmeware uploadable by Arduino OTA.
4. Config is controllable in realtime, and supports fairly aggressive polling rates.
5. No network should not prohibit core detect/dimming functionality.
    - Note, plan to allow sharing sensors...obviously that isn't included here (e.g. not making )

TODO:
1. When updating something, returning the binary app state in response can drastically cut down
   on requests (requires more complex JS logic, but that's fine).
2. Layers are currently pretty heavily tied to arduino/esp. Makes unit-testing harder.
    - Goal: leverage templates + shims to make a test build possible on non-esp hosts.
3. Sharing sensors
4. Robust to network outages (e.g. rebind as part of state machine).
    - note reboot is an easy way to do this, but given some GPIO pin activity during boot this would
      be less than ideal.
    - it would require re-"beginning" all server objects including mdns and maybe arduino ota.
    - would need same logic as setup to effectively switch to the portal

Stretch TODO:
1. ESP AP mode allows multiple to link together to continue allowing sharing sensors without network
    - what is AP range?
    - would need a "house" key to validate connecting. No security + no SSL...big yikes
    - ...maybe not.