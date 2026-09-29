import { db } from '../db/index.js';
import { id, nowIso, slugify } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { cacheBump, cacheKey, cacheGet, cacheSet } from '../lib/cache.js';
import { randomAvatarSeed } from '../lib/crypto.js';
import { audit } from './audit.js';

export type EventMode = 'local' | 'global';
export type EventStatus = 'draft' | 'published' | 'live' | 'closed' | 'archived';

export interface EventInput {
  name: string;
  tagline?: string;
  description?: string;
  rulesMd?: string;
  organizerName?: string;
  contactEmail?: string;
  coverUrl?: string;
  coverStyle?: string;
  accentColor?: string;
  mode: EventMode;
  format: 'online' | 'offline' | 'hybrid';
  venue?: string;
  city?: string;
  country?: string;
  timezone?: string;
  prizePoolCents?: number;
  prizeCurrency?: string;
  prizeHeadline?: string;
  registrationOpensAt?: string | null;
  registrationClosesAt?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  submissionDeadline?: string | null;
  judgingStartsAt?: string | null;
  judgingEndsAt?: string | null;
  resultsReleaseAt?: string | null;
  minTeamSize?: number;
  maxTeamSize?: number;
  allowSolo?: boolean;
  allowCrossCollege?: boolean;
  eligibility?: string;
  judgingMode?: 'raw' | 'normalized';
  normalizeLambda?: number;
  resultsVisibility?: 'hidden' | 'public';
  showcaseVisibility?: 'hidden' | 'public';
  publicListing?: boolean;
  requireApproval?: boolean;
  submissionFields?: unknown[];
  judgingBlurb?: string;
  schedule?: unknown[];
  slug?: string;
}

