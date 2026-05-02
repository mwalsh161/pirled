- Python: conda env: mdns
- PlatformIO builds: go straight to the repo-local core cache to avoid sandbox writes to `~/.platformio`.
  Before the first build, create cache symlinks if they do not exist:
  `ln -s /Users/mpwalsh/.platformio/packages .platformio-core/packages`
  and `ln -s /Users/mpwalsh/.platformio/platforms .platformio-core/platforms`.
  Then run:
  `PLATFORMIO_CORE_DIR=.platformio-core /Users/mpwalsh/.platformio/penv/bin/pio run`.
  `.platformio-core/` is intentionally gitignored and may persist between builds.
