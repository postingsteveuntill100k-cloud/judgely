# Judgely Architecture Specification

## 1. System Philosophy & Positioning

> **Judgely is open-source judging infrastructure for hackathons: transparent assignments, defensible scoring, explainable normalization, auditable decisions, and self-hosted operation.**

Judgely is designed around a single non-negotiable principle:
**One coherent product connecting the entire event lifecycle:**
$$\text{Registration} \longrightarrow \text{Teams} \longrightarrow \text{Submissions} \longrightarrow \text{Eligibility} \longrightarrow \text{Assignments} \longrightarrow \text{Judging} \longrightarrow \text{Normalization} \longrightarrow \text{Results} \longrightarrow \text{Audit} \longrightarrow \text{Export}$$

The surface is clean, minimalist, and utilitarian.
The underlying system is rigorous, secure, and mathematically defensible.

---

## 2. Component Boundaries

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                             CLIENT LAYER                                    │
│  - Browser Single-Page App (Vanilla JS + Clean Responsive Monospace UI)      │
│  - DOGFOOD Acceptance Checker (python3 run.py .dogfood.toml)                │
│  - HTTP Clients (curl, scripts, API consumers)                              │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ HTTP / Cookies / Headers / JSON
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BACKEND BOUNDARY & AUTH                             │
│  - Express HTTP Server (Pinned Node.js 22 LTS)                              │
│  - Session & Identity Resolution Middleware (Cookie, Bearer, Token)         │
│  - Strict RBAC & Role Isolation Barrier (HTTP 401 / 403 Enforcement)        │
└──────────────────┬──────────────────────────────────────┬───────────────────┘
                   │                                      │
                   ▼                                      ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────────┐
│             ROUTING LAYER            │  │          DOMAIN SERVICES          │
│  - Public Gallery (/projects)        │  │  - Judging Engine (Weighted Rubric│
│  - Submissions (/projects/new)       │  │  - Normalization Engine (Z-Score) │
│  - Judge Portal (/api/judge/*)       │  │  - Health & Anomaly Detector      │
│  - Organizer Admin (/api/organizer/*)│  │  - Audit Logging Service          │
│  - CSV Export (/api/export.csv)      │  │  - CSV Results Exporter           │
└──────────────────┬───────────────────┘  └───────────────────┬───────────────┘
                   │                                          │
                   └───────────────────┬──────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PERSISTENCE LAYER (OFFLINE)                        │
│  - SQLite Database (`data/judgely.db` via built-in `node:sqlite`)           │
│  - Normalized Schema with Foreign Key Cascades & WAL Mode                   │
│  - Fixture Seeder (Idempotent, derives all event facts from fixtures.json)  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Backend-Enforced Role Isolation (Security Architecture)

Security in Judgely is enforced strictly at the API layer, never trusted to frontend views or hidden buttons:

1. **Authentication Resolution**:
   Every incoming HTTP request resolves the authenticated identity from either `Cookie: session=<token>` or `Authorization: Bearer <token>`.
2. **Deterministic Seed Identities**:
   To enable automated machine verification (`run.py`), deterministic session tokens are initialized on startup:
   - Organizer (`session=org_7f2a`)
   - Judge A (`session=jdg_a_91bc`, bound to fixture judge `jdg_01`)
   - Judge B (`session=jdg_b_44de`, bound to fixture judge `jdg_02`)
   - Participant (`session=prt_2e88`, bound to fixture team `tm_01`)
3. **Role Isolation Policy**:
   - `GET /api/judge/scores`:
     - If accessed by a participant $\longrightarrow$ **HTTP 403 Forbidden**.
     - If accessed by Judge A $\longrightarrow$ returns Judge A's scores (**HTTP 200**).
     - If accessed by Judge B requesting Judge A's scores (`?judge=jdg_01`) $\longrightarrow$ **HTTP 403 Forbidden**. The backend verifies that the target judge does not match `req.user.judge_id`.
   - `GET /api/export.csv`:
     - If accessed by non-organizers $\longrightarrow$ **HTTP 403 Forbidden**.
     - If accessed by organizers $\longrightarrow$ returns CSV body (**HTTP 200**).
   - `GET /api/projects/:id`:
     - Individual judge reviews, names, and qualitative remarks are stripped for public visitors and participants.
     - Judges can only inspect their own evaluations.
     - Organizers have full inspection permissions.

---

## 4. Self-Hosting & Zero-Cloud Guarantee

Judgely is built with zero cloud accounts, zero hosted databases, zero external authentication services, and zero runtime network dependencies:
- **Database Engine**: Uses Node.js 22 built-in `node:sqlite` (SQLite 3.46+), eliminating external database daemons (like PostgreSQL or MySQL) and native C++ compilation steps (`better-sqlite3` or `node-gyp`).
- **Offline Docker Container**: The provided `Dockerfile` installs dependencies, copies code, and pre-seeds the SQLite database at build time. The container boots and operates with the network completely disabled.
- **Single Process**: A single Node.js process hosts both the API and the static web assets on port `8080`.

---

## 5. Architectural Rationale

| Decision | Alternative Considered | Why Judgely Selected This Approach |
| :--- | :--- | :--- |
| **Node.js + Built-in `node:sqlite`** | Python FastAPI / Postgres | Single process, zero compilation, universal JSON support, boots instantaneously in lightweight Alpine containers without external database servers. |
| **Vanilla HTML/CSS/JS** | Next.js / Vite SPA | Avoids heavy client-side builds, works seamlessly offline, pre-renders project titles directly for automated checkers (`run.py`), and loads in $<50$ms. |
| **Normalized SQLite Schema** | NoSQL / Document Store | Strong relational guarantees, foreign keys, and atomic transactions prevent orphaned reviews or inconsistent judging state. |
| **Regularized Z-Score Normalization** | Raw Average / Min-Max | Eliminates harsh/lenient judge bias while providing mathematical proofs against zero-variance judges (`jdg_07`). |
| **Append-Only Audit Trail** | Mutable Status Flags | Essential for hackathon dispute resolution and organizer defensibility. |
