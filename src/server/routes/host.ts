import { wrapRouter } from './safe.js';
import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { page, intParam, strParam, navFor } from './helpers.js';
import { requireAuth, ipOf } from '../middleware/session.js';
import { limitWrite, limitInvite } from '../middleware/guards.js';
import {
  createEvent, updateEvent, requireEvent, requireOrganizer, preflight, publishEvent,
  unpublishEvent, archiveEvent, advanceEventStatus, eventState, mapEventToInput,
} from '../services/events.js';
import { registerParticipant, createTeam, updateTeam, deleteTeam, requireTeamAccess } from '../services/teams.js';
import { createRubric, addCriterion, updateCriterion, removeCriterion, activeRubric, RUBRIC_PRESET, validateWeights, progressFor } from '../services/judging.js';
import { inviteJudge, removeJudge, resendInvitation, parseBulkEmails } from '../services/invites.js';
import { computeResults, publishResults, withdrawResults, explainMethod } from '../services/results.js';
import { audit, AUDIT_LABELS } from '../services/audit.js';
import { suggestNext } from '../services/nextAction.js';
import { notifyTeam, fanoutAnnouncement } from '../services/notify.js';
import { isoDate, optionalIsoDate, parse, text, intIn, boolish } from '../lib/validate.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { id, nowIso, slugify } from '../lib/ids.js';
import { safeUrl, renderRichText } from '../lib/format.js';
import { csvDocument } from '../lib/csv.js';
import { limits } from '../lib/ratelimit.js';

type Ctx = { req: Request; res: Response; event: any };

