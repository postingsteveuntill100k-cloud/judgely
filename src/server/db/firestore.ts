/**
 * Firestore driver — Global mode.
 *
 * Used when the deployment runs on Google Cloud (Firebase Hosting + Cloud
 * Functions) and DB_DRIVER=firestore. The canonical, offline-capable install is
 * SQLite; this driver exists so a public deployment is not a single-file local
 * application wearing a global hat.
 *
 * Documents mirror the SQL tables one-to-one. Relationships are ids, never
 * embedded blobs, and every list query is bounded and ordered so Firestore can
 * serve it from an index instead of scanning a collection.
 */
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { Driver, Page } from './driver.js';

type Doc = Record<string, any>;

interface FirestoreClient {
  db: {
    collection(name: string): Collection;
    batch(): any;
  };
}

interface Snapshot {
  id?: string;
  exists: boolean;
  data(): any;
}

interface Collection {
  doc(id?: string): { id: string; get(): Promise<Snapshot>; set(data: Doc, o?: Doc): Promise<any>; update(data: Doc): Promise<any>; delete(): Promise<any> };
  where(field: string, op: string, value: any): Query;
  orderBy(field: string, dir?: string): Query;
  limit(n: number): Query;
  offset(n: number): Query;
  get(): Promise<{ docs: { id: string; data(): any }[]; size: number }>;
  add(data: Doc): Promise<{ id: string }>;
  count(): Promise<{ data(): { count: number } }>;
}

interface Query extends Collection {}

const JSON_FIELDS = new Set(['submission_fields', 'schedule', 'tech_stack', 'answers', 'requirements', 'breakdown', 'meta']);
const BOOL_FIELDS = new Set(['allow_solo', 'allow_cross_college', 'public_listing', 'require_approval',
  'contact_visible', 'required', 'hidden', 'onboarded', 'disabled', 'email_verified', 'published_at_present']);

function hydrate(raw: Doc | null | undefined): any {
  if (!raw) return null;
  const out: Doc = { ...raw };
  for (const k of JSON_FIELDS) {
    if (typeof out[k] === 'string') {
      try { out[k] = JSON.parse(out[k]); } catch { out[k] = null; }
    }
  }
  for (const k of BOOL_FIELDS) if (k in out) out[k] = Boolean(out[k]);
  return out;
}
const hydrateAll = (rows: { id: string; data(): any }[]): any[] => rows.map((r) => ({ id: r.id, ...hydrate(r.data()) }));

export class FirestoreDriver implements Driver {
  readonly name = 'firestore' as const;
  private fs!: FirestoreClient;
  private cache: { db: FirestoreClient; expires: number } | null = null;

  async init(): Promise<void> {
    if (!config.firebase.configured) {
      throw new Error(
        'DB_DRIVER=firestore needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY.',
      );
    }
    await this.admin();
    await this.fs.db.collection('users').limit(1).get();
    log.info('firestore ready', { project: config.firebase.projectId });
  }

  private async admin(): Promise<FirestoreClient> {
    if (this.cache && Date.now() < this.cache.expires) return this.cache.db;
    const mod: any = await import('firebase-admin/app');
    const firestore: any = await import('firebase-admin/firestore');
    const app = mod.getApps().length
      ? mod.getApp()
      : mod.initializeApp(
          { credential: { projectId: config.firebase.projectId, clientEmail: config.firebase.clientEmail, privateKey: config.firebase.privateKey } },
          'hackerly',
        );
    firestore.setApp(app);
    const db = firestore.getFirestore(app);
    this.fs = { db } as FirestoreClient;
    this.cache = { db: this.fs, expires: Date.now() + 55 * 60_000 };
    return this.fs;
  }

  async close() { this.cache = null; }

  async health() {
    try {
      await this.admin();
      await this.fs.db.collection('users').limit(1).get();
      return { ok: true, driver: 'firestore', detail: 'connected' };
    } catch (e) {
      console.error('[Health] Firestore check failed:', e);
      return { ok: false, driver: 'firestore', detail: 'unreachable' };
    }
  }

  // ------------------------------------------------------------------ utils

  private col(name: string): Collection { return this.fs.db.collection(name); }
  private batch(): any { return (this.fs.db as any).batch(); }

  private async one(name: string, id: string): Promise<any> {
    if (!id) return null;
    const snap = await this.col(name).doc(id).get();
    return snap.exists ? { id: snap.id ?? id, ...hydrate(snap.data()) } : null;
  }

  private async put(name: string, doc: Doc): Promise<any> {
    await this.col(name).doc(doc.id).set(strip(doc));
    return doc;
  }

  private async patch(name: string, id: string, data: Doc): Promise<any> {
    if (!Object.keys(data).length) return this.one(name, id);
    await this.col(name).doc(id).update(strip(data));
    return this.one(name, id);
  }

  private async whereEq(name: string, field: string, value: any, limit = 200): Promise<any[]> {
    const snap = await this.col(name).where(field, '==', value).limit(limit).get();
    return hydrateAll(snap.docs);
  }

  private async whereIn(name: string, field: string, values: any[], limit = 500): Promise<any[]> {
    if (!values.length) return [];
    const out: any[] = [];
    for (let i = 0; i < values.length; i += 30) {
      const chunk = values.slice(i, i + 30);
      const snap = await this.col(name).where(field, 'in', chunk).limit(limit).get();
      out.push(...hydrateAll(snap.docs));
    }
    return out;
  }

