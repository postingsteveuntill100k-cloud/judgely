#!/usr/bin/env bash
# Start, stop or restart the local Hackerly process.
#
#   scripts/serve.sh start [port]
#   scripts/serve.sh stop
#   scripts/serve.sh restart [port]
#   scripts/serve.sh log
set -euo pipefail
cd "$(dirname "$0")/.."

PIDFILE="${PIDFILE:-/tmp/opencode/hackerly.pid}"
LOGFILE="${LOGFILE:-/tmp/opencode/hackerly.log}"
PORT="${2:-${PORT:-8090}}"
mkdir -p "$(dirname "$PIDFILE")"

stop() {
  if [ -f "$PIDFILE" ]; then
    pid="$(cat "$PIDFILE")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; sleep 1; fi
    rm -f "$PIDFILE"
  fi
}

start() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "already running (pid $(cat "$PIDFILE")) on port ${PORT}"
    return
  fi
  PORT="$PORT" nohup node dist/server/index.js > "$LOGFILE" 2>&1 &
  echo $! > "$PIDFILE"
  for _ in $(seq 1 40); do
    if curl -fsS -m 2 "http://localhost:${PORT}/healthz" >/dev/null 2>&1; then
      echo "hackerly up on http://localhost:${PORT} (pid $(cat "$PIDFILE"))"
      return
    fi
    sleep 0.5
  done
  echo "failed to start; last log lines:"
  tail -20 "$LOGFILE"
  exit 1
}

case "${1:-start}" in
  start)   start ;;
  stop)    stop; echo "stopped" ;;
  restart) stop; start ;;
  log)     tail -n "${2:-40}" "$LOGFILE" ;;
  *)       echo "usage: $0 {start|stop|restart|log} [port]"; exit 2 ;;
esac
