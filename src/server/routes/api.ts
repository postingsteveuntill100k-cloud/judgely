import { wrapRouter } from './safe.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { eventState, requireEvent, requireOrganizer, eventState as stateOf, assertSubmissionsOpen } from '../services/events.js';
import { requireTeamAccess, registerParticipant, isRegistered } from '../services/teams.js';
import { createProject, updateProject, submitProject, validateSubmission, loadProjectForActor } from '../services/projects.js';
import { myScores, saveReview, activeRubric, progressFor } from '../services/judging.js';
import { audit } from '../services/audit.js';
import { buildCsv, listParticipants } from './host.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { parse, text, optionalIsoDate, emailField, usernameField } from '../lib/validate.js';
import { csvDocument } from '../lib/csv.js';
import { safeUrl, renderRichText } from '../lib/format.js';
import { limits } from '../lib/ratelimit.js';
import { ipOf } from '../middleware/session.js';
import { log } from '../lib/logger.js';
import { id, nowIso, slugify } from '../lib/ids.js';
import { resultsArePublic } from '../services/results.js';
import { DEFAULT_SUBMISSION_FIELDS } from '../services/events.js';

async function resultsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const d = db();
    const event = await d.getEventBySlug(req.params.slug);
    if (!event || event.status === 'draft') throw notFound('No such hackathon.');
    if (!(await resultsArePublic(event))) {
      throw notFound('Results for this hackathon have not been published.');
    }
    const rows = await d.listResults(event.id, true);
    res.json({
      event: event.slug,
      published: true,
      // Aggregates only. Individual judge scores and identities are never here.
      results: rows.map((r) => ({
        rank: r.rank,
        track_rank: r.track_rank,
        project_id: r.project_id,
        project_slug: r.project_slug,
        project: r.project_title,
        team: r.team_name,
        track: r.track_name,
        score: r.final_score,
        review_count: r.review_count,
        published_at: r.published_at,
      })),
    });
  } catch (e) {
    next(e);
  }
}