async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const d = db();
  let slug = slugify(base, 'hackathon');
  let n = 1;
  for (;;) {
    const existing = await d.getEventBySlug(slug);
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${slugify(base, 'hackathon')}-${n}`;
    if (n > 60) return `${slugify(base, 'hackathon')}-${id('').slice(0, 6)}`;
  }
}

export async function createEvent(input: EventInput, ownerId: string): Promise<any> {
  const d = db();
  if (!input.name?.trim()) throw badRequest('Give the hackathon a name.', 'name_required', { field: 'name' });
  if (!input.mode || !['local', 'global'].includes(input.mode)) {
    throw badRequest('Choose whether this is a local or a global hackathon.', 'mode_required', { field: 'mode' });
  }
  if (!input.submissionDeadline) {
    throw badRequest('Set a submission deadline. Participants need to know when the clock stops.', 'deadline_required', { field: 'submission_deadline' });
  }
  if (input.startsAt && input.endsAt && new Date(input.endsAt) < new Date(input.startsAt)) {
    throw badRequest('The end date cannot be before the start date.', 'bad_dates', { field: 'ends_at' });
  }
  if (input.submissionDeadline && input.endsAt && new Date(input.submissionDeadline) > new Date(input.endsAt)) {
    throw badRequest('The submission deadline has to fall before the event ends.', 'bad_dates', { field: 'submission_deadline' });
  }
  const minSize = clampInt(input.minTeamSize, 1, 20, 1);
  const maxSize = clampInt(input.maxTeamSize, 1, 20, 4);
  if (minSize > maxSize) throw badRequest('The minimum team size cannot be larger than the maximum.', 'bad_team_sizes', { field: 'max_team_size' });

  const at = nowIso();
  const slug = await uniqueSlug(input.slug || input.name);
  const event = {
    id: id('evt'),
    slug,
    name: input.name.trim(),
    tagline: (input.tagline ?? '').trim(),
    description: (input.description ?? '').trim(),
    rules_md: input.rulesMd ?? '',
    organizer_name: (input.organizerName ?? '').trim(),
    contact_email: (input.contactEmail ?? '').trim(),
    cover_url: input.coverUrl ?? '',
    cover_style: input.coverStyle || 'auto',
    accent_color: input.accentColor || '',
    mode: input.mode,
    status: 'draft' as EventStatus,
    format: input.format ?? 'online',
    venue: (input.venue ?? '').trim(),
    city: (input.city ?? '').trim(),
    country: (input.country ?? '').trim(),
    timezone: input.timezone || 'UTC',
    prize_pool_cents: clampInt(input.prizePoolCents, 0, 1_000_000_00, 0),
    prize_currency: input.prizeCurrency || 'INR',
    prize_headline: (input.prizeHeadline ?? '').trim(),
    registration_opens_at: input.registrationOpensAt ?? null,
    registration_closes_at: input.registrationClosesAt ?? null,
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    submission_deadline: input.submissionDeadline,
    judging_starts_at: input.judgingStartsAt ?? null,
    judging_ends_at: input.judgingEndsAt ?? null,
    results_release_at: input.resultsReleaseAt ?? null,
    min_team_size: minSize,
    max_team_size: maxSize,
    allow_solo: input.allowSolo === false ? 0 : 1,
    allow_cross_college: input.allowCrossCollege === false ? 0 : 1,
    eligibility: (input.eligibility ?? '').trim(),
    judging_mode: input.judgingMode === 'normalized' ? 'normalized' : 'raw',
    normalize_lambda: typeof input.normalizeLambda === 'number' ? Math.min(1, Math.max(0, input.normalizeLambda)) : 0,
    results_visibility: input.resultsVisibility === 'public' ? 'public' : 'hidden',
    showcase_visibility: input.showcaseVisibility === 'public' ? 'public' : 'hidden',
    public_listing: input.publicListing === false ? 0 : 1,
    require_approval: input.requireApproval ? 1 : 0,
    submission_fields: JSON.stringify(normalizeFields(input.submissionFields)),
    judging_blurb: (input.judgingBlurb ?? '').trim(),
    schedule: JSON.stringify(Array.isArray(input.schedule) ? input.schedule : []),
    created_by: ownerId,
    created_at: at,
    updated_at: at,
    published_at: null,
  };
  const created = await d.createEvent(event);
  await audit({
    eventId: created.id,
    actorId: ownerId,
    action: 'event.created',
    entityType: 'event',
    entityId: created.id,
    summary: `Created ${created.name} (${created.mode} mode)`,
  });
  cacheBump('events');
  return created;
}

export const DEFAULT_SUBMISSION_FIELDS = [
  { key: 'repo_url', label: 'Source code repository', type: 'url', required: true, placeholder: 'https://github.com/you/project' },
  { key: 'demo_url', label: 'Working demo', type: 'url', required: false, placeholder: 'https://your-project.vercel.app' },
  { key: 'video_url', label: 'Demo video', type: 'url', required: false, placeholder: 'https://www.youtube.com/watch?v=...' },
  { key: 'docs_url', label: 'Documentation', type: 'url', required: false, placeholder: 'https://github.com/you/project#readme' },
  { key: 'tech_stack', label: 'Technologies used', type: 'tags', required: true, placeholder: 'React, Node, Postgres' },
  { key: 'problem', label: 'What problem does it solve?', type: 'textarea', required: true },
  { key: 'how_it_works', label: 'How does it work?', type: 'textarea', required: false },
  { key: 'tried', label: 'What did you try that did not work?', type: 'textarea', required: false },
];

function normalizeFields(fields: unknown[] | undefined): unknown[] {
  if (!Array.isArray(fields) || !fields.length) return DEFAULT_SUBMISSION_FIELDS;
  const out: any[] = [];
  for (const raw of fields.slice(0, 24)) {
    const f = raw as any;
    const key = slugify(String(f.key ?? f.label ?? ''), '').replace(/-/g, '_');
    if (!key || !/^[a-z][a-z0-9_]{0,39}$/.test(key)) continue;
    out.push({
      key,
      label: String(f.label ?? key).slice(0, 120),
      type: ['url', 'text', 'textarea', 'tags'].includes(f.type) ? f.type : 'text',
      required: Boolean(f.required),
      placeholder: String(f.placeholder ?? '').slice(0, 160),
      help: String(f.help ?? '').slice(0, 240),
    });
  }
  return out.length ? out : DEFAULT_SUBMISSION_FIELDS;
}

export async function updateEvent(eventId: string, patch: Record<string, unknown>, actorId: string): Promise<any> {
  const d = db();
  const current = await d.getEventById(eventId);
  if (!current) throw notFound('That hackathon no longer exists.');
  const merged: EventInput = {
    ...mapEventToInput(current),
    ...camelize(stripUndefined(patch)),
  };
  if (patch.name !== undefined && !String(patch.name).trim()) {
    throw badRequest('The hackathon needs a name.', 'name_required', { field: 'name' });
  }
  if (merged.submissionDeadline && merged.endsAt && new Date(merged.submissionDeadline) > new Date(merged.endsAt)) {
    throw badRequest('The submission deadline has to fall before the event ends.', 'bad_dates', { field: 'submission_deadline' });
  }
  const minSize = clampInt(merged.minTeamSize, 1, 20, 1);
  const maxSize = clampInt(merged.maxTeamSize, 1, 20, 4);
  if (minSize > maxSize) throw badRequest('The minimum team size cannot be larger than the maximum.', 'bad_team_sizes', { field: 'max_team_size' });

  const row: Record<string, unknown> = {
    name: merged.name.trim(),
    tagline: merged.tagline ?? '',
    description: merged.description ?? '',
    rules_md: merged.rulesMd ?? '',
    organizer_name: merged.organizerName ?? '',
    contact_email: merged.contactEmail ?? '',
    cover_url: merged.coverUrl ?? '',
    cover_style: merged.coverStyle ?? 'auto',
    accent_color: merged.accentColor ?? '',
    format: merged.format ?? 'online',
    venue: merged.venue ?? '',
    city: merged.city ?? '',
    country: merged.country ?? '',
    timezone: merged.timezone ?? 'UTC',
    prize_pool_cents: clampInt(merged.prizePoolCents, 0, 1_000_000_00, 0),
    prize_currency: merged.prizeCurrency ?? 'INR',
    prize_headline: merged.prizeHeadline ?? '',
    registration_opens_at: merged.registrationOpensAt ?? null,
    registration_closes_at: merged.registrationClosesAt ?? null,
    starts_at: merged.startsAt ?? null,
    ends_at: merged.endsAt ?? null,
    submission_deadline: merged.submissionDeadline ?? null,
    judging_starts_at: merged.judgingStartsAt ?? null,
    judging_ends_at: merged.judgingEndsAt ?? null,
    results_release_at: merged.resultsReleaseAt ?? null,
    min_team_size: minSize,
    max_team_size: maxSize,
    allow_solo: merged.allowSolo === false ? 0 : 1,
    allow_cross_college: merged.allowCrossCollege === false ? 0 : 1,
    eligibility: merged.eligibility ?? '',
    judging_mode: merged.judgingMode === 'normalized' ? 'normalized' : 'raw',
    normalize_lambda: typeof merged.normalizeLambda === 'number' ? Math.min(1, Math.max(0, merged.normalizeLambda)) : 0,
    results_visibility: merged.resultsVisibility ?? 'hidden',
    showcase_visibility: merged.showcaseVisibility ?? 'hidden',
    public_listing: merged.publicListing === false ? 0 : 1,
    require_approval: merged.requireApproval ? 1 : 0,
    submission_fields: JSON.stringify(normalizeFields(merged.submissionFields)),
    judging_blurb: merged.judgingBlurb ?? '',
    schedule: JSON.stringify(Array.isArray(merged.schedule) ? merged.schedule : []),
    updated_at: nowIso(),
  };
  const updated = await d.updateEvent(eventId, row);
  await audit({
    eventId,
    actorId,
    action: 'event.updated',
    entityType: 'event',
    entityId: eventId,
    summary: `Updated settings for ${updated.name}`,
    meta: { fields: Object.keys(row).filter((k) => !['updated_at'].includes(k)) },
  });
  cacheBump('events');
  return updated;
}

export async function publishEvent(eventId: string, actorId: string): Promise<any> {
  const d = db();
  const event = await d.getEventById(eventId);
  if (!event) throw notFound('That hackathon no longer exists.');
  const blockers = await preflight(event);
  if (blockers.length) {
    throw conflict(`Almost there — ${blockers[0]}`, 'not_ready_to_publish', { meta: { blockers } });
  }
  const at = nowIso();
  const updated = await d.updateEvent(eventId, { status: 'published', published_at: at, updated_at: at });
  await audit({
    eventId,
    actorId,
    action: 'event.published',
    entityType: 'event',
    entityId: eventId,
    summary: `Published ${event.name}`,
  });
  cacheBump('events');
  return updated;
}

export async function unpublishEvent(eventId: string, actorId: string): Promise<any> {
  const d = db();
  const event = await d.getEventById(eventId);
  if (!event) throw notFound('That hackathon no longer exists.');
  const updated = await d.updateEvent(eventId, { status: 'draft', published_at: null, updated_at: nowIso() });
  await audit({
    eventId,
    actorId,
    action: 'event.unpublished',
    entityType: 'event',
    entityId: eventId,
    summary: `Moved ${event.name} back to draft`,
  });
  cacheBump('events');
  return updated;
}

export async function archiveEvent(eventId: string, actorId: string): Promise<any> {
  const d = db();
  const updated = await d.updateEvent(eventId, { status: 'archived', public_listing: 0, updated_at: nowIso() });
  await audit({ eventId, actorId, action: 'event.archived', entityType: 'event', entityId: eventId, summary: 'Archived the hackathon' });
  cacheBump('events');
  return updated;
}

export async function advanceEventStatus(eventId: string, actorId: string): Promise<any> {
  const d = db();
  const event = await d.getEventById(eventId);
  if (!event) throw notFound('That hackathon no longer exists.');
  if (event.status === 'draft') return publishEvent(eventId, actorId);
  if (event.status === 'published') {
    if (!(await d.isOrganizer(eventId, actorId))) throw forbidden();
    const updated = await d.updateEvent(eventId, { status: 'live', updated_at: nowIso() });
    await audit({ eventId, actorId, action: 'event.live', entityType: 'event', entityId: eventId, summary: 'Hackathon is now live' });
    cacheBump('events');
    return updated;
  }
  if (event.status === 'live') {
    const updated = await d.updateEvent(eventId, { status: 'closed', updated_at: nowIso() });
    await audit({ eventId, actorId, action: 'event.closed', entityType: 'event', entityId: eventId, summary: 'Hackathon closed for submissions' });
    cacheBump('events');
    return updated;
  }
  if (event.status === 'closed') {
    const updated = await d.updateEvent(eventId, { status: 'archived', public_listing: 0, updated_at: nowIso() });
    await audit({ eventId, actorId, action: 'event.archived', entityType: 'event', entityId: eventId, summary: 'Archived the hackathon' });
    cacheBump('events');
    return updated;
  }
  throw conflict('This hackathon is already archived.', 'bad_transition');
}

export async function preflight(event: any): Promise<string[]> {
  const d = db();
  const blockers: string[] = [];
  if (!event.name?.trim()) blockers.push('add a name');
  if (!event.submission_deadline) blockers.push('set a submission deadline');
  if (!event.description || event.description.length < 40) blockers.push('write a description of at least 40 characters');
  const tracks = await d.listTracks(event.id);
  if (!tracks.length) blockers.push('add at least one track');
  const rubric = await d.getActiveRubric(event.id);
  if (!rubric) blockers.push('create a judging rubric');
  else {
    const criteria = await d.listCriteria(rubric.id);
    if (!criteria.length) blockers.push('add at least one rubric criterion');
    else {
      const weightSum = criteria.reduce((a, c) => a + (c.weight ?? 0), 0);
      if (Math.abs(weightSum - 100) > 0.01 && Math.abs(weightSum - 1) > 0.001) {
        blockers.push('make the rubric weights add up to 100');
      }
    }
  }
  if (!event.starts_at) blockers.push('set a start date');
  return blockers;
}

// ------------------------------------------------------------- access rules

export async function requireEvent(slugOrId: string): Promise<any> {
  const d = db();
  const bySlug = await d.getEventBySlug(slugOrId);
  if (bySlug) return bySlug;
  const byId = await d.getEventById(slugOrId);
  if (byId) return byId;
  throw notFound('We could not find that hackathon.');
}

export async function requireOrganizer(eventId: string, userId: string | undefined | null): Promise<any> {
  if (!userId) {
    const { unauthorized } = await import('../lib/errors.js');
    throw unauthorized('Sign in to manage a hackathon.');
  }
  const d = db();
  const event = await d.getEventById(eventId);
  if (!event) throw notFound('We could not find that hackathon.');
  if (!(await d.isOrganizer(eventId, userId))) {
    throw forbidden('Only the organizers of this hackathon can do that.');
  }
  return event;
}

/** A judge record for this user at this event, or null. */
export async function judgeFor(eventId: string, userId: string): Promise<any | null> {
  const d = db();
  const judges = await d.listEventJudges(eventId);
  return judges.find((j) => j.user_id === userId && j.status !== 'removed') ?? null;
}

// ---------------------------------------------------------- derived state

export interface EventState {
  phase: 'setup' | 'upcoming' | 'registration_open' | 'building' | 'submissions_closed' | 'judging' | 'results' | 'archived';
  registration: 'closed' | 'not_open' | 'open' | 'full';
  submissions: 'open' | 'closed' | 'not_started';
  judging: 'not_started' | 'open' | 'closed';
  results: 'hidden' | 'published';
  canRegister: boolean;
  canSubmit: boolean;
  canJudge: boolean;
  canViewProjects: boolean;
  headline: string;
  nextDeadline: { label: string; at: string } | null;
}

export function eventState(event: any, at = new Date()): EventState {
  const now = at.getTime();
  const t = (v: string | null | undefined) => (v ? new Date(v).getTime() : null);
  const regOpen = t(event.registration_opens_at);
  const regClose = t(event.registration_closes_at);
  const start = t(event.starts_at);
  const end = t(event.ends_at);
  const deadline = t(event.submission_deadline);
  const judgeStart = t(event.judging_starts_at);
  const judgeEnd = t(event.judging_ends_at);
  const resultsAt = t(event.results_release_at);

  const archived = event.status === 'archived' || event.status === 'draft';
  const isPublished = event.status !== 'draft' && event.status !== 'archived';

  let submissions: EventState['submissions'] = 'not_started';
  if (!deadline) submissions = 'not_started';
  else if (now <= deadline) submissions = 'open';
  else submissions = 'closed';

  let registration: EventState['registration'] = 'closed';
  if (regOpen && now < regOpen) registration = 'not_open';
  else if (regClose && now >= regClose) registration = 'closed';
  else if (regOpen || regClose || true) registration = 'open';
  if (!isPublished) registration = 'closed';
  if (regOpen && now < regOpen) registration = 'not_open';

  let judging: EventState['judging'] = 'not_started';
  if (judgeStart && now >= judgeStart) judging = now <= (judgeEnd ?? Number.MAX_SAFE_INTEGER) ? 'open' : 'closed';
  else if (!judgeStart && submissions === 'closed') judging = 'open';

  let results: EventState['results'] = 'hidden';
  if (event.results_visibility === 'public') {
    const hasPublished = now >= (resultsAt ?? (judgeEnd ?? deadline ?? end ?? 0));
    if (hasPublished) results = 'published';
  }

  let phase: EventState['phase'];
  if (archived) phase = 'archived';
  else if (start && now < start) phase = registration === 'open' ? 'registration_open' : 'upcoming';
  else if (end && now > end) phase = results === 'published' ? 'results' : 'judging';
  else if (submissions === 'closed') phase = 'judging';
  else phase = 'building';

  const candidates: [string, number | null][] = [
    ['Registration closes', regClose],
    ['Event starts', start],
    ['Submissions close', deadline],
    ['Judging ends', judgeEnd],
    ['Results published', resultsAt],
  ];
  let nextDeadline: { label: string; at: string } | null = null;
  for (const [label, when] of candidates) {
    if (when && when > now && (!nextDeadline || when < new Date(nextDeadline.at).getTime())) {
      nextDeadline = { label, at: new Date(when).toISOString() };
    }
  }

  const headlineMap: Record<EventState['phase'], string> = {
    setup: 'Being set up',
    upcoming: 'Registration is open',
    registration_open: 'Registration is open',
    building: 'Hacking in progress',
    submissions_closed: 'Submissions are closed',
    judging: 'Judging in progress',
    results: 'Results are out',
    archived: 'Finished',
  };

  return {
    phase,
    registration: isPublished ? registration : 'closed',
    submissions: isPublished ? submissions : 'closed',
    judging: isPublished ? judging : 'not_started',
    results,
    canRegister: isPublished && registration === 'open' && submissions !== 'closed',
    canSubmit: isPublished && submissions === 'open',
    canJudge: isPublished && (judging === 'open' || submissions === 'closed'),
    canViewProjects: isPublished,
    headline: headlineMap[phase],
    nextDeadline,
  };
}

/**
 * Server-side gate for every submission write. The UI mirrors this, but this is
 * the only thing that decides.
 */
export function assertSubmissionsOpen(event: any): void {
  if (event.status === 'draft') {
    throw conflict('This hackathon is not published yet, so nobody can submit yet.', 'event_draft');
  }
  if (event.status === 'archived') {
    throw conflict('This hackathon is archived. Submissions are closed permanently.', 'event_archived');
  }
  if (!event.submission_deadline) {
    throw conflict('The organizer has not set a submission deadline yet.', 'no_deadline');
  }
  if (new Date(event.submission_deadline).getTime() < Date.now()) {
    throw conflict(
      'Submissions closed for this hackathon. The deadline has passed, so new submissions and edits are refused by the server.',
      'submissions_closed',
      { meta: { deadline: event.submission_deadline } },
    );
  }
}

export function assertRegistrationOpen(event: any): void {
  const state = eventState(event);
  if (state.registration === 'not_open') {
    throw conflict('Registration has not opened yet for this hackathon.', 'registration_not_open', {
      meta: { opensAt: event.registration_opens_at },
    });
  }
  if (state.registration !== 'open') {
    throw conflict('Registration is closed for this hackathon.', 'registration_closed', {
      meta: { closesAt: event.registration_closes_at },
    });
  }
}

// -------------------------------------------------------------------- misc

export function mapEventToInput(e: any): EventInput {
  return {
    name: e.name,
    tagline: e.tagline,
    description: e.description,
    rulesMd: e.rules_md,
    organizerName: e.organizer_name,
    contactEmail: e.contact_email,
    coverUrl: e.cover_url,
    coverStyle: e.cover_style,
    accentColor: e.accent_color,
    mode: e.mode,
    format: e.format,
    venue: e.venue,
    city: e.city,
    country: e.country,
    timezone: e.timezone,
    prizePoolCents: e.prize_pool_cents,
    prizeCurrency: e.prize_currency,
    prizeHeadline: e.prize_headline,
    registrationOpensAt: e.registration_opens_at,
    registrationClosesAt: e.registration_closes_at,
    startsAt: e.starts_at,
    endsAt: e.ends_at,
    submissionDeadline: e.submission_deadline,
    judgingStartsAt: e.judging_starts_at,
    judgingEndsAt: e.judging_ends_at,
    resultsReleaseAt: e.results_release_at,
    minTeamSize: e.min_team_size,
    maxTeamSize: e.max_team_size,
    allowSolo: Boolean(e.allow_solo),
    allowCrossCollege: Boolean(e.allow_cross_college),
    eligibility: e.eligibility,
    judgingMode: e.judging_mode,
    normalizeLambda: e.normalize_lambda,
    resultsVisibility: e.results_visibility,
    showcaseVisibility: e.showcase_visibility,
    publicListing: Boolean(e.public_listing),
    requireApproval: Boolean(e.require_approval),
    submissionFields: e.submission_fields,
    judgingBlurb: e.judging_blurb,
    schedule: e.schedule,
    slug: e.slug,
  };
}

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Form bodies and API payloads arrive in snake_case. Route handlers and the
 * service agree on camelCase, so normalise once here rather than at forty call
 * sites. Unknown keys are dropped, so a request cannot set a column nobody meant
 * to expose.
 */
const SNAKE_TO_CAMEL: Record<string, keyof EventInput> = {
  tagline: 'tagline',
  rules_md: 'rulesMd',
  organizer_name: 'organizerName',
  contact_email: 'contactEmail',
  cover_url: 'coverUrl',
  cover_style: 'coverStyle',
  accent_color: 'accentColor',
  prize_pool_cents: 'prizePoolCents',
  prize_currency: 'prizeCurrency',
  prize_headline: 'prizeHeadline',
  registration_opens_at: 'registrationOpensAt',
  registration_closes_at: 'registrationClosesAt',
  starts_at: 'startsAt',
  ends_at: 'endsAt',
  submission_deadline: 'submissionDeadline',
  judging_starts_at: 'judgingStartsAt',
  judging_ends_at: 'judgingEndsAt',
  results_release_at: 'resultsReleaseAt',
  min_team_size: 'minTeamSize',
  max_team_size: 'maxTeamSize',
  allow_solo: 'allowSolo',
  allow_cross_college: 'allowCrossCollege',
  judging_mode: 'judgingMode',
  normalize_lambda: 'normalizeLambda',
  results_visibility: 'resultsVisibility',
  showcase_visibility: 'showcaseVisibility',
  public_listing: 'publicListing',
  require_approval: 'requireApproval',
  submission_fields: 'submissionFields',
  judging_blurb: 'judgingBlurb',
  schedule: 'schedule',
};

function camelize(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const target = SNAKE_TO_CAMEL[k];
    if (target) out[target] = v;
  }
  return out;
}

export function coverSeed(event: any): number {
  return randomAvatarSeed(event.slug || event.id || 'hackerly');
}

export function trackColor(index: number): string {
  const palette = ['#E24A1C', '#1F6F6B', '#3B4CCA', '#B8860B', '#7A3E9D', '#0F7A4A', '#C2410C', '#334155'];
  return palette[index % palette.length];
}

export async function listPublicEvents(opts: { q?: string; limit: number; offset: number; order?: string }) {
  const key = cacheKey('events', 'public', opts.q ?? '', opts.order ?? 'soon', opts.limit, opts.offset);
  const hit = cacheGet<{ rows: any[]; total: number }>(key);
  if (hit) return hit;
  const result = await db().listEvents({
    status: ['published', 'live', 'closed'],
    listing: true,
    q: opts.q,
    limit: opts.limit,
    offset: opts.offset,
    order: opts.order,
  });
  cacheSet(key, result);
  return result;
}
