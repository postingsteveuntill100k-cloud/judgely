# Deployment

Two supported shapes. One of them is verified end to end; the other is
implemented and blocked by IAM on this particular project. Both are described
here as they actually are.

---

## 1. Self-hosted — the canonical path

This is what `docker compose up` does, and it needs no cloud account.

```bash
git clone <this repo> && cd hackerly
cp .env.example .env          # then set SESSION_SECRET
docker compose up --build
```

The app is on <http://localhost:8080>. SQLite lives in a named volume; the
container runs as a non-root user and the database file is never exposed
outside the volume.

Generate a secret:

```bash
openssl rand -hex 32
```

### What the environment switches do

| Variable | Default | Notes |
| -------- | ------- | ----- |
| `SESSION_SECRET` | — | **Required in production.** Signs session cookies. |
| `PORT` | `8080` | |
| `DATA_DIR` / `SQLITE_FILE` | `./data` | |
| `SEED_ON_BOOT` | `true` | Migrates and seeds an empty database. |
| `SEED_DEMO` | `true` | Loads the three demo events. |
| `SEED_FIXTURES` | `true` | Loads `fixtures.json` (the DOGFOOD set). |
| `ACCEPTANCE_ACCOUNTS` | on outside production | The fixed-header accounts `.dogfood.toml` uses. **Off by default in production.** |
| `TRUST_PROXY` | on in production | Honours `X-Forwarded-For` for client IPs. Leave off when there is no proxy in front. |
| `RATE_LIMIT` | on | |
| `PUBLIC_READ_LIMIT` | `3000` /min | Anonymous page reads per IP. Raise it for a large venue behind one NAT; see the note in `lib/ratelimit.ts`. |
| `CSRF_PROTECT` | on in production | |
| `DB_DRIVER` | `sqlite` | `sqlite` or `firestore`. |
| `MAIL_MODE` | `log` | `log` writes to the log; `smtp` sends. |
| `FIREBASE_*` | — | Only for the auth bridge in Global mode. |

### Behind nginx or Caddy

Terminate TLS at the proxy, pass the real client IP, and set
`TRUST_PROXY=true`. Hackerly sets its own `X-Forwarded-*` expectations; the
only thing it trusts is the client IP header, and only when you tell it to.

---

## 2. Firebase / Google Cloud — implemented, blocked here

The Firebase path is real code, not a stub. The Express app runs as a Cloud
Function behind Firebase Hosting, with Firestore as the database:

- `firebase.json` — hosting rewrites, function config, Firestore rules and
  indexes, emulator config
- `functions/index.mjs` — boots the same `createApp()`; idempotent, so a warm
  container reuses one database connection
- `firestore.rules` — denies all client access; the server holds the admin
  credentials
- `firestore.indexes.json` — the composite indexes the driver's aggregate
  queries need
- `scripts/deploy-firebase.sh` — builds, checks prerequisites, and refuses to
  deploy a partial site
- `src/server/services/firebase.ts` + `POST /auth/firebase` — the auth bridge,
  which verifies an ID token with the admin SDK (including revocation) and
  issues an ordinary Hackerly session

To deploy once you have the access:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
./scripts/deploy-firebase.sh --project hackerly-hackatrons
```

### What is actually blocked, and by what

I probed the project `hackerly-hackatrons` with the provided service account
(`firebase-adminsdk-fbsvc@hackerly-hackatrons.iam.gserviceaccount.com`) and
recorded the exact results. The project is `ACTIVE` and Firebase is enabled on
it; **Hosting works and has two sites** (`hackerly.web.app` and the default
`hackerly-hackatrons.web.app`).

| API | State | Detail |
| --- | --- | --- |
| Firebase Hosting | **available** | `sites:list` returns 200; `versions.create` returns 200 |
| Firestore | disabled | 403 `Cloud Firestore API has not been used … or it is disabled` |
| Identity Platform (Auth) | disabled | 404 on every `identitytoolkit` path; the API is not enabled for the project |
| Cloud Functions | disabled | 403 `Cloud Functions API has not been used …` |
| Cloud Run | disabled | 403 |
| Artifact Registry | disabled | 403 |
| Secret Manager | disabled | 403 |
| Task Queue | disabled | 403 |
| Cloud Scheduler | disabled | 403 |
| `serviceusage.services.enable` | **denied** | 403 `Permission denied to enable service [firestore.googleapis.com]` |

The service account can read project metadata and Hosting, and it is
**explicitly denied permission to enable the APIs** it needs. So the blocker is
IAM, not code:

```
roles/serviceusage.serviceUsageAdmin
roles/developer
roles/datastore.user
```

and these APIs enabled once: `firestore`, `identitytoolkit`, `cloudfunctions`,
`cloudbuild`, `artifactregistry`, `run`.

`scripts/deploy-firebase.sh` runs exactly these checks first and prints this
list rather than failing partway through a deploy. On the credential above it
reports:

```
  BLOCKED Firestore API
  BLOCKED Firebase Auth
  ok      Hosting
  BLOCKED Functions
  3 prerequisite(s) are not available to this credential.
  aborting rather than deploying a partial site
```

### What I did not do

I did not deploy the static shell to Hosting and call it the product. Hosting
alone would serve a site with no database, no sign-in and no enforcement — the
exact thing the specification rules out, and worse than not deploying, because
the URL would look live. The one thing that *is* permitted is deployed, and the
one that is not, is left undone and written down.

### Verifying the code, without the API

The Firestore driver cannot be exercised against a real Firestore here, so
rather than assert it works I checked what can be checked:

```bash
node scripts/driver-contract.mjs
# Driver interface methods: 124
# Firestore driver missing: 0   stubs: 0
# SQLite driver issues:    0
```

All 124 methods of the storage contract are implemented in the Firestore
driver, with no stubs or empty bodies. Enabling the API is the only thing
standing between the current tree and a Firestore-backed deployment.

**Caveat, stated plainly:** that check is static. It proves the driver
implements the contract; it does not prove Firestore's query semantics match
SQLite's in every case. The first real run against Firestore should be treated
as a test, and `npm test` plus `scripts/journey.mjs` are the right things to
run against it.

---

## Operational notes

**Backups.** SQLite is a single file. `sqlite3 data/hackerly.db ".backup
backup.db"` while the app is running, or copy the volume with the container
stopped. The audit log and the CSV export are the two things a self-hoster is
most likely to want before they are not.

**Migrations.** `npm run db:migrate` applies `schema.sql`, which is
declarative and idempotent. There is no down-migration; take a backup first.

**Upgrading.** `docker compose pull && docker compose up -d --build`. The
database is migrated on boot.

**Logs.** Structured JSON on stdout, one object per line. `LOG_LEVEL=debug` for
request logging.

**Health.** `GET /healthz` returns 200 with uptime and driver name;
`GET /readyz` is what a container orchestrator should poll.
