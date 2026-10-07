-- Hackerly schema (SQLite dialect).
-- Real relationships, real constraints, real indexes. No JSON blobs where a
-- table would do the job.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- ---------------------------------------------------------------- identity --

CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  email_lower    TEXT NOT NULL UNIQUE,
  username       TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  bio            TEXT NOT NULL DEFAULT '',
  headline       TEXT NOT NULL DEFAULT '',
  location       TEXT NOT NULL DEFAULT '',
  avatar_url     TEXT NOT NULL DEFAULT '',
  avatar_seed    INTEGER NOT NULL DEFAULT 0,
  website_url    TEXT NOT NULL DEFAULT '',
  github_url     TEXT NOT NULL DEFAULT '',
  linkedin_url   TEXT NOT NULL DEFAULT '',
  password_hash  TEXT,
  auth_provider  TEXT NOT NULL DEFAULT 'local',   -- local | firebase
  firebase_uid   TEXT,
  platform_role  TEXT NOT NULL DEFAULT 'user',    -- user | platform_admin
  email_verified INTEGER NOT NULL DEFAULT 0,
  disabled       INTEGER NOT NULL DEFAULT 0,
  onboarded      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at DESC);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id         TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  ok         INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(identifier, created_at DESC);

-- ------------------------------------------------------------------ events --

