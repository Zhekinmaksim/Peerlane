#!/usr/bin/env bash
#
# bootstrap.sh — one-time setup for the Peerlane mesh.
#
# Clones and builds AXL, generates 4 ed25519 identity keys, one per node.
# After running this, ./start-mesh.sh can bring the whole mesh up.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo ">>> Peerlane bootstrap"
echo "    root = $ROOT"

# ── 1. Clone + build AXL ──
if [ ! -d "axl" ]; then
  echo ">>> cloning gensyn-ai/axl"
  git clone https://github.com/gensyn-ai/axl.git
fi

pushd axl > /dev/null
if [ ! -f node ]; then
  echo ">>> building AXL node binary (go build)"
  # Go 1.26 compat: the docs note the toolchain pin is in go.mod.
  GOTOOLCHAIN=go1.25.5 go build -o node ./cmd/node/
fi
popd > /dev/null

# ── 2. Generate keys for each role ──
mkdir -p keys

# Locate an OpenSSL that supports ed25519. macOS ships LibreSSL which doesn't.
OPENSSL_BIN="openssl"
if [ "$(uname)" = "Darwin" ]; then
  if [ -x /opt/homebrew/opt/openssl/bin/openssl ]; then
    OPENSSL_BIN=/opt/homebrew/opt/openssl/bin/openssl
  elif [ -x /usr/local/opt/openssl/bin/openssl ]; then
    OPENSSL_BIN=/usr/local/opt/openssl/bin/openssl
  fi
fi

for role in coord research verify analyst; do
  key="keys/${role}.pem"
  if [ ! -f "$key" ]; then
    echo ">>> generating key for ${role}"
    "$OPENSSL_BIN" genpkey -algorithm ed25519 -out "$key"
  fi
done

echo ">>> bootstrap complete"
echo "    next: ./scripts/start-mesh.sh"
