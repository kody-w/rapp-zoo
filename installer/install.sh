#!/bin/bash
# install.sh — one-liner installer for rapp-zoo.
#
#   curl -fsSL https://kody-w.github.io/rapp-zoo/installer/install.sh | bash
#
# Clones rapp-zoo to ~/.rapp-zoo/ and prints next steps. Idempotent.

set -e

REPO_URL="https://github.com/kody-w/rapp-zoo.git"
INSTALL_DIR="$HOME/.rapp-zoo"

if [ -d "$INSTALL_DIR/.git" ]; then
    echo "[zoo] $INSTALL_DIR exists — pulling latest"
    git -C "$INSTALL_DIR" pull --ff-only
else
    echo "[zoo] cloning into $INSTALL_DIR"
    git clone "$REPO_URL" "$INSTALL_DIR"
fi

chmod +x "$INSTALL_DIR/installer/start.sh" 2>/dev/null || true

cat <<EOF

[zoo] Installed at $INSTALL_DIR

Next:
  bash $INSTALL_DIR/installer/start.sh

Then open http://127.0.0.1:7070 in your browser.
EOF
