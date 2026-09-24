#!/usr/bin/env bash
# pmstack one-line installer: fetches pmstack, runs ./setup with your arguments, cleans up.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- /path/to/project
#   curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash -s -- --global
#   curl -fsSL https://raw.githubusercontent.com/RyanAlberts/pmstack/main/install.sh | bash
#     (the last form installs into the folder you run it from)
#
# Set PMSTACK_REF to install a tag or branch other than main.
# Read it first: https://github.com/RyanAlberts/pmstack/blob/main/install.sh
set -euo pipefail

REPO="https://github.com/RyanAlberts/pmstack.git"
REF="${PMSTACK_REF:-main}"
TMP_DIR="$(mktemp -d -t pmstack.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Fetching pmstack ($REF)"
git clone --depth 1 --branch "$REF" --quiet "$REPO" "$TMP_DIR/pmstack"

# Run setup from the caller's folder, so "no folder" and relative paths mean
# the folder you ran this from, not the temporary copy.
"$TMP_DIR/pmstack/setup" "$@"

echo ""
echo "Removing the temporary copy of pmstack."
