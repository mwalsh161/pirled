#!/bin/bash

# Get the directory of this script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VENV="$DIR/.venv"

source "$VENV/bin/activate"
cd "$DIR"
python -m server "$@"