  private async count(name: string, filters: [string, any][] = []): Promise<number> {
    try {
      let q: Query = this.col(name) as any;
      for (const [f, v] of filters) q = q.where(f, '==', v);
      const r = await q.count();
      return r.data().count;
    } catch {
      const rows = await this.listAll(name, filters, 5000);
      return rows.length;
    }
  }

  private async listAll(name: string, filters: [string, any][], limit = 1000): Promise<any[]> {
    let q: Query = this.col(name) as any;
    for (const [f, v] of filters) q = q.where(f, '==', v);
    const snap = await q.limit(limit).get();
    return hydrateAll(snap.docs);
  }

  private async pageOf<T>(name: string, filters: [string, any][], opts: { limit: number; offset: number; orderBy?: [string, string]; }): Promise<Page<T>> {
    let q: Query = this.col(name) as any;
    for (const [f, v] of filters) q = q.where(f, '==', v);
    if (opts.orderBy) q = q.orderBy(opts.orderBy[0], opts.orderBy[1] as any);
    const total = await this.count(name, filters);
    const snap = await q.offset(opts.offset).limit(opts.limit).get();
    return { items: hydrateAll(snap.docs) as T[], total, page: Math.floor((opts.offset ?? 0) / (opts.limit ?? 50)) + 1, perPage: opts.limit ?? 50, pages: Math.max(1, Math.ceil(total / (opts.limit ?? 50))) };
  }

  // ------------------------------------------------------------------ users

  async createUser(u: Doc) {
    await this.admin();
    const batch = this.batch();
    batch.set(this.col('users').doc(u.id), u);
    if (u.email_lower) {
      batch.set(this.col('idx_users_email_lower').doc(hashKey(u.email_lower)), { id: u.id }, { merge: true });
    }
    if (u.username_lower) {
      batch.set(this.col('idx_users_username_lower').doc(hashKey(u.username_lower)), { id: u.id }, { merge: true });
    }
    if (u.firebase_uid) {
      batch.set(this.col('idx_users_firebase_uid').doc(hashKey(u.firebase_uid)), { id: u.id }, { merge: true });
    }
    await batch.commit();
    return this.getUserById(u.id);
  }
  async getUserById(id: string) { return this.one('users', id); }
  async getUserByEmail(email: string) { return this.one('users', await this.idFor('users', 'email_lower', String(email).toLowerCase())); }
  async getUserByUsername(username: string) { return this.one('users', await this.idFor('users', 'username_lower', String(username).toLowerCase())); }
  async getUserByFirebaseUid(uid: string) { return this.one('users', await this.idFor('users', 'firebase_uid', uid)); }
  async updateUser(id: string, patch: Doc) {
    const prev = await this.getUserById(id);
    await this.admin();
    const batch = this.batch();
    batch.set(this.col('users').doc(id), patch, { merge: true });
    if (patch.email_lower && prev?.email_lower && patch.email_lower !== prev.email_lower) {
      batch.delete(this.col('idx_users_email_lower').doc(hashKey(prev.email_lower)));
      batch.set(this.col('idx_users_email_lower').doc(hashKey(patch.email_lower)), { id }, { merge: true });
    }
    if (patch.username_lower && prev?.username_lower && patch.username_lower !== prev.username_lower) {
      batch.delete(this.col('idx_users_username_lower').doc(hashKey(prev.username_lower)));
      batch.set(this.col('idx_users_username_lower').doc(hashKey(patch.username_lower)), { id }, { merge: true });
    }
    await batch.commit();
    return this.getUserById(id);
  }
  async countUsers() { return this.count('users'); }
  async listUsers(limit = 50, offset = 0) {
    const p = await this.pageOf<any>('users', [], { limit, offset, orderBy: ['created_at', 'desc'] });
    return p.items;
  }
  /** Id-index side collections, so lookups never depend on a collection scan. */
  private async idFor(coll: string, field: string, value: any): Promise<string> {
    const snap = await this.col(`idx_${coll}_${field}`).doc(hashKey(value)).get();
    return snap.exists ? snap.data().id : '';
  }
  private async index(coll: string, field: string, value: any, id: string): Promise<void> {
    await this.col(`idx_${coll}_${field}`).doc(hashKey(value)).set({ id }, { merge: true });
  }
  private async unindex(coll: string, field: string, value: any): Promise<void> {
    await this.col(`idx_${coll}_${field}`).doc(hashKey(value)).delete();
  }

  // --------------------------------------------------------------- sessions

