#!/usr/bin/env bash
# Build, migrate and start Hackerly for local development.
#
#   ./scripts/dev.sh            # start on PORT (default 8080)
#   PORT=8090 ./scripts/dev.sh
#
# Data lives in ./data. The schema is created on boot and the DOGFOOD fixtures
# plus a small demo set are seeded when the database is empty.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
export PORT

echo "› installing"
npm install --no-audit --no-fund >/dev/null

echo "› building"
npx tsc -p tsconfig.json
node scripts/copy-assets.mjs >/dev/null

echo "› starting on http://localhost:${PORT}"
exec node dist/server/index.js
