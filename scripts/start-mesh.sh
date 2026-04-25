#!/usr/bin/env bash
#
# start-mesh.sh — bring the full Peerlane mesh up.
#
# Starts:
#   - 4 AXL nodes (one per role) with their own pubkey + HTTP bridge port
#   - 4 Node.js agent processes (coord, research, verify, analyst)
#
# All processes log into ./logs/ and are tracked via PID files in ./run/.
# Ctrl-C stops everything cleanly.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p logs run
: > mesh-registry.json  # clear the registry so every startup is fresh
rm -rf mesh-registry.json.d

if [ ! -x axl/node ]; then
  echo "!!! axl/node not found. Run scripts/bootstrap.sh first."
  exit 1
fi

declare -a PIDS=()

start_axl() {
  local role="$1"
  local config="scripts/node-config-${role}.json"
  local logfile="logs/axl-${role}.log"
  echo ">>> starting AXL node for ${role} (config=${config})"
  (cd "$ROOT" && ./axl/node -config "$config" > "$logfile" 2>&1) &
  local pid=$!
  echo "$pid" > "run/axl-${role}.pid"
  PIDS+=("$pid")
}

start_agent() {
  local role="$1"
  local port="$2"
  local logfile="logs/agent-${role}.log"
  echo ">>> starting agent: ${role} (AXL port ${port})"
  (cd "$ROOT/backend" && \
    AXL_API_PORT="$port" \
    PEERLANE_REGISTRY_PATH="$ROOT/mesh-registry.json" \
    COORD_HTTP_PORT="${COORD_HTTP_PORT:-8080}" \
    npm run "start:${role}" --silent > "../${logfile}" 2>&1) &
  local pid=$!
  echo "$pid" > "run/agent-${role}.pid"
  PIDS+=("$pid")
}

cleanup() {
  echo ""
  echo ">>> shutting down mesh"
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -f run/*.pid
  echo ">>> done"
}
trap cleanup EXIT INT TERM

# ── Start the AXL listener first so others can peer to it ──
start_axl coord
sleep 2  # give coord time to bind its listening port

start_axl research
start_axl verify
start_axl analyst

echo ">>> waiting for AXL bridges to come up"
sleep 3

# ── Start agents ──
start_agent coord 9002
start_agent research 9012
start_agent verify 9022
start_agent analyst 9032

echo ""
echo "═══════════════════════════════════════════════"
echo " Peerlane mesh running"
echo " HTTP+WS API:   http://localhost:${COORD_HTTP_PORT:-8080}"
echo " Logs:          tail -f logs/*.log"
echo " Registry:      cat mesh-registry.json"
echo " Press Ctrl-C to stop"
echo "═══════════════════════════════════════════════"
echo ""

wait
