import Database from 'better-sqlite3';
import { readFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { Driver, Page } from './driver.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** schema.sql is copied next to the compiled JS at build time. */
function schemaPath(): string {
  const candidates = [
    path.join(HERE, 'schema.sql'),
    path.join(config.root, 'src/server/db/schema.sql'),
    path.join(config.root, 'dist/server/db/schema.sql'),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error('schema.sql not found. Run `npm run build`.');
}

const JSON_COLUMNS = new Set([
  'submission_fields',
  'schedule',
  'tech_stack',
  'answers',
  'requirements',
  'breakdown',
  'meta',
]);

type Row = Record<string, any>;

function hydrate(row: Row | undefined | null): any {
  if (!row) return null;
  const out: Row = { ...row };
  for (const key of JSON_COLUMNS) {
    if (typeof out[key] === 'string') {
      try {
        out[key] = JSON.parse(out[key]);
      } catch {
        out[key] = null;
      }
    }
  }
  // SQLite has no boolean; surface numbers as booleans where the schema says so.
  for (const key of ['allow_solo', 'allow_cross_college', 'public_listing', 'require_approval',
    'contact_visible', 'required', 'hidden', 'onboarded', 'disabled', 'email_verified']) {
    if (key in out && out[key] !== null && out[key] !== undefined) out[key] = Boolean(out[key]);
  }
  return out;
}

const hydrateAll = (rows: Row[]): any[] => rows.map(hydrate);

export class SqliteDriver implements Driver {
  readonly name = 'sqlite' as const;
  /** Typed loosely on purpose: better-sqlite3's own generics are stricter than
   *  the query shapes this file builds, and casting here keeps the SQL honest. */
  private db!: any;

  async init(): Promise<void> {
    mkdirSync(path.dirname(config.db.sqliteFile), { recursive: true });
    this.db = new Database(config.db.sqliteFile);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(readFileSync(schemaPath(), 'utf8'));
    try {
      this.db.exec('ALTER TABLE reviews ADD COLUMN rubric_id TEXT REFERENCES rubrics(id) ON DELETE SET NULL');
    } catch {
      /* column already exists */
    }
    this.db
      .prepare(`INSERT INTO schema_meta(key, value) VALUES('version', '1')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run();
    log.info('sqlite ready', { file: path.basename(config.db.sqliteFile) });
  }

  async close(): Promise<void> {
    try {
      this.db?.close();
    } catch {
      /* already closed */
    }
  }

  async health() {
    try {
      this.db.prepare('SELECT 1').get();
      return { ok: true, driver: 'sqlite', detail: 'connected' };
    } catch (e) {
      console.error('[Health] SQLite check failed:', e);
      return { ok: false, driver: 'sqlite', detail: 'unreachable' };
    }
  }

  // ---------------------------------------------------------------- helpers

  private insert(table: string, data: Row): void {
    const keys = Object.keys(data);
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`;
    this.db.prepare(sql).run(...keys.map((k) => normalize(data[k])));
  }

  private update(table: string, id: string, data: Row): any {
    const keys = Object.keys(data);
    if (!keys.length) return hydrate(this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
    const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
    this.db.prepare(sql).run(...keys.map((k) => normalize(data[k])), id);
    return hydrate(this.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  }

  private tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }

  private page<T>(rows: Row[], total: number, pageNo: number, perPage: number): Page<T> {
    return { items: hydrateAll(rows), total, page: pageNo, perPage, pages: Math.max(1, Math.ceil(total / perPage)) };
  }

  // ------------------------------------------------------------------ users

  async createUser(u: Row) { this.insert('users', u); return this.getUserById(u.id); }
  async getUserById(id: string) { return hydrate(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id)); }
  async getUserByEmail(email: string) { return hydrate(this.db.prepare('SELECT * FROM users WHERE email_lower = ?').get(String(email).toLowerCase())); }
  async getUserByUsername(username: string) { return hydrate(this.db.prepare('SELECT * FROM users WHERE username_lower = ?').get(String(username).toLowerCase())); }
  async getUserByFirebaseUid(uid: string) { return hydrate(this.db.prepare('SELECT * FROM users WHERE firebase_uid = ?').get(uid)); }
  async updateUser(id: string, patch: Row) { return this.update('users', id, patch); }
  async countUsers(): Promise<number> { return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as any).n; }
  async listUsers(limit = 50, offset = 0) {
    return hydrateAll(this.db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?').all(limit, offset));
  }

  // --------------------------------------------------------------- sessions

  async createSession(s: Row) { this.insert('sessions', s); }
  async getSessionByTokenHash(h: string) { return hydrate(this.db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(h)); }
  async touchSession(id: string, seenAt: string) { this.db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(seenAt, id); }
  async deleteSession(id: string) { this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id); }
  async deleteSessionsForUser(userId: string) { this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId); }
  async purgeExpiredSessions(beforeIso: string) { return this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(beforeIso).changes; }
  async listSessions(userId: string) {
    return hydrateAll(this.db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC').all(userId));
  }

  async recordLoginAttempt(a: Row) { this.insert('login_attempts', a); }
  async countRecentLoginFailures(identifier: string, sinceIso: string): Promise<number> {
    return (this.db
      .prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE identifier = ? AND ok = 0 AND created_at >= ?')
      .get(identifier, sinceIso) as any).n;
  }

  // ----------------------------------------------------------------- events

  async createEvent(e: Row) {
    return this.tx(() => {
      this.insert('events', e);
      this.insert('event_organizers', { event_id: e.id, user_id: e.created_by, role: 'owner', created_at: e.created_at });
      this.insert('event_members', { event_id: e.id, user_id: e.created_by, role: 'organizer', status: 'active', registered_at: e.created_at });
      return hydrate(this.db.prepare('SELECT * FROM events WHERE id = ?').get(e.id));
    });
  }

  async updateEvent(id: string, patch: Row) { return this.update('events', id, patch); }
  async getEventById(id: string) { return hydrate(this.db.prepare('SELECT * FROM events WHERE id = ?').get(id)); }
  async getEventBySlug(slug: string) { return hydrate(this.db.prepare('SELECT * FROM events WHERE slug = ?').get(slug)); }

  async listEvents(opts: { status?: string[]; listing?: boolean; q?: string; limit: number; offset: number; order?: string }) {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.status?.length) { where.push(`status IN (${opts.status.map(() => '?').join(',')})`); params.push(...opts.status); }
    if (opts.listing) where.push('public_listing = 1');
    if (opts.q) { where.push('(name LIKE ? OR tagline LIKE ? OR description LIKE ?)'); const like = `%${opts.q}%`; params.push(like, like, like); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order =
      opts.order === 'prize'
        ? 'prize_pool_cents DESC, starts_at DESC'
        : opts.order === 'ending'
          ? 'COALESCE(ends_at, starts_at) ASC'
          : 'COALESCE(starts_at, created_at) DESC, created_at DESC';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`).get(...params) as any).n;
    const rows = this.db.prepare(`SELECT * FROM events ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, (opts.limit ?? 50), (opts.offset ?? 0));
    return { rows: hydrateAll(rows), total };
  }

  async countEventsByStatus() {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM events GROUP BY status').all() as any[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  async addOrganizer(eventId: string, userId: string, role: string, at: string) {
    this.db.prepare(`INSERT INTO event_organizers(event_id,user_id,role,created_at) VALUES(?,?,?,?)
                     ON CONFLICT(event_id,user_id) DO UPDATE SET role = excluded.role`).run(eventId, userId, role, at);
    this.db.prepare(`INSERT INTO event_members(event_id,user_id,role,status,registered_at) VALUES(?,?,'organizer','active',?)
                     ON CONFLICT(event_id,user_id,role) DO UPDATE SET status='active'`).run(eventId, userId, at);
  }
  async removeOrganizer(eventId: string, userId: string) {
    this.db.prepare('DELETE FROM event_organizers WHERE event_id = ? AND user_id = ?').run(eventId, userId);
    this.db.prepare("DELETE FROM event_members WHERE event_id = ? AND user_id = ? AND role = 'organizer'").run(eventId, userId);
  }
  async listOrganizers(eventId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT u.*, eo.role AS organizer_role FROM event_organizers eo
      JOIN users u ON u.id = eo.user_id WHERE eo.event_id = ? ORDER BY eo.created_at`).all(eventId));
  }
  async isOrganizer(eventId: string, userId: string): Promise<boolean> {
    return Boolean(this.db.prepare('SELECT 1 FROM event_organizers WHERE event_id = ? AND user_id = ?').get(eventId, userId));
  }
  async getEventOrganizer(eventId: string, userId: string) {
    return hydrate(this.db.prepare('SELECT * FROM event_organizers WHERE event_id = ? AND user_id = ?').get(eventId, userId));
  }
  async listEventsForOrganizer(userId: string, limit = 50, offset = 0) {
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM events e JOIN event_organizers eo ON eo.event_id = e.id WHERE eo.user_id = ?`).get(userId) as any).n;
    const rows = this.db.prepare(`
      SELECT e.*, eo.role AS organizer_role FROM events e
      JOIN event_organizers eo ON eo.event_id = e.id
      WHERE eo.user_id = ? ORDER BY e.created_at DESC LIMIT ? OFFSET ?`).all(userId, limit, offset);
    return { rows: hydrateAll(rows), total };
  }

  // -------------------------------------------------------------- membership

  async addMember(eventId: string, userId: string, role: string, at: string) {
    this.db.prepare(`INSERT INTO event_members(event_id,user_id,role,status,registered_at) VALUES(?,?,?,'active',?)
                     ON CONFLICT(event_id,user_id,role) DO UPDATE SET status='active'`).run(eventId, userId, role, at);
  }
  async removeMember(eventId: string, userId: string, role: string) {
    this.db.prepare('DELETE FROM event_members WHERE event_id = ? AND user_id = ? AND role = ?').run(eventId, userId, role);
  }
  async getMembership(eventId: string, userId: string, role?: string) {
    const sql = role
      ? 'SELECT * FROM event_members WHERE event_id = ? AND user_id = ? AND role = ?'
      : 'SELECT * FROM event_members WHERE event_id = ? AND user_id = ? AND status = \'active\'';
    const params = role ? [eventId, userId, role] : [eventId, userId];
    return hydrate(this.db.prepare(sql).get(...params));
  }
  async listEventMembers(eventId: string, role?: string) {
    const params: any[] = [eventId];
    let clause = '';
    if (role) { clause = 'AND role = ?'; params.push(role); }
    return hydrateAll(this.db.prepare(`SELECT * FROM event_members WHERE event_id = ? ${clause} ORDER BY registered_at`).all(...params));
  }
  async listMemberEvents(userId: string, role?: string) {
    const sql = role
      ? `SELECT e.*, m.event_id, m.role AS member_role, m.registered_at FROM event_members m
         JOIN events e ON e.id = m.event_id WHERE m.user_id = ? AND m.role = ? AND m.status='active'
         ORDER BY COALESCE(e.starts_at, e.created_at) DESC`
      : `SELECT e.*, m.event_id, m.role AS member_role, m.registered_at FROM event_members m
         JOIN events e ON e.id = m.event_id WHERE m.user_id = ? AND m.status='active'
         ORDER BY COALESCE(e.starts_at, e.created_at) DESC`;
    return hydrateAll(this.db.prepare(sql).all(...(role ? [userId, role] : [userId])));
  }

  // ----------------------------------------------------------- announcements

  async createAnnouncement(a: Row) { this.insert('announcements', a); return hydrate(this.db.prepare('SELECT * FROM announcements WHERE id = ?').get(a.id)); }
  async listAnnouncements(eventId: string, limit: number) {
    return hydrateAll(this.db.prepare('SELECT a.*, u.display_name AS author_name, u.username AS author_username FROM announcements a LEFT JOIN users u ON u.id = a.created_by WHERE a.event_id = ? ORDER BY a.created_at DESC LIMIT ?').all(eventId, limit));
  }
  async deleteAnnouncement(id: string) { this.db.prepare('DELETE FROM announcements WHERE id = ?').run(id); }

  // ------------------------------------------------------------------ tracks

  async createTrack(t: Row) { this.insert('tracks', t); return this.getTrack(t.id); }
  async updateTrack(id: string, patch: Row) { return this.update('tracks', id, patch); }
  async getTrack(id: string) { return hydrate(this.db.prepare('SELECT * FROM tracks WHERE id = ?').get(id)); }
  async getTrackBySlug(eventId: string, slug: string) { return hydrate(this.db.prepare('SELECT * FROM tracks WHERE event_id = ? AND slug = ?').get(eventId, slug)); }
  async deleteTrack(id: string) { this.db.prepare('DELETE FROM tracks WHERE id = ?').run(id); }
  async listTracks(eventId: string) {
    return hydrateAll(this.db.prepare('SELECT * FROM tracks WHERE event_id = ? ORDER BY sort_order, name').all(eventId));
  }

  // ------------------------------------------------------------------- teams

  async createTeam(t: Row) {
    this.tx(() => {
      this.insert('teams', t);
      this.addTeamMemberSync(t.id, t.created_by, 'owner', t.created_at);
    });
    return this.getTeam(t.id);
  }
  private addTeamMemberSync(teamId: string, userId: string, role: string, at: string) {
    this.db.prepare(`INSERT INTO team_members(team_id,user_id,role,joined_at) VALUES(?,?,?,?)
                     ON CONFLICT(team_id,user_id) DO UPDATE SET role = excluded.role`).run(teamId, userId, role, at);
  }
  async updateTeam(id: string, patch: Row) { return this.update('teams', id, patch); }
  async getTeam(id: string) {
    return hydrate(this.db.prepare(`
      SELECT t.*, e.name AS event_name, e.slug AS event_slug, e.submission_deadline, e.status AS event_status
      FROM teams t JOIN events e ON e.id = t.event_id WHERE t.id = ?`).get(id));
  }
  async getTeamBySlug(eventId: string, slug: string) { return hydrate(this.db.prepare('SELECT * FROM teams WHERE event_id = ? AND slug = ?').get(eventId, slug)); }
  async deleteTeam(id: string) {
    this.tx(() => {
      this.db.prepare('DELETE FROM team_members WHERE team_id = ?').run(id);
      this.db.prepare('DELETE FROM projects WHERE team_id = ?').run(id);
      this.db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    });
  }
  async listTeams(eventId: string, opts: { q?: string; limit?: number; offset?: number }) {
    const where = ['t.event_id = ?'];
    const params: any[] = [eventId];
    if (opts.q) { where.push('(t.name LIKE ? OR t.description LIKE ?)'); params.push(`%${opts.q}%`, `%${opts.q}%`); }
    const clause = `WHERE ${where.join(' AND ')}`;
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM teams t ${clause}`).get(...params) as any).n;
    const rows = this.db.prepare(`
      SELECT t.*, u.display_name AS owner_name, u.username AS owner_username,
             (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) AS member_count,
             (SELECT p.id FROM projects p WHERE p.team_id = t.id LIMIT 1) AS project_id,
             (SELECT p.status FROM projects p WHERE p.team_id = t.id LIMIT 1) AS project_status,
             (SELECT p.title FROM projects p WHERE p.team_id = t.id LIMIT 1) AS project_title
      FROM teams t JOIN users u ON u.id = t.created_by
      ${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`).all(...params, (opts.limit ?? 50), (opts.offset ?? 0));
    return { rows: hydrateAll(rows), total };
  }
  async listTeamsForUser(userId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT t.*, e.name AS event_name, e.slug AS event_slug, e.submission_deadline, e.status AS event_status,
             tm.role AS my_team_role,
             (SELECT p.id FROM projects p WHERE p.team_id = t.id LIMIT 1) AS project_id,
             (SELECT p.title FROM projects p WHERE p.team_id = t.id LIMIT 1) AS project_title,
             (SELECT p.status FROM projects p WHERE p.team_id = t.id LIMIT 1) AS project_status
      FROM team_members tm JOIN teams t ON t.id = tm.team_id JOIN events e ON e.id = t.event_id
      WHERE tm.user_id = ? ORDER BY t.created_at DESC`).all(userId));
  }
  async addTeamMember(teamId: string, userId: string, role: string, at: string) { this.addTeamMemberSync(teamId, userId, role, at); }
  async removeTeamMember(teamId: string, userId: string) { this.db.prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(teamId, userId); }
  async getTeamMember(teamId: string, userId: string) {
    return hydrate(this.db.prepare('SELECT * FROM team_members WHERE team_id = ? AND user_id = ?').get(teamId, userId));
  }
  async listTeamMembers(teamId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT u.*, tm.role AS team_role, tm.joined_at FROM team_members tm
      JOIN users u ON u.id = tm.user_id WHERE tm.team_id = ?
      ORDER BY CASE tm.role WHEN 'owner' THEN 0 ELSE 1 END, tm.joined_at`).all(teamId));
  }
  async countTeamMembers(teamId: string): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(teamId) as any).n;
  }

  // ---------------------------------------------------------------- projects

  async createProject(p: Row) { this.insert('projects', p); return this.getProject(p.id); }
  async updateProject(id: string, patch: Row) { return this.update('projects', id, patch); }
  async getProject(id: string) {
    return hydrate(this.db.prepare(`
      SELECT p.*, t.name AS track_name, t.slug AS track_slug, t.prize_text AS track_prize,
             tm.name AS team_name, tm.slug AS team_slug,
             e.name AS event_name, e.slug AS event_slug, e.status AS event_status,
             e.mode AS event_mode, e.showcase_visibility, e.results_visibility, e.prize_currency,
             e.submission_deadline, e.judging_mode, e.slug AS event_slug2
      FROM projects p
      LEFT JOIN tracks t ON t.id = p.track_id
      JOIN teams tm ON tm.id = p.team_id
      JOIN events e ON e.id = p.event_id
      WHERE p.id = ?`).get(id));
  }
  async getProjectBySlug(eventId: string, slug: string) {
    const row = this.db.prepare('SELECT id FROM projects WHERE event_id = ? AND slug = ?').get(eventId, slug) as any;
    return row ? this.getProject(row.id) : null;
  }
  async listProjects(opts: { eventId?: string; trackId?: string; teamId?: string; status?: string[]; q?: string; publicOnly?: boolean; sort?: string; limit?: number; offset?: number }) {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.eventId) { where.push('p.event_id = ?'); params.push(opts.eventId); }
    if (opts.trackId) { where.push('p.track_id = ?'); params.push(opts.trackId); }
    if (opts.teamId) { where.push('p.team_id = ?'); params.push(opts.teamId); }
    if (opts.status?.length) { where.push(`p.status IN (${opts.status.map(() => '?').join(',')})`); params.push(...opts.status); }
    if (opts.q) { where.push('(p.title LIKE ? OR p.summary LIKE ? OR p.tagline LIKE ?)'); const l = `%${opts.q}%`; params.push(l, l, l); }
    if (opts.publicOnly) {
      where.push(`p.status IN ('submitted','under_review','results_released')`);
      where.push(`e.status IN ('published','live','closed')`);
      where.push(`e.showcase_visibility = 'public'`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order =
      opts.sort === 'votes'
        ? 'vote_count DESC, p.submitted_at DESC'
        : opts.sort === 'oldest'
          ? 'p.submitted_at ASC'
          : 'p.submitted_at DESC, p.created_at DESC';
    const join = 'FROM projects p JOIN events e ON e.id = p.event_id LEFT JOIN tracks tr ON tr.id = p.track_id JOIN teams tm ON tm.id = p.team_id';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n ${join} ${clause}`).get(...params) as any).n;
    const rows = this.db.prepare(`
      SELECT p.*, tr.name AS track_name, tr.slug AS track_slug, tr.prize_text AS track_prize,
             tm.name AS team_name, tm.slug AS team_slug, tm.avatar_seed AS team_avatar_seed,
             e.name AS event_name, e.slug AS event_slug, e.status AS event_status, e.mode AS event_mode,
             e.prize_currency, e.prize_pool_cents, e.showcase_visibility, e.results_visibility, e.accent_color,
             e.submission_deadline,
             (SELECT COUNT(*) FROM project_votes v WHERE v.project_id = p.id) AS vote_count,
             (SELECT COUNT(*) FROM team_members m WHERE m.team_id = p.team_id) AS team_size,
             (SELECT r.final_score FROM results r WHERE r.project_id = p.id AND r.published_at IS NOT NULL) AS public_rank_score,
             (SELECT r.rank FROM results r WHERE r.project_id = p.id AND r.published_at IS NOT NULL) AS public_rank
      ${join} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, (opts.limit ?? 50), (opts.offset ?? 0));
    return { rows: hydrateAll(rows), total };
  }
  async listProjectsForTeam(teamId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT p.*, tr.name AS track_name, tr.slug AS track_slug, tr.prize_text AS track_prize,
             tm.name AS team_name, tm.slug AS team_slug, tm.avatar_seed AS team_avatar_seed
      FROM projects p
      JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN tracks tr ON tr.id = p.track_id
      WHERE p.team_id = ?`).all(teamId));
  }
  async countProjectsByStatus(eventId: string) {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM projects WHERE event_id = ? GROUP BY status').all(eventId) as any[];
    const out: Record<string, number> = { draft: 0, submitted: 0, under_review: 0, results_released: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  // ----------------------------------------------------------------- rubrics

  async createRubric(r: Row) {
    return this.tx(() => {
      this.insert('rubrics', r);
      return r.id;
    });
  }
  async getActiveRubric(eventId: string) {
    return hydrate(this.db.prepare(`SELECT * FROM rubrics WHERE event_id = ? AND status='active' ORDER BY version DESC LIMIT 1`).get(eventId));
  }
  async getRubric(id: string) { return hydrate(this.db.prepare('SELECT * FROM rubrics WHERE id = ?').get(id)); }
  async listRubrics(eventId: string) {
    return hydrateAll(this.db.prepare('SELECT * FROM rubrics WHERE event_id = ? ORDER BY version DESC').all(eventId));
  }
  async createCriterion(c: Row) { this.insert('rubric_criteria', c); return this.getCriterion(c.id); }
  async updateCriterion(id: string, patch: Row) { return this.update('rubric_criteria', id, patch); }
  async deleteCriterion(id: string) { this.db.prepare('DELETE FROM rubric_criteria WHERE id = ?').run(id); }
  async getCriterion(id: string) { return hydrate(this.db.prepare('SELECT * FROM rubric_criteria WHERE id = ?').get(id)); }
  async listCriteria(rubricId: string) {
    return hydrateAll(this.db.prepare('SELECT * FROM rubric_criteria WHERE rubric_id = ? ORDER BY sort_order, name').all(rubricId));
  }
  async archiveRubric(id: string) { this.db.prepare(`UPDATE rubrics SET status='archived' WHERE id = ?`).run(id); }

  // ------------------------------------------------------------------ judges

  async createEventJudge(j: Row) { this.insert('event_judges', j); return this.getEventJudge(j.id); }
  async getEventJudge(id: string) {
    return hydrate(this.db.prepare(`
      SELECT ej.*, u.display_name, u.username, u.avatar_url, u.avatar_seed, u.bio
      FROM event_judges ej LEFT JOIN users u ON u.id = ej.user_id WHERE ej.id = ?`).get(id));
  }
  async getEventJudgeByEmail(eventId: string, email: string) {
    return hydrate(this.db.prepare('SELECT * FROM event_judges WHERE event_id = ? AND email_lower = ?').get(eventId, String(email).toLowerCase()));
  }
  async getEventJudgeForUser(eventId: string, userId: string) {
    return hydrate(this.db.prepare(`
      SELECT ej.*, u.display_name, u.username, u.avatar_url, u.avatar_seed
      FROM event_judges ej LEFT JOIN users u ON u.id = ej.user_id
      WHERE ej.event_id = ? AND ej.user_id = ?`).get(eventId, userId));
  }
  async updateEventJudge(id: string, patch: Row) { return this.update('event_judges', id, patch); }
  async listEventJudges(eventId: string, opts: { status?: string } = {}) {
    const params: any[] = [eventId];
    let clause = '';
    if (opts.status) { clause = 'AND ej.status = ?'; params.push(opts.status); }
    return hydrateAll(this.db.prepare(`
      SELECT ej.*, u.display_name, u.username, u.avatar_url, u.avatar_seed,
             (SELECT COUNT(*) FROM judge_assignments a WHERE a.event_judge_id = ej.id) AS assigned_count,
             (SELECT COUNT(*) FROM judge_assignments a WHERE a.event_judge_id = ej.id AND a.status='submitted') AS submitted_count
      FROM event_judges ej LEFT JOIN users u ON u.id = ej.user_id
      WHERE ej.event_id = ? ${clause} ORDER BY ej.status, ej.invited_at`).all(...params));
  }
  /**
   * Events this user judges. `id` is the EVENT id (callers need that, not the
   * judge row id), and the judge row is exposed as `judge_id`.
   */
  async listJudgeEvents(userId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT ej.id AS judge_id, ej.event_id, ej.user_id, ej.status AS judge_status,
             e.id, e.name AS event_name, e.slug AS event_slug, e.status AS event_status, e.mode AS event_mode,
             e.judging_ends_at, e.submission_deadline, e.cover_url, e.cover_style, e.accent_color, e.prize_currency,
             (SELECT COUNT(*) FROM judge_assignments a WHERE a.event_judge_id = ej.id) AS assigned_count,
             (SELECT COUNT(*) FROM judge_assignments a WHERE a.event_judge_id = ej.id AND a.status='submitted') AS submitted_count
      FROM event_judges ej JOIN events e ON e.id = ej.event_id
      WHERE ej.user_id = ? AND ej.status = 'active' ORDER BY e.created_at DESC`).all(userId));
  }

  // ------------------------------------------------------------- assignments

  async createAssignment(a: Row) { this.insert('judge_assignments', a); return this.getAssignment(a.id); }
  async updateAssignment(id: string, patch: Row) { return this.update('judge_assignments', id, patch); }
  async getAssignment(id: string) {
    return hydrate(this.db.prepare(`
      SELECT a.*, p.title AS project_title, p.slug AS project_slug, p.status AS project_status,
             ej.email AS judge_email, ej.user_id AS judge_user_id, ej.status AS judge_status,
             e.name AS event_name, e.slug AS event_slug, e.status AS event_status, e.mode AS event_mode
      FROM judge_assignments a
      JOIN projects p ON p.id = a.project_id
      JOIN event_judges ej ON ej.id = a.event_judge_id
      JOIN events e ON e.id = a.event_id
      WHERE a.id = ?`).get(id));
  }
  async deleteAssignment(id: string) { this.db.prepare('DELETE FROM judge_assignments WHERE id = ?').run(id); }
  async listAssignments(opts: { eventId?: string; judgeId?: string; projectId?: string; status?: string[]; limit: number; offset: number }) {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.eventId) { where.push('a.event_id = ?'); params.push(opts.eventId); }
    if (opts.judgeId) { where.push('a.event_judge_id = ?'); params.push(opts.judgeId); }
    if (opts.projectId) { where.push('a.project_id = ?'); params.push(opts.projectId); }
    if (opts.status?.length) { where.push(`a.status IN (${opts.status.map(() => '?').join(',')})`); params.push(...opts.status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM judge_assignments a ${clause}`).get(...params) as any).n;
    const rows = this.db.prepare(`
      SELECT a.*, p.title AS project_title, p.slug AS project_slug, p.status AS project_status, p.team_id,
             tm.name AS team_name, tr.name AS track_name,
             ej.email AS judge_email, ej.status AS judge_status,
             r.id AS review_id, r.status AS review_status, r.submitted_at AS review_submitted_at
      FROM judge_assignments a
      JOIN projects p ON p.id = a.project_id
      JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN tracks tr ON tr.id = p.track_id
      JOIN event_judges ej ON ej.id = a.event_judge_id
      LEFT JOIN reviews r ON r.assignment_id = a.id
      ${clause} ORDER BY a.assigned_at LIMIT ? OFFSET ?`).all(...params, (opts.limit ?? 50), (opts.offset ?? 0));
    return { rows: hydrateAll(rows), total };
  }
  async countAssignmentsByStatus(eventId: string) {
    const rows = this.db.prepare('SELECT status, COUNT(*) AS n FROM judge_assignments WHERE event_id = ? GROUP BY status').all(eventId) as any[];
    const out: Record<string, number> = { pending: 0, in_progress: 0, submitted: 0, reopened: 0 };
    for (const r of rows) out[r.status] = r.n;
    return out;
  }
  async listAssignmentProjectIds(judgeId: string) {
    return (this.db.prepare('SELECT project_id FROM judge_assignments WHERE event_judge_id = ?').all(judgeId) as any[]).map((r) => r.project_id);
  }

  // ----------------------------------------------------------------- reviews

  async createReview(r: Row) { this.insert('reviews', r); return this.getReview(r.id); }
  async updateReview(id: string, patch: Row) { return this.update('reviews', id, patch); }
  async getReview(id: string) {
    return hydrate(this.db.prepare(`
      SELECT r.*, p.title AS project_title, p.slug AS project_slug, p.event_id AS p_event_id,
             ej.user_id AS judge_user_id, ej.email AS judge_email
      FROM reviews r JOIN projects p ON p.id = r.project_id
      JOIN event_judges ej ON ej.id = r.event_judge_id WHERE r.id = ?`).get(id));
  }
  async getReviewByAssignment(assignmentId: string) {
    return hydrate(this.db.prepare('SELECT * FROM reviews WHERE assignment_id = ?').get(assignmentId));
  }
  async listReviews(opts: { eventId?: string; judgeId?: string; userId?: string; projectId?: string; status?: string; limit?: number; offset?: number }) {
    const where: string[] = [];
    const params: any[] = [];
    if (opts.eventId) { where.push('r.event_id = ?'); params.push(opts.eventId); }
    if (opts.judgeId) { where.push('r.event_judge_id = ?'); params.push(opts.judgeId); }
    if (opts.userId) { where.push('r.user_id = ?'); params.push(opts.userId); }
    if (opts.projectId) { where.push('r.project_id = ?'); params.push(opts.projectId); }
    if (opts.status) { where.push('r.status = ?'); params.push(opts.status); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = opts.limit ?? 5000;
    const offset = opts.offset ?? 0;
    return hydrateAll(this.db.prepare(`
      SELECT r.*, p.title AS project_title, p.slug AS project_slug, p.team_id,
             tm.name AS team_name, tr.name AS track_name
      FROM reviews r JOIN projects p ON p.id = r.project_id
      JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN tracks tr ON tr.id = p.track_id
      ${clause} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset));
  }
  async countReviews(eventId: string) {
    const r = this.db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted FROM reviews WHERE event_id = ?`).get(eventId) as any;
    return { total: r.total ?? 0, submitted: r.submitted ?? 0 };
  }
  async upsertScore(s: Row) {
    this.db.prepare(`INSERT INTO review_scores(id, review_id, criterion_id, score, note) VALUES(?,?,?,?,?)
                     ON CONFLICT(review_id, criterion_id) DO UPDATE SET score = excluded.score, note = excluded.note`)
      .run(s.id, s.review_id, s.criterion_id, s.score, s.note ?? '');
  }
  async replaceReviewScores(reviewId: string, scores: Row[]) {
    this.tx(() => {
      this.db.prepare('DELETE FROM review_scores WHERE review_id = ?').run(reviewId);
      const stmt = this.db.prepare(`INSERT INTO review_scores(id, review_id, criterion_id, score, note) VALUES(?,?,?,?,?)`);
      for (const s of scores) {
        stmt.run(s.id, reviewId, s.criterion_id, s.score, s.note ?? '');
      }
    });
  }
  async listScores(reviewId: string) {
    return hydrateAll(this.db.prepare(`SELECT rs.*, c.key, c.name, c.weight, c.max_score, c.sort_order
      FROM review_scores rs JOIN rubric_criteria c ON c.id = rs.criterion_id
      WHERE rs.review_id = ? ORDER BY c.sort_order`).all(reviewId));
  }
  async listScoresForProject(projectId: string) {
    return hydrateAll(this.db.prepare(`SELECT rs.*, r.user_id, r.event_judge_id, r.status AS review_status
      FROM review_scores rs JOIN reviews r ON r.id = rs.review_id WHERE r.project_id = ?`).all(projectId));
  }
  async listAllScoresForEvent(eventId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT rs.review_id, rs.criterion_id, rs.score, r.project_id, r.event_judge_id, r.user_id, r.status AS review_status
      FROM review_scores rs JOIN reviews r ON r.id = rs.review_id WHERE r.event_id = ?`).all(eventId));
  }

  // ----------------------------------------------------------------- results

  async replaceResults(eventId: string, rows: Row[], computedAt: string) {
    this.tx(() => {
      const published = rows.some((r) => r.published_at);
      this.db.prepare('DELETE FROM results WHERE event_id = ?').run(eventId);
      for (const r of rows) {
        this.insert('results', { ...r, event_id: eventId, computed_at: computedAt });
      }
      if (published) {
        const stmt = this.db.prepare('UPDATE results SET published_at = ? WHERE event_id = ? AND rank <= ?');
        for (const r of rows) {
          if (r.published_at) stmt.run(r.published_at, eventId, r.rank);
        }
      }
    });
  }
  async listResults(eventId: string, publishedOnly: boolean) {
    return hydrateAll(this.db.prepare(`
      SELECT res.*, p.title AS project_title, p.slug AS project_slug, p.summary AS project_summary,
             p.image_url, p.tech_stack, tm.name AS team_name, tm.slug AS team_slug, tm.avatar_seed AS team_avatar_seed
      FROM results res
      JOIN projects p ON p.id = res.project_id
      JOIN teams tm ON tm.id = p.team_id
      WHERE res.event_id = ? ${publishedOnly ? 'AND res.published_at IS NOT NULL' : ''}
      ORDER BY res.rank`).all(eventId));
  }
  async getResultForProject(eventId: string, projectId: string) {
    return hydrate(this.db.prepare('SELECT * FROM results WHERE event_id = ? AND project_id = ?').get(eventId, projectId));
  }
  async publishResults(eventId: string, at: string) { this.db.prepare('UPDATE results SET published_at = ? WHERE event_id = ?').run(at, eventId); }
  async unpublishResults(eventId: string) { this.db.prepare('UPDATE results SET published_at = NULL WHERE event_id = ?').run(eventId); }
  async addResultPrizes(eventId: string, rows: Row[]) {
    this.tx(() => {
      this.db.prepare('DELETE FROM result_prizes WHERE event_id = ?').run(eventId);
      for (const r of rows) this.insert('result_prizes', { ...r, event_id: eventId });
    });
  }
  async listResultPrizes(eventId: string) {
    return hydrateAll(this.db.prepare(`
      SELECT rp.*, p.title AS project_title, p.slug AS project_slug, tm.name AS team_name
      FROM result_prizes rp JOIN projects p ON p.id = rp.project_id JOIN teams tm ON tm.id = p.team_id
      WHERE rp.event_id = ? ORDER BY rp.amount_cents DESC`).all(eventId));
  }

  // ----------------------------------------------------------- notifications

  async createNotification(n: Row) { this.insert('notifications', n); }
  async createNotifications(notifications: Row[]) {
    if (!notifications.length) return;
    this.tx(() => {
      for (const n of notifications) {
        this.insert('notifications', n);
      }
    });
  }
  async listNotifications(userId: string, limit: number) {
    return hydrateAll(this.db.prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`).all(userId, limit));
  }
  async countUnread(userId: string): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as any).n;
  }
  async markAllRead(userId: string, at: string) {
    this.db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(at, userId);
  }

  // ------------------------------------------------------------ invitations

  async createInvitation(i: Row) { this.insert('invitations', i); return hydrate(this.db.prepare('SELECT * FROM invitations WHERE id = ?').get(i.id)); }
  async getInvitationByToken(token: string) { return hydrate(this.db.prepare('SELECT * FROM invitations WHERE token = ?').get(token)); }
  async updateInvitation(id: string, patch: Row) {
    this.db.prepare(`UPDATE invitations SET ${Object.keys(patch).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...Object.values(patch).map((v) => normalize(v)), id);
  }
  async listInvitations(eventId: string) {
    return hydrateAll(this.db.prepare('SELECT * FROM invitations WHERE event_id = ? ORDER BY created_at DESC').all(eventId));
  }

  // ------------------------------------------------------------------ audit

  async addAudit(a: Row) { this.insert('audit_events', a); }
  async listAudit(eventId: string | null, opts: { limit?: number; offset?: number; action?: string }) {
    const where: string[] = [];
    const params: any[] = [];
    if (eventId) { where.push('a.event_id = ?'); params.push(eventId); }
    if (opts.action) { where.push('a.action = ?'); params.push(opts.action); }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit_events a ${clause}`).get(...params) as any).n;
    const rows = this.db.prepare(`
      SELECT a.*, u.display_name AS actor_name, u.username AS actor_username, e.name AS event_name
      FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN events e ON e.id = a.event_id
      ${clause} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`).all(...params, (opts.limit ?? 50), (opts.offset ?? 0));
    return { rows: hydrateAll(rows), total };
  }
  async countAudit(eventId: string): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM audit_events WHERE event_id = ?').get(eventId) as any).n;
  }

  // -------------------------------------------------------- public extras

  async addVote(projectId: string, userId: string, at: string) {
    this.db.prepare('INSERT OR IGNORE INTO project_votes(id, project_id, user_id, created_at) VALUES(?,?,?,?)')
      .run(`vot_${projectId.slice(-10)}_${userId.slice(-6)}`, projectId, userId, at);
  }
  async removeVote(projectId: string, userId: string) {
    this.db.prepare('DELETE FROM project_votes WHERE project_id = ? AND user_id = ?').run(projectId, userId);
  }
  async hasVoted(projectId: string, userId: string): Promise<boolean> {
    return Boolean(this.db.prepare('SELECT 1 FROM project_votes WHERE project_id = ? AND user_id = ?').get(projectId, userId));
  }
  async countVotes(projectId: string): Promise<number> {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM project_votes WHERE project_id = ?').get(projectId) as any).n;
  }
  async voteCounts(projectIds: string[]): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    if (!projectIds.length) return out;
    const placeholders = projectIds.map(() => '?').join(',');
    const rows = this.db.prepare(`SELECT project_id, COUNT(*) AS n FROM project_votes WHERE project_id IN (${placeholders}) GROUP BY project_id`).all(...projectIds) as any[];
    for (const r of rows) out[r.project_id] = r.n;
    return out;
  }
  async addComment(c: Row) { this.insert('project_comments', c); return hydrate(this.db.prepare('SELECT * FROM project_comments WHERE id = ?').get(c.id)); }
  async listComments(projectId: string, limit: number) {
    return hydrateAll(this.db.prepare(`
      SELECT c.*, u.display_name, u.username, u.avatar_seed FROM project_comments c
      JOIN users u ON u.id = c.user_id WHERE c.project_id = ? AND c.hidden = 0 ORDER BY c.created_at DESC LIMIT ?`)
      .all(projectId, limit));
  }
  async setCommentHidden(id: string, hidden: boolean) {
    this.db.prepare('UPDATE project_comments SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id);
  }

  async platformCounts() {
    const one = (sql: string) => (this.db.prepare(sql).get() as any).n;
    return {
      users: one('SELECT COUNT(*) AS n FROM users'),
      events: one("SELECT COUNT(*) AS n FROM events WHERE status != 'draft'"),
      projects: one("SELECT COUNT(*) AS n FROM projects WHERE status != 'draft'"),
      reviews: one("SELECT COUNT(*) AS n FROM reviews WHERE status = 'submitted'"),
    };
  }

  /** Escape hatch for maintenance tasks and the seed tooling. */
  raw() {
    return this.db;
  }
}

function normalize(v: unknown): any {
  if (v === undefined) return null;
  if (v === true) return 1;
  if (v === false) return 0;
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v as any;
}
