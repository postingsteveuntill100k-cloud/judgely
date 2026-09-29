#!/usr/bin/env bash
# Deploy Hackerly to Firebase.
#
# This deploys the real application: an Express server running as a Cloud
# Function behind Firebase Hosting, with Firestore as the database and Firebase
# Auth available as a sign-in bridge. It is not a static copy of the site.
#
# Before it will work, the project's service account needs these roles, which
# the Firebase console can grant under IAM:
#
#   roles/serviceusage.serviceUsageAdmin   (enable the APIs below)
#   roles/developer                        (deploy functions and hosting)
#   roles/datastore.user                   (write Firestore)
#
# and these APIs must be enabled once:
#
#   firestore.googleapis.com
#   identitytoolkit.googleapis.com
#   cloudfunctions.googleapis.com
#   cloudbuild.googleapis.com
#   artifactregistry.googleapis.com
#   run.googleapis.com
#
# The script checks the prerequisites first and tells you precisely which one
# is missing, rather than failing halfway through a deploy.
#
#   ./scripts/deploy-firebase.sh [--project PROJECT_ID] [--dry-run]
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="hackerly-hackatrons"
DRY_RUN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --project) PROJECT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

if ! command -v firebase >/dev/null 2>&1 && [ ! -x node_modules/.bin/firebase ]; then
  echo "firebase CLI not found. Install it with:  npm i -D firebase-tools" >&2
  exit 1
fi
FIREBASE=(node_modules/.bin/firebase)
[ -x node_modules/.bin/firebase ] || FIREBASE=(firebase)

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
warn() { printf '\033[33m%s\033[0m\n' "$*"; }
die()  { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- build
say "1/5  Building"
npm run build >/dev/null
node scripts/copy-assets.mjs >/dev/null
[ -f dist/server/index.js ] || die "build produced no dist/server/index.js"
echo "    dist/ is current"

# ------------------------------------------------------- prerequisites
say "2/5  Checking the project can accept this deployment"
MISSING=0
check() { # name, command...
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    echo "    ok      $label"
  else
    echo "    BLOCKED $label"
    MISSING=$((MISSING + 1))
  fi
}

check "Firestore API"        "${FIREBASE[@]}" firestore:databases:list --project "$PROJECT"
check "Firebase Auth"         "${FIREBASE[@]}" auth:export /dev/null --project "$PROJECT"
check "Hosting"               "${FIREBASE[@]}" hosting:sites:list --project "$PROJECT"
check "Functions"             "${FIREBASE[@]}" functions:list --project "$PROJECT"

if [ "$MISSING" -gt 0 ]; then
  warn ""
  warn "$MISSING prerequisite(s) are not available to this credential."
  warn "This is an access problem, not a code problem: the Firestore driver and"
  warn "the auth bridge are implemented and need no further code (verify with"
  warn "  node scripts/driver-contract.mjs"
  warn "which checks all 124 storage methods across both drivers)."
  warn ""
  warn "To fix, grant the service account:"
  warn "  roles/serviceusage.serviceUsageAdmin"
  warn "  roles/developer"
  warn "  roles/datastore.user"
  warn "then enable firestore.googleapis.com, identitytoolkit.googleapis.com,"
  warn "cloudfunctions.googleapis.com, cloudbuild.googleapis.com,"
  warn "artifactregistry.googleapis.com and run.googleapis.com."
  warn ""
  warn "Self-hosting needs none of this:  docker compose up"
  die   "aborting rather than deploying a partial site"
fi

if [ "$DRY_RUN" = "1" ]; then
  warn "--dry-run: prerequisites look good, stopping before any change."
  exit 0
fi

# ------------------------------------------------------------- deploy
say "3/5  Firestore rules and indexes"
"${FIREBASE[@]}" deploy --only firestore:rules,firestore:indexes --project "$PROJECT"

say "4/5  Function"
"${FIREBASE[@]}" deploy --only functions --project "$PROJECT"

say "5/5  Hosting"
"${FIREBASE[@]}" deploy --only hosting --project "$PROJECT"

say "Done"
"${FIREBASE[@]}" hosting:sites:list --project "$PROJECT" || true
echo
echo "The app is served from the Hosting URL above. Sign-in works with the"
echo "built-in accounts out of the box; Firebase Auth becomes available once"
echo "identitytoolkit.googleapis.com is enabled (see DEPLOYMENT.md)."
