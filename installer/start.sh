#!/bin/bash
# start.sh — launch rapp-zoo on http://127.0.0.1:7070 (configurable).
#
# Reuses ~/.brainstem/venv if present (RAPP brainstem install). Otherwise
# falls back to a local ./venv created on first run.

set -e
cd "$(dirname "$0")/.."

BRAINSTEM_VENV="$HOME/.brainstem/venv/bin/python"
LOCAL_VENV="./venv/bin/python"

PYTHON=""
if [ -x "$BRAINSTEM_VENV" ]; then
    PYTHON="$BRAINSTEM_VENV"
elif [ -x "$LOCAL_VENV" ]; then
    PYTHON="$LOCAL_VENV"
else
    echo "[zoo] no venv found, creating ./venv…"
    PYTHON_CMD=$(command -v python3.11 || command -v python3.12 || command -v python3.13 || command -v python3)
    "$PYTHON_CMD" -m venv ./venv
    PYTHON="$LOCAL_VENV"
fi

if ! "$PYTHON" -c "import flask" 2>/dev/null; then
    echo "[zoo] installing dependencies…"
    "${PYTHON%/python}/pip" install -r installer/requirements.txt -q
fi

export PYTHONUTF8=1
exec "$PYTHON" zoo.py "$@"
