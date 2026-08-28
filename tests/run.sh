#!/bin/bash
# tests/run.sh — run the rapp-zoo test suite (Flask test client).
set -e
cd "$(dirname "$0")/.."
PYTHON="${PYTHON:-python3}"
"$PYTHON" -m compileall -q zoo.py utils agents starters
"$PYTHON" -m unittest discover -s tests -p "test_*.py" -v