export function apiRoutes(): Router {
  const r = Router();

  // ---------------------------------------------------------------- v1 --
  const v1 = Router();

  v1.get('/', (_req, res) => {
    res.json({
      name: 'Hackerly API',
      version: '1',
      description: 'Read and write hackathon events, teams, projects, submissions and reviews. Authorization is enforced server-side on every route.',
      docs: '/about#api',
      endpoints: [
        { method: 'GET', path: '/api/v1/events', auth: 'none', summary: 'Published hackathons' },
        { method: 'GET', path: '/api/v1/events/:slug', auth: 'none', summary: 'One hackathon' },
        { method: 'POST', path: '/api/v1/events', auth: 'session', summary: 'Create a hackathon' },
        { method: 'GET', path: '/api/v1/events/:slug/projects', auth: 'none', summary: 'Submitted projects' },
        { method: 'POST', path: '/api/v1/events/:slug/submissions', auth: 'session', summary: 'Create or submit a project' },
        { method: 'GET', path: '/api/v1/judge/scores', auth: 'judge', summary: 'Your own review scores' },
        { method: 'POST', path: '/api/v1/reviews/:assignmentId', auth: 'judge', summary: 'Save or submit a review' },
        { method: 'GET', path: '/api/v1/events/:slug/export.csv', auth: 'organizer', summary: 'CSV export' },
      ],
    });
  });

  v1.get('/events', async (req, res, next) => {
    try {
      const d = db();
      const { rows, total } = await d.listEvents({ status: ['published', 'live', 'closed'], listing: true, limit: 50, offset: 0 });
      res.json({
        total,
        events: rows.map((e) => publicEventPayload(e)),
      });
    } catch (e) {
      next(e);
    }
  });

  v1.get('/events/:slug', async (req, res, next) => {
    try {
      const d = db();
      const event = await d.getEventBySlug(req.params.slug);
      if (!event || event.status === 'draft') throw notFound('No such hackathon.');
      const [tracks, projects] = await Promise.all([
        d.listTracks(event.id),
        d.listProjects({ eventId: event.id, status: ['submitted', 'under_review', 'results_released'], limit: 100, offset: 0 }),
      ]);
      res.json({
        event: publicEventPayload(event),
        state: eventState(event),
        tracks: tracks.map((t) => ({ id: t.id, slug: t.slug, name: t.name, description: t.description, prize_text: t.prize_text })),
        projects: projects.rows.map((p) => publicProjectPayload(p)),
      });
    } catch (e) {
      next(e);
    }
  });

  v1.post('/events', async (req, res, next) => {
    if (!req.actor) return next(unauthorized('Sign in to create a hackathon.'));
    try {
      const { createEvent } = await import('../services/events.js');
      const body = req.body as Record<string, unknown>;
      const event = await createEvent(
        {
          name: String(body.name ?? ''),
          tagline: String(body.tagline ?? ''),
          description: String(body.description ?? ''),
          mode: body.mode === 'local' ? 'local' : 'global',
          format: (body.format as any) ?? 'online',
          submissionDeadline: (body.submission_deadline as string) ?? null,
          startsAt: (body.starts_at as string) ?? null,
          endsAt: (body.ends_at as string) ?? null,
          prizePoolCents: Number(body.prize_pool_cents ?? 0),
          prizeCurrency: String(body.prize_currency ?? 'INR'),
          minTeamSize: Number(body.min_team_size ?? 1),
          maxTeamSize: Number(body.max_team_size ?? 4),
        },
        req.actor.id,
      );
      res.status(201).json({ event });
    } catch (e) {
      next(e);
    }
  });

  v1.get('/events/:slug/projects', async (req, res, next) => {
    try {
      const d = db();
      const event = await d.getEventBySlug(req.params.slug);
      if (!event || event.status === 'draft') throw notFound('No such hackathon.');
      const { rows, total } = await d.listProjects({
        eventId: event.id,
        status: ['submitted', 'under_review', 'results_released'],
        limit: 100,
        offset: Number(req.query.offset ?? 0),
      });
      res.json({ total, projects: rows.map((p) => publicProjectPayload(p)) });
    } catch (e) {
      next(e);
    }
  });

  v1.post('/events/:slug/submissions', async (req, res, next) => {
    if (!req.actor) return next(unauthorized('Sign in to submit a project.'));
    try {
      const d = db();
      const event = await requireEvent(req.params.slug);
      const body = req.body as Record<string, any>;
      const teamId = String(body.team_id ?? '');
      if (!teamId) throw badRequest('team_id is required.', 'team_required', { field: 'team_id' });
      const { team } = await requireTeamAccess(event, teamId, req.actor.id);
      const existing = await d.listProjectsForTeam(team.id);
      if (existing.length) {
        const project = existing[0];
        if (body.submit !== false) await submitProject(event, project, req.actor.id);
        return res.json({ project: await d.getProject(project.id), created: false });
      }
      const project = await createProject(event, team, {
        title: String(body.title ?? ''),
        tagline: String(body.tagline ?? ''),
        summary: String(body.summary ?? ''),
        description: String(body.description ?? ''),
        trackId: body.track_id ?? null,
        techStack: body.tech_stack ?? [],
        repoUrl: String(body.repo_url ?? ''),
        demoUrl: String(body.demo_url ?? ''),
        videoUrl: String(body.video_url ?? ''),
        docsUrl: String(body.docs_url ?? ''),
        answers: body.answers ?? {},
      }, req.actor.id);
      if (body.submit !== false) {
        const updated = await submitProject(event, project, req.actor.id);
        return res.status(201).json({ project: updated, created: true });
      }
      res.status(201).json({ project, created: true });
    } catch (e) {
      next(e);
    }
  });

  /**
   * A judge's own scores. There is no parameter that widens this: the judge is
   * always the caller. Asking for somebody else's handle is a 403, decided here
   * and not in a template.
   */
  v1.get('/judge/scores', async (req, res, next) => {
    try {
      const d = db();
      const events = await d.listJudgeEvents(req.actor!.id);
      if (!events.length) {
        throw forbidden('You are not a judge on any hackathon.', 'not_a_judge');
      }
      const eventFilter = String(req.query.event ?? '');
      const targets = eventFilter ? events.filter((e) => e.slug === eventFilter) : events;
      if (!targets.length) throw forbidden('You are not a judge on that hackathon.', 'not_a_judge_for_event');

      const requested = req.query.judge;
      if (requested !== undefined) {
        const handle = String(requested).trim().toLowerCase();
        const mine = targets.some((e) => String(req.actor!.username).toLowerCase() === handle)
          || targets.some((e) => String(req.actor!.id) === handle)
          || targets.some((e) => String(req.actor!.email).toLowerCase() === handle);
        if (!mine) {
          // Deliberately the same answer whether the other judge exists or not.
          throw forbidden('Review scores are private to the judge who wrote them.', 'not_your_scores');
        }
      }

      const out: any[] = [];
      for (const e of targets) out.push(...(await myScores(e.id, req.actor!.id)));
      res.json({ judge: req.actor!.username, count: out.length, reviews: out });
    } catch (e) {
      next(e);
    }
  });

  v1.post('/reviews/:assignmentId', async (req, res, next) => {
    if (!req.actor) return next(unauthorized('Sign in as a judge to submit a review.'));
    try {
      const d = db();
      const assignment = await d.getAssignment(req.params.assignmentId);
      if (!assignment) throw notFound('That assignment no longer exists.');
      const event = await d.getEventById(assignment.event_id);
      if (!event) throw notFound('That hackathon no longer exists.');
      const me = await d.getEventJudgeForUser(event.id, req.actor!.id);
      if (!me || me.status !== 'active' || assignment.event_judge_id !== me.id) {
        throw forbidden('That review belongs to another judge.', 'not_your_review');
      }
      const { criteria } = await activeRubric(event.id);
      const body = req.body as Record<string, any>;
      const scores = (Array.isArray(body.scores) ? body.scores : []).map((s: any) => ({
        criterionId: String(s.criterion_id ?? s.criterionId ?? ''),
        score: Number(s.score),
        note: String(s.note ?? ''),
      }));
      void criteria;
      const { review } = await saveReview(
        event,
        assignment.id,
        { id: req.actor.id, name: req.actor.displayName, email: req.actor.email },
        {
          scores,
          comment: String(body.comment ?? ''),
          strengths: String(body.strengths ?? ''),
          improvements: String(body.improvements ?? ''),
          recommendation: String(body.recommendation ?? ''),
          submit: body.submit === true,
        },
      );
      res.json({ review });
    } catch (e) {
      next(e);
    }
  });

  v1.get('/events/:slug/export.csv', async (req, res, next) => {
    try {
      const d = db();
      const event = await d.getEventBySlug(req.params.slug);
      if (!event) throw notFound('No such hackathon.');
      await requireOrganizer(event.id, req.actor?.id);
      const kind = String(req.query.kind ?? 'results');
      const csv = await buildCsv(d, event, kind);
      await audit({ eventId: event.id, actorId: req.actor!.id, action: 'export.csv', entityType: 'event', entityId: event.id, summary: `API export ${kind}`, ip: ipOf(req) });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="hackerly-${event.slug}-${kind}.csv"`);
      res.send(csv);
    } catch (e) {
      next(e);
    }
  });

  v1.get('/me', async (req, res, next) => {
    if (!req.actor) return next(unauthorized());
    try {
      const d = db();
      res.json({
        user: { id: req.actor.id, username: req.actor.username, display_name: req.actor.displayName, email: req.actor.email },
        events: (await d.listMemberEvents(req.actor.id)).map((e) => ({ slug: e.slug, name: e.name, role: e.member_role })),
        organizing: (await d.listEventsForOrganizer(req.actor.id, 100, 0)).rows.map((e) => ({ slug: e.slug, name: e.name })),
        judging: (await d.listJudgeEvents(req.actor.id)).map((e) => ({ slug: e.event_slug, name: e.event_name })),
      });
    } catch (e) {
      next(e);
    }
  });

  /** Public published results. Also reachable at the short /api path. */
  v1.get('/events/:slug/results', resultsHandler);
  r.use('/v1', v1);

  // ------------------------------------------- DOGFOOD / REST convenience --

  /**
   * Create a submission.
   *
   * The event is taken from, in order: an explicit `event` field or query
   * parameter, the `X-Hackerly-Event` header, or — when the caller is registered
   * for exactly one hackathon — that event. An ambiguous request is refused
   * rather than guessed at.
   */
  r.post('/submissions', async (req, res, next) => {
    if (!req.actor) return next(unauthorized('Sign in to submit a project.'));
    try {
      const d = db();
      const body = (req.body ?? {}) as Record<string, any>;
      const explicit = String(body.event ?? body.event_slug ?? body.event_id ?? req.query.event ?? req.get('x-hackerly-event') ?? '').trim();
      let event: any = null;
      if (explicit) {
        event = await requireEvent(explicit);
      } else {
        const memberships = await d.listMemberEvents(req.actor.id, 'participant');
        if (memberships.length === 1) {
          event = memberships[0];
        } else if (memberships.length === 0) {
          throw badRequest(
            'You are not registered for a hackathon. Register first, or pass the event explicitly.',
            'not_registered',
            { field: 'event' },
          );
        } else {
          throw badRequest(
            `You are registered for ${memberships.length} hackathons, so say which one: pass ?event=<slug>.`,
            'ambiguous_event',
            { field: 'event' },
          );
        }
      }

      const teamId = String(body.team_id ?? '').trim();
      if (teamId) {
        const { team } = await requireTeamAccess(event, teamId, req.actor.id);
        return await writeSubmission({ req, res, event, team });
      }

      // No team given: use the caller's team for this event, or create one.
      const teams = (await d.listTeamsForUser(req.actor.id)).filter((t) => t.event_id === event.id);
      let team = teams[0];
      if (!team) {
        if (event.allow_solo === false && event.min_team_size > 1) {
          throw conflict('This hackathon needs a team. Create one before submitting.', 'team_required');
        }
        const { createTeam } = await import('../services/teams.js');
        team = await createTeam(event, req.actor, {
          name: String(body.team_name ?? '').trim() || `${req.actor.displayName}'s team`,
        });
      }
      return await writeSubmission({ req, res, event, team });
    } catch (e) {
      next(e);
    }
  });

  async function writeSubmission({ req, res, event, team }: { req: Request; res: Response; event: any; team: any }) {
    const d = db();
    limits.submit(req.actor!.id);
    const body = (req.body ?? {}) as Record<string, any>;
    // The deadline is checked before anything is written. A closed event must
    // not even produce a draft.
    assertSubmissionsOpen(event);
    const existing = await d.listProjectsForTeam(team.id);
    const input = {
      title: String(body.title ?? body.name ?? '').trim(),
      tagline: String(body.tagline ?? ''),
      summary: String(body.summary ?? body.tagline ?? ''),
      description: String(body.description ?? ''),
      trackId: body.track_id ?? existing[0]?.track_id ?? null,
      techStack: body.tech_stack ?? [],
      repoUrl: String(body.repo_url ?? existing[0]?.repo_url ?? ''),
      demoUrl: String(body.demo_url ?? existing[0]?.demo_url ?? ''),
      videoUrl: String(body.video_url ?? existing[0]?.video_url ?? ''),
      docsUrl: String(body.docs_url ?? existing[0]?.docs_url ?? ''),
      answers: body.answers ?? existing[0]?.answers ?? {},
    };
    let project = existing[0];
    if (project) {
      project = await updateProject(event, project, req.actor!.id, input);
    } else {
      project = await createProject(event, team, input, req.actor!.id);
    }
    const wantsSubmit = body.submit !== false && body.status !== 'draft';
    const final = wantsSubmit ? await submitProject(event, project, req.actor!.id) : project;
    res.status(201).json({
      project: final,
      event: { slug: event.slug, name: event.name, submission_deadline: event.submission_deadline },
      issues: wantsSubmit ? [] : await validateSubmission(event, final),
    });
  }

  /** Judge's own scores, at the short path the acceptance checker uses. */
  r.get('/judge/scores', async (req, res, next) => {
    try {
      if (!req.actor) return next(unauthorized('Sign in as a judge to read your scores.'));
      const d = db();
      const events = await d.listJudgeEvents(req.actor.id);
      if (!events.length) {
        return next(forbidden('You are not a judge on any hackathon. A participant cannot read review scores.', 'not_a_judge'));
      }
      const requested = req.query.judge;
      if (requested !== undefined) {
        const handle = String(requested).trim().toLowerCase();
        const mine =
          String(req.actor.username).toLowerCase() === handle ||
          String(req.actor.id) === handle ||
          String(req.actor.email).toLowerCase() === handle;
        if (!mine) {
          return next(forbidden('Review scores are private to the judge who wrote them.', 'not_your_scores'));
        }
      }
      const out: any[] = [];
      for (const e of events) out.push(...(await myScores(e.id, req.actor.id)));
      res.json({ judge: req.actor.username, count: out.length, reviews: out });
    } catch (e) {
      next(e);
    }
  });

  r.get('/judge/progress', async (req, res, next) => {
    try {
      if (!req.actor) return next(unauthorized());
      const d = db();
      const events = await d.listJudgeEvents(req.actor.id);
      if (!events.length) return next(forbidden('You are not a judge on any hackathon.', 'not_a_judge'));
      const out: any[] = [];
      for (const e of events) {
        const { rows } = await d.listAssignments({ judgeId: e.id, limit: 2000 });
        out.push({
          event: e.event_slug,
          assigned: rows.length,
          done: rows.filter((a) => a.status === 'submitted').length,
          open: rows.filter((a) => a.status !== 'submitted').length,
        });
      }
      res.json({ judge: req.actor.username, events: out });
    } catch (e) {
      next(e);
    }
  });

  /**
   * Organizer CSV export. Authorised here, not in the template: a participant
   * or judge gets a 403 no matter what they ask for.
   */
  r.get('/export.csv', async (req, res, next) => {
    try {
      if (!req.actor) return next(unauthorized('Sign in as an organizer to export.'));
      const d = db();
      const slug = String(req.query.event ?? req.get('x-hackerly-event') ?? '').trim();
      const organized = await d.listEventsForOrganizer(req.actor.id, 100, 0);
      if (!organized.rows.length) {
        return next(forbidden('Only the organizers of a hackathon can export its data.', 'not_organizer'));
      }
      const event = slug ? await d.getEventBySlug(slug) : organized.rows[0];
      if (!event) return next(notFound('No hackathon with that name. Pass ?event=<slug>.'));
      if (!organized.rows.some((e) => e.id === event.id)) {
        return next(forbidden('Only the organizers of a hackathon can export its data.', 'not_organizer'));
      }
      const kind = String(req.query.kind ?? 'results');
      const csv = await buildCsv(d, event, kind);
      await audit({ eventId: event.id, actorId: req.actor.id, action: 'export.csv', entityType: 'event', entityId: event.id, summary: `Exported ${kind} as CSV`, ip: ipOf(req) });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="hackerly-${event.slug}-${kind}.csv"`);
      res.send(csv);
    } catch (e) {
      next(e);
    }
  });

  r.get('/events/:slug/participants.csv', async (req, res, next) => {
    try {
      if (!req.actor) return next(unauthorized());
      const d = db();
      const event = await d.getEventBySlug(req.params.slug);
      if (!event) return next(notFound('No such hackathon.'));
      await requireOrganizer(event.id, req.actor.id);
      const people = await listParticipants(d, event.id);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.send(csvDocument(
        ['display_name', 'username', 'email', 'team', 'team_role', 'registered_at'],
        people.map((p) => [p.display_name, p.username, p.email, p.team_name, p.team_role, p.registered_at]),
      ));
    } catch (e) {
      next(e);
    }
  });

  r.get('/events/:slug/progress', async (req, res, next) => {
    try {
      if (!req.actor) return next(unauthorized());
      const event = await d_event(req.params.slug);
      await requireOrganizer(event.id, req.actor.id);
      res.json(await progressFor(event));
    } catch (e) {
      next(e);
    }
  });

  async function d_event(slug: string) {
    return requireEvent(slug);
  }

  r.get('/public/events', async (req, res, next) => {
    try {
      const d = db();
      const { rows } = await d.listEvents({ status: ['published', 'live', 'closed'], listing: true, limit: 100, offset: 0 });
      res.json({ events: rows.map(publicEventPayload) });
    } catch (e) {
      next(e);
    }
  });

  r.post('/events/:slug/registrations', async (req, res, next) => {
    if (!req.actor) return next(unauthorized('Sign in to register.'));
    try {
      const event = await requireEvent(req.params.slug);
      await registerParticipant(event, req.actor.id);
      res.status(201).json({ registered: true, event: event.slug, state: stateOf(event) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/events/:slug/results', resultsHandler);

  r.post('/fixtures/reload', async (req, res, next) => {
    if (!req.actor || req.actor.platformRole !== 'platform_admin') {
      return next(forbidden('Platform administrators only.'));
    }
    try {
      const { loadFixtures } = await import('../seed/fixtures.js');
      const report = await loadFixtures({ force: true });
      res.json(report);
    } catch (e) {
      next(e);
    }
  });

  return wrapRouter(r);
}

/**
 * Role-specific response model. Private scores, judge identities, internal ids
 * and audit data never appear here, whatever the caller does.
 */
export function publicEventPayload(e: any) {
  const state = eventState(e);
  return {
    id: e.id,
    slug: e.slug,
    name: e.name,
    tagline: e.tagline,
    description: e.description,
    format: e.format,
    mode: e.mode,
    status: e.status,
    prize_pool_cents: e.prize_pool_cents,
    prize_currency: e.prize_currency,
    prize_headline: e.prize_headline,
    city: e.city,
    country: e.country,
    cover_url: e.cover_url ? safeUrl(e.cover_url) : '',
    accent_color: e.accent_color,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    registration_opens_at: e.registration_opens_at,
    registration_closes_at: e.registration_closes_at,
    submission_deadline: e.submission_deadline,
    judging_ends_at: e.judging_ends_at,
    results_release_at: e.results_release_at,
    min_team_size: e.min_team_size,
    max_team_size: e.max_team_size,
    allow_solo: e.allow_solo,
    submission_fields: (Array.isArray(e.submission_fields) ? e.submission_fields : DEFAULT_SUBMISSION_FIELDS).map((f: any) => ({
      key: f.key, label: f.label, type: f.type, required: f.required,
    })),
    state: {
      phase: state.phase,
      registration: state.registration,
      submissions: state.submissions,
      results: state.results,
      headline: state.headline,
    },
  };
}

export function publicProjectPayload(p: any) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    tagline: p.tagline,
    summary: p.summary,
    description: p.description,
    team: p.team_name,
    track: p.track_name ?? null,
    tech_stack: p.tech_stack ?? [],
    image_url: p.image_url ? safeUrl(p.image_url) : '',
    repo_url: p.repo_url,
    demo_url: p.demo_url,
    video_url: p.video_url,
    docs_url: p.docs_url,
    status: p.status,
    submitted_at: p.submitted_at,
    event: p.event_slug,
    rank: p.public_rank ?? null,
    score: p.public_rank_score ?? null,
  };
}

export { config, log, id, nowIso, slugify, isRegistered, renderRichText, parse, text, optionalIsoDate, emailField, usernameField, z };