export function hostRoutes(): Router {
  const r = Router();
  r.use(requireAuth);

  /** Load the event and prove the caller organizes it. Every host route goes through this. */
  r.param('slug', async (req, _res, next, slug) => {
    try {
      const event = await requireEvent(slug);
      await requireOrganizer(event.id, req.actor!.id);
      (req as any).hostEvent = event;
      next();
    } catch (e) {
      next(e);
    }
  });

  // Every host page gets the navigation, its active section and real counts.
  r.use(async (req: Request, _res: Response, next: NextFunction) => {
    const event = (req as any).hostEvent;
    if (!event) return next();
    try {
      (req as any).hostCounts = await hostCounts(db(), event.id);
      (req as any).hostNav = hostNavFor(req.path, event.slug);
    } catch {
      (req as any).hostCounts = {};
      (req as any).hostNav = 'overview';
    }
    next();
  });

  const withEvent = (fn: (ctx: Ctx) => Promise<void>) => async (req: Request, res: Response, next: NextFunction) => {
    try {
      await fn({ req, res, event: (req as any).hostEvent });
    } catch (e) {
      next(e);
    }
  };

  // ------------------------------------------------------------- overview --
  r.get('/events', withEvent(async ({ req, res }) => {
    const d = db();
    const { rows, total } = await d.listEventsForOrganizer(req.actor!.id, 100, 0);
    await page(res, 'host/events', req, {
      pageTitle: 'Your hackathons',
      events: rows.map((e) => ({ ...e, state: eventState(e) })),
      total,
    }, 200, 'host');
  }));

  r.get('/start', withEvent(async ({ req, res }) => {
    await page(res, 'host/start', req, { pageTitle: 'How hosting works' }, 200, 'host');
  }));

  r.get('/events/new', withEvent(async ({ req, res }) => {
    await page(res, 'host/new', req, { pageTitle: 'Host a hackathon' }, 200, 'host');
  }));

  r.post('/events/new', limitWrite, withEvent(async ({ req, res }) => {
    const body = req.body as Record<string, string>;
    const mode = body.mode === 'local' ? 'local' : body.mode === 'global' ? 'global' : 'global';
    const name = String(body.name ?? '').trim();
    if (!name) {
      await page(res, 'host/new', req, {
        pageTitle: 'Host a hackathon',
        error: 'Please enter a name for your hackathon.',
        values: body,
      }, 400, 'host');
      return;
    }
    const now = new Date();
    const event = await createEvent(
      {
        name,
        tagline: String(body.tagline ?? '').trim(),
        mode,
        format: mode === 'local' ? 'offline' : 'online',
        timezone: 'UTC',
        organizerName: req.actor!.displayName,
        contactEmail: req.actor!.email,
        startsAt: new Date(now.getTime() + 86400_000).toISOString(),
        submissionDeadline: new Date(now.getTime() + 14 * 86400_000).toISOString(),
        endsAt: new Date(now.getTime() + 15 * 86400_000).toISOString(),
        registrationOpensAt: now.toISOString(),
        registrationClosesAt: new Date(now.getTime() + 13 * 86400_000).toISOString(),
        judgingEndsAt: new Date(now.getTime() + 16 * 86400_000).toISOString(),
        resultsReleaseAt: new Date(now.getTime() + 17 * 86400_000).toISOString(),
        judgingMode: 'raw',
        minTeamSize: 1,
        maxTeamSize: 4,
        allowSolo: true,
        showcaseVisibility: mode === 'global' ? 'public' : 'hidden',
        resultsVisibility: 'hidden',
        publicListing: mode === 'global',
      },
      req.actor!.id,
    );
    res.redirect(303, `/host/events/${event.slug}/setup/basics`);
  }));

  r.get('/events/:slug', withEvent(async ({ req, res, event }) => {
    const d = db();
    const [progress, projectCounts, teams, judges, announcements, auditCount, blockers] = await Promise.all([
      progressFor(event),
      d.countProjectsByStatus(event.id),
      d.listTeams(event.id, { limit: 5, offset: 0 }),
      d.listEventJudges(event.id),
      d.listAnnouncements(event.id, 5),
      d.countAudit(event.id),
      preflight(event),
    ]);
    const state = eventState(event);
    const nextAction = await suggestNext({ event, state, progress, blockers, projectCounts });
    await page(res, 'host/overview', req, {
      pageTitle: event.name,
      event, state, progress, projectCounts, teams: teams.rows, teamCount: teams.total,
      judges, announcements, auditCount, blockers, nextAction,
      rulesHtml: renderRichText(event.rules_md),
    }, 200, 'host');
  }));

  // --------------------------------------------------------------- wizard --
  const wizardSteps = [
    { key: 'basics', label: 'Basics' },
    { key: 'dates', label: 'Dates' },
    { key: 'prizes', label: 'Prizes & eligibility' },
    { key: 'teams', label: 'Teams' },
    { key: 'tracks', label: 'Tracks' },
    { key: 'submission', label: 'Submission' },
    { key: 'judging', label: 'Judging' },
    { key: 'rules', label: 'Rules & schedule' },
    { key: 'branding', label: 'Branding' },
    { key: 'publish', label: 'Review & publish' },
  ];
  r.get('/events/:slug/setup', withEvent(async ({ req, res, event }) => {
    res.redirect(303, `/host/events/${event.slug}/setup/basics`);
  }));
  r.get('/events/:slug/setup/:step', withEvent(async ({ req, res, event }) => {
    const step = String(req.params.step);
    if (!wizardSteps.some((s) => s.key === step)) throw notFound('That setup step does not exist.');
    const d = db();
    const index = wizardSteps.findIndex((s) => s.key === step);
    const data: any = {
      pageTitle: `Set up ${event.name}`,
      event,
      state: eventState(event),
      steps: wizardSteps,
      step,
      stepIndex: index,
      stepCount: wizardSteps.length,
      input: mapEventToInput(event),
      blockers: await preflight(event),
      isNew: event.status === 'draft',
    };
    if (step === 'tracks') {
      data.tracks = await d.listTracks(event.id);
    }
    if (step === 'judging') {
      const { rubric, criteria } = await activeRubric(event.id);
      data.rubric = rubric;
      data.criteria = criteria;
      data.preset = RUBRIC_PRESET;
      data.weightProblems = criteria.length ? validateWeights(criteria) : [];
      data.progress = await progressFor(event);
    }
    if (step === 'publish') {
      data.tracks = await d.listTracks(event.id);
      const { criteria } = await activeRubric(event.id);
      data.criteria = criteria;
    }
    if (step === 'submission') {
      data.fields = Array.isArray(event.submission_fields) ? event.submission_fields : [];
    }
    if (step === 'rules') {
      data.milestones = Array.isArray(event.schedule) ? event.schedule : [];
      data.rulesHtml = renderRichText(event.rules_md);
    }
    await page(res, `host/setup-${step}`, req, data, 200, 'host');
  }));

  r.post('/events/:slug/setup/:step', limitWrite, withEvent(async ({ req, res, event }) => {
    const step = String(req.params.step);
    const body = req.body as Record<string, any>;
    const nextKey = wizardSteps[Math.min(wizardSteps.length - 1, wizardSteps.findIndex((s) => s.key === step) + 1)]?.key ?? 'publish';

    if (step === 'basics') {
      const data = parse(
        z.object({
          name: text(90, 'The hackathon name', 3),
          tagline: text(160, 'The tagline', 0),
          description: text(4000, 'The description', 40),
          organizer_name: text(80, 'The organizer name', 2),
          contact_email: z.string().trim().toLowerCase().refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v), 'Enter a valid email address.'),
        }),
        body,
      );
      await updateEvent(event.id, data, req.actor!.id);
    } else if (step === 'dates') {
      const data = parse(
        z.object({
          registration_opens_at: optionalIsoDate,
          registration_closes_at: optionalIsoDate,
          starts_at: optionalIsoDate,
          ends_at: optionalIsoDate,
          submission_deadline: optionalIsoDate,
          judging_starts_at: optionalIsoDate,
          judging_ends_at: optionalIsoDate,
          results_release_at: optionalIsoDate,
        }),
        body,
      );
      if (!data.submission_deadline) throw badRequest('A submission deadline is required. Participants need to know when the clock stops.', 'deadline_required', { field: 'submission_deadline' });
      await updateEvent(event.id, data, req.actor!.id);
    } else if (step === 'prizes') {
      const data = parse(
        z.object({
          prize_pool_cents: intIn(0, 1_000_000_00),
          prize_currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY']),
          prize_headline: text(60, 'The prize headline', 0),
          eligibility: text(2000, 'The eligibility text', 0),
        }),
        body,
      );
      await updateEvent(event.id, data, req.actor!.id);
    } else if (step === 'teams') {
      const data = parse(
        z.object({
          min_team_size: intIn(1, 20),
          max_team_size: intIn(1, 20),
          allow_solo: boolish,
          allow_cross_college: boolish,
        }),
        body,
      );
      if (data.min_team_size > data.max_team_size) {
        throw badRequest('The minimum team size cannot be larger than the maximum.', 'bad_team_sizes', { field: 'max_team_size' });
      }
      await updateEvent(event.id, data, req.actor!.id);
    } else if (step === 'submission') {
      const fields = buildFields(body);
      await updateEvent(event.id, { submissionFields: fields, judgingBlurb: String(body.judging_blurb ?? '').slice(0, 400) }, req.actor!.id);
    } else if (step === 'rules') {
      const milestones = buildMilestones(body);
      await updateEvent(event.id, { rulesMd: String(body.rules_md ?? '').slice(0, 20000), schedule: milestones }, req.actor!.id);
    } else if (step === 'branding') {
      const data = parse(
        z.object({
          cover_url: z.string().transform((v) => safeUrl(v)),
          cover_style: z.enum(['auto', 'grid', 'arcs', 'strata', 'orbit', 'bars', 'mesh']),
          accent_color: z.string().refine((v) => !v || /^#[0-9a-fA-F]{6}$/.test(v), 'Pick a colour from the list.'),
          format: z.enum(['online', 'offline', 'hybrid']),
          venue: text(120, 'The venue', 0),
          city: text(60, 'The city', 0),
          country: text(60, 'The country', 0),
        }),
        body,
      );
      await updateEvent(event.id, data, req.actor!.id);
    }

    const back = String(body._action ?? '');
    if (back === 'publish') return void res.redirect(303, `/host/events/${event.slug}/setup/publish`);
    if (back === 'save') return void res.redirect(303, `/host/events/${event.slug}/setup/${step}?saved=1`);
    res.redirect(303, `/host/events/${event.slug}/setup/${nextKey}`);
  }));

  r.post('/events/:slug/judging-mode', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, string>;
    const mode = body.judging_mode === 'normalized' ? 'normalized' : 'raw';
    const lambda = Number(body.normalize_lambda);
    await updateEvent(event.id, {
      judgingMode: mode,
      normalizeLambda: Number.isFinite(lambda) ? Math.min(1, Math.max(0, lambda)) : event.normalize_lambda,
    }, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/setup/judging?saved=method`);
  }));

  r.post('/events/:slug/judging-dates', limitWrite, withEvent(async ({ req, res, event }) => {
    const data = parse(
      z.object({ judging_starts_at: optionalIsoDate, judging_ends_at: optionalIsoDate }),
      req.body,
    );
    await updateEvent(event.id, data, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/setup/judging?saved=dates`);
  }));

  // ---------------------------------------------------------------- setup --
  r.post('/events/:slug/publish', limitWrite, withEvent(async ({ req, res, event }) => {
    await publishEvent(event.id, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}?published=1`);
  }));
  r.post('/events/:slug/unpublish', limitWrite, withEvent(async ({ req, res, event }) => {
    await unpublishEvent(event.id, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}`);
  }));
  r.post('/events/:slug/status', limitWrite, withEvent(async ({ req, res, event }) => {
    await advanceEventStatus(event.id, req.actor!.id);
    res.redirect(303, req.get('referer')?.includes('/host/') ? req.get('referer')! : `/host/events/${event.slug}`);
  }));
  r.post('/events/:slug/archive', limitWrite, withEvent(async ({ req, res, event }) => {
    await archiveEvent(event.id, req.actor!.id);
    res.redirect(303, `/host/events`);
  }));

  r.post('/events/:slug/tracks', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, string>;
    const name = String(body.name ?? '').trim();
    if (name.length < 2) throw badRequest('Give the track a name of at least 2 characters.', 'bad_track_name', { field: 'name' });
    const d = db();
    const existing = await d.listTracks(event.id);
    const slug = slugify(name, `track-${existing.length + 1}`);
    if (existing.some((t) => t.slug === slug)) throw conflict('A track with that name already exists.', 'duplicate_track');
    const track = await d.createTrack({
      id: id('trk'),
      event_id: event.id,
      slug,
      name,
      description: String(body.description ?? '').slice(0, 600),
      eligibility: String(body.eligibility ?? '').slice(0, 400),
      prize_text: String(body.prize_text ?? '').slice(0, 200),
      brief: String(body.brief ?? '').slice(0, 2000),
      requirements: JSON.stringify(buildTrackRequirements(body)),
      max_teams: body.max_teams ? intInSafe(body.max_teams) : null,
      sort_order: existing.length,
      created_at: nowIso(),
    });
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'track.created', entityType: 'track', entityId: track.id, summary: `Added track ${track.name}` });
    res.redirect(303, `/host/events/${event.slug}/setup/tracks?saved=${encodeURIComponent(track.name)}`);
  }));

  r.post('/events/:slug/tracks/:trackId/delete', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const track = await d.getTrack(req.params.trackId);
    if (!track || track.event_id !== event.id) throw notFound('That track no longer exists.');
    const used = await d.listProjects({ eventId: event.id, trackId: track.id, limit: 1, offset: 0 });
    if (used.total > 0) {
      throw conflict(`${used.total} ${used.total === 1 ? 'project uses' : 'projects use'} this track, so it cannot be deleted.`, 'track_in_use');
    }
    await d.deleteTrack(track.id);
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'track.deleted', entityType: 'track', entityId: track.id, summary: `Deleted track ${track.name}` });
    res.redirect(303, `/host/events/${event.slug}/setup/tracks`);
  }));

  // --------------------------------------------------------------- rubric --
  r.post('/events/:slug/rubric', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, any>;
    const criteria = parseCriteriaBody(body);
    await createRubric(event, criteria, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/setup/judging?saved=rubric`);
  }));

  r.post('/events/:slug/rubric/criteria', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, any>;
    const { rubric } = await activeRubric(event.id);
    if (!rubric) throw conflict('Create a rubric first, then add criteria to it.', 'no_rubric');
    await addCriterion(event, rubric, {
      name: String(body.name ?? ''),
      description: String(body.description ?? ''),
      weight: Number(body.weight ?? 0),
      maxScore: Number(body.max_score ?? 10),
      required: body.required !== undefined,
    }, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/setup/judging`);
  }));

  r.post('/events/:slug/rubric/criteria/:criterionId', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, any>;
    await updateCriterion(event, req.params.criterionId, {
      name: String(body.name ?? ''),
      description: String(body.description ?? ''),
      weight: Number(body.weight ?? 0),
      maxScore: Number(body.max_score ?? 10),
      required: body.required !== undefined,
    }, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/setup/judging?saved=criterion`);
  }));

  r.post('/events/:slug/rubric/criteria/:criterionId/delete', limitWrite, withEvent(async ({ req, res, event }) => {
    await removeCriterion(event, req.params.criterionId, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/setup/judging`);
  }));

  // --------------------------------------------------------------- teams --
  r.get('/events/:slug/teams', withEvent(async ({ req, res, event }) => {
    const d = db();
    const q = strParam(req.query.q, 60);
    const pageNo = intParam(req.query.page, 1);
    const perPage = 25;
    const { rows, total } = await d.listTeams(event.id, { q, limit: 500, offset: 0 });
    const teams: any[] = [];
    for (const t of rows) teams.push({ ...t, members: await d.listTeamMembers(t.id) });
    await page(res, 'host/teams', req, {
      pageTitle: `Teams — ${event.name}`,
      event, state: eventState(event), teams: teams.slice((pageNo - 1) * perPage, pageNo * perPage),
      total, page: pageNo, pages: Math.max(1, Math.ceil(total / perPage)), q,
    }, 200, 'host');
  }));

  r.post('/events/:slug/teams', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, string>;
    const team = await createTeam(event, req.actor!, { name: body.name ?? '', description: body.description ?? '' });
    res.redirect(303, `/host/events/${event.slug}/teams?saved=${encodeURIComponent(team.name)}`);
  }));

  r.post('/events/:slug/teams/:teamId', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, string>;
    const team = await db().getTeam(req.params.teamId);
    if (!team || team.event_id !== event.id) throw notFound('That team no longer exists.');
    if (String(body.action) === 'delete') {
      await deleteTeam(event, team, req.actor!.id);
      return void res.redirect(303, `/host/events/${event.slug}/teams`);
    }
    await updateTeam(event, team, req.actor!.id, { name: body.name, description: body.description });
    res.redirect(303, `/host/events/${event.slug}/teams?saved=${encodeURIComponent(team.name)}`);
  }));

  r.post('/events/:slug/teams/:teamId/remove-member', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const team = await d.getTeam(req.params.teamId);
    if (!team || team.event_id !== event.id) throw notFound('That team no longer exists.');
    const { team: t } = await requireTeamAccess(event, team.id, req.actor!.id);
    void t;
    const target = String((req.body as any).user_id ?? '');
    const member = await d.getTeamMember(team.id, target);
    if (!member) throw notFound('That person is not on this team.');
    if (member.role === 'owner') throw conflict('The team owner cannot be removed.', 'owner_cannot_leave');
    await d.removeTeamMember(team.id, target);
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'team.member_removed', entityType: 'team', entityId: team.id, summary: 'Removed a team member' });
    res.redirect(303, `/host/events/${event.slug}/teams?saved=member-removed`);
  }));

  // ------------------------------------------------------------- projects --
  r.get('/events/:slug/projects', withEvent(async ({ req, res, event }) => {
    const d = db();
    const status = strParam(req.query.status, 20);
    const q = strParam(req.query.q, 60);
    const pageNo = intParam(req.query.page, 1);
    const perPage = 25;
    const result = await d.listProjects({
      eventId: event.id,
      q,
      status: status ? [status] : undefined,
      limit: 500,
      offset: 0,
    });
    const rows: any[] = [];
    for (const p of result.rows) {
      rows.push({ ...p, members: await d.listTeamMembers(p.team_id), team: await d.getTeam(p.team_id) });
    }
    const counts = await d.countProjectsByStatus(event.id);
    await page(res, 'host/projects', req, {
      pageTitle: `Projects — ${event.name}`,
      event, state: eventState(event), projects: rows.slice((pageNo - 1) * perPage, pageNo * perPage),
      total: result.total, page: pageNo, pages: Math.max(1, Math.ceil(result.total / perPage)),
      counts, filters: { status, q },
      tracks: await d.listTracks(event.id),
    }, 200, 'host');
  }));

  // --------------------------------------------------------------- judges --
  r.get('/events/:slug/judges', withEvent(async ({ req, res, event }) => {
    const d = db();
    const judges = await d.listEventJudges(event.id);
    const invitations = await d.listInvitations(event.id);
    const progress = await progressFor(event);
    const submitted = (await d.listResults(event.id, false)).length;
    void submitted;
    await page(res, 'host/judges', req, {
      pageTitle: `Judges — ${event.name}`,
      event, state: eventState(event), judges, invitations, progress,
      mailMode: (await import('../config.js')).config.mail.mode,
      saved: strParam(req.query.saved, 60),
    }, 200, 'host');
  }));

  r.post('/events/:slug/judges/invite', limitInvite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, string>;
    const raw = String(body.email ?? '').trim();
    const bulk = String(body.bulk ?? '').trim();
    const emails = bulk ? await parseBulkEmails(bulk) : [raw];
    const results: any[] = [];
    for (const email of emails) {
      const out = await inviteJudge(event, { id: req.actor!.id, displayName: req.actor!.displayName }, { email, message: body.message });
      results.push(out);
    }
    res.redirect(303, `/host/events/${event.slug}/judges?invited=${results.length}`);
  }));

  r.post('/events/:slug/judges/:judgeId/remove', limitWrite, withEvent(async ({ req, res, event }) => {
    await removeJudge(event, req.params.judgeId, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/judges`);
  }));

  r.post('/events/:slug/judges/:judgeId/resend', limitInvite, withEvent(async ({ req, res, event }) => {
    await resendInvitation(event, req.params.judgeId, { id: req.actor!.id, displayName: req.actor!.displayName });
    res.redirect(303, `/host/events/${event.slug}/judges?resent=1`);
  }));

  // ---------------------------------------------------------- assignments --
  r.get('/events/:slug/assignments', withEvent(async ({ req, res, event }) => {
    const d = db();
    const judges = await d.listEventJudges(event.id);
    const projects = (await d.listProjects({ eventId: event.id, status: ['submitted', 'under_review', 'results_released'], limit: 1000, offset: 0 })).rows;
    const { rows } = await d.listAssignments({ eventId: event.id, limit: 5000, offset: 0 });
    const matrix: Record<string, Set<string>> = {};
    for (const a of rows) {
      matrix[a.project_id] = matrix[a.project_id] ?? new Set();
      matrix[a.project_id].add(a.event_judge_id);
    }
    const live = judges.filter((j) => j.status !== 'removed');
    await page(res, 'host/assignments', req, {
      pageTitle: `Assignments — ${event.name}`,
      event, state: eventState(event),
      // Only an accepted judge can be assigned work, so only accepted judges
      // are offered here. Pending invitations are shown as a follow-up, not as
      // a checkbox that would silently do nothing.
      judges: live.filter((j) => j.status === 'active'),
      pendingJudges: live.filter((j) => j.status !== 'active'),
      projects, rows, matrix,
      perJudgeCount: judges.reduce<Record<string, number>>((acc, j) => {
        acc[j.id] = rows.filter((a) => a.event_judge_id === j.id).length;
        return acc;
      }, {}),
    }, 200, 'host');
  }));

  r.post('/events/:slug/assignments', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, any>;
    const d = db();
    const strategy = String(body.strategy ?? 'all');
    const judges = await d.listEventJudges(event.id);
    const activeJudges = judges.filter((j) => j.status === 'active');
    if (!activeJudges.length) {
      throw conflict('Invite judges and wait for at least one to accept before assigning projects.', 'no_active_judges');
    }
    const projects = (await d.listProjects({ eventId: event.id, status: ['submitted', 'under_review'], limit: 1000, offset: 0 })).rows;
    if (!projects.length) throw conflict('There are no submitted projects to assign yet.', 'no_projects');

    const explicitJudgeIds = new Set(toArray(body.judge_ids));
    const explicitProjectIds = new Set(toArray(body.project_ids));
    const targets = explicitProjectIds.size ? projects.filter((p) => explicitProjectIds.has(p.id)) : projects;

    let created = 0;
    if (strategy === 'round_robin') {
      // One judge per project, dealt round-robin so the load is even.
      let i = 0;
      for (const p of targets) {
        const judge = activeJudges[i % activeJudges.length];
        i += 1;
        created += await assignOne(d, event, judge.id, p.id, req.actor!.id);
      }
    } else {
      const judgeList = explicitJudgeIds.size ? activeJudges.filter((j) => explicitJudgeIds.has(j.id)) : activeJudges;
      if (!judgeList.length) throw badRequest('Select at least one active judge.', 'no_judges_selected');
      for (const judge of judgeList) {
        for (const p of targets) created += await assignOne(d, event, judge.id, p.id, req.actor!.id);
      }
    }
    await audit({
      eventId: event.id, actorId: req.actor!.id, action: 'assignment.bulk_created',
      entityType: 'event', entityId: event.id, summary: `Created ${created} assignments`,
      meta: { strategy, projects: targets.length },
    });
    res.redirect(303, `/host/events/${event.slug}/assignments?created=${created}`);
  }));

  r.post('/events/:slug/assignments/:assignmentId/delete', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const a = await d.getAssignment(req.params.assignmentId);
    if (!a || a.event_id !== event.id) throw notFound('That assignment no longer exists.');
    if (a.status === 'submitted') throw conflict('That review is already submitted. Reopen it from the judging page first.', 'review_submitted');
    const project = await d.getProject(a.project_id);
    const judge = await d.getEventJudge(a.event_judge_id);
    await d.deleteAssignment(a.id);
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'assignment.deleted', entityType: 'assignment', entityId: a.id, summary: `Removed ${judge?.email ?? 'judge'} from ${project?.title ?? a.project_id}` });
    res.redirect(303, req.get('referer')?.includes('/host/') ? req.get('referer')! : `/host/events/${event.slug}/assignments`);
  }));

  r.post('/events/:slug/auto-assign', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const allJudges = await d.listEventJudges(event.id);
    const active = allJudges.filter((j) => j.status === 'active');
    if (!active.length) throw conflict('No judge has accepted an invitation yet.', 'no_active_judges');
    const projects = (await d.listProjects({ eventId: event.id, status: ['submitted', 'under_review'], limit: 1000, offset: 0 })).rows;
    const { rows: existing } = await d.listAssignments({ eventId: event.id, limit: 5000, offset: 0 });
    const load = new Map(active.map((j) => [j.id, existing.filter((a) => a.event_judge_id === j.id).length]));
    const covered = new Set(existing.map((a) => a.project_id));
    let created = 0;
    for (const p of projects) {
      if (covered.has(p.id)) continue;
      // Give it to whoever has the lightest load, so an organizer with 3 judges
      // and 40 projects does not hand everything to the first one.
      const judge = [...load.entries()].sort((a, b) => a[1] - b[1])[0][0];
      created += await assignOne(d, event, judge, p.id, req.actor!.id);
      load.set(judge, (load.get(judge) ?? 0) + 1);
    }
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'assignment.bulk_created', entityType: 'event', entityId: event.id, summary: `Balanced assignment created ${created} rows` });
    res.redirect(303, `/host/events/${event.slug}/assignments?created=${created}`);
  }));

  // -------------------------------------------------------------- judging --
  r.get('/events/:slug/judging', withEvent(async ({ req, res, event }) => {
    const d = db();
    const progress = await progressFor(event);
    const { rows: assignments } = await d.listAssignments({ eventId: event.id, limit: 5000, offset: 0 });
    const { criteria } = await activeRubric(event.id);
    const judgeFilter = strParam(req.query.judge, 60);
    const projectFilter = strParam(req.query.project, 60);
    const rows = assignments.filter(
      (a) => (!judgeFilter || a.event_judge_id === judgeFilter) && (!projectFilter || a.project_id === projectFilter),
    );
    await page(res, 'host/judging', req, {
      pageTitle: `Judging — ${event.name}`,
      event, state: eventState(event), progress, assignments: rows, criteria,
      judges: progress.perJudge, filters: { judge: judgeFilter, project: projectFilter },
    }, 200, 'host');
  }));

  r.post('/events/:slug/reviews/:reviewId/reopen', limitWrite, withEvent(async ({ req, res, event }) => {
    const { reopenReview } = await import('../services/judging.js');
    await reopenReview(event, req.params.reviewId, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/judging?reopened=1`);
  }));

  // -------------------------------------------------------------- results --
  r.get('/events/:slug/results', withEvent(async ({ req, res, event }) => {
    const d = db();
    const bundle = (await d.listResults(event.id, false));
    const { criteria } = await activeRubric(event.id);
    const prizes = await d.listResultPrizes(event.id);
    await page(res, 'host/results', req, {
      pageTitle: `Results — ${event.name}`,
      event, state: eventState(event), results: bundle, criteria, prizes,
      progress: await progressFor(event),
      method: explainMethod(event, criteria),
      computed: bundle.length > 0,
      saved: strParam(req.query.saved, 40),
    }, 200, 'host');
  }));

  r.post('/events/:slug/results/compute', limitWrite, withEvent(async ({ req, res, event }) => {
    await computeResults(event, { publish: false });
    res.redirect(303, `/host/events/${event.slug}/results?saved=computed`);
  }));

  r.post('/events/:slug/results/publish', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    if (!(await d.listResults(event.id, false)).length) {
      await computeResults(event, { publish: false });
    }
    await publishResults(event, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/results?saved=published`);
  }));

  r.post('/events/:slug/results/withdraw', limitWrite, withEvent(async ({ req, res, event }) => {
    await withdrawResults(event, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/results?saved=withdrawn`);
  }));

  // ------------------------------------------------------- announcements --
  r.post('/events/:slug/announcements', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const body = req.body as Record<string, string>;
    const title = String(body.title ?? '').trim();
    if (title.length < 3) throw badRequest('Give the announcement a short title.', 'bad_title', { field: 'title' });
    await d.createAnnouncement({
      id: id('ann'),
      event_id: event.id,
      title: title.slice(0, 140),
      body: String(body.body ?? '').slice(0, 4000),
      audience: ['everyone', 'participants', 'judges', 'organizers'].includes(body.audience) ? body.audience : 'everyone',
      created_by: req.actor!.id,
      created_at: nowIso(),
    });
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'announcement.created', entityType: 'event', entityId: event.id, summary: `Posted "${title}"` });
    if (body.audience !== 'organizers') {
      setImmediate(() => {
        fanoutAnnouncement(event, body.audience, {
          title,
          body: String(body.body ?? '').slice(0, 300),
          link: `/hackathons/${event.slug}`,
        }).catch((err) => console.error('Async announcement fanout failed:', err));
      });
    }
    res.redirect(303, `/host/events/${event.slug}?posted=1`);
  }));

  r.post('/events/:slug/announcements/:announcementId/delete', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const list = await d.listAnnouncements(event.id, 200);
    if (!list.some((a) => a.id === req.params.announcementId)) throw notFound('That announcement no longer exists.');
    await d.deleteAnnouncement(req.params.announcementId);
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'announcement.deleted', entityType: 'event', entityId: event.id, summary: 'Removed an announcement' });
    res.redirect(303, `/host/events/${event.slug}`);
  }));

  // ---------------------------------------------------- comment moderation --
  r.post('/events/:slug/comments/:commentId/hide', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    await d.setCommentHidden(req.params.commentId, true);
    await audit({
      eventId: event.id,
      actorId: req.actor!.id,
      action: 'comment.hidden',
      entityType: 'project',
      entityId: req.params.commentId,
      summary: 'Organizer hid comment',
    });
    res.redirect(303, req.get('referer')?.includes('/hackathons/') || req.get('referer')?.includes('/host/') ? req.get('referer')! : `/host/events/${event.slug}`);
  }));

  r.post('/events/:slug/comments/:commentId/unhide', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    await d.setCommentHidden(req.params.commentId, false);
    await audit({
      eventId: event.id,
      actorId: req.actor!.id,
      action: 'comment.unhidden',
      entityType: 'project',
      entityId: req.params.commentId,
      summary: 'Organizer unhid comment',
    });
    res.redirect(303, req.get('referer')?.includes('/hackathons/') || req.get('referer')?.includes('/host/') ? req.get('referer')! : `/host/events/${event.slug}`);
  }));

  // ---------------------------------------------------------------- audit --
  r.get('/events/:slug/audit', withEvent(async ({ req, res, event }) => {
    const d = db();
    const pageNo = intParam(req.query.page, 1);
    const perPage = 40;
    const action = strParam(req.query.action, 60);
    const { rows, total } = await d.listAudit(event.id, { limit: 500, offset: 0, action: action || undefined });
    const all = await d.listAudit(event.id, { limit: 500, offset: 0 });
    const actions = [...new Set(all.rows.map((a) => a.action))].sort();
    await page(res, 'host/audit', req, {
      pageTitle: `Audit — ${event.name}`,
      event, state: eventState(event), rows: rows.slice((pageNo - 1) * perPage, pageNo * perPage),
      total, page: pageNo, pages: Math.max(1, Math.ceil(total / perPage)), actions, action, labels: AUDIT_LABELS,
    }, 200, 'host');
  }));

  // -------------------------------------------------------------- exports --
  r.get('/events/:slug/export.csv', withEvent(async ({ req, res, event }) => {
    const d = db();
    const kind = strParam(req.query.kind, 30) || 'results';
    const csv = await buildCsv(d, event, kind);
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'export.csv', entityType: 'event', entityId: event.id, summary: `Exported ${kind} as CSV`, ip: ipOf(req) });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hackerly-${event.slug}-${kind}.csv"`);
    res.send(csv);
  }));

  r.get('/events/:slug/export', withEvent(async ({ req, res, event }) => {
    const d = db();
    const kinds = [
      { key: 'results', label: 'Results and scores', detail: 'Every project with its final, raw and per-judge scores.' },
      { key: 'projects', label: 'Projects', detail: 'Submitted projects, tracks, teams and links.' },
      { key: 'teams', label: 'Teams and members', detail: 'Team rosters with each member’s username and email.' },
      { key: 'reviews', label: 'Judge reviews', detail: 'Submitted reviews with scores, comments and timestamps.' },
      { key: 'judges', label: 'Judges and progress', detail: 'The panel, invitation status and review completion.' },
      { key: 'audit', label: 'Audit log', detail: 'Operational history for this event.' },
    ];
    const counts: Record<string, number> = {
      results: (await d.listResults(event.id, false)).length,
      projects: (await d.listProjects({ eventId: event.id, limit: 1, offset: 0 })).total,
      teams: (await d.listTeams(event.id, { limit: 1, offset: 0 })).total,
      reviews: (await d.countReviews(event.id)).total,
      judges: (await d.listEventJudges(event.id)).length,
      audit: (await d.countAudit(event.id)),
    };
    await page(res, 'host/export', req, { pageTitle: `Export — ${event.name}`, event, kinds, counts, state: eventState(event) }, 200, 'host');
  }));

  // ------------------------------------------------------- project detail --
  r.get('/events/:slug/projects/:projectId', withEvent(async ({ req, res, event }) => {
    const d = db();
    const project = await d.getProject(req.params.projectId);
    if (!project || project.event_id !== event.id) throw notFound('That project no longer exists.');
    const { rows: assignments } = await d.listAssignments({ eventId: event.id, projectId: project.id, limit: 100 });
    const reviews = (await d.listReviews({ eventId: event.id, projectId: project.id })).filter((r) => r.status === 'submitted');
    const judges = await d.listEventJudges(event.id);
    const { rubric, criteria } = await activeRubric(event.id);
    const perJudge: any[] = [];
    for (const r of reviews) {
      const scores = await d.listScores(r.id);
      perJudge.push({
        judge: judges.find((j: any) => j.id === r.event_judge_id),
        review: r,
        scores,
        total: criteria.length ? round2(scores.reduce((a, s) => a + s.score, 0)) : null,
      });
    }
    await page(res, 'host/project', req, {
      pageTitle: project.title,
      event, state: eventState(event), project, members: await d.listTeamMembers(project.team_id),
      team: await d.getTeam(project.team_id), assignments, perJudge, criteria, rubric,
      result: await d.getResultForProject(event.id, project.id),
    }, 200, 'host');
  }));

  // ----------------------------------------------------------- settings --
  r.get('/events/:slug/settings', withEvent(async ({ req, res, event }) => {
    await page(res, 'host/settings', req, {
      pageTitle: `Settings — ${event.name}`,
      event, state: eventState(event), input: mapEventToInput(event), organizers: await db().listOrganizers(event.id),
    }, 200, 'host');
  }));

  r.post('/events/:slug/settings', limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, any>;
    const data = parse(
      z.object({
        name: text(90, 'The hackathon name', 3),
        tagline: text(160, 'The tagline', 0),
        description: text(6000, 'The description', 20),
        format: z.enum(['online', 'offline', 'hybrid']),
        venue: text(120, 'The venue', 0),
        city: text(60, 'The city', 0),
        country: text(60, 'The country', 0),
        timezone: text(60, 'The timezone', 1),
        registration_opens_at: optionalIsoDate,
        registration_closes_at: optionalIsoDate,
        starts_at: optionalIsoDate,
        ends_at: optionalIsoDate,
        submission_deadline: optionalIsoDate,
        judging_starts_at: optionalIsoDate,
        judging_ends_at: optionalIsoDate,
        results_release_at: optionalIsoDate,
        min_team_size: intIn(1, 20),
        max_team_size: intIn(1, 20),
        allow_solo: boolish,
        judging_mode: z.enum(['raw', 'normalized']),
        normalize_lambda: z.union([z.string(), z.number()]).transform((v) => Number(v) || 0),
        results_visibility: z.enum(['hidden', 'public']),
        showcase_visibility: z.enum(['hidden', 'public']),
        public_listing: boolish,
        require_approval: boolish,
        cover_url: z.string().transform((v) => safeUrl(v)),
        cover_style: z.enum(['auto', 'grid', 'arcs', 'strata', 'orbit', 'bars', 'mesh']),
        accent_color: z.string().refine((v) => !v || /^#[0-9a-fA-F]{6}$/.test(v), 'Pick a colour from the list.'),
        prize_pool_cents: intIn(0, 1_000_000_00),
        prize_currency: z.enum(['INR', 'USD', 'EUR', 'GBP', 'JPY']),
        prize_headline: text(60, 'The prize headline', 0),
        eligibility: text(2000, 'The eligibility text', 0),
        contact_email: z.string().trim().toLowerCase().refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(v), 'Enter a valid email address.'),
        organizer_name: text(80, 'The organizer name', 0),
      }),
      body,
    );
    if (data.min_team_size > data.max_team_size) {
      throw badRequest('The minimum team size cannot be larger than the maximum.', 'bad_team_sizes', { field: 'max_team_size' });
    }
    if (!data.submission_deadline) {
      throw badRequest('A submission deadline is required. The server refuses submissions without one.', 'deadline_required', { field: 'submission_deadline' });
    }
    if (data.ends_at && data.submission_deadline && new Date(data.submission_deadline) > new Date(data.ends_at)) {
      throw badRequest('The submission deadline has to fall before the event ends.', 'bad_dates', { field: 'submission_deadline' });
    }
    await updateEvent(event.id, data, req.actor!.id);
    res.redirect(303, `/host/events/${event.slug}/settings?saved=1`);
  }));

  r.post('/events/:slug/participants', limitWrite, withEvent(async ({ req, res, event }) => {
    const d = db();
    const email = String((req.body as any).email ?? '').trim().toLowerCase();
    const user = await d.getUserByEmail(email);
    if (!user) throw notFound('No Hackerly account uses that email address. Ask them to sign up first.', 'no_user');
    await d.addMember(event.id, user.id, 'participant', nowIso());
    await audit({ eventId: event.id, actorId: req.actor!.id, action: 'participant.added', entityType: 'user', entityId: user.id, summary: `Added ${user.username} as a participant` });
    res.redirect(303, `/host/events/${event.slug}?added=${encodeURIComponent(user.username)}`);
  }));

  r.get('/events/:slug/participants', withEvent(async ({ req, res, event }) => {
    const d = db();
    const participants = await listParticipants(d, event.id);
    const teams = await d.listTeams(event.id, { limit: 1, offset: 0 });
    const q = strParam(req.query.q, 60).toLowerCase();
    const filtered = q
      ? participants.filter((p) => `${p.display_name} ${p.username} ${p.email} ${p.team_name ?? ''}`.toLowerCase().includes(q))
      : participants;
    await page(res, 'host/participants', req, {
      pageTitle: `Participants — ${event.name}`,
      event, state: eventState(event), people: filtered, q,
      stats: { teams: teams.total, people: participants.length, withoutTeam: participants.filter((p) => !p.team_id).length },
    }, 200, 'host');
  }));

  return wrapRouter(r);
}