CREATE TABLE IF NOT EXISTS events (
  id                    TEXT PRIMARY KEY,
  slug                  TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  tagline               TEXT NOT NULL DEFAULT '',
  description           TEXT NOT NULL DEFAULT '',
  rules_md              TEXT NOT NULL DEFAULT '',
  organizer_name        TEXT NOT NULL DEFAULT '',
  contact_email         TEXT NOT NULL DEFAULT '',
  cover_url             TEXT NOT NULL DEFAULT '',
  cover_style           TEXT NOT NULL DEFAULT 'auto',
  accent_color          TEXT NOT NULL DEFAULT '',
  mode                  TEXT NOT NULL DEFAULT 'global',   -- local | global
  status                TEXT NOT NULL DEFAULT 'draft',     -- draft|published|live|closed|archived
  format                TEXT NOT NULL DEFAULT 'online',   -- online|offline|hybrid
  venue                 TEXT NOT NULL DEFAULT '',
  city                  TEXT NOT NULL DEFAULT '',
  country               TEXT NOT NULL DEFAULT '',
  timezone              TEXT NOT NULL DEFAULT 'UTC',
  prize_pool_cents      INTEGER NOT NULL DEFAULT 0,
  prize_currency        TEXT NOT NULL DEFAULT 'INR',
  prize_headline        TEXT NOT NULL DEFAULT '',
  registration_opens_at TEXT,
  registration_closes_at TEXT,
  starts_at             TEXT,
  ends_at               TEXT,
  submission_deadline   TEXT,
  judging_starts_at     TEXT,
  judging_ends_at       TEXT,
  results_release_at    TEXT,
  min_team_size         INTEGER NOT NULL DEFAULT 1,
  max_team_size         INTEGER NOT NULL DEFAULT 4,
  allow_solo            INTEGER NOT NULL DEFAULT 1,
  allow_cross_college   INTEGER NOT NULL DEFAULT 1,
  eligibility           TEXT NOT NULL DEFAULT '',
  judging_mode          TEXT NOT NULL DEFAULT 'raw',      -- raw | normalized
  normalize_lambda      REAL NOT NULL DEFAULT 0.0,
  results_visibility    TEXT NOT NULL DEFAULT 'hidden',  -- hidden | public
  showcase_visibility   TEXT NOT NULL DEFAULT 'public',  -- hidden | public
  public_listing        INTEGER NOT NULL DEFAULT 1,
  contact_visible       INTEGER NOT NULL DEFAULT 1,
  require_approval      INTEGER NOT NULL DEFAULT 0,
  submission_fields     TEXT NOT NULL DEFAULT '[]',      -- JSON array of field defs
  judging_blurb         TEXT NOT NULL DEFAULT '',
  schedule              TEXT NOT NULL DEFAULT '[]',      -- JSON array of milestones
  created_by            TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  published_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_status ON events(status, public_listing, starts_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_creator ON events(created_by);
CREATE INDEX IF NOT EXISTS idx_events_deadline ON events(submission_deadline);

CREATE TABLE IF NOT EXISTS event_organizers (
  event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'owner',   -- owner | cohost
  created_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_event_organizers_user ON event_organizers(user_id);

CREATE TABLE IF NOT EXISTS event_members (
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'participant', -- participant|judge|organizer
  status     TEXT NOT NULL DEFAULT 'active',      -- active|removed
  registered_at TEXT NOT NULL,
  PRIMARY KEY (event_id, user_id, role)
);
CREATE INDEX IF NOT EXISTS idx_event_members_user ON event_members(user_id, role);

CREATE TABLE IF NOT EXISTS announcements (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  audience   TEXT NOT NULL DEFAULT 'everyone', -- everyone|participants|judges|organizers
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_announcements_event ON announcements(event_id, created_at DESC);

-- ------------------------------------------------------- teams & projects --

CREATE TABLE IF NOT EXISTS teams (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug        TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  avatar_seed INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_teams_event ON teams(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS team_members (
  team_id   TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      TEXT NOT NULL DEFAULT 'member',  -- owner | member
  joined_at TEXT NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);

CREATE TABLE IF NOT EXISTS tracks (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  eligibility   TEXT NOT NULL DEFAULT '',
  prize_text    TEXT NOT NULL DEFAULT '',
  brief         TEXT NOT NULL DEFAULT '',
  requirements  TEXT NOT NULL DEFAULT '[]',
  max_teams     INTEGER,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  UNIQUE (event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_tracks_event ON tracks(event_id, sort_order);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id       TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  track_id      TEXT REFERENCES tracks(id) ON DELETE SET NULL,
  slug          TEXT NOT NULL,
  title         TEXT NOT NULL,
  tagline       TEXT NOT NULL DEFAULT '',
  summary       TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  tech_stack    TEXT NOT NULL DEFAULT '[]',
  image_url     TEXT NOT NULL DEFAULT '',
  repo_url      TEXT NOT NULL DEFAULT '',
  demo_url      TEXT NOT NULL DEFAULT '',
  video_url     TEXT NOT NULL DEFAULT '',
  docs_url      TEXT NOT NULL DEFAULT '',
  answers       TEXT NOT NULL DEFAULT '{}',
  status        TEXT NOT NULL DEFAULT 'draft',  -- draft|submitted|under_review|results_released
  submitted_at  TEXT,
  locked_at     TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (event_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id, status, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_projects_track ON projects(track_id);

-- One submitted project per team per event: a team submits once.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_project_team ON projects(event_id, team_id);

-- ------------------------------------------------------------------ judging --

CREATE TABLE IF NOT EXISTS rubrics (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  status     TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at TEXT NOT NULL,
  UNIQUE (event_id, version)
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
  id          TEXT PRIMARY KEY,
  rubric_id   TEXT NOT NULL REFERENCES rubrics(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  weight      REAL NOT NULL DEFAULT 1,
  max_score   INTEGER NOT NULL DEFAULT 10,
  required    INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (rubric_id, key)
);
CREATE INDEX IF NOT EXISTS idx_criteria_rubric ON rubric_criteria(rubric_id, sort_order);

CREATE TABLE IF NOT EXISTS event_judges (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     TEXT REFERENCES users(id) ON DELETE SET NULL,
  email       TEXT NOT NULL,
  email_lower TEXT NOT NULL,
  username    TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'invited', -- invited|active|declined|removed
  invited_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  invited_at  TEXT NOT NULL,
  accepted_at TEXT,
  removed_at  TEXT,
  UNIQUE (event_id, email_lower)
);
CREATE INDEX IF NOT EXISTS idx_event_judges_user ON event_judges(user_id);
CREATE INDEX IF NOT EXISTS idx_event_judges_event ON event_judges(event_id, status);

CREATE TABLE IF NOT EXISTS judge_assignments (
  id           TEXT PRIMARY KEY,
  event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_judge_id TEXT NOT NULL REFERENCES event_judges(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending', -- pending|in_progress|submitted|reopened
  assigned_at  TEXT NOT NULL,
  submitted_at TEXT,
  UNIQUE (event_id, project_id, event_judge_id)
);
CREATE INDEX IF NOT EXISTS idx_assignments_judge ON judge_assignments(event_judge_id, status);
CREATE INDEX IF NOT EXISTS idx_assignments_project ON judge_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_assignments_event ON judge_assignments(event_id, status);

CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  assignment_id  TEXT NOT NULL UNIQUE REFERENCES judge_assignments(id) ON DELETE CASCADE,
  event_id      TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_judge_id TEXT NOT NULL REFERENCES event_judges(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rubric_id     TEXT REFERENCES rubrics(id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'draft', -- draft | submitted
  comment       TEXT NOT NULL DEFAULT '',
  strengths     TEXT NOT NULL DEFAULT '',
  improvements  TEXT NOT NULL DEFAULT '',
  recommendation TEXT NOT NULL DEFAULT '',
  weighted_score REAL,
  submitted_at  TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_judge ON reviews(user_id, event_id);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_event ON reviews(event_id, status);

CREATE TABLE IF NOT EXISTS review_scores (
  id          TEXT PRIMARY KEY,
  review_id   TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
  criterion_id TEXT NOT NULL REFERENCES rubric_criteria(id) ON DELETE CASCADE,
  score       INTEGER NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  UNIQUE (review_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_review_scores_review ON review_scores(review_id);

-- ------------------------------------------------------------------ results --

CREATE TABLE IF NOT EXISTS results (
  id              TEXT PRIMARY KEY,
  event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  review_count    INTEGER NOT NULL DEFAULT 0,
  raw_score       REAL,
  adjusted_score  REAL,
  final_score     REAL,
  rank            INTEGER,
  track_rank      INTEGER,
  track_name      TEXT NOT NULL DEFAULT '',
  track_color     TEXT NOT NULL DEFAULT '',
  breakdown       TEXT NOT NULL DEFAULT '{}',
  computed_at     TEXT NOT NULL,
  published_at    TEXT,
  UNIQUE (event_id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_results_event ON results(event_id, rank);

CREATE TABLE IF NOT EXISTS result_prizes (
  id         TEXT PRIMARY KEY,
  event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  amount_cents INTEGER NOT NULL DEFAULT 0,
  currency   TEXT NOT NULL DEFAULT 'INR',
  rank_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_result_prizes_event ON result_prizes(event_id);

-- ------------------------------------------------------------ notifications --

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id   TEXT REFERENCES events(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  read_at    TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS invitations (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  email_lower TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'judge',
  token       TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'sent', -- sent | accepted | revoked | expired
  delivery    TEXT NOT NULL DEFAULT 'log',  -- log | smtp
  message     TEXT NOT NULL DEFAULT '',
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_invitations_event ON invitations(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id          TEXT PRIMARY KEY,
  event_id    TEXT REFERENCES events(id) ON DELETE CASCADE,
  actor_id    TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT NOT NULL DEFAULT 'system',
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id   TEXT NOT NULL DEFAULT '',
  summary     TEXT NOT NULL DEFAULT '',
  meta        TEXT NOT NULL DEFAULT '{}',
  ip          TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_events(event_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_events(actor_id, created_at DESC);

-- Public voting (T3). Kept deliberately small and abuse-aware.
CREATE TABLE IF NOT EXISTS project_votes (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  UNIQUE (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_votes_project ON project_votes(project_id);

CREATE TABLE IF NOT EXISTS project_comments (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  hidden     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comments_project ON project_comments(project_id, created_at DESC);
