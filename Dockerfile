# Hackerly — runtime image
#
# One stage on purpose: the build needs the TypeScript compiler, the runtime does
# not, and a self-hosted install should be a small, auditable image rather than a
# clever multi-stage one that is hard to debug.

FROM node:22-bookworm-slim

# better-sqlite3 needs a toolchain if no prebuilt binary matches the platform.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    SQLITE_FILE=/data/hackerly.db \
    FIXTURES_FILE=/app/fixtures.json

# Dependencies first so a source change does not reinstall the world.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY fixtures.json run.py .dogfood.toml ./
COPY scripts ./scripts

# The compiler is a dev dependency, so build in the same image that runs.
RUN npm install --no-save --no-audit --no-fund typescript@5.7.3 \
 && npx tsc -p tsconfig.json \
 && node scripts/copy-assets.mjs \
 && npm prune --omit=dev

RUN mkdir -p /data && chown -R node:node /app /data
USER node

VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/index.js"]
