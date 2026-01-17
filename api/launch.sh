#!/bin/bash

# Get the directory of this script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VENV="$DIR/.venv"
SCRIPT="$DIR/server.py"

source "$VENV/bin/activate"
python "$SCRIPT" "$@"
