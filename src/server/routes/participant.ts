import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { page } from './helpers.js';
import { requireAuth } from '../middleware/session.js';
import { limitWrite } from '../middleware/guards.js';
import { wrapRouter } from './safe.js';
import { eventState, requireEvent, assertRegistrationOpen, assertSubmissionsOpen } from '../services/events.js';
import {
  registerParticipant, unregisterParticipant, isRegistered, createTeam, joinTeam, leaveTeam,
  updateTeam, requireTeamAccess, deleteTeam,
} from '../services/teams.js';
import {
  createProject, updateProject, submitProject, withdrawSubmission, validateSubmission,
} from '../services/projects.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { id, nowIso, secret, sha256, slugify } from '../lib/ids.js';
import { config } from '../config.js';
import { log } from '../lib/logger.js';

export function participantRoutes(): Router {
  const r = Router();
  // Deliberately not r.use(requireAuth): this router is mounted at the site
  // root, so a blanket guard would 401 every public route registered after it.
  const auth = [requireAuth];

  // ------------------------------------------------------------- register --
  r.get('/hackathons/:slug/register', auth, withEvent(async ({ req, res, event }) => {
    const d = db();
    const state = eventState(event);
    const registered = await isRegistered(event.id, req.actor!.id);
    const mine = (await d.listTeamsForUser(req.actor!.id)).filter((t) => t.event_id === event.id);
    await page(res, 'participant/register', req, {
      pageTitle: `Register — ${event.name}`,
      event,
      state,
      registered,
      team: mine[0] ?? null,
      teams: (await d.listTeams(event.id, { limit: 200, offset: 0 })).rows,
    });
  }));

  r.post('/hackathons/:slug/register', auth, limitWrite, withEvent(async ({ req, res, event }) => {
    await registerParticipant(event, req.actor!.id);
    res.redirect(303, '/teams');
  }));

  r.post('/hackathons/:slug/withdraw', auth, limitWrite, withEvent(async ({ req, res, event }) => {
    await unregisterParticipant(event, req.actor!.id);
    res.redirect(303, `/hackathons/${event.slug}`);
  }));

  // ---------------------------------------------------------------- teams --
  r.get('/teams', auth, async (req, res) => {
    const d = db();
    const teams = await d.listTeamsForUser(req.actor!.id);
    const rows: any[] = [];
    for (const t of teams) {
      rows.push({
        ...t,
        members: await d.listTeamMembers(t.id),
        projects: await d.listProjectsForTeam(t.id),
        issues: [],
      });
    }
    for (const row of rows) {
      const event = await d.getEventById(row.event_id);
      row.event = event;
      row.state = event ? eventState(event) : null;
      if (row.projects[0]) {
        row.issues = await validateSubmission(event, row.projects[0]);
      }
    }
    /**
     * Events this person is registered for but has no team on. Without this,
     * "register for a hackathon" is a dead end: the register page offers to
     * create a team, then drops you on a page that cannot.
     */
    const joined = new Set(rows.map((r) => r.event_id));
    const memberships = await d.listMemberEvents(req.actor!.id);
    const canStart: any[] = [];
    for (const m of memberships) {
      const eventId = m.event_id ?? m.id;
      if (joined.has(eventId)) continue;
      const event = m.slug ? m : await d.getEventById(eventId);
      if (!event) continue;
      const state = eventState(event);
      if (!state.canRegister) continue;
      canStart.push({
        event,
        state,
        teams: (await d.listTeams(event.id, { limit: 6, offset: 0 })).total,
      });
    }
    await page(res, 'participant/teams', req, { pageTitle: 'Your teams', teams: rows, canStart });
  });

  r.get('/teams/new/:slug', auth, withEvent(async ({ req, res, event }) => {
    const existing = (await db().listTeamsForUser(req.actor!.id)).filter((t) => t.event_id === event.id);
    await page(res, 'participant/team-new', req, {
      pageTitle: `Create a team — ${event.name}`,
      event,
      state: eventState(event),
      existingTeam: existing[0] ?? null,
    });
  }));

  r.post('/teams/new/:slug', auth, limitWrite, withEvent(async ({ req, res, event }) => {
    const body = req.body as Record<string, string>;
    const team = await createTeam(event, req.actor!, { name: body.name ?? '', description: body.description ?? '' });
    res.redirect(303, `/teams/${team.id}`);
  }));

  r.post('/teams/join', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const body = req.body as Record<string, string>;
      const eventSlug = String(body.event ?? '').trim();
      const teamSlug = String(body.team ?? '').trim();
      if (!eventSlug || !teamSlug) throw badRequest('Choose a hackathon and a team.', 'missing');
      const event = await requireEvent(eventSlug);
      const team = await d.getTeamBySlug(event.id, teamSlug);
      if (!team) throw notFound('That team does not exist in this hackathon.');
      await joinTeam(event, req.actor!, team.id);
      res.redirect(303, `/teams/${team.id}`);
    } catch (e) {
      next(e);
    }
  });

  r.get('/teams/:teamId', auth, async (req, res, next) => {
    try {
      const d = db();
      const team = await d.getTeam(req.params.teamId);
      if (!team) throw notFound('That team no longer exists.');
      const { role } = await requireTeamAccess({ id: team.event_id }, team.id, req.actor!.id);
      const event = await d.getEventById(team.event_id);
      const members = await d.listTeamMembers(team.id);
      const projects = await d.listProjectsForTeam(team.id);
      const project = projects[0] ?? null;
      const state = event ? eventState(event) : null;
      const issues = project ? await validateSubmission(event, project) : [];
      const tracks = event ? await d.listTracks(event.id) : [];
      await page(res, 'participant/team', req, {
        pageTitle: team.name,
        event, state, team, members, role, project, issues, tracks,
        inviteCode: teamInviteCode(team),
        saved: req.query.saved ?? null,
        submitted: req.query.submitted === '1',
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/teams/:teamId', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const team = await d.getTeam(req.params.teamId);
      if (!team) throw notFound('That team no longer exists.');
      const event = await d.getEventById(team.event_id);
      const { role } = await requireTeamAccess(event, team.id, req.actor!.id);
      const body = req.body as Record<string, string>;
      if (String(body.action) === 'leave') {
        await leaveTeam(event, team, req.actor!.id);
        return void res.redirect(303, '/teams');
      }
      if (String(body.action) === 'delete') {
        await deleteTeam(event, team, req.actor!.id);
        return void res.redirect(303, '/teams');
      }
      await updateTeam(event, team, req.actor!.id, { name: body.name, description: body.description });
      res.redirect(303, `/teams/${team.id}?saved=1`);
      void role;
    } catch (e) {
      next(e);
    }
  });

  r.post('/teams/:teamId/remove-member', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const team = await d.getTeam(req.params.teamId);
      if (!team) throw notFound('That team no longer exists.');
      const event = await d.getEventById(team.event_id);
      const { role } = await requireTeamAccess(event, team.id, req.actor!.id);
      const target = String((req.body as any).user_id ?? '');
      if (role !== 'owner' && target !== req.actor!.id) {
        throw forbidden('Only the team owner can remove somebody else.');
      }
      const member = await d.getTeamMember(team.id, target);
      if (!member) throw notFound('That person is not on this team.');
      if (member.role === 'owner') {
        throw conflict('The team owner cannot be removed. Delete the team or ask them to leave.', 'owner_cannot_leave');
      }
      await d.removeTeamMember(team.id, target);
      res.redirect(303, `/teams/${team.id}?saved=member-removed`);
    } catch (e) {
      next(e);
    }
  });

  // -------------------------------------------------------------- project --
  r.get('/teams/:teamId/project/new', auth, async (req, res, next) => {
    try {
      const d = db();
      const team = await d.getTeam(req.params.teamId);
      if (!team) throw notFound('That team no longer exists.');
      const event = await d.getEventById(team.event_id);
      const { role } = await requireTeamAccess(event, team.id, req.actor!.id);
      assertSubmissionsOpen(event);
      if ((await d.listProjectsForTeam(team.id)).length) {
        throw conflict('This team already has a project. Open it to edit instead.', 'team_already_has_project');
      }
      const project = await createProject(event, team, { title: 'Untitled project' }, req.actor!.id);
      res.redirect(303, `/teams/${team.id}/project/${project.slug}`);
      void role;
    } catch (e) {
      next(e);
    }
  });

  r.get('/teams/:teamId/project/:projectSlug', auth, async (req, res, next) => {
    try {
      const d = db();
      const team = await d.getTeam(req.params.teamId);
      if (!team) throw notFound('That team no longer exists.');
      const event = await d.getEventById(team.event_id);
      const { role } = await requireTeamAccess(event, team.id, req.actor!.id);
      const project = await d.getProjectBySlug(event.id, req.params.projectSlug);
      if (!project || project.team_id !== team.id) throw notFound('That project no longer exists.');
      const state = eventState(event);
      const issues = await validateSubmission(event, project);
      const tracks = await d.listTracks(event.id);
      const canEdit = state.canSubmit;
      await page(res, 'participant/project', req, {
        pageTitle: project.title,
        event, state, team, role, project, issues, tracks, canEdit,
        members: await d.listTeamMembers(team.id),
        fields: Array.isArray(event.submission_fields) ? event.submission_fields : [],
        saved: req.query.saved ?? null,
        submitted: req.query.submitted === '1',
        formError: req.query.error ?? null,
      });
    } catch (e) {
      next(e);
    }
  });

  r.post('/teams/:teamId/project/:projectSlug', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const team = await d.getTeam(req.params.teamId);
      if (!team) throw notFound('That team no longer exists.');
      const event = await d.getEventById(team.event_id);
      await requireTeamAccess(event, team.id, req.actor!.id);
      const project = await d.getProjectBySlug(event.id, req.params.projectSlug);
      if (!project || project.team_id !== team.id) throw notFound('That project no longer exists.');

      const body = req.body as Record<string, any>;
      const answers: Record<string, string> = { ...(project.answers ?? {}) };
      const fields: any[] = Array.isArray(event.submission_fields) ? event.submission_fields : [];
      for (const f of fields) {
        if (['repo_url', 'demo_url', 'video_url', 'docs_url', 'tech_stack'].includes(f.key)) continue;
        const v = body[`field_${f.key}`];
        if (v !== undefined) answers[f.key] = String(v);
      }

      const updated = await updateProject(event, project, req.actor!.id, {
        title: body.title,
        tagline: body.tagline,
        summary: body.summary,
        description: body.description,
        trackId: body.track_id || null,
        techStack: body.tech_stack,
        repoUrl: body.repo_url,
        demoUrl: body.demo_url,
        videoUrl: body.video_url,
        docsUrl: body.docs_url,
        imageUrl: body.image_url,
        answers,
      });

      if (String(body.action) === 'submit') {
        try {
          await submitProject(event, updated, req.actor!.id);
          return void res.redirect(303, `/teams/${team.id}/project/${updated.slug}?submitted=1`);
        } catch (e) {
          const err = e as any;
          return void res.redirect(
            303,
            `/teams/${team.id}/project/${updated.slug}?error=${encodeURIComponent(err.message ?? 'Submission refused')}`,
          );
        }
      }
      if (String(body.action) === 'withdraw') {
        await withdrawSubmission(event, updated, req.actor!.id);
        return void res.redirect(303, `/teams/${team.id}/project/${updated.slug}?saved=withdrawn`);
      }
      res.redirect(303, `/teams/${team.id}/project/${updated.slug}?saved=1`);
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------------- public voting/comment --
  /**
   * Community voting and comments (the "public" tier of the DOGFOOD spec).
   *
   * A signed-in person may vote once per project and comment. Votes do not
   * enter the ranking: results come from the rubric, and the interface says so,
   * because mixing a popularity contest into a judged event is how panels stop
   * being trusted.
   */
  r.post('/projects/:projectId/vote', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const project = await d.getProject(req.params.projectId);
      if (!project || project.status === 'draft') throw notFound('That project no longer exists.');
      const event = await d.getEventById(project.event_id);
      if (event.status === 'draft' || event.showcase_visibility !== 'public') {
        throw notFound('That project is not public.');
      }
      const already = await d.hasVoted(project.id, req.actor!.id);
      if (already) await d.removeVote(project.id, req.actor!.id);
      else await d.addVote(project.id, req.actor!.id, nowIso());
      res.redirect(303, `/hackathons/${event.slug}/projects/${project.slug}#community`);
    } catch (e) {
      next(e);
    }
  });

  r.post('/projects/:projectId/comment', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const project = await d.getProject(req.params.projectId);
      if (!project || project.status === 'draft') throw notFound('That project no longer exists.');
      const event = await d.getEventById(project.event_id);
      if (event.status === 'draft' || event.showcase_visibility !== 'public') {
        throw notFound('That project is not public.');
      }
      const body = String((req.body as any).body ?? '').trim();
      if (body.length < 2) throw badRequest('Write something before posting.', 'empty_comment');
      if (body.length > 1000) throw badRequest('Comments are limited to 1000 characters.', 'comment_too_long');
      await d.addComment({
        id: id('cmt'),
        project_id: project.id,
        user_id: req.actor!.id,
        body,
        hidden: 0,
        created_at: nowIso(),
      });
      res.redirect(303, `/hackathons/${event.slug}/projects/${project.slug}#community`);
    } catch (e) {
      next(e);
    }
  });

  // ------------------------------------------- team invitations (by code) --
  r.get('/join', auth, async (req, res) => {
    const d = db();
    const events = await d.listMemberEvents(req.actor!.id, 'participant');
    const open = (await d.listEvents({ status: ['published', 'live'], listing: true, limit: 100, offset: 0 })).rows;
    await page(res, 'participant/join', req, {
      pageTitle: 'Join a team',
      events: open.filter((e) => !events.some((m) => m.id === e.id)),
      mine: events,
    });
  });

  r.post('/join', auth, limitWrite, async (req, res, next) => {
    try {
      const d = db();
      const body = req.body as Record<string, string>;
      const event = await requireEvent(String(body.event ?? ''));
      const teamSlug = String(body.team ?? '').trim().toLowerCase();
      const team = await d.getTeamBySlug(event.id, teamSlug);
      if (!team) throw notFound('No team with that name in this hackathon. Check the invite message.');
      await joinTeam(event, req.actor!.id, team.id);
      res.redirect(303, `/teams/${team.id}`);
    } catch (e) {
      next(e);
    }
  });

  return wrapRouter(r);
}

function withEvent(fn: (ctx: { req: Request; res: Response; event: any }) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const event = await requireEvent(req.params.slug);
      if (event.status === 'draft') throw notFound('That hackathon is not public yet.');
      await fn({ req, res, event });
    } catch (e) {
      next(e);
    }
  };
}

/** Short, stable join code derived from the team id, so invites can be a link. */
function teamInviteCode(team: any): string {
  return `${slugify(team.name, 'team').slice(0, 18)}`;
}

export { config, id, nowIso, secret, sha256, assertRegistrationOpen, log, teamInviteCode };
