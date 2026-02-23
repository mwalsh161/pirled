from __future__ import annotations

# Backward-compatible shim: app composition now lives in api/server/app.py.
from .app import app

__all__ = ["app"]
