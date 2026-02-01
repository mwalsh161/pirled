#!/bin/bash
# Pre-commit hook to update firmware version hash

set -e  # Exit on any error

# Get the short commit hash of HEAD (or 0000000 if no commits yet)
SHORT_HASH=$(git rev-parse --short HEAD 2>/dev/null || echo "0000000")

# Path to the project root
PROJECT_ROOT="$(git rev-parse --show-toplevel)"

FILES_MODIFIED=0

# Update index.html v parameter
INDEX_HTML="$PROJECT_ROOT/api/static/index.html"
if [ ! -f "$INDEX_HTML" ]; then
    echo "ERROR: Could not find $INDEX_HTML"
    exit 1
fi

if ! grep -q "app\.js?v=$SHORT_HASH" "$INDEX_HTML"; then
    sed -i '' "s/app\.js?v=[^\"']*/app.js?v=$SHORT_HASH/" "$INDEX_HTML"
    if grep -q "app\.js?v=$SHORT_HASH" "$INDEX_HTML"; then
        echo "Updated $INDEX_HTML to v=$SHORT_HASH"
        FILES_MODIFIED=1
    else
        echo "ERROR: Failed to update version in $INDEX_HTML"
        exit 1
    fi
fi

# Update FIRMWARE_VERSION in Config.cpp
CONFIG_CPP="$PROJECT_ROOT/src/Config.cpp"
if [ ! -f "$CONFIG_CPP" ]; then
    echo "ERROR: Could not find $CONFIG_CPP"
    exit 1
fi

if ! grep -q "static const char FIRMWARE_VERSION\[\] PROGMEM = \"$SHORT_HASH\"" "$CONFIG_CPP"; then
    sed -i '' "s/static const char FIRMWARE_VERSION\[\] PROGMEM = \"[^\"]*\"/static const char FIRMWARE_VERSION[] PROGMEM = \"$SHORT_HASH\"/" "$CONFIG_CPP"
    if grep -q "static const char FIRMWARE_VERSION\[\] PROGMEM = \"$SHORT_HASH\"" "$CONFIG_CPP"; then
        echo "Updated $CONFIG_CPP to FIRMWARE_VERSION=$SHORT_HASH"
        FILES_MODIFIED=1
    else
        echo "ERROR: Failed to update FIRMWARE_VERSION in $CONFIG_CPP"
        exit 1
    fi
fi

# If files were modified, stage them and fail so user can review and recommit
if [ $FILES_MODIFIED -eq 1 ]; then
    git add "$INDEX_HTML" "$CONFIG_CPP"
    echo ""
    echo "Version files were updated. Please review and recommit:"
    echo "  git diff --cached"
    echo "  git commit"
    exit 1
fi
