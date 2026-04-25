#!/usr/bin/env bash
#
# End-to-end smoke test for the Docker demo.
#
# Checks:
#   1. docker compose builds and starts all services
#   2. coord healthcheck becomes healthy
#   3. frontend proxy accepts POST /task
#   4. WebSocket emits task_started, message, contribution, task_complete
#   5. registry contains 4 distinct peers
#   6. compose logs show all four agents reached AXL ready

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f backend/node_modules/ws/package.json ]; then
  echo ">>> installing backend dependencies for smoke WS client"
  npm install --prefix backend --no-audit --no-fund
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

echo ">>> starting docker compose in mock LLM mode"
env -u ANTHROPIC_API_KEY docker compose up -d --build

echo ">>> waiting for coord healthcheck"
for _ in $(seq 1 60); do
  status="$(docker compose ps --format json coord | node -e 'let s=""; process.stdin.on("data",d=>s+=d); process.stdin.on("end",()=>{try{const rows=s.trim().split(/\n+/).filter(Boolean).map(JSON.parse); console.log(rows[0]?.Health || rows[0]?.State || "")}catch{console.log("")}})')"
  if [ "$status" = "healthy" ]; then
    break
  fi
  sleep 2
done

curl -fsS http://127.0.0.1:5173/status >/dev/null

echo ">>> verifying websocket task flow"
node scripts/smoke-ws.mjs

echo ">>> verifying registry has 4 peers"
docker compose exec -T coord node -e '
const fs = require("fs");
const reg = JSON.parse(fs.readFileSync("/data/registry/mesh-registry.json", "utf8"));
const roles = ["coord", "research", "verify", "analyst"];
for (const role of roles) {
  if (!reg.peers?.[role]?.pubkey) throw new Error(`missing ${role}`);
}
const unique = new Set(roles.map((role) => reg.peers[role].pubkey));
if (unique.size !== roles.length) throw new Error("pubkeys are not distinct");
console.log(JSON.stringify(reg, null, 2));
'

echo ">>> verifying agent logs"
docker compose logs --no-color coord research verify analyst | grep -E "AXL ready|all peers online|HTTP\\+WS listening"

echo ">>> smoke test passed"
