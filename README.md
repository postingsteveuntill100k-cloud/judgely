# Judgely

> **Open-source judging infrastructure for hackathons: transparent assignments, defensible scoring, explainable normalization, auditable decisions, and self-hosted operation.**

Judgely is a self-hostable submission and judging platform built for **DOGFOOD 2026**. It provides an integrated event lifecycle with backend-enforced role isolation, cross-judge Z-score normalization, judging health anomaly detection, and automated acceptance verification.

---

## Features

- **T1 Core**:
  - Public project gallery with track filtering and live keyword search.
  - Server-side pre-rendered project cards for immediate crawler and checker compatibility.
  - Submission deadline enforcement that strictly rejects late submissions.
  - Deterministic session authentication for organizers, judges, participants, and visitors.
- **T2 Judging Infrastructure**:
  - **Backend-Enforced Role Isolation**: Judges cannot view peer scores; participants are denied access to scoring endpoints; public project APIs strip private reviewer identities.
  - **Weighted Rubric Scoring**: Configurable scoring criteria with bound checking and atomic upsert transactions.
  - **Cross-Judge Normalization Engine**: Z-score standardization with variance regularization (handling judges with zero score variance like `jdg_07`) and Bayesian sample-size shrinkage.
  - **Judging Health & Anomaly Detector**: Neutral, explainable heuristic flags identifying zero-variance grading, duplicate submissions, and polarized scores.
  - **Organizer Command Center**: Real-time review coverage distribution, assignment manager with track compatibility hints, and live settings.
  - **Audit Trail**: Append-only log recording who, what, when, and which resource was modified.
  - **Official CSV Export**: Comma-separated results export with rank deltas, raw scores, and normalized scores.

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

## Deterministic Test Accounts

Judgely seeds deterministic session credentials corresponding to fixture identities:

| Role | Session Header | Identity Mapped from Fixture |
| :--- | :--- | :--- |
| **Organizer** | `Cookie: session=org_7f2a` | Lead Organizer (`usr_organizer`) |
| **Judge A** | `Cookie: session=jdg_a_91bc` | First fixture judge (`jdg_01`, Tomas Varga) |
| **Judge B** | `Cookie: session=jdg_b_44de` | Second fixture judge (`jdg_02`, Wei Lindqvist) |
| **Participant** | `Cookie: session=prt_2e88` | First fixture team member (`tm_01`, Priya Nair) |
| **Visitor** | *(No header)* | Unauthenticated guest |

The web interface also includes an interactive **Demo Role Switcher** bar at the top to seamlessly toggle between these sessions.

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

Judgely includes a comprehensive test suite covering DOGFOOD acceptance checks, weighted scoring math, normalization proofs, role isolation barriers, and awkward fixture edge cases:

```bash
npm test
```

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

*(Note: If Docker is unavailable in the host execution environment, local tests verify equivalent standalone execution with zero external network calls).*

---

## Optional NexusLabs / Firebase Integration

Firebase is an **optional convenience deployment** for hosted demonstrations and remote testing.
- The canonical open-source Judgely product is self-hosted and has zero runtime dependency on Firebase.
- All Firebase hosting and authentication experiments are strictly scoped to the existing **NexusLabs** workspace and its associated Firebase project. No external cloud credentials are committed to Git.

---

## Technical Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md): System components, role isolation security model, and rationale.
- [`DATA-MODEL.md`](DATA-MODEL.md): Relational schema, join tables, and fixture transformation pipeline.
- [`JUDGING.md`](JUDGING.md): Rubric weighting formulas, Z-score normalization proof, and tie-breaking rules.
- [`LICENSE`](LICENSE): MIT License.

---

## Honest Limitations

1. **In-Memory Session Map**: The prototype matches session tokens against the `users` table directly. Production deployments would add token expiration and refresh token rotation.
2. **Single Event Scope**: The current database model supports multiple events, but the default UI is configured to display and manage `evt_01` from the DOGFOOD fixtures.
3. **Static File Serving**: Express directly serves the pre-rendered HTML and client assets. Production high-traffic deployments can place an Nginx reverse proxy in front for static asset caching.