// ------------------------------------------------------------------ helpers

/**
 * Everyone attached to an event: registered participants plus team rosters,
 * merged into one list the organizer can actually search.
 */
/** Counts shown as badges in the host navigation, from real queries. */
export function hostNavFor(pathname: string, slug: string): string {
  const p = pathname.replace(`/host/events/${slug}`, '');
  if (p.startsWith('/setup')) return 'setup';
  if (p.startsWith('/participants')) return 'participants';
  if (p.startsWith('/teams')) return 'teams';
  if (p.startsWith('/projects')) return 'projects';
  if (p.startsWith('/judges')) return 'judges';
  if (p.startsWith('/assignments')) return 'assignments';
  if (p.startsWith('/judging')) return 'judging';
  if (p.startsWith('/results')) return 'results';
  if (p.startsWith('/audit')) return 'audit';
  if (p.startsWith('/export')) return 'export';
  if (p.startsWith('/settings')) return 'settings';
  return 'overview';
}

export async function hostCounts(d: any, eventId: string): Promise<Record<string, number>> {
  const [teams, projects, judges, assignments, audit, participants] = await Promise.all([
    d.listTeams(eventId, { limit: 1, offset: 0 }),
    d.listProjects({ eventId, limit: 1, offset: 0 }),
    d.listEventJudges(eventId),
    d.listAssignments({ eventId, limit: 1, offset: 0 }),
    d.countAudit(eventId),
    listParticipants(d, eventId),
  ]);
  return {
    teams: teams.total,
    projects: projects.total,
    judges: judges.length,
    assignments: assignments.total,
    audit,
    participants: participants.length,
  };
}

