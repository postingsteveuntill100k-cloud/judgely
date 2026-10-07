# Architecture

```
                     ┌──────────────────────────┐
  browser  ────────▶ │  Express 4 + EJS server  │
                     │  (Node 22, TypeScript)   │
                     └────────────┬─────────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              ▼                   ▼                   ▼
        middleware            routes              services
   session · CSRF ·        public · auth ·      auth · events ·
   security · rate         participant ·        teams · projects
   limits · errors         host · judge ·       judging · results
                           api · invites        invites · notify
              │                   │                   │
              └───────────────────┴───────────────────┘
                                  ▼
                          ┌───────────────┐
                          │ Driver (124)  │  storage contract
                          └───────┬───────┘
                        ┌─────────┴─────────┐
                        ▼                   ▼
                 SQLite driver      Firestore driver
                 (canonical)        (Global mode)
```

Roughly 8,400 lines of server TypeScript, 67 EJS templates, one design system
in three stylesheets.

---

## Why server-rendered

Deadlines, roles and cross-event isolation are the product. If those were
checked in the browser they would be suggestions. Rendering on the server means
the check and the page come from the same code path, and the DOGFOOD HTML checks
inspect the same bytes a browser gets.

The consequence is a real constraint: every page must be readable before
JavaScript loads. Progressive enhancement is therefore the pattern, not a
retrofit. `public/js/*.js` is a set of ES modules that add behaviour —
score buttons, a live countdown, the organizer setup wizard's unsaved-changes
guard, the copy-to-clipboard for invite links. The forms all work with the
scripting disabled.

There is no bundler, no framework runtime and no client-side router. Adding one
would mean shipping a second application to re-implement rules the server
already enforces.

---

## Layers

### `config.ts`
Reads the environment once, validates it, and fails loudly. In production,
`SESSION_SECRET` is mandatory. Every feature switch (`SEED_ON_BOOT`,
`ACCEPTANCE_ACCOUNTS`, `TRUST_PROXY`, `RATE_LIMIT`, `PUBLIC_READ_LIMIT`) is a
named setting with a documented default rather than a hidden branch.

### `middleware/`
- **`session.ts`** — resolves the cookie or bearer token into `req.actor`.
  Attaches the client IP, honouring `X-Forwarded-For` only when
  `TRUST_PROXY` is on, because trusting it by default would let a client
  forge its own rate-limit bucket.
- **`security.ts`** — CSP, `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, HSTS in production.
- **`guards.ts`** — the named rate-limit budgets, all in `lib/ratelimit.ts`.
- **`errors.ts`** — the single error middleware. An `AppError` carries a
  status, a machine code and a sentence; browsers get an HTML page, API
  clients get JSON, and an unexpected error is logged with its stack and shown
  as a 500 without leaking it.

### `routes/`
Ten routers, mounted once each. `wrapRouter` guarantees that a thrown `AppError`
reaches the error middleware instead of leaving the request hanging — an
unhandled rejection in an `async` handler is a hung request, not a 500.

| Router          | Surface                                        |
| --------------- | ---------------------------------------------- |
| `public.ts`     | discovery, event microsite, gallery, results    |
| `auth.ts`       | sign in, sign up, Firebase bridge, sign out     |
| `participant.ts`| register, teams, projects, submissions          |
| `host.ts`       | the organizer workspace, ~50 routes             |
| `judge.ts`      | queue, review, compare                          |
| `api.ts`        | REST v1 plus the DOGFOOD paths                  |
| `invites.ts`    | accept an invitation                            |

`host.ts` and `judge.ts` re-check the event on every request. Navigation state
in the URL is not authorization.

### `services/`
The rules live here, not in the routes, which is what makes them testable and
reusable by the API as well as the HTML pages.

- **`events.ts`** — `eventState(event)` is the single "what can happen now"
  function, and `assertSubmissionsOpen` is the single deadline gate. Both are
  called from every write path.
- **`projects.ts`** — create, update, submit, withdraw. `updateProject` calls
  `assertSubmissionsOpen` unconditionally; see the note in README about the bug
  that regression test guards.
- **`judging.ts`** — rubric versioning, `assignJudge`, `saveReview` with full
  rubric validation, and `progressFor`.
- **`results.ts`** — compute, normalize, publish. See `JUDGING.md`.
- **`nextAction.ts`** — the one function that decides "what does this organizer
  do next", used by the overview page. It exists so the advice cannot drift
  from the data: the next step is computed from counts, not written as prose.

### `db/`
`driver.ts` (the contract), `sqlite.ts`, `firestore.ts`, `schema.sql`.
`db/cli.ts` provides `migrate`, `seed`, `reset` and `tokens`.

### `seed/`
- **`fixtures.ts`** — loads the shared DOGFOOD `fixtures.json` through the
  real service functions. Fixtures are seed data, never a runtime fallback: if
  they fail to load, the app says so.
- **`demo.ts`** — three events at three points in their life. HACKTRON is
  mid-build with a partially accepted panel; Meridian is two weeks out with
  teams forming; Fold is finished, and its results were produced by calling
  `saveReview` and `publishResults` for real, not by inserting rows.
- **`acceptance.ts`** — the four fixed-header accounts `.dogfood.toml` uses.
  They are ordinary users with ordinary sessions; only the token is
  deterministic, so the config file survives a restart.

---

## How a request is handled

```
request
  → compression
  → security headers
  → session (cookie/bearer → req.actor)
  → CSRF (state-changing methods, production)
  → rate limit (publicRead / write / review / invite / auth)
  → route handler
      → re-read the event, re-check the role
      → service function (the rules)
      → Driver (storage)
      → render EJS, or JSON for /api
  → on AppError: error middleware (HTML or JSON, by Accept)