  async createSession(s: Doc) {
    await this.admin();
    const batch = this.batch();
    batch.set(this.col('sessions').doc(s.id), s);
    batch.set(this.col('idx_sessions_token_hash').doc(hashKey(s.token_hash)), { id: s.id }, { merge: true });
    await batch.commit();
  }
  async getSessionByTokenHash(h: string) { return this.one('sessions', await this.idFor('sessions', 'token_hash', h)); }
  async touchSession(id: string, seenAt: string) { await this.patch('sessions', id, { last_seen_at: seenAt }); }
  async deleteSession(id: string) {
    const s = await this.one('sessions', id);
    await this.admin();
    const batch = this.batch();
    if (s && s.token_hash) {
      batch.delete(this.col('idx_sessions_token_hash').doc(hashKey(s.token_hash)));
    }
    batch.delete(this.col('sessions').doc(id));
    await batch.commit();
  }
  async deleteSessionsForUser(userId: string) {
    const rows = await this.whereEq('sessions', 'user_id', userId);
    await Promise.all(rows.map((r) => this.deleteSession(r.id)));
  }
  async purgeExpiredSessions(beforeIso: string) {
    const snap = await (this.col('sessions') as any).where('expires_at', '<', beforeIso).get();
    if (snap.empty) return 0;
    await this.admin();
    const batch = this.batch();
    for (const doc of snap.docs) {
      const data = doc.data();
      if (data?.token_hash) {
        batch.delete(this.col('idx_sessions_token_hash').doc(hashKey(data.token_hash)));
      }
      batch.delete(doc.ref);
    }
    await batch.commit();
    return snap.size;
  }
  async listSessions(userId: string) { return this.whereEq('sessions', 'user_id', userId); }

  async recordLoginAttempt(a: Doc) { await this.put('login_attempts', a); }
  async countRecentLoginFailures(identifier: string, sinceIso: string) {
    try {
      const r = await (this.col('login_attempts') as any)
        .where('identifier', '==', identifier)
        .where('ok', '==', 0)
        .where('created_at', '>=', sinceIso)
        .count();
      return r.data().count;
    } catch {
      const snap = await (this.col('login_attempts') as any)
        .where('identifier', '==', identifier)
        .where('ok', '==', 0)
        .where('created_at', '>=', sinceIso)
        .get();
      return snap.size;
    }
  }

  // ----------------------------------------------------------------- events

  async createEvent(e: Doc) {
    await this.admin();
    const batch = this.batch();
    batch.set(this.col('events').doc(e.id), e);
    batch.set(this.col('idx_events_slug').doc(hashKey(e.slug)), { id: e.id }, { merge: true });
    const oid = `${e.id}__${e.created_by}`;
    batch.set(this.col('event_organizers').doc(oid), { id: oid, event_id: e.id, user_id: e.created_by, role: 'owner', created_at: e.created_at });
    const mid = `${e.id}__${e.created_by}__organizer`;
    batch.set(this.col('event_members').doc(mid), { id: mid, event_id: e.id, user_id: e.created_by, role: 'organizer', status: 'active', registered_at: e.created_at });
    await batch.commit();
    return this.one('events', e.id);
  }
  async updateEvent(id: string, patch: Doc) { return this.patch('events', id, patch); }
  async getEventById(id: string) { return this.one('events', id); }
  async getEventBySlug(slug: string) { return this.one('events', await this.idFor('events', 'slug', slug)); }

