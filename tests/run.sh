#!/bin/bash
# tests/run.sh — run the rapp-zoo test suite (Flask test client).
set -e
cd "$(dirname "$0")/.."
python3 -m unittest discover -s tests -p "test_*.py" -v