export async function listParticipants(d: any, eventId: string): Promise<any[]> {
  const memberships = await d.listEventMembers(eventId, 'participant');
  const teams = await d.listTeams(eventId, { limit: 1000, offset: 0 });
  const byUser = new Map<string, any>();
  for (const m of memberships) {
    const user = await d.getUserById(m.user_id);
    if (!user) continue;
    byUser.set(user.id, {
      id: user.id,
      display_name: user.display_name,
      username: user.username,
      email: user.email,
      avatar_seed: user.avatar_seed,
      registered_at: m.registered_at,
      team_id: null,
      team_name: '',
      team_role: '',
    });
  }
  for (const t of teams.rows) {
    for (const m of await d.listTeamMembers(t.id)) {
      const existing = byUser.get(m.id);
      if (existing) {
        existing.team_id = t.id;
        existing.team_name = t.name;
        existing.team_role = m.team_role;
      } else {
        byUser.set(m.id, {
          id: m.id,
          display_name: m.display_name,
          username: m.username,
          email: m.email,
          avatar_seed: m.avatar_seed,
          registered_at: m.joined_at,
          team_id: t.id,
          team_name: t.name,
          team_role: m.team_role,
        });
      }
    }
  }
  return [...byUser.values()].sort((a, b) => String(a.display_name).localeCompare(String(b.display_name)));
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === 'string' && v.length) return [v];
  return [];
}

