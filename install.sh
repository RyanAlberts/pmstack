#!/usr/bin/env bash
# pmstack 1-line installer.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- /path/to/project
#   curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- --global
#
# Clones pmstack to a temp dir, runs ./setup with your args, cleans up.
# Safe to read first: https://github.com/RyanAlberts/pmstack/blob/main/install.sh
set -euo pipefail

REPO="https://github.com/RyanAlberts/pmstack.git"
REF="${PMSTACK_REF:-main}"
TMP_DIR="$(mktemp -d -t pmstack.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "→ Fetching pmstack ($REF) to $TMP_DIR"
git clone --depth 1 --branch "$REF" --quiet "$REPO" "$TMP_DIR/pmstack"

echo "→ Running setup"
cd "$TMP_DIR/pmstack"
./setup "$@"

echo ""
echo "✓ pmstack ready. Temp clone removed automatically."
