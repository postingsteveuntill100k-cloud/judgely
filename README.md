# Judgely

> **Open-source judging infrastructure for hackathons: transparent assignments, defensible scoring, explainable normalization, auditable decisions, and self-hosted operation.**

- **GitHub Repository**: [https://github.com/postingsteveuntill100k-cloud/judgely](https://github.com/postingsteveuntill100k-cloud/judgely)
- **Live Demo (NexusLabs Firebase Hosting)**: [https://nexuslabs-b7b5e.web.app](https://nexuslabs-b7b5e.web.app)

Judgely is a self-hostable submission and judging platform built for **DOGFOOD 2026**. It provides an integrated event lifecycle with backend-enforced role isolation, cross-judge Z-score normalization, judging health anomaly detection, automated acceptance verification, and a modern clean White/Off-White/Slate technical design system.

---

## Architecture & Workspaces

Judgely separates the hackathon lifecycle into four first-class, dedicated workspaces:

1. **Public Event Showcase**:
   - Event hero overview with real-time participation statistics (projects, tracks, judges).
   - Filterable project gallery with live keyword search and track pill selectors.
   - Server-side pre-rendered project cards for immediate crawler and checker compatibility.
   - Slide-over project drawer with team rosters, repo links, and embargoed/released standings.
2. **Participant Workspace (Hack2Skill Inspired)**:
   - Milestone roadmap tracking: Registration → Team Formation → Submission → Review → Results.
   - First-class team management with member roles (`Lead`, `Member`) and ownership semantics.
   - Project submission manager with input validation, URL protocol sanitization, and live status tracking.
3. **Judge Workspace**:
   - Calm, focused evaluation queue displaying workload telemetry (assigned, completed, remaining).
   - Authoritative rubric evaluation form derived directly from event database rubric criteria.
   - Strict role isolation: judges evaluate independently; peer scores and comments are never leaked.
4. **Organizer Operations Command Center**:
   - Operational review coverage telemetry with interactive coverage distribution visualization.
   - Explainable integrity anomaly detector flagging zero-variance grading (`jdg_07`), duplicate submissions (`tm_07`), and high inter-judge variance.
   - Assignment dispatch manager enforcing track alignment, conflict-of-interest checks, and workload balance.
   - Results visibility control: one-click switch to toggle between embargoed scoring and official public release.
   - Append-only chronological system audit trail and official comma-separated results CSV export.

---

## Security Hardening (Forensic Code Audit Passes)

- **Bug 1 (Judge Assignment Bypass)**: `POST /api/judge/scores` verifies active judge assignment before scoring; unassigned attempts receive `403 Forbidden`. Auto-assignment creation is strictly prohibited.
- **Bug 2 (Public Normalization API Leak)**: `GET /api/results` strictly enforces results embargo. Normalization internals, judge bias, and private scores are hidden until organizer release.
- **Bug 3 & 4 (Session Security)**: Disallowed query-string authentication (`?session=...`) and eliminated client-side token storage in `localStorage`. Authentication uses secure, server-managed `HttpOnly; SameSite=Lax` cookies with database expiration timestamps.
- **Bug 5 (No DOM Hardcoded Tokens)**: Removed session credentials from `index.html`. Local demo switching uses server-managed `POST /api/auth/demo-login`.
- **Bug 6 (HTML & URL Injection Defense)**: Bulletproof HTML entity escaping on SSR project cards and strict URL protocol validation (only `http://` and `https://` permitted; dangerous protocols like `javascript:` rejected).
- **Bug 7 (Authoritative Rubric)**: Scoring engine rejects unknown criteria with `400 Bad Request` and enforces score bounds against authoritative event rubric weights (no arbitrary fallback weights).
- **Bug 8 & 9 (Team & Submission Ownership)**: Submissions enforce team membership verification; participants cannot submit into or modify projects belonging to other teams.
- **Dynamic Event Context**: Replaced hardcoded `evt_01` defaults across all routes and services with dynamic event resolution middleware.

---

## Quickstart (Local Development)

### Prerequisites
- Node.js `>=22.5.0` (with built-in `node:sqlite`)
- Python 3 (for running `run.py`)

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Database
Seeds all 41 projects, 30 judges, 8 tracks, and 126 reviews dynamically from `fixtures.json`:
```bash
npm run seed
```

### 3. Start the Portal
```bash
npm start
```
The portal starts on `http://localhost:8080`.

---

## Deterministic Test Accounts & Passwords

Judgely supports standard local password authentication (`POST /api/auth/login`) with `scrypt` password hashing, as well as deterministic session cookies for automated test suites (`.dogfood.toml`):

| Role | Email | Password | Session Cookie (Automated Tests) | Identity Mapped from Fixture |
| :--- | :--- | :--- | :--- | :--- |
| **Organizer** | `organizer@judgely.local` | `organizer123` | `Cookie: session=org_7f2a` | Lead Organizer (`usr_organizer`) |
| **Judge A** | `tomas.varga@example.org` | `judge123` | `Cookie: session=jdg_a_91bc` | First fixture judge (`jdg_01`, Tomas Varga) |
| **Judge B** | `wei.lindqvist@example.org` | `judge123` | `Cookie: session=jdg_b_44de` | Second fixture judge (`jdg_02`, Wei Lindqvist) |
| **Participant** | `priya1@example.org` | `participant123` | `Cookie: session=prt_2e88` | First fixture team member (`tm_01`, Priya Nair) |
| **Visitor** | *(None)* | *(None)* | *(No header)* | Unauthenticated guest |

### Production vs Demo Mode
- **Production (`DEMO_MODE=false`)**:
  - `POST /api/auth/demo-login` is disabled (returns `403 Forbidden`).
  - Demo persona buttons are completely removed from the UI.
  - All users must authenticate via email + password or valid session cookies.
- **Development / Demo (`DEMO_MODE=true`)**:
  - The login screen displays quick demo persona buttons to streamline evaluations.

---

## Running the Official DOGFOOD Acceptance Checker

With the Judgely server running on port `8080`:

```bash
python3 run.py .dogfood.toml
```

Output:
```text
DOGFOOD 2026 acceptance report
portal: http://localhost:8080
claimed: T1 T2
fixtures: fixtures.json

T1  gallery is public ................. PASS
T1  project from fixtures shown ....... PASS
T1  closed event refuses submissions .. PASS
T2  judge sees own scores ............. PASS
T2  judge cannot see peer scores ...... PASS
T2  participant blocked ............... PASS
T2  csv export works .................. PASS

claimed T1 T2, verified T1 T2
```

Save and commit the report:
```bash
python3 run.py .dogfood.toml > acceptance-report.txt
```

---

## Running Automated Tests

Judgely includes a comprehensive regression test suite (38 automated unit, integration, and security attack tests):

```bash
npm test
```

Covers:
- Session forgery rejection & query-token rejection
- Role isolation barriers (Judge A vs Judge B, Participant vs Scores, Visitor vs Audit)
- Unassigned project score refusal (HTTP 403)
- Rubric criteria validation & unknown criterion rejection (HTTP 400)
- Team ownership & IDOR defenses
- Results embargo before and after release
- SSR XSS escaping and URL sanitization
- Zero-variance normalization handling (`jdg_07`) and Bayesian shrinkage

---

## Docker & Self-Hosting (Offline Operation)

### Docker Startup
```bash
docker compose up --build
```

### Offline Verification
The container pre-seeds the SQLite database at build time. To verify offline operation with Docker:
```bash
# Start container with disabled networking
docker run --network none -p 8080:8080 judgely_portal
```
The portal boots and runs completely without network access, cloud accounts, or remote services.

---

## NexusLabs / Firebase Integration

- The canonical open-source Judgely product is self-hosted and has zero runtime dependency on Firebase.
- Firebase Hosting is deployed to the existing **NexusLabs** project (`nexuslabs-b7b5e` at `https://nexuslabs-b7b5e.web.app`) for client asset demonstration.
- All Firebase hosting configuration is strictly scoped to `nexuslabs-b7b5e`.

---

## Technical Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): System components, role isolation security model, and rationale.
- [`DATA-MODEL.md`](DATA-MODEL.md): Relational schema, join tables, and fixture transformation pipeline.
- [`JUDGING.md`](JUDGING.md): Rubric weighting formulas, Z-score normalization proof, and tie-breaking rules.
- [`LICENSE`](LICENSE): MIT License.