async function assignOne(d: any, event: any, judgeId: string, projectId: string, actorId: string): Promise<number> {
  const judge = await d.getEventJudge(judgeId);
  if (!judge || judge.event_id !== event.id) return 0;
  const existing = await d.listAssignments({ eventId: event.id, projectId, limit: 500 });
  if (existing.some((a: any) => a.event_judge_id === judgeId)) return 0;
  await d.createAssignment({
    id: id('asg'),
    event_id: event.id,
    project_id: projectId,
    event_judge_id: judgeId,
    status: 'pending',
    assigned_at: nowIso(),
    submitted_at: null,
  });
  await d.createNotification({
    id: id('ntf'),
    user_id: judge.user_id ?? `judge:${judgeId}`,
    event_id: event.id,
    kind: 'assignment',
    title: 'A project is waiting for your review',
    body: `${judge.display_name || judge.email} has a new assignment on ${event.name}.`,
    link: `/judge/events/${event.slug}`,
    read_at: null,
    created_at: nowIso(),
  });
  void actorId;
  return 1;
}

function buildFields(body: Record<string, any>): any[] {
  const keys = toArray(body.field_key);
  const out: any[] = [];
  for (let i = 0; i < keys.length; i += 1) {
    const key = String(keys[i]).trim();
    if (!key) continue;
    out.push({
      key,
      label: String(body.field_label?.[i] ?? key).slice(0, 120),
      type: ['url', 'text', 'textarea', 'tags'].includes(body.field_type?.[i]) ? body.field_type[i] : 'text',
      required: body.field_required?.[i] === 'on' || body.field_required?.[i] === 'true',
      placeholder: String(body.field_placeholder?.[i] ?? '').slice(0, 160),
      help: String(body.field_help?.[i] ?? '').slice(0, 240),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function buildMilestones(body: Record<string, any>): any[] {
  const labels = toArray(body.milestone_label);
  const out: any[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = String(labels[i]).trim();
    if (!label) continue;
    const raw = String(body.milestone_at?.[i] ?? '').trim();
    const at = raw ? new Date(raw) : null;
    out.push({
      label: label.slice(0, 120),
      at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : null,
      detail: String(body.milestone_detail?.[i] ?? '').slice(0, 300),
    });
    if (out.length >= 30) break;
  }
  return out;
}

function buildTrackRequirements(body: Record<string, any>): any[] {
  const labels = toArray(body.req_label);
  const out: any[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = String(labels[i]).trim();
    if (!label) continue;
    out.push({ label: label.slice(0, 120), required: body.req_required?.[i] === 'on' });
    if (out.length >= 12) break;
  }
  return out;
}

function parseCriteriaBody(body: Record<string, any>) {
  const names = toArray(body.criteria_name);
  const out: any[] = [];
  for (let i = 0; i < names.length; i += 1) {
    const name = String(names[i]).trim();
    if (!name) continue;
    out.push({
      name,
      description: String(body.criteria_description?.[i] ?? ''),
      weight: Number(body.criteria_weight?.[i] ?? 0) || 0,
      maxScore: Number(body.criteria_max?.[i] ?? 10) || 10,
      required: body.criteria_required?.[i] !== 'off',
    });
    if (out.length >= 16) break;
  }
  if (!out.length) {
    throw badRequest('A rubric needs at least one criterion.', 'empty_rubric');
  }
  return out;
}

function intInSafe(v: unknown): number | null {
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildCsv(d: any, event: any, kind: string): Promise<string> {
  if (kind === 'projects') {
    const { rows } = await d.listProjects({ eventId: event.id, limit: 100000, offset: 0 });
    return csvDocument(
      ['project_id', 'title', 'slug', 'team', 'track', 'status', 'submitted_at', 'final_rank', 'final_score', 'repo_url', 'demo_url', 'video_url', 'tech_stack', 'summary'],
      rows.map((p: any) => [p.id, p.title, p.slug, p.team_name, p.track_name ?? '', p.status, p.submitted_at ?? '', p.public_rank ?? '', p.public_rank_score ?? '', p.repo_url, p.demo_url, p.video_url, (p.tech_stack ?? []).join(' | '), p.summary]),
    );
  }
  if (kind === 'teams') {
    const { rows } = await d.listTeams(event.id, { limit: 100000, offset: 0 });
    const out: unknown[][] = [];
    for (const t of rows) {
      const members = await d.listTeamMembers(t.id);
      if (!members.length) {
        out.push([t.id, t.name, t.slug, '', '', '', t.created_at, '']);
        continue;
      }
      for (const m of members) {
        out.push([t.id, t.name, t.slug, m.display_name, m.username, m.email, t.created_at, m.team_role]);
      }
    }
    return csvDocument(['team_id', 'team', 'slug', 'member', 'username', 'email', 'created_at', 'role'], out);
  }
  if (kind === 'reviews') {
    const reviews = await d.listReviews({ eventId: event.id, status: 'submitted' });
    const judges = await d.listEventJudges(event.id);
    const judgeMap = new Map<string, any>(judges.map((j: any) => [j.id, j]));
    const { criteria } = await activeRubric(event.id);
    const allScores = await d.listAllScoresForEvent(event.id);
    const scoresByReview = new Map<string, any[]>();
    for (const s of allScores) {
      if (!scoresByReview.has(s.review_id)) scoresByReview.set(s.review_id, []);
      scoresByReview.get(s.review_id)!.push(s);
    }
    const out: unknown[][] = [];
    for (const r of reviews) {
      const judge = judgeMap.get(r.event_judge_id);
      const scores = scoresByReview.get(r.id) ?? [];
      const byCriterion = new Map(scores.map((s: any) => [s.criterion_id, s.score]));
      out.push([
        r.project_id,
        r.project_title,
        judge?.email ?? '',
        r.weighted_score ?? '',
        r.recommendation ?? '',
        r.submitted_at ?? '',
        r.comment ?? '',
        ...criteria.map((c: any) => byCriterion.get(c.id) ?? ''),
      ]);
    }
    return csvDocument(
      ['project_id', 'project', 'judge', 'weighted_score', 'recommendation', 'submitted_at', 'comment', ...criteria.map((c: any) => c.key)],
      out,
    );
  }
  if (kind === 'judges') {
    const judges = await d.listEventJudges(event.id);
    const { rows } = await d.listAssignments({ eventId: event.id, limit: 100000, offset: 0 });
    return csvDocument(
      ['judge_id', 'name', 'email', 'username', 'status', 'invited_at', 'accepted_at', 'assigned', 'submitted'],
      judges.map((j: any) => [
        j.id,
        j.display_name ?? '',
        j.email,
        j.username ?? '',
        j.status,
        j.invited_at,
        j.accepted_at ?? '',
        rows.filter((a: any) => a.event_judge_id === j.id).length,
        rows.filter((a: any) => a.event_judge_id === j.id && a.status === 'submitted').length,
      ]),
    );
  }
  if (kind === 'audit') {
    const { rows } = await d.listAudit(event.id, { limit: 100000, offset: 0 });
    return csvDocument(
      ['created_at', 'actor', 'action', 'entity_type', 'entity_id', 'summary', 'ip'],
      rows.map((a: any) => [a.created_at, a.actor_label, a.action, a.entity_type, a.entity_id, a.summary, a.ip]),
    );
  }
  // results (default)
  const rows = await d.listResults(event.id, false);
  const projects = (await d.listProjects({ eventId: event.id, limit: 100000, offset: 0 })).rows;
  const byId = new Map(projects.map((p: any) => [p.id, p]));
  const out: unknown[][] = [];
  for (const r of rows) {
    const p: any = byId.get(r.project_id);
    const b = typeof r.breakdown === 'string' ? JSON.parse(r.breakdown || '{}') : r.breakdown ?? {};
    out.push([
      r.rank ?? '',
      r.track_rank ?? '',
      r.project_id,
      p?.title ?? r.project_title ?? '',
      p?.team_name ?? r.team_name ?? '',
      r.track_name ?? '',
      r.review_count ?? 0,
      r.raw_score ?? '',
      r.adjusted_score ?? '',
      r.final_score ?? '',
      r.published_at ? 'published' : 'draft',
      (b.per_judge ?? []).map((x: any) => `${x.judge_email}:${x.score}`).join(' | '),
      (b.notes ?? []).join(' | '),
    ]);
  }
  return csvDocument(
    ['rank', 'track_rank', 'project_id', 'project', 'team', 'track', 'review_count', 'raw_score', 'adjusted_score', 'final_score', 'publication', 'per_judge_scores', 'notes'],
    out,
  );
}

export { forbidden, limits, renderRichText, eventState, ipOf, navFor };
