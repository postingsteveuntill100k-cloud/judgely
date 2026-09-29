import { wrapRouter } from './safe.js';
import { Router, type Request } from 'express';
import { db } from '../db/index.js';
import { page, intParam, strParam, loadPublicEvent, viewerContext, navFor } from './helpers.js';
import { eventState, listPublicEvents } from '../services/events.js';
import { limitPublicRead } from '../middleware/guards.js';
import { cacheKey, cacheGet, cacheSet } from '../lib/cache.js';
import { safeUrl } from '../lib/format.js';
import { requireAuth } from '../middleware/session.js';
import { badRequest } from '../lib/errors.js';
import { validateSubmission } from '../services/projects.js';

export function publicRoutes(): Router {
  const r = Router();
  r.use(limitPublicRead);

  // ---------------------------------------------------------------- home --
  r.get('/', async (req, res) => {
    const d = db();
    const key = cacheKey('home');
    let events = cacheGet<any[]>(key);
    if (!events) {
      const all = await d.listEvents({ status: ['published', 'live', 'closed'], listing: true, limit: 60, offset: 0, order: 'soon' });
      events = all.rows.map((e) => ({ ...e, state: eventState(e) }));
      cacheSet(key, events, 20);
    }
    const now = Date.now();
    const open = events.filter((e) => e.state.canRegister);
    const upcoming = events.filter((e) => !e.state.canRegister && e.state.phase !== 'archived' && new Date(e.ends_at ?? e.submission_deadline ?? 0).getTime() > now);
    const featured = [...open, ...upcoming].slice(0, 3);
    const past = events.filter((e) => new Date(e.ends_at ?? e.submission_deadline ?? 0).getTime() <= now).slice(0, 6);

    const galleryKey = cacheKey('home-projects');
    let showcase = cacheGet<any>(galleryKey);
    if (!showcase) {
      const res2 = await d.listProjects({ publicOnly: true, limit: 6, offset: 0 });
      showcase = res2.rows;
      cacheSet(galleryKey, showcase, 30);
    }
    const platform = await d.platformCounts().catch(() => ({ users: 0, events: 0, projects: 0, reviews: 0 }));

    await page(res, 'public/home', req, {
      pageTitle: '',
      metaDescription:
        'Hackerly is a hackathon platform. Browse hackathons with real prizes and dates, join a team, submit a project, and get it judged against a published rubric.',
      featured,
      past,
      showcase,
      platform,
      openCount: open.length,
    }, 200, 'home');
  });

  // --------------------------------------------------------- discovery --
  r.get('/hackathons', async (req, res) => {
    const d = db();
    const q = strParam(req.query.q, 80);
    const status = strParam(req.query.status, 20);
    const order = strParam(req.query.order, 20) || 'soon';
    const format = strParam(req.query.format, 20);
    const pageNo = intParam(req.query.page, 1);
    const perPage = 12;

    const filters: { q: string; order: string } = { q, order };
    const all = await listPublicEvents({ q: filters.q, limit: 200, offset: 0, order: filters.order });
    let rows = all.rows.map((e) => ({ ...e, state: eventState(e) }));
    if (status === 'open') rows = rows.filter((e) => e.state.canRegister);
    else if (status === 'live') rows = rows.filter((e) => e.state.phase === 'building' || e.state.phase === 'judging');
    else if (status === 'closed') rows = rows.filter((e) => ['judging', 'results', 'archived'].includes(e.state.phase));
    if (format) rows = rows.filter((e) => e.format === format);
    if (order === 'prize') rows.sort((a, b) => (b.prize_pool_cents ?? 0) - (a.prize_pool_cents ?? 0));

    const total = rows.length;
    const items = rows.slice((pageNo - 1) * perPage, pageNo * perPage);
    const counts = await attachCounts(items);

    await page(res, 'public/hackathons', req, {
      pageTitle: 'Explore hackathons',
      metaDescription: 'Every hackathon on Hackerly: prize pools, dates, formats, tracks and whether registration is still open.',
      events: items,
      counts,
      total,
      page: pageNo,
      pages: Math.max(1, Math.ceil(total / perPage)),
      filters: { q, status, order, format },
      openCount: rows.filter((e) => e.state.canRegister).length,
    }, 200, 'hackathons');
  });

  // ------------------------------------------------- public gallery (/projects)
  // The showcase is the platform's front window. It must work with no account.
  r.get('/projects', async (req, res) => {
    const d = db();
    const q = strParam(req.query.q, 80);
    const track = strParam(req.query.track, 40);
    const eventSlug = strParam(req.query.event, 60);
    const sort = strParam(req.query.sort, 20) || 'recent';
    const pageNo = intParam(req.query.page, 1);
    const perPage = 24;

    const all = await d.listProjects({ publicOnly: true, q, limit: 400, offset: 0, sort: sort === 'oldest' ? 'oldest' : 'recent' });
    let rows = all.rows;
    if (track) rows = rows.filter((p) => p.track_slug === track);
    if (eventSlug) rows = rows.filter((p) => p.event_slug === eventSlug);

    const total = rows.length;
    const items = rows.slice((pageNo - 1) * perPage, pageNo * perPage);
    const eventsForFilter = await d.listEvents({ status: ['published', 'live', 'closed'], listing: true, limit: 60, offset: 0, order: 'soon' });
    const trackNames = [...new Map(rows.filter((p) => p.track_name).map((p) => [p.track_slug, p.track_name])).entries()];

    await page(res, 'public/gallery', req, {
      pageTitle: 'Project showcase',
      metaDescription: 'Projects built at hackathons running on Hackerly. Look at what people actually shipped.',
      projects: items,
      total,
      page: pageNo,
      pages: Math.max(1, Math.ceil(total / perPage)),
      events: eventsForFilter.rows,
      trackNames,
      filters: { q, track, event: eventSlug, sort },
    }, 200, 'hackathons');
  });

  /** Short link: /projects/<id> resolves and redirects to the canonical URL. */
  r.get('/projects/:id', async (req, res, next) => {
    const d = db();
    const project = await d.getProject(req.params.id);
    if (!project || project.status === 'draft') return next();
    const event = await d.getEventById(project.event_id);
    if (!event || event.status === 'draft') return next();
    res.redirect(301, `/hackathons/${event.slug}/projects/${project.slug}`);
  });

  // ------------------------------------------------------- event microsite --
  r.get('/hackathons/:slug', async (req, res, next) => {
    const d = db();
    let event;
    try {
      event = await loadPublicEvent(req.params.slug);
    } catch {
      return next();
    }
    const [tracks, teams, projects, judges, announcements, resultRows] = await Promise.all([
      d.listTracks(event.id),
      d.listTeams(event.id, { limit: 500, offset: 0 }),
      d.listProjects({ eventId: event.id, status: ['submitted', 'under_review', 'results_released'], limit: 12, offset: 0 }),
      d.listEventJudges(event.id, { status: 'active' }),
      d.listAnnouncements(event.id, 6),
      d.listResults(event.id, true),
    ]);
    const state = eventState(event);
    const ctx = await viewerContext(event, req);
    const totalProjects = (await d.listProjects({ eventId: event.id, status: ['submitted', 'under_review', 'results_released'], limit: 1, offset: 0 })).total;
    const allTeams = await d.listTeams(event.id, { limit: 1, offset: 0 });

    await page(res, 'public/event', req, {
      pageTitle: event.name,
      metaDescription: event.tagline || event.description.slice(0, 150),
      event,
      state,
      tracks,
      teams: teams.rows,
      teamCount: allTeams.total,
      projects: projects.rows,
      projectCount: totalProjects,
      judges: judges.filter((j) => j.display_name || j.username).slice(0, 12),
      judgeCount: judges.length,
      announcements,
      results: resultRows,
      viewer: ctx,
      organizer: event.organizer_name,
    }, 200, 'hackathons');
  });

  r.get('/hackathons/:slug/tracks/:trackSlug', async (req, res, next) => {
    const d = db();
    let event;
    try {
      event = await loadPublicEvent(req.params.slug);
    } catch {
      return next();
    }
    const track = await d.getTrackBySlug(event.id, req.params.trackSlug);
    if (!track) return next();
    const projects = await d.listProjects({ eventId: event.id, trackId: track.id, status: ['submitted', 'under_review', 'results_released'], limit: 100, offset: 0 });
    const tracks = await d.listTracks(event.id);
    const state = eventState(event);
    const ctx = await viewerContext(event, req);
    await page(res, 'public/track', req, {
      pageTitle: `${track.name} — ${event.name}`,
      event, state, track, tracks, projects: projects.rows, total: projects.total, viewer: ctx,
    }, 200, 'hackathons');
  });

  r.get('/hackathons/:slug/projects', async (req, res, next) => {
    const d = db();
    let event;
    try {
      event = await loadPublicEvent(req.params.slug);
    } catch {
      return next();
    }
    const trackSlug = strParam(req.query.track, 40);
    const q = strParam(req.query.q, 60);
    const pageNo = intParam(req.query.page, 1);
    const perPage = 12;
    const tracks = await d.listTracks(event.id);
    const track = trackSlug ? tracks.find((t) => t.slug === trackSlug) : null;
    const result = await d.listProjects({
      eventId: event.id,
      trackId: track?.id,
      q,
      status: ['submitted', 'under_review', 'results_released'],
      limit: 400,
      offset: 0,
    });
    const items = result.rows.slice((pageNo - 1) * perPage, pageNo * perPage);
    const state = eventState(event);
    const ctx = await viewerContext(event, req);
    await page(res, 'public/event-projects', req, {
      pageTitle: `Projects — ${event.name}`,
      event, state, tracks, track, projects: items, total: result.total,
      page: pageNo, pages: Math.max(1, Math.ceil(result.total / perPage)), filters: { track: trackSlug, q },
      viewer: ctx,
    }, 200, 'hackathons');
  });

  r.get('/hackathons/:slug/projects/:projectSlug', async (req, res, next) => {
    const d = db();
    let event;
    try {
      event = await loadPublicEvent(req.params.slug);
    } catch {
      return next();
    }
    const project = await d.getProjectBySlug(event.id, req.params.projectSlug);
    if (!project) return next();
    if (project.status === 'draft') return next();
    if (event.showcase_visibility !== 'public' && !(await d.isOrganizer(event.id, req.actor ? req.actor.id : ''))) {
      // Projects stay private until the organizer opens the showcase.
      if (!req.actor) return next();
    }
    await renderPublicProject(res, req, project, d, event);
  });

  r.get('/hackathons/:slug/results', async (req, res, next) => {
    const d = db();
    let event;
    try {
      event = await loadPublicEvent(req.params.slug);
    } catch {
      return next();
    }
    const state = eventState(event);
    const published = state.results === 'published';
    if (!published) {
      const counts = await d.countProjectsByStatus(event.id).catch(() => ({ submitted: 0, under_review: 0, results_released: 0 }));
      const projectCount = (counts.submitted || 0) + (counts.under_review || 0) + (counts.results_released || 0);
      await page(res, 'public/results-pending', req, {
        pageTitle: `Results — ${event.name}`,
        event, state, published: false, projectCount,
      }, 200, 'hackathons');
      return;
    }
    const rows = await d.listResults(event.id, true);
    const tracks = await d.listTracks(event.id);
    const prizes = await d.listResultPrizes(event.id);
    const isOrganizer = req.actor ? await d.isOrganizer(event.id, req.actor.id) : false;
    await page(res, 'public/results', req, {
      pageTitle: `Results — ${event.name}`,
      event, state, published: true, results: rows, tracks, prizes, isOrganizer,
    }, 200, 'hackathons');
  });

  // ------------------------------------------------------------- profiles --
  r.get('/u/:username', async (req, res, next) => {
    const d = db();
    const user = await d.getUserByUsername(req.params.username);
    if (!user) return next();
    const teams = await d.listTeamsForUser(user.id);
    const projectIds = [...new Set(teams.map((t) => t.project_id).filter(Boolean))];
    const allProjects = await d.listProjects({ publicOnly: true, limit: 800, offset: 0 });
    const projects = allProjects.rows.filter((p) => projectIds.includes(p.id) || p.team_id === user.id);
    const events = await d.listMemberEvents(user.id, 'participant');
    const judges = await d.listJudgeEvents(user.id);
    await page(res, 'public/profile', req, {
      pageTitle: `${user.display_name} (@${user.username})`,
      metaDescription: user.bio || `Projects and hackathons by ${user.display_name} on Hackerly.`,
      user, projects, events, judges,
    }, 200);
  });

  // --------------------------------------------------------- landing pages --
  r.get('/host', async (req, res) => {
    const counts = await db().platformCounts().catch(() => ({ users: 0, events: 0, projects: 0, reviews: 0 }));
    await page(res, 'public/host-landing', req, {
      pageTitle: 'Host a hackathon',
      metaDescription: 'Run a complete hackathon on Hackerly: tracks, teams, submissions, judge invitations, weighted rubrics, results and exports.',
      counts,
    }, 200, 'host');
  });

  r.get('/judge', async (req, res) => {
    await page(res, 'public/judge-landing', req, {
      pageTitle: 'Judge at Hackerly',
      metaDescription: 'Review assigned projects against a published rubric, explain your scores, and move on to the next one.',
    }, 200, 'judge');
  });

  r.get('/about', async (req, res) => {
    const counts = await db().platformCounts().catch(() => ({ users: 0, events: 0, projects: 0, reviews: 0 }));
    await page(res, 'public/about', req, {
      pageTitle: 'About Hackerly',
      metaDescription: 'What Hackerly is, how judging works, and how to run it yourself.',
      counts,
    }, 200, 'about');
  });

  r.get('/testing', async (req, res) => {
    await page(res, 'public/testing', req, {
      pageTitle: 'Testing & Verification',
      metaDescription: 'System verification console covering DOGFOOD acceptance tiers T1 and T2, security tests, and cloud deployment.',
    }, 200, 'testing');
  });

  // ------------------------------------------------------------ dashboard --
  r.get('/dashboard', requireAuth, async (req, res) => {
    const d = db();
    const actor = req.actor!;
    const events = await d.listMemberEvents(actor.id);
    const organized = await d.listEventsForOrganizer(actor.id, 50, 0);
    const teams = await d.listTeamsForUser(actor.id);
    const judges = await d.listJudgeEvents(actor.id);
    const notifications = await d.listNotifications(actor.id, 8);
    const assignments = judges.length
      ? (await Promise.all(judges.map((j) => d.listAssignments({ judgeId: j.id, limit: 500 })))).flat()
      : [];
    const projects: any[] = [];
    for (const t of teams) {
      const list = await d.listProjectsForTeam(t.id);
      if (list[0]) projects.push({ ...list[0], team_name: t.name, event_slug: t.event_slug });
    }
    await page(res, 'app/dashboard', req, {
      pageTitle: 'Dashboard',
      events, organized: organized.rows, teams, judges, notifications, projects, assignments,
    }, 200);
  });

  r.get('/settings/profile', requireAuth, async (req, res) => {
    const user = await db().getUserById(req.actor!.id);
    await page(res, 'app/profile-settings', req, { pageTitle: 'Profile settings', user, saved: req.query.saved === '1' }, 200);
  });

  r.post('/settings/profile', requireAuth, async (req, res, next) => {
    const d = db();
    const body = req.body as Record<string, string>;
    const username = String(body.username ?? '').trim().toLowerCase().replace(/^@/, '');
    if (!/^[a-z][a-z0-9_-]{2,23}$/.test(username)) {
      return next(badRequest('Usernames start with a letter, then 2-23 letters, numbers, underscores or hyphens.', 'bad_username', { field: 'username' }));
    }
    const existing = await d.getUserByUsername(username);
    if (existing && existing.id !== req.actor!.id) {
      return next(badRequest('That username is taken. Try another one.', 'username_taken', { field: 'username' }));
    }
    const displayName = String(body.display_name ?? '').trim();
    if (displayName.length < 2) return next(badRequest('Add a name people will recognise.', 'bad_name', { field: 'display_name' }));
    await d.updateUser(req.actor!.id, {
      username,
      username_lower: username,
      display_name: displayName.slice(0, 60),
      headline: String(body.headline ?? '').trim().slice(0, 90),
      bio: String(body.bio ?? '').trim().slice(0, 500),
      location: String(body.location ?? '').trim().slice(0, 60),
      website_url: safeUrl(body.website_url),
      github_url: safeUrl(body.github_url),
      linkedin_url: safeUrl(body.linkedin_url),
      avatar_url: safeUrl(body.avatar_url),
      onboarded: 1,
      updated_at: new Date().toISOString(),
    });
    res.redirect(303, '/settings/profile?saved=1');
  });

  return wrapRouter(r);
}

