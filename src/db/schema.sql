-- Judgely Relational Database Schema
-- Normalized relational architecture for hackathon judging operations

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    submissions_close TEXT NOT NULL,
    results_released INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS rubric_criteria (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    weight REAL NOT NULL DEFAULT 1.0,
    max_score REAL NOT NULL DEFAULT 5.0
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('organizer', 'judge', 'participant', 'visitor')),
    session_token TEXT UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judges (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judge_tracks (
    judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    PRIMARY KEY (judge_id, track_id)
);

CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS team_members (
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('lead', 'member')),
    PRIMARY KEY (team_id, email)
);

CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    summary TEXT,
    tech_stack TEXT DEFAULT '',
    repo_url TEXT,
    demo_url TEXT,
    submitted_at TEXT NOT NULL,
    updated_at TEXT,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('draft', 'submitted', 'withdrawn', 'disqualified'))
);

CREATE TABLE IF NOT EXISTS judge_assignments (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned', 'completed', 'conflict', 'reassigned')),
    assigned_at TEXT NOT NULL,
    UNIQUE(project_id, judge_id)
);

CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    judge_id TEXT NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
    comment TEXT DEFAULT '',
    total_weighted_score REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('draft', 'submitted')),
    submitted_at TEXT NOT NULL,
    UNIQUE(project_id, judge_id)
);

CREATE TABLE IF NOT EXISTS review_scores (
    id TEXT PRIMARY KEY,
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    criterion_name TEXT NOT NULL,
    score REAL NOT NULL,
    UNIQUE(review_id, criterion_name)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    user_id TEXT,
    role TEXT,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    details TEXT,
    timestamp TEXT NOT NULL
);

-- Indices for performance and query optimization
CREATE INDEX IF NOT EXISTS idx_projects_event ON projects(event_id);
CREATE INDEX IF NOT EXISTS idx_projects_track ON projects(track_id);
CREATE INDEX IF NOT EXISTS idx_projects_team ON projects(team_id);
CREATE INDEX IF NOT EXISTS idx_assignments_judge ON judge_assignments(judge_id);
CREATE INDEX IF NOT EXISTS idx_assignments_project ON judge_assignments(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_judge ON reviews(judge_id);
CREATE INDEX IF NOT EXISTS idx_reviews_project ON reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_users_session ON users(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_team_members_email ON team_members(email);
CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(user_id);
