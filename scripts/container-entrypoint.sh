#!/usr/bin/env bash
#
# Container entrypoint.
#
# Inputs (env):
#   ROLE         — one of: coord, research, verify, analyst
#   AXL_API_PORT — AXL HTTP bridge port (defaults match scripts/node-config-*.json)
#
# Flow:
#   1. Generate an ed25519 identity key if it doesn't already exist.
#   2. Start the AXL node in the background.
#   3. Wait until its HTTP bridge responds.
#   4. Exec the matching Node.js agent.

set -euo pipefail

ROLE="${ROLE:?ROLE env var must be set to coord|research|verify|analyst}"

case "$ROLE" in
  coord)    AXL_API_PORT="${AXL_API_PORT:-9002}"; AGENT_ENTRY="coordinator" ;;
  research) AXL_API_PORT="${AXL_API_PORT:-9012}" ;;
  verify)   AXL_API_PORT="${AXL_API_PORT:-9022}" ;;
  analyst)  AXL_API_PORT="${AXL_API_PORT:-9032}" ;;
  *) echo "invalid ROLE: $ROLE" >&2; exit 2 ;;
esac
export AXL_API_PORT
AGENT_ENTRY="${AGENT_ENTRY:-$ROLE}"

CONFIG_SRC="/app/scripts/node-config-${ROLE}.json"
CONFIG_DST="/data/keys/node-config-${ROLE}.json"
KEY_FILE="/data/keys/${ROLE}.pem"

mkdir -p /data/keys /data/registry

# The coordinator owns demo-run registry reset. Workers rewrite their own role
# files after the reset, so stale registrations from an old volume do not make
# a missing node look online.
if [ "$ROLE" = "coord" ]; then
  rm -f /data/registry/mesh-registry.json
  rm -rf /data/registry/mesh-registry.json.d
fi

# Generate identity key if missing (persisted via volume).
if [ ! -f "$KEY_FILE" ]; then
  echo "[entrypoint/${ROLE}] generating ed25519 key"
  openssl genpkey -algorithm ed25519 -out "$KEY_FILE"
fi

# Copy config into /data/keys and rewrite paths (keys/ → /data/keys/).
# In Docker, workers must peer to the coord service name, not their own
# localhost. Bare-metal startup still uses the checked-in 127.0.0.1 configs.
if [ "$ROLE" = "coord" ]; then
  sed "s|keys/|/data/keys/|g" "$CONFIG_SRC" > "$CONFIG_DST"
else
  sed -E "s|keys/|/data/keys/|g; s|tls://127.0.0.1:7001|tls://coord:7001|g; s|\"tcp_port\": 70[0-9]1|\"tcp_port\": 7001|g" "$CONFIG_SRC" > "$CONFIG_DST"
fi

echo "[entrypoint/${ROLE}] starting AXL node on :$AXL_API_PORT"
axl-node -config "$CONFIG_DST" > "/data/logs/axl-${ROLE}.log" 2>&1 &
AXL_PID=$!

# Wait for the HTTP bridge to respond.
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${AXL_API_PORT}/topology" >/dev/null 2>&1; then
    echo "[entrypoint/${ROLE}] AXL bridge ready"
    break
  fi
  sleep 1
  if [ "$i" -eq 60 ]; then
    echo "[entrypoint/${ROLE}] AXL bridge did not come up in 60s" >&2
    tail -n 40 "/data/logs/axl-${ROLE}.log" >&2 || true
    exit 1
  fi
done

# Forward termination to the AXL node on exit.
trap 'kill -TERM $AXL_PID 2>/dev/null || true' EXIT TERM INT

# Hand off to the agent. exec so signals reach it directly.
echo "[entrypoint/${ROLE}] launching agent"
exec node "/app/dist/agents/${AGENT_ENTRY}.js"