async function renderPublicProject(res: any, req: Request, project: any, d: any, event?: any) {
  const ev = event ?? (await d.getEventById(project.event_id));
  const isOrganizer = req.actor ? await d.isOrganizer(ev.id, req.actor.id) : false;
  const members = await d.listTeamMembers(project.team_id);
  const track = project.track_id ? await d.getTrack(project.track_id) : null;
  const result = await d.getResultForProject(ev.id, project.id);
  const publishedResult = result && result.published_at ? result : null;
  const comments = ev.showcase_visibility === 'public' ? await d.listComments(project.id, 20) : [];
  const votes = await d.countVotes(project.id);
  const voted = req.actor ? await d.hasVoted(project.id, req.actor.id) : false;
  const state = eventState(ev);
  const fields: any[] = Array.isArray(ev.submission_fields) ? ev.submission_fields : [];
  const issues = req.actor && !isOrganizer && project.team_id
    ? (await d.getTeamMember(project.team_id, req.actor!.id)) ? await validateSubmission(ev, project) : []
    : [];
  await page(res, 'public/project', req, {
    pageTitle: project.title,
    metaDescription: project.tagline || project.summary || `A project from ${ev.name} on Hackerly.`,
    project, event: ev, state, members, track, result: publishedResult, comments, votes, voted, isOrganizer, fields, issues,
  }, 200, 'hackathons');
}

async function attachCounts(events: any[]) {
  const d = db();
  const out: Record<string, { projects: number; teams: number }> = {};
  for (const e of events) {
    const [p, t] = await Promise.all([
      d.listProjects({ eventId: e.id, status: ['submitted', 'under_review', 'results_released'], limit: 1, offset: 0 }),
      d.listTeams(e.id, { limit: 1, offset: 0 }),
    ]);
    out[e.id] = { projects: p.total, teams: t.total };
  }
  return out;
}

export { navFor };
