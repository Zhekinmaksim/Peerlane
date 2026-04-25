# ─────────────────────────────────────────────────────────
# Peerlane image
#
# Stage 1: build the AXL node binary (Go 1.25.5, per AXL docs)
# Stage 2: build the TypeScript agent bundle
# Stage 3: runtime — slim image with both the AXL binary and compiled JS
# ─────────────────────────────────────────────────────────

# ── Stage 1: AXL binary ──
FROM golang:1.25.5-bookworm AS axl-builder

WORKDIR /src
RUN git clone --depth 1 https://github.com/gensyn-ai/axl.git .
RUN GOTOOLCHAIN=go1.25.5 go build -o /out/node ./cmd/node/


# ── Stage 2: TS build ──
FROM node:20-bookworm-slim AS agent-builder

WORKDIR /app
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npx tsc -p tsconfig.json


# ── Stage 3: runtime ──
FROM node:20-bookworm-slim AS runtime

# OpenSSL 3+ (ed25519 capable) + curl for the healthcheck.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# AXL node binary from stage 1.
COPY --from=axl-builder /out/node /usr/local/bin/axl-node

# Compiled agents + production dependencies.
COPY backend/package.json backend/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=agent-builder /app/dist ./dist

# AXL node configs.
COPY scripts/node-config-*.json ./scripts/

# Entrypoint script dispatches on $ROLE.
COPY scripts/container-entrypoint.sh /usr/local/bin/peerlane-entrypoint
RUN chmod +x /usr/local/bin/peerlane-entrypoint

# Registry lives on a shared volume in compose.
RUN mkdir -p /data/registry /data/keys /data/logs
ENV PEERLANE_REGISTRY_PATH=/data/registry/mesh-registry.json

# Use tini so PID 1 reaps child processes cleanly.
ENTRYPOINT ["/usr/bin/tini", "--", "peerlane-entrypoint"]