```

The role check happens inside the handler against data loaded fresh for this
request. There is no path where the browser can tell the server what role it
has.

---

## Security Architecture & Firestore Model

Judgely enforces a strict server-mediated security model:

```
Browser
  ↓ HTTP / TLS
Express Application
  ↓ Session Authentication (fail-closed, constant-time validation)
Authorization Gateways (withEvent, withRole, withTeamMember)
  ↓ Ownership & Tenant Verification (indexed lookups)
Business Logic Services (judging, results, projects, teams)
  ↓ Driver Interface (128 atomic/transactional methods)
Database: SQLite / Firestore (via Firebase Admin SDK)
```

### Complete Lockdown of Direct Browser Firestore Access

Under `firestore.rules`, all client-side mutations and reads are locked down with **deny-by-default**:
- Every collection (`users`, `sessions`, `events`, `event_organizers`, `event_members`, `event_judges`, `teams`, `team_members`, `projects`, `assignments`, `reviews`, `review_scores`, `invitations`, `notifications`, `audit_events`, `prizes`, `results`) has `allow read, write: if false;`.
- There is a catch-all `match /{document=**} { allow read, write: if false; }`.
- No direct authenticated client rules (`request.auth != null`) exist.
- Browsers cannot read or write Firestore directly. All interactions are securely validated by the Express application, which interacts with Firestore exclusively using the Firebase Admin SDK.

### Database Index Atomicity & Scalability

1. **Atomic Index Writes**: In `src/server/db/firestore.ts`, all primary writes and secondary indexes (emails, usernames, token hashes, event slugs) are performed atomically using batch writes (`this.batch()`).
2. **Direct Indexed Lookups**: Replaced all full table and collection dump scans (`listAssignments(...5000).find(...)`) with direct indexed driver methods:
   - `getEventOrganizer(eventId, userId)`
   - `getEventJudgeForUser(eventId, userId)`
   - `getAssignment(assignmentId)`
   - `getReview(reviewId)`
3. **Single-Pass Aggregations**: Functions like `progressFor` use a single O(M) pass to index assignments by judge and project into Maps, eliminating quadratic comparisons and keeping execution under 200ms even with 5,000 assignments.
4. **Rubric Immutability**: Rubrics are strictly immutable once any review has been drafted or submitted. Any attempt to add or modify criteria on an active rubric in use triggers a `409 conflict('rubric_in_use')`.
5. **Deterministic Results**: `computeResults` eliminates accidental tie-breakers or database row ordering effects by sorting strictly by final score descending, breaking ties by project title ascending, and falling back to unique project ID.
6. **Transactional Review Replacement**: `replaceReviewScores` atomically validates, purges stale scores, and writes the exact new score set in a single database transaction.

---

## Two backends, one contract

`Driver` has 128 methods. `sqlite.ts` implements them in SQL;
`firestore.ts` implements them with the Admin SDK, emulating the joins the
application depends on.

`scripts/driver-contract.mjs` parses `driver.ts` and both implementations and
fails if either is missing a method or has a stub body. It is a build-time
guard against the Firestore path quietly rotting.

### The Firestore trade-offs, stated plainly

- **Server-Side Exclusivity:** The browser never touches Firestore directly. The Admin SDK mediates every query.
- **Batch Atomicity:** All secondary index writes (email lookups, username lookups, slug lookups) are bundled into atomic batch commits alongside primary documents.
- **Composite indexes are declared, not implicit.** `firestore.indexes.json`
  exists because a missing index is a runtime 400, not a build error.

---

## Deployment shapes

**Self-hosted (canonical).** `docker compose up` → Node on 8080, SQLite in a
volume. No external services. This is the default and the fully supported path.

**Google Cloud (Global mode).** The same Express app runs as a Cloud Function
behind Firebase Hosting, with Firestore as the database. `functions/index.mjs`
boots the same `createApp()`; there is no second implementation. Firebase Auth
is an optional bridge at `/auth/firebase`: it verifies an ID token with the
admin SDK (with revocation checking) and issues an ordinary Hackerly session,
so authorization stays identical either way.

See `DEPLOYMENT.md` for what is verified and what is blocked on this project.

---

## Testing

Four layers, all against the real server:

| Command                       | What it proves                                   |
| ----------------------------- | ------------------------------------------------ |
| `npm test`                    | 29 integration tests, in-process, real HTTP       |
| `bash scripts/sweep.sh`       | ~60 routes return their expected status per role  |
| `node scripts/journey.mjs`    | sign-up → register → team → project → submit → judge, verified in the database |
| `node scripts/critic.mjs`     | 32 pages × 5 viewports in real Chrome: no console errors, no horizontal overflow |
| `node scripts/driver-contract.mjs` | both storage drivers implement the full contract |
| `node scripts/loadtest.mjs`   | measured throughput and latency, printed as measured |
