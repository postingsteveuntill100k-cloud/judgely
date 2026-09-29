# Data model

Twenty-five tables, one relational shape, two storage backends.

- SQLite (canonical, via `better-sqlite3`) — what `docker compose up` uses.
- Firestore (Global mode on Google Cloud) — same contract, same SQL semantics
  emulated in the driver.

`src/server/db/driver.ts` is the contract. `sqlite.ts` and `firestore.ts` are
the only two implementations, and `scripts/driver-contract.mjs` checks that both
implement all 124 methods with no stubs.

---

## The shape

```
users ──┬── sessions              (one login per device)
        ├── login_attempts        (audit of failures, for rate limiting)
        ├── event_organizers ──── events
        ├── event_members         (participants, per event)
        ├── team_members ──── teams ──── projects ──┬── project_votes
        │                                            ├── project_comments
        │                                            ├── judge_assignments ──── reviews ──── review_scores
        │                                            └── results ──── result_prizes
        ├── event_judges ──────── judge_assignments
        └── invitations, notifications, audit_events
```

`events` also owns `tracks`, `rubrics` → `rubric_criteria`, and
`announcements`.

---

## Tables

### Identity

**`users`** — `id`, `email` (unique, stored lowercased), `username` (unique),
`display_name`, `password_hash` (scrypt, per-user salt), `firebase_uid`,
`auth_provider`, `bio`, `headline`, `avatar_seed`, `email_verified`,
`disabled_at`, timestamps.

Email and username are both unique, so `/login` can accept either. Passwords
are hashed with scrypt; the plaintext is never stored or logged.

**`sessions`** — `token_hash` (SHA-256 of the token, unique), `user_id`,
`expires_at`, `last_seen_at`, `user_agent`, `ip`. The cookie carries the token,
the database stores only its hash, so a database leak does not hand over live
sessions.

**`login_attempts`** — `identifier`, `ip`, `ok`, `created_at`. Drives the
"too many sign-in attempts" limit and the security page.

### Events

**`events`** — the big one. `slug` unique, `mode` (`local` / `global`),
`status` (`draft` / `published` / `live` / `closed` / `archived`), `format`,
venue and city, `registration_opens_at` / `registration_closes_at` /
`starts_at` / `ends_at` / `submission_deadline` / `judging_starts_at` /
`judging_ends_at` / `results_release_at`, team size limits, `allow_solo`,
`allow_cross_college`, `eligibility`, `judging_mode` (`raw` / `normalized`),
`normalize_lambda`, `results_visibility`, `showcase_visibility`,
`public_listing`, `prize_pool_cents`, `prize_currency`, `accent_color`,
`cover_style`, and two JSON columns: `submission_fields` and `schedule`.

`submission_fields` is what makes the submission form per-event: an organizer
declares the fields, whether each is required, and the server validates against
that declaration. A client cannot add a field the organizer did not ask for.

**`event_organizers`** — `(event_id, user_id)` unique. The only source of host
authority; there is no global "admin" role that could reach every event.

**`event_members`** — `(event_id, user_id, role)` unique. Registration
membership. A registered participant on one event is a stranger on another.

**`tracks`** — `event_id`, `slug`, `name`, `description`, `eligibility`,
`prize_text`, `brief`, `requirements`, `sort_order`. Tracks carry prizes
because a hackathon's track prize is part of what a hacker is choosing between.

**`announcements`** — organizer posts shown on the event page.

### Teams and projects

**`teams`** — `event_id`, `slug` (unique per event), `name`, `description`,
`avatar_seed`, `created_by`.

**`team_members`** — `(team_id, user_id)` unique, `role` (`owner` / `member`),
`joined_at`. The owner is the only one who can delete the team or add people.

**`projects`** — `event_id`, `team_id`, `track_id`, `slug` (unique per event),
`title`, `tagline`, `summary`, `description`, `tech_stack` (JSON array),
`image_url`, `repo_url`, `demo_url`, `video_url`, `docs_url`, `answers` (JSON,
keyed by the event's `submission_fields`), `status`
(`draft` / `submitted` / `under_review` / `results_released`), `submitted_at`,
`locked_at`.

One project per team, enforced in `services/projects.ts`. `locked_at` is set
when submissions close so the audit trail shows when the content stopped moving.

**`project_votes`** — `(project_id, user_id)` unique. One vote per person.
**`project_comments`** — moderated public discussion on a project.

### Judging

**`rubrics`** — `event_id`, `version`, `status` (`draft` / `active` /
`archived`), `created_by`. Exactly one active rubric per event.

**`rubric_criteria`** — `rubric_id`, `key`, `name`, `description`, `weight`,
`max_score`, `required`, `sort_order`.

**`event_judges`** — `event_id`, `user_id`, `email`, `email_lower`, `status`
(`invited` / `active` / `declined` / `removed`), `invited_by`, `invited_at`,
`accepted_at`, `removed_at`. A judge must accept before they can be assigned
work — which is why the assignment screen shows pending invitations as a
follow-up rather than as a checkbox that would do nothing.

**`judge_assignments`** — `event_id`, `project_id`, `event_judge_id`, `status`
(`pending` / `in_progress` / `submitted` / `reopened`), `assigned_at`,
`due_at`, `reopened_at`. Unique per `(project_id, event_judge_id)`, so
"create assignments" is safe to press twice.

**`reviews`** — `assignment_id`, `event_id`, `project_id`, `event_judge_id`,
`user_id`, `status`, `comment`, `strengths`, `improvements`, `recommendation`,
`submitted_at`, `rubric_id` (the version that was in force).

**`review_scores`** — `review_id`, `criterion_id`, `score`, `note`. Notes are
per-judge and private to the panel.

### Results

**`results`** — `event_id`, `project_id`, `review_count`, `raw_score`,
`adjusted_score`, `final_score`, `judge_offset`, `rank`, `track_rank`,
`per_judge` (JSON), `notes` (JSON diagnostics), `computed_at`, `published_at`.

`published_at` is the switch between "the organizer has computed this" and
"the public can see it". Both raw and adjusted are kept, so the effect of
normalization is always inspectable.

**`result_prizes`** — per-track prize rows shown on the public results page.

### Operational

**`invitations`** — organizer invites, single-use tokens, expiry.
**`notifications`** — per-user, `read_at`.
**`audit_events`** — every organizer action: who, when, what, with
`entity_type` / `entity_id` / `meta`. This is the audit page and the CSV
export's source.

---

## Constraints

- **25 tables, 46 foreign keys, 17 unique constraints, 35 indexes.**
- Every `event_id` foreign key makes cross-event isolation a database fact
  rather than a convention: a team from one event cannot be joined to a project
  in another, and the organizer route checks the event before it touches a row.
- Uniqueness that expresses a rule: one project per team (enforced in the
  service), one review per assignment, one vote per person per project, one
  active rubric per event, one session per token hash.
- `PRAGMA foreign_keys = ON` on every SQLite connection, so those keys are
  actually enforced rather than merely declared.

---

## Storage behind the interface

The application never sees SQL. It calls the `Driver`, which is 124 methods
over the domain. `sqlite.ts` translates them to SQL; `firestore.ts` translates
them to collection reads, writes and (for the handful of aggregate queries)
`collectionGroup` queries with the composite indexes in
`firestore.indexes.json`.

The consequence worth stating: **the Firestore path is not a degraded mode.**
It implements the same contract, including the joins (`getProject` returns its
track, team and event; `listAssignments` returns project, team, track, judge and
review) that the SQLite driver does with `LEFT JOIN`. The only difference is
cost per join, not capability.
