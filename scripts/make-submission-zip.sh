#!/usr/bin/env bash
#
# Build a clean ETHGlobal submission archive from tracked repository files.
# This avoids local .env files, node_modules, dist, .vercel, .git, and macOS
# metadata that can appear in Finder-created zip files.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${1:-peerlane-submission.zip}"

git -C "$ROOT" archive --format=zip --output="$ROOT/$OUT" HEAD
echo "wrote $OUT"