  async listEvents(opts: { status?: string[]; listing?: boolean; q?: string; limit: number; offset: number; order?: string }) {
    const filters: [string, any][] = [];
    if (opts.status?.length) {
      let q: Query = this.col('events') as any;
      q = q.where('status', 'in', opts.status.slice(0, 10));
      let rows = hydrateAll((await q.limit(300).get()).docs);
      if (opts.q) { const l = opts.q.toLowerCase(); rows = rows.filter((r: Doc) => `${r.name} ${r.tagline}`.toLowerCase().includes(l)); }
      rows = sortEvents(rows, opts.order);
      const lim0 = opts.limit ?? 50; const off0 = opts.offset ?? 0; return { rows: rows.slice(off0, off0 + lim0), total: rows.length };
    }
    if (opts.listing) filters.push(['public_listing', true]);
    const all = await this.listAll('events', filters, 500);
    let rows = all as Doc[];
    if (opts.q) { const l = opts.q.toLowerCase(); rows = rows.filter((r) => `${r.name} ${r.tagline} ${r.description}`.toLowerCase().includes(l)); }
    rows = sortEvents(rows, opts.order);
    const lim0 = opts.limit ?? 50; const off0 = opts.offset ?? 0; return { rows: rows.slice(off0, off0 + lim0), total: rows.length };
  }
  async countEventsByStatus() {
    const rows = await this.listAll('events', [], 1000);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
    return out;
  }
  async addOrganizer(eventId: string, userId: string, role: string, at: string) {
    const oid = `${eventId}__${userId}`;
    await this.put('event_organizers', { id: oid, event_id: eventId, user_id: userId, role, created_at: at });
    await this.addMember(eventId, userId, 'organizer', at);
  }
  async removeOrganizer(eventId: string, userId: string) {
    await this.col('event_organizers').doc(`${eventId}__${userId}`).delete();
    await this.removeMember(eventId, userId, 'organizer');
  }
  async listOrganizers(eventId: string) {
    const rows = await this.whereEq('event_organizers', 'event_id', eventId);
    const users = await this.whereIn('users', 'id', rows.map((r) => r.user_id));
    return users.map((u) => ({ ...u, organizer_role: rows.find((r) => r.user_id === u.id)?.role ?? 'cohost' }));
  }
  async isOrganizer(eventId: string, userId: string): Promise<boolean> {
    const snap = await this.col('event_organizers').doc(`${eventId}__${userId}`).get();
    return snap.exists;
  }
  async getEventOrganizer(eventId: string, userId: string) {
    return this.one('event_organizers', `${eventId}__${userId}`);
  }
  async listEventsForOrganizer(userId: string, limit = 50, offset = 0) {
    const links = await this.whereEq('event_organizers', 'user_id', userId);
    const events = await this.whereIn('events', 'id', links.map((l) => l.event_id));
    const rows = events
      .map((e) => ({ ...e, organizer_role: links.find((l) => l.event_id === e.id)?.role ?? 'cohost' }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    return { rows: rows.slice(offset, offset + limit), total: rows.length };
  }

  async addMember(eventId: string, userId: string, role: string, at: string) {
    await this.put('event_members', { id: `${eventId}__${userId}__${role}`, event_id: eventId, user_id: userId, role, status: 'active', registered_at: at });
  }
  async removeMember(eventId: string, userId: string, role: string) {
    await this.col('event_members').doc(`${eventId}__${userId}__${role}`).delete();
  }
  async getMembership(eventId: string, userId: string, role?: string) {
    if (role) return this.one('event_members', `${eventId}__${userId}__${role}`);
    const rows = await this.whereEq('event_members', 'user_id', userId);
    return rows.find((r) => r.event_id === eventId && r.status === 'active') ?? null;
  }
  async listEventMembers(eventId: string, role?: string) {
    let rows = await this.whereEq('event_members', 'event_id', eventId);
    if (role) rows = rows.filter((r: Doc) => r.role === role);
    return rows.sort((a: Doc, b: Doc) => String(a.registered_at).localeCompare(String(b.registered_at)));
  }
  async listMemberEvents(userId: string, role?: string) {
    let rows = await this.whereEq('event_members', 'user_id', userId);
    if (role) rows = rows.filter((r) => r.role === role);
    rows = rows.filter((r) => r.status === 'active');
    const events = await this.whereIn('events', 'id', rows.map((r) => r.event_id));
    return events
      .map((e) => ({ ...e, member_role: rows.find((r) => r.event_id === e.id)?.role ?? 'participant', registered_at: rows.find((r) => r.event_id === e.id)?.registered_at }))
      .sort((a, b) => String(b.starts_at ?? b.created_at).localeCompare(String(a.starts_at ?? a.created_at)));
  }

  async createAnnouncement(a: Doc) { await this.put('announcements', a); return this.one('announcements', a.id); }
  async listAnnouncements(eventId: string, limit: number) { return (await this.whereEq('announcements', 'event_id', eventId)).slice(0, limit); }
  async deleteAnnouncement(id: string) { await this.col('announcements').doc(id).delete(); }

  // ------------------------------------------------------------------ tracks

  async createTrack(t: Doc) { await this.put('tracks', t); return this.one('tracks', t.id); }
  async updateTrack(id: string, patch: Doc) { return this.patch('tracks', id, patch); }
  async getTrack(id: string) { return this.one('tracks', id); }
  async getTrackBySlug(eventId: string, slug: string) {
    const rows = await this.whereEq('tracks', 'event_id', eventId);
    return rows.find((t: Doc) => t.slug === slug) ?? null;
  }
  async deleteTrack(id: string) {
    const t = await this.one('tracks', id);
    if (t) await this.unindex('tracks', 'event_id_slug', `${t.event_id}:${t.slug}`);
    await this.col('tracks').doc(id).delete();
  }
  async listTracks(eventId: string) {
    return (await this.whereEq('tracks', 'event_id', eventId)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  // ------------------------------------------------------------------- teams

  async createTeam(t: Doc) {
    await this.put('teams', t);
    await this.addTeamMember(t.id, t.created_by, 'owner', t.created_at);
    return this.one('teams', t.id);
  }
  async updateTeam(id: string, patch: Doc) { return this.patch('teams', id, patch); }
  async getTeam(id: string) { return this.one('teams', id); }
  async getTeamBySlug(eventId: string, slug: string) {
    const rows = await this.whereEq('teams', 'event_id', eventId);
    return rows.find((t: Doc) => t.slug === slug) ?? null;
  }
  async deleteTeam(id: string) {
    const members = await this.whereEq('team_members', 'team_id', id);
    const projects = await this.whereEq('projects', 'team_id', id);
    const projectIds = projects.map((p: Doc) => p.id);

    let assignments: Doc[] = [];
    let reviews: Doc[] = [];
    let votes: Doc[] = [];
    let comments: Doc[] = [];

    if (projectIds.length > 0) {
      assignments = await this.whereIn('judge_assignments', 'project_id', projectIds);
      reviews = await this.whereIn('reviews', 'project_id', projectIds);
      votes = await this.whereIn('project_votes', 'project_id', projectIds);
      comments = await this.whereIn('project_comments', 'project_id', projectIds);
    }

    const reviewIds = reviews.map((r: Doc) => r.id);
    let scores: Doc[] = [];
    if (reviewIds.length > 0) {
      scores = await this.whereIn('review_scores', 'review_id', reviewIds);
    }

    await this.admin();
    const batch = this.batch();
    for (const m of members) batch.delete(this.col('team_members').doc(m.id));
    for (const p of projects) batch.delete(this.col('projects').doc(p.id));
    for (const a of assignments) batch.delete(this.col('judge_assignments').doc(a.id));
    for (const r of reviews) batch.delete(this.col('reviews').doc(r.id));
    for (const s of scores) batch.delete(this.col('review_scores').doc(s.id));
    for (const v of votes) batch.delete(this.col('project_votes').doc(v.id));
    for (const c of comments) batch.delete(this.col('project_comments').doc(c.id));
    batch.delete(this.col('teams').doc(id));
    await batch.commit();
  }
  async listTeams(eventId: string, opts: { q?: string; limit?: number; offset?: number }) {
    let rows = await this.whereEq('teams', 'event_id', eventId);
    if (opts.q) { const l = opts.q.toLowerCase(); rows = rows.filter((r: Doc) => `${r.name} ${r.description}`.toLowerCase().includes(l)); }
    rows = rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const lim0 = opts.limit ?? 50; const off0 = opts.offset ?? 0; return { rows: rows.slice(off0, off0 + lim0), total: rows.length };
  }
  async listTeamsForUser(userId: string) {
    const links = await this.whereEq('team_members', 'user_id', userId);
    const teams = await this.whereIn('teams', 'id', links.map((l) => l.team_id));
    const events = await this.whereIn('events', 'id', teams.map((t: Doc) => t.event_id));
    return teams.map((t) => ({
      ...t,
      event_name: events.find((e) => e.id === t.event_id)?.name,
      event_slug: events.find((e) => e.id === t.event_id)?.slug,
      my_team_role: links.find((l) => l.team_id === t.id)?.role,
    }));
  }
  async addTeamMember(teamId: string, userId: string, role: string, at: string) {
    await this.put('team_members', { id: `${teamId}__${userId}`, team_id: teamId, user_id: userId, role, joined_at: at });
  }
  async removeTeamMember(teamId: string, userId: string) { await this.col('team_members').doc(`${teamId}__${userId}`).delete(); }
  async getTeamMember(teamId: string, userId: string) { return this.one('team_members', `${teamId}__${userId}`); }
  async listTeamMembers(teamId: string) {
    const links = await this.whereEq('team_members', 'team_id', teamId);
    const users = await this.whereIn('users', 'id', links.map((l) => l.user_id));
    return users
      .map((u) => ({ ...u, team_role: links.find((l) => l.user_id === u.id)?.role, joined_at: links.find((l) => l.user_id === u.id)?.joined_at }))
      .sort((a, b) => (a.team_role === 'owner' ? -1 : b.team_role === 'owner' ? 1 : 0));
  }
  async countTeamMembers(teamId: string): Promise<number> {
    return (await this.whereEq('team_members', 'team_id', teamId)).length;
  }

  // ---------------------------------------------------------------- projects

  async createProject(p: Doc) { await this.put('projects', p); return this.one('projects', p.id); }
  async updateProject(id: string, patch: Doc) { return this.patch('projects', id, patch); }
  async getProject(id: string) { return this.one('projects', id); }
  async getProjectBySlug(eventId: string, slug: string) {
    const rows = await this.whereEq('projects', 'event_id', eventId);
    return rows.find((p: Doc) => p.slug === slug) ?? null;
  }
  async listProjects(opts: { eventId?: string; trackId?: string; teamId?: string; status?: string[]; q?: string; publicOnly?: boolean; sort?: string; limit?: number; offset?: number }) {
    let rows: any[] = opts.eventId ? await this.whereEq('projects', 'event_id', opts.eventId) : await this.listAll('projects', [], 2000);
    if (opts.trackId) rows = rows.filter((r) => r.track_id === opts.trackId);
    if (opts.teamId) rows = rows.filter((r) => r.team_id === opts.teamId);
    if (opts.status?.length) rows = rows.filter((r) => opts.status!.includes(r.status));
    if (opts.publicOnly) rows = rows.filter((r) => ['submitted', 'under_review', 'results_released'].includes(r.status));
    if (opts.q) { const l = opts.q.toLowerCase(); rows = rows.filter((r) => `${r.title} ${r.summary} ${r.tagline}`.toLowerCase().includes(l)); }
    const teams = await this.whereIn('teams', 'id', [...new Set(rows.map((r) => r.team_id))]);
    rows = rows.map((r) => {
      const t = teams.find((x) => x.id === r.team_id);
      return { ...r, team_name: t?.name, team_slug: t?.slug, team_avatar_seed: t?.avatar_seed, team_size: undefined };
    });
    rows.sort((a, b) => String(b.submitted_at ?? b.created_at).localeCompare(String(a.submitted_at ?? a.created_at)));
    const lim0 = opts.limit ?? 50; const off0 = opts.offset ?? 0; return { rows: rows.slice(off0, off0 + lim0), total: rows.length };
  }
  async listProjectsForTeam(teamId: string) {
    const rows = await this.whereEq('projects', 'team_id', teamId);
    const trackIds = [...new Set(rows.map((r) => r.track_id).filter(Boolean))];
    const tracks = trackIds.length ? await this.whereIn('tracks', 'id', trackIds) : [];
    const team = await this.one('teams', teamId);
    return rows.map((r) => {
      const tr = tracks.find((t) => t.id === r.track_id);
      return {
        ...r,
        track_name: tr?.name, track_slug: tr?.slug, track_prize: tr?.prize_text,
        team_name: team?.name, team_slug: team?.slug, team_avatar_seed: team?.avatar_seed,
      };
    });
  }
  async countProjectsByStatus(eventId: string) {
    const rows = await this.whereEq('projects', 'event_id', eventId);
    const out: Record<string, number> = { draft: 0, submitted: 0, under_review: 0, results_released: 0 };
    for (const r of rows) if (out[r.status] !== undefined) out[r.status] += 1;
    return out;
  }

  // ----------------------------------------------------------------- rubrics

  async createRubric(r: Doc) { await this.put('rubrics', r); return r.id; }
  async getActiveRubric(eventId: string) {
    const rows = (await this.whereEq('rubrics', 'event_id', eventId)).filter((r: Doc) => r.status === 'active');
    return rows.sort((a, b) => b.version - a.version)[0] ?? null;
  }
  async getRubric(id: string) { return this.one('rubrics', id); }
  async listRubrics(eventId: string) {
    return (await this.whereEq('rubrics', 'event_id', eventId)).sort((a, b) => b.version - a.version);
  }
  async createCriterion(c: Doc) { await this.put('rubric_criteria', c); return this.one('rubric_criteria', c.id); }
  async updateCriterion(id: string, patch: Doc) { return this.patch('rubric_criteria', id, patch); }
  async deleteCriterion(id: string) { await this.col('rubric_criteria').doc(id).delete(); }
  async getCriterion(id: string) { return this.one('rubric_criteria', id); }
  async listCriteria(rubricId: string) {
    return (await this.whereEq('rubric_criteria', 'rubric_id', rubricId)).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }
  async archiveRubric(id: string) { await this.patch('rubrics', id, { status: 'archived' }); }

  // ------------------------------------------------------------------ judges

  async createEventJudge(j: Doc) {
    await this.put('event_judges', j);
    await this.index('event_judges', 'event_email', `${j.event_id}:${j.email_lower}`, j.id);
    return this.one('event_judges', j.id);
  }
  async getEventJudge(id: string) { return this.one('event_judges', id); }
  async getEventJudgeByEmail(eventId: string, email: string) {
    const id = await this.idFor('event_judges', 'event_email', `${eventId}:${String(email).toLowerCase()}`);
    return id ? this.one('event_judges', id) : null;
  }
  async getEventJudgeForUser(eventId: string, userId: string) {
    const rows = await this.whereEq('event_judges', 'event_id', eventId);
    return rows.find((r: Doc) => r.user_id === userId) ?? null;
  }
  async updateEventJudge(id: string, patch: Doc) { return this.patch('event_judges', id, patch); }
  async listEventJudges(eventId: string, opts: { status?: string } = {}) {
    let rows = await this.whereEq('event_judges', 'event_id', eventId);
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    const users = await this.whereIn('users', 'id', rows.map((r) => r.user_id).filter(Boolean));
    return rows.map((r) => {
      const u = users.find((x) => x.id === r.user_id);
      return { ...r, display_name: u?.display_name, username: u?.username, avatar_url: u?.avatar_url, avatar_seed: u?.avatar_seed };
    });
  }
  async listJudgeEvents(userId: string) {
    const rows = (await this.whereEq('event_judges', 'user_id', userId)).filter((r) => r.status === 'active');
    const events = await this.whereIn('events', 'id', rows.map((r) => r.event_id));
    return events.map((e) => {
      const row = rows.find((r) => r.event_id === e.id) ?? {};
      // The event id wins on `id`; the judge row is exposed as `judge_id`.
      return { ...row, ...e, id: e.id, judge_id: row.id, event_id: e.id };
    });
  }

  // ------------------------------------------------------------- assignments

  async createAssignment(a: Doc) { await this.put('judge_assignments', a); return this.one('judge_assignments', a.id); }
  async updateAssignment(id: string, patch: Doc) { return this.patch('judge_assignments', id, patch); }
  async getAssignment(id: string) { return this.one('judge_assignments', id); }
  async deleteAssignment(id: string) { await this.col('judge_assignments').doc(id).delete(); }
  async listAssignments(opts: { eventId?: string; judgeId?: string; projectId?: string; status?: string[]; limit: number; offset: number }) {
    let rows: any[] = opts.eventId
      ? await this.whereEq('judge_assignments', 'event_id', opts.eventId)
      : opts.judgeId
        ? await this.whereEq('judge_assignments', 'event_judge_id', opts.judgeId)
        : opts.projectId
          ? await this.whereEq('judge_assignments', 'project_id', opts.projectId)
          : await this.listAll('judge_assignments', [], 3000);
    if (opts.judgeId) rows = rows.filter((r) => r.event_judge_id === opts.judgeId);
    if (opts.projectId) rows = rows.filter((r) => r.project_id === opts.projectId);
    if (opts.status?.length) rows = rows.filter((r) => opts.status!.includes(r.status));
    const projects = await this.whereIn('projects', 'id', [...new Set(rows.map((r) => r.project_id))]);
    rows = rows.map((r) => ({ ...r, project_title: projects.find((p) => p.id === r.project_id)?.title }));
    const lim0 = opts.limit ?? 50; const off0 = opts.offset ?? 0; return { rows: rows.slice(off0, off0 + lim0), total: rows.length };
  }
  async countAssignmentsByStatus(eventId: string) {
    const rows = await this.whereEq('judge_assignments', 'event_id', eventId);
    const out: Record<string, number> = { pending: 0, in_progress: 0, submitted: 0, reopened: 0 };
    for (const r of rows) if (out[r.status] !== undefined) out[r.status] += 1;
    return out;
  }
  async listAssignmentProjectIds(judgeId: string) {
    return (await this.whereEq('judge_assignments', 'event_judge_id', judgeId)).map((r) => r.project_id);
  }

  // ----------------------------------------------------------------- reviews

  async createReview(r: Doc) { await this.put('reviews', r); return this.one('reviews', r.id); }
  async updateReview(id: string, patch: Doc) { return this.patch('reviews', id, patch); }
  async getReview(id: string) { return this.one('reviews', id); }
  async getReviewByAssignment(assignmentId: string) {
    const rows = await this.whereEq('reviews', 'assignment_id', assignmentId);
    return rows[0] ?? null;
  }
  async listReviews(opts: { eventId?: string; judgeId?: string; userId?: string; projectId?: string; status?: string; limit?: number; offset?: number }) {
    let rows = opts.eventId ? await this.whereEq('reviews', 'event_id', opts.eventId) : await this.listAll('reviews', [], 3000);
    if (opts.judgeId) rows = rows.filter((r) => r.event_judge_id === opts.judgeId);
    if (opts.userId) rows = rows.filter((r) => r.user_id === opts.userId);
    if (opts.projectId) rows = rows.filter((r) => r.project_id === opts.projectId);
    if (opts.status) rows = rows.filter((r) => r.status === opts.status);
    rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const lim = opts.limit ?? 5000;
    return rows.slice(opts.offset ?? 0, (opts.offset ?? 0) + lim);
  }
  async countReviews(eventId: string) {
    const rows = await this.whereEq('reviews', 'event_id', eventId);
    return { total: rows.length, submitted: rows.filter((r) => r.status === 'submitted').length };
  }
  async upsertScore(s: Doc) {
    const id = `${s.review_id}__${s.criterion_id}`;
    await this.col('review_scores').doc(id).set({ id, review_id: s.review_id, criterion_id: s.criterion_id, score: s.score, note: s.note ?? '' }, { merge: true });
  }
  async replaceReviewScores(reviewId: string, scores: Array<{ criterion_id: string; score: number; note?: string }>) {
    const existing = await this.whereEq('review_scores', 'review_id', reviewId);
    await this.admin();
    const batch = this.batch();
    for (const s of existing) {
      batch.delete(this.col('review_scores').doc(s.id));
    }
    for (const s of scores) {
      const id = `${reviewId}__${s.criterion_id}`;
      batch.set(this.col('review_scores').doc(id), {
        id,
        review_id: reviewId,
        criterion_id: s.criterion_id,
        score: s.score,
        note: s.note ?? '',
      });
    }
    await batch.commit();
  }
  async listScores(reviewId: string) {
    const rows = await this.whereEq('review_scores', 'review_id', reviewId);
    return rows.sort((a, b) => String(a.criterion_id).localeCompare(String(b.criterion_id)));
  }
  async listScoresForProject(projectId: string) {
    const reviews = await this.whereEq('reviews', 'project_id', projectId);
    const scores = await this.whereIn('review_scores', 'review_id', reviews.map((r) => r.id));
    return scores.map((s) => ({ ...s, user_id: reviews.find((r) => r.id === s.review_id)?.user_id, event_judge_id: reviews.find((r) => r.id === s.review_id)?.event_judge_id }));
  }
  async listAllScoresForEvent(eventId: string) {
    const reviews = await this.whereEq('reviews', 'event_id', eventId);
    return this.whereIn('review_scores', 'review_id', reviews.map((r) => r.id));
  }

  // ----------------------------------------------------------------- results

  async replaceResults(eventId: string, rows: Doc[], computedAt: string) {
    const old = await this.whereEq('results', 'event_id', eventId);
    await this.admin();
    const batch = this.batch();
    for (const r of old) {
      batch.delete(this.col('results').doc(r.id));
    }
    for (const r of rows) {
      const id = r.id ?? `${eventId}__${r.project_id}`;
      batch.set(this.col('results').doc(id), strip({ ...r, id, event_id: eventId, computed_at: computedAt }));
    }
    await batch.commit();
  }
  async listResults(eventId: string, publishedOnly: boolean) {
    let rows = await this.whereEq('results', 'event_id', eventId);
    if (publishedOnly) rows = rows.filter((r) => r.published_at);
    return rows.sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));
  }
  async getResultForProject(eventId: string, projectId: string) { return this.one('results', `${eventId}__${projectId}`); }
  async publishResults(eventId: string, at: string) {
    const rows = await this.whereEq('results', 'event_id', eventId);
    if (!rows.length) return;
    await this.admin();
    const batch = this.batch();
    for (const r of rows) {
      batch.update(this.col('results').doc(r.id), { published_at: at });
    }
    await batch.commit();
  }
  async unpublishResults(eventId: string) {
    const rows = await this.whereEq('results', 'event_id', eventId);
    if (!rows.length) return;
    await this.admin();
    const batch = this.batch();
    for (const r of rows) {
      batch.update(this.col('results').doc(r.id), { published_at: null });
    }
    await batch.commit();
  }
  async addResultPrizes(eventId: string, rows: Doc[]) {
    const old = await this.whereEq('result_prizes', 'event_id', eventId);
    await this.admin();
    const batch = this.batch();
    for (const r of old) {
      batch.delete(this.col('result_prizes').doc(r.id));
    }
    for (const r of rows) {
      const id = r.id ?? this.col('result_prizes').doc().id;
      batch.set(this.col('result_prizes').doc(id), strip({ ...r, id, event_id: eventId }));
    }
    await batch.commit();
  }
  async listResultPrizes(eventId: string) { return this.whereEq('result_prizes', 'event_id', eventId); }

  // ----------------------------------------------------------- notifications

  async createNotification(n: Doc) { await this.put('notifications', n); }
  async createNotifications(notifications: Doc[]) {
    if (!notifications.length) return;
    const chunkSize = 400;
    for (let i = 0; i < notifications.length; i += chunkSize) {
      const chunk = notifications.slice(i, i + chunkSize);
      await this.admin();
      const batch = this.batch();
      for (const n of chunk) {
        batch.set(this.col('notifications').doc(n.id), strip(n));
      }
      await batch.commit();
    }
  }
  async listNotifications(userId: string, limit: number) {
    return (await this.whereEq('notifications', 'user_id', userId)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  }
  async countUnread(userId: string): Promise<number> {
    return (await this.whereEq('notifications', 'user_id', userId)).filter((n) => !n.read_at).length;
  }
  async markAllRead(userId: string, at: string) {
    const rows = await this.whereEq('notifications', 'user_id', userId);
    await Promise.all(rows.filter((r) => !r.read_at).map((r) => this.col('notifications').doc(r.id).update({ read_at: at })));
  }

  // ------------------------------------------------------------ invitations

  async createInvitation(i: Doc) { await this.put('invitations', i); await this.index('invitations', 'token', i.token, i.id); return this.one('invitations', i.id); }
  async getInvitationByToken(token: string) { return this.one('invitations', await this.idFor('invitations', 'token', token)); }
  async updateInvitation(id: string, patch: Doc) { await this.patch('invitations', id, patch); }
  async listInvitations(eventId: string) {
    return (await this.whereEq('invitations', 'event_id', eventId)).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  }

  // ------------------------------------------------------------------ audit

  async addAudit(a: Doc) { await this.put('audit_events', a); }
  async listAudit(eventId: string | null, opts: { limit?: number; offset?: number; action?: string }) {
    let rows = eventId ? await this.whereEq('audit_events', 'event_id', eventId) : await this.listAll('audit_events', [], 2000);
    if (opts.action) rows = rows.filter((r) => r.action === opts.action);
    rows.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const lim0 = opts.limit ?? 50; const off0 = opts.offset ?? 0; return { rows: rows.slice(off0, off0 + lim0), total: rows.length };
  }
  async countAudit(eventId: string): Promise<number> {
    return (await this.whereEq('audit_events', 'event_id', eventId)).length;
  }

  // ------------------------------------------------------------ public extras

  async addVote(projectId: string, userId: string, at: string) {
    await this.put('project_votes', { id: `${projectId}__${userId}`, project_id: projectId, user_id: userId, created_at: at });
  }
  async removeVote(projectId: string, userId: string) { await this.col('project_votes').doc(`${projectId}__${userId}`).delete(); }
  async hasVoted(projectId: string, userId: string) { return Boolean(await this.one('project_votes', `${projectId}__${userId}`)); }
  async countVotes(projectId: string): Promise<number> { return (await this.whereEq('project_votes', 'project_id', projectId)).length; }
  async voteCounts(projectIds: string[]): Promise<Record<string, number>> {
    const rows = await this.whereIn('project_votes', 'project_id', projectIds);
    const out: Record<string, number> = {};
    for (const r of rows) out[r.project_id] = (out[r.project_id] ?? 0) + 1;
    return out;
  }
  async addComment(c: Doc) { await this.put('project_comments', c); return this.one('project_comments', c.id); }
  async listComments(projectId: string, limit: number) {
    return (await this.whereEq('project_comments', 'project_id', projectId)).filter((c) => !c.hidden).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, limit);
  }
  async setCommentHidden(id: string, hidden: boolean) { await this.patch('project_comments', id, { hidden }); }

  async platformCounts() {
    return {
      users: await this.count('users'),
      events: (await this.listAll('events', [], 1000)).filter((e) => e.status !== 'draft').length,
      projects: (await this.listAll('projects', [], 2000)).filter((p) => p.status !== 'draft').length,
      reviews: (await this.listAll('reviews', [], 3000)).filter((r) => r.status === 'submitted').length,
    };
  }
}

function strip(doc: Doc): Doc {
  const out: Doc = {};
  for (const [k, v] of Object.entries(doc)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

function hashKey(value: any): string {
  const s = String(value);
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `k${Math.abs(h)}_${s.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)}_${s.length}`;
}

function sortEvents(rows: Doc[], order?: string): Doc[] {
  const key = (r: Doc) => (order === 'prize' ? r.prize_pool_cents ?? 0 : String(r.starts_at ?? r.created_at ?? ''));
  if (order === 'prize') return rows.sort((a, b) => (b.prize_pool_cents ?? 0) - (a.prize_pool_cents ?? 0));
  if (order === 'ending') return rows.sort((a, b) => String(a.ends_at ?? a.starts_at ?? '9999').localeCompare(String(b.ends_at ?? b.starts_at ?? '9999')));
  return rows.sort((a, b) => String(key(b)).localeCompare(String(key(a))));
}
