#!/usr/bin/env bash
# Sweep every route, public and authenticated, and report the status codes.
# This is the cheap regression net: one broken template shows up immediately.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-http://localhost:8090}"
LOG="${LOG:-/tmp/opencode/hackerly.log}"

role_cookie() {
  grep -m1 "^  │ $1 " "$LOG" | sed 's/.*Cookie: //'
}

ORG="$(role_cookie organizer)"
JA="$(role_cookie judge_a)"
JB="$(role_cookie judge_b)"
PART="$(role_cookie participant)"

fail=0
check() { # path cookie
  local path="$1" cookie="${2:-}"
  local code
  if [ -n "$cookie" ]; then
    code=$(curl -s -m 15 -o /dev/null -w "%{http_code}" -H "Cookie: $cookie" "$BASE$path")
  else
    code=$(curl -s -m 15 -o /dev/null -w "%{http_code}" "$BASE$path")
  fi
  if [ "$code" != "$1$EXPECT" ] 2>/dev/null; then :; fi
  printf "%-6s %s\n" "$code" "$path"
  case "$code" in 200|204|301|302|303|304|400|401|403|404|409) ;; *) fail=$((fail+1));; esac
}

EXPECT=""
echo "── public ─────────────────────────────────────────"
for p in / /hackathons "/hackathons?status=open" "/hackathons?order=prize" /projects "/projects?q=quiet" \
         /hackathons/hacktron-2026 /hackathons/hacktron-2026/projects /hackathons/hacktron-2026/tracks/developer-tools \
         /hackathons/hacktron-2026/teams /hackathons/fold-2026-spring /hackathons/fold-2026-spring/results \
         /hackathons/fold-2026-spring/projects /hackathons/sample-hack-2026 /hackathons/sample-hack-2026/projects \
         /host /judge /about /auth/signin /auth/signup /api/v1 /healthz /nope; do
  check "$p"
done

echo "── organizer (sample-hack-2026) ───────────────────"
for p in /dashboard /settings/profile /teams /join \
         /host/events /host/start /host/events/new \
         /host/events/sample-hack-2026 /host/events/sample-hack-2026/participants \
         /host/events/sample-hack-2026/teams /host/events/sample-hack-2026/projects \
         /host/events/sample-hack-2026/judges /host/events/sample-hack-2026/assignments \
         /host/events/sample-hack-2026/judging /host/events/sample-hack-2026/results \
         /host/events/sample-hack-2026/audit /host/events/sample-hack-2026/export \
         /host/events/sample-hack-2026/settings \
         /host/events/sample-hack-2026/setup/basics /host/events/sample-hack-2026/setup/dates \
         /host/events/sample-hack-2026/setup/prizes /host/events/sample-hack-2026/setup/teams \
         /host/events/sample-hack-2026/setup/tracks /host/events/sample-hack-2026/setup/submission \
         /host/events/sample-hack-2026/setup/judging /host/events/sample-hack-2026/setup/rules \
         /host/events/sample-hack-2026/setup/branding /host/events/sample-hack-2026/setup/publish \
         /host/events/sample-hack-2026/export.csv; do
  check "$p" "$ORG"
done

echo "── judge ─────────────────────────────────────────"
for p in /judge/events /judge/reviews /judge/events/sample-hack-2026 /judge/events/sample-hack-2026/compare; do
  check "$p" "$JA"
done
AID=$(curl -s -m 15 -H "Cookie: $JA" "$BASE/judge/events/sample-hack-2026" | grep -oE '/judge/review/[a-z0-9_]+' | head -1)
check "$AID" "$JA"

echo "── participant ───────────────────────────────────"
check /dashboard "$PART"
check /teams "$PART"

echo
if [ "$fail" -gt 0 ]; then
  echo "$fail route(s) returned an unexpected status (5xx or connection failure)."
  echo "last template errors:"
  grep "template failed\|unhandled error" "$LOG" | tail -5 | sed 's/\\n/\n/g' | grep -E "^ *>>|is not|Error" | head -12
  exit 1
fi
echo "all routes answered with an expected status."
