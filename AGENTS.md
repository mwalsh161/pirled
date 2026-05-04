- Python: conda env: mdns
- PlatformIO builds: use the project config's repo-local `core_dir` so VS Code and CLI builds share the same PlatformIO core cache.
  Run:
  `pio run`.
  See `README.md` for optional local symlink setup to reuse an existing PlatformIO install.
  `.platformio-core/` is intentionally gitignored and may persist between builds.
