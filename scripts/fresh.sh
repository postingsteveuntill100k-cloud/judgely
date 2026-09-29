#!/usr/bin/env bash
# Start a throwaway instance with its own database, for verification.
#   ./scripts/fresh.sh [port] [datadir]
set -euo pipefail
cd "$(dirname "$0")/.."
PORT="${1:-8160}"
DIR="${2:-/tmp/opencode/fresh-$PORT}"
PIDFILE="$DIR/server.pid"

if [ -f "$PIDFILE" ]; then
  kill "$(cat "$PIDFILE")" 2>/dev/null || true
  sleep 1
fi
rm -rf "$DIR"
mkdir -p "$DIR"

PORT="$PORT" DATA_DIR="$DIR" SQLITE_FILE="$DIR/hackerly.db" \
  nohup node dist/server/index.js > "$DIR/server.log" 2>&1 &
echo $! > "$PIDFILE"

for _ in $(seq 1 90); do
  if curl -fsS -m 2 "http://localhost:$PORT/healthz" >/dev/null 2>&1; then
    echo "fresh instance on http://localhost:$PORT (dir $DIR)"
    exit 0
  fi
  sleep 1
done
echo "failed to start:"
tail -20 "$DIR/server.log"
exit 1
