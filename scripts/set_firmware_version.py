"""
PlatformIO pre-build script to set FIRMWARE_VERSION from git
"""

import subprocess

Import("env")  # type: ignore  # noqa: F821
if env.IsIntegrationDump():  # type: ignore # noqa: F821
    # stop the current script execution
    Return()  # type: ignore # noqa: F821

# code below runs for the "build" and other targets


def get_git_version():
    """Get version from git (describe > short hash > timestamp)"""
    try:
        # Try git describe first (tags preferred)
        version = subprocess.check_output(
            ("git", "describe", "--tags", "--always", "--dirty"),
            stderr=subprocess.DEVNULL,
            text=True,
        ).strip()
        if version:
            return version
    except Exception:
        pass

    # Fallback to short hash
    version = subprocess.check_output(
        ("git", "rev-parse", "--short", "HEAD"),
        stderr=subprocess.DEVNULL,
        text=True,
    ).strip()
    if version:
        return version


def stamp_firmware_version(source, target, env):
    """Pre-build action to set FIRMWARE_VERSION define"""


version = get_git_version()
print(f"[firmware-version] FIRMWARE_VERSION={version}")
env.Append(CPPDEFINES=[f'FIRMWARE_VERSION=\\"{version}\\"'])  # type: ignore # noqa: F821
