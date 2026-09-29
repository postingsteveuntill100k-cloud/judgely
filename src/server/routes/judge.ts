import { wrapRouter } from './safe.js';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { db } from '../db/index.js';
import { page, intParam, strParam } from './helpers.js';
import { requireAuth, ipOf } from '../middleware/session.js';
import { limitReview, limitWrite } from '../middleware/guards.js';
import { eventState } from '../services/events.js';
import { activeRubric, saveReview, myScores, progressFor } from '../services/judging.js';
import { resultsArePublic } from '../services/results.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { validateSubmission } from '../services/projects.js';
import { notify } from '../services/notify.js';
import { safeUrl } from '../lib/format.js';

export function judgeRoutes(): Router {
  const r = Router();
  r.use(requireAuth);

  /** Load the event and the caller's judge record. Nothing else is allowed in. */
  r.param('slug', async (req, _res, next, slug) => {
    try {
      const d = db();
      const event = await d.getEventBySlug(slug);
      if (!event) throw notFound('We could not find that hackathon.');
      const judges = await d.listEventJudges(event.id);
      const me = judges.find((j) => j.user_id === req.actor!.id && j.status === 'active');
      if (!me) {
        throw forbidden('You are not an active judge for this hackathon. Open the invitation the organizer sent you.');
      }
      (req as any).judgeEvent = event;
      (req as any).judgeRecord = me;
      next();
    } catch (e) {
      next(e);
    }
  });

  r.get('/events', async (req, res) => {
    const d = db();
    const events = await d.listJudgeEvents(req.actor!.id);
    const rows: any[] = [];
    for (const e of events) {
      const { rows: assignments } = await d.listAssignments({ judgeId: e.id, limit: 2000 });
      rows.push({
        ...e,
        state: eventState(e),
        pending: assignments.filter((a) => a.status !== 'submitted').length,
        total: assignments.length,
        done: assignments.filter((a) => a.status === 'submitted').length,
      });
    }
    await page(res, 'judge/events', req, { pageTitle: 'Judging', events: rows }, 200, 'judge');
  });

  r.get('/reviews', async (req, res) => {
    const d = db();
    const events = await d.listJudgeEvents(req.actor!.id);
    const all: any[] = [];
    for (const e of events) {
      const { rows } = await d.listAssignments({ judgeId: e.id, limit: 2000 });
      for (const a of rows) {
        all.push({ ...a, event_name: e.event_name, event_slug: e.event_slug });
      }
    }
    const filter = strParam(req.query.status, 20);
    const rows = filter === 'done' ? all.filter((a) => a.status === 'submitted') : filter === 'open' ? all.filter((a) => a.status !== 'submitted') : all;
    const nextUp = all.filter((a) => a.status !== 'submitted').sort((a, b) => String(a.assigned_at).localeCompare(String(b.assigned_at)));
    await page(res, 'judge/reviews', req, {
      pageTitle: 'My reviews',
      assignments: rows.sort((a, b) => String(a.assigned_at).localeCompare(String(b.assigned_at))),
      filter, nextUp: nextUp[0] ?? null, total: all.length,
    }, 200, 'judge');
  });

  r.get('/events/:slug', async (req, res) => {
    const d = db();
    const event = (req as any).judgeEvent;
    const me = (req as any).judgeRecord;
    const { rows } = await d.listAssignments({ judgeId: me.id, limit: 2000 });
    const { criteria } = await activeRubric(event.id);
    const progress = await progressFor(event);
    const byId = new Map(progress.perJudge.map((j) => [j.id, j]));
    await page(res, 'judge/event', req, {
      pageTitle: `Reviewing ${event.name}`,
      event, state: eventState(event), me, assignments: rows, criteria,
      resultsPublic: await resultsArePublic(event),
      mine: byId.get(me.id) ?? { assigned: rows.length, done: 0 },
    }, 200, 'judge');
  });

  /**
   * The review workspace. Everything a judge needs to score a project lives on
   * this one screen: the submission, the rubric, the requirement checklist, and
   * the submit button.
   */
  r.get('/review/:assignmentId', async (req, res, next) => {
    const d = db();
    const { rows } = await d.listAssignments({ limit: 5000, offset: 0 });
    const assignment = rows.find((a) => a.id === req.params.assignmentId);
    if (!assignment) return next(notFound('That assignment no longer exists.'));
    const event = await d.getEventById(assignment.event_id);
    if (!event) return next(notFound('That hackathon no longer exists.'));
    const judges = await d.listEventJudges(event.id);
    const me = judges.find((j) => j.user_id === req.actor!.id && j.status === 'active');
    if (!me) return next(forbidden('You are not an active judge for this hackathon.'));
    // The backend, not the template, is what stops one judge opening another's work.
    if (assignment.event_judge_id !== me.id) {
      return next(forbidden('That review belongs to another judge. You can only open your own assignments.'));
    }

    const project = await d.getProject(assignment.project_id);
    if (!project) return next(notFound('That project no longer exists.'));
    const { rubric, criteria } = await activeRubric(event.id);
    if (!rubric) return next(badRequest('The organizer has not published a rubric for this hackathon yet.', 'no_rubric'));
    const review = await d.getReviewByAssignment(assignment.id);
    const scores = review ? await d.listScores(review.id) : [];
    const members = await d.listTeamMembers(project.team_id);
    const team = await d.getTeam(project.team_id);
    const issues = await validateSubmission(event, project);
    const siblings = (await d.listAssignments({ judgeId: me.id, limit: 2000 })).rows
      .sort((a, b) => String(a.assigned_at).localeCompare(String(b.assigned_at)));
    const idx = siblings.findIndex((a) => a.id === assignment.id);
    const queue = siblings.filter((a) => a.status !== 'submitted');
    const state = eventState(event);
    const resultsPublic = await resultsArePublic(event);

    await page(res, 'judge/review', req, {
      pageTitle: `Review ${project.title}`,
      event, state, assignment, project, team, members, criteria, rubric, review, scores,
      issues, queue: queue.length, nextUp: queue.find((a) => a.id !== assignment.id) ?? null,
      position: idx + 1, of: siblings.length, resultsPublic,
      formError: null, formIssues: [],
      comment: review ? review.comment : '',
      strengths: review ? review.strengths : '',
      improvements: review ? review.improvements : '',
      recommendation: review ? review.recommendation : '',
      fields: Array.isArray(event.submission_fields) ? event.submission_fields : [],
    }, 200, 'judge');
  });

  r.post('/review/:assignmentId', limitReview, async (req, res, next) => {
    const d = db();
    const body = req.body as Record<string, any>;
    const { rows } = await d.listAssignments({ limit: 5000, offset: 0 });
    const assignment = rows.find((a) => a.id === req.params.assignmentId);
    if (!assignment) return next(notFound('That assignment no longer exists.'));
    const event = await d.getEventById(assignment.event_id);
    if (!event) return next(notFound('That hackathon no longer exists.'));
    const judges = await d.listEventJudges(event.id);
    const me = judges.find((j) => j.user_id === req.actor!.id && j.status === 'active');
    if (!me || assignment.event_judge_id !== me.id) {
      return next(forbidden('That review belongs to another judge.'));
    }
    // The judge id is taken from the session, never from the request body.
    delete body.event_judge_id;
    delete body.judge_id;
    delete body.user_id;
    delete body.project_id;
    delete body.event_id;

    const { criteria } = await activeRubric(event.id);
    const scores: { criterionId: string; score: number; note: string }[] = [];
    for (const c of criteria) {
      const raw = body[`criterion_${c.id}`];
      const note = String(body[`note_${c.id}`] ?? '').slice(0, 600);
      if (raw === undefined || raw === '') {
        if (c.required && String(body.action) === 'submit') {
          // saveReview reports this properly; leave it to the service so the
          // error message names every missing criterion.
        }
        continue;
      }
      scores.push({ criterionId: c.id, score: Number(raw), note });
    }
    // The submit buttons all post action=submit and vary `then`.
    const submit = String(body.action) === 'submit';
    try {
      const { review } = await saveReview(
        event,
        assignment.id,
        { id: req.actor!.id, name: req.actor!.displayName, email: req.actor!.email },
        {
          scores,
          comment: String(body.comment ?? ''),
          strengths: String(body.strengths ?? ''),
          improvements: String(body.improvements ?? ''),
          recommendation: String(body.recommendation ?? ''),
          submit,
        },
      );
      if (submit) {
        const queue = (await d.listAssignments({ judgeId: me.id, limit: 2000 })).rows.filter((a) => a.status !== 'submitted');
        const nextUp = queue.find((a) => a.id !== assignment.id);
        if (String(body.then) === 'next' && nextUp) {
          return void res.redirect(303, `/judge/review/${nextUp.id}`);
        }
        if (String(body.then) === 'done') {
          await notify({
            userId: req.actor!.id,
            eventId: event.id,
            kind: 'judge',
            title: `Review saved for ${assignment.project_title}`,
            body: 'Your review is submitted. It stays private to you and the organizers.',
            link: `/judge/events/${event.slug}`,
          });
          return void res.redirect(303, `/judge/events/${event.slug}?done=${review.id.slice(-6)}`);
        }
        return void res.redirect(303, `/judge/review/${assignment.id}?submitted=1`);
      }
      res.redirect(303, `/judge/review/${assignment.id}?saved=1`);
    } catch (e) {
      // Re-render with the error rather than dumping the judge on a blank page.
      const project = await d.getProject(assignment.project_id);
      const { rubric, criteria: crit } = await activeRubric(event.id);
      const siblings = (await d.listAssignments({ judgeId: me.id, limit: 2000 })).rows;
      const review = await d.getReviewByAssignment(assignment.id);
      const scores2 = review ? await d.listScores(review.id) : [];
      return page(res, 'judge/review', req, {
        pageTitle: `Review ${project?.title ?? ''}`,
        event, state: eventState(event), assignment, project,
        team: project ? await d.getTeam(project.team_id) : null,
        members: project ? await d.listTeamMembers(project.team_id) : [],
        criteria: crit, rubric, review, scores: scores2,
        issues: project ? await validateSubmission(event, project) : [],
        queue: siblings.filter((a) => a.status !== 'submitted').length,
        nextUp: null, position: siblings.findIndex((a) => a.id === assignment.id) + 1,
        of: siblings.length, resultsPublic: false,
        fields: Array.isArray(event.submission_fields) ? event.submission_fields : [],
        formError: (e as any).message,
        formIssues: (e as any).meta?.issues ?? [],
        submitted: scores,
        comment: String(body.comment ?? ''),
        strengths: String(body.strengths ?? ''),
        improvements: String(body.improvements ?? ''),
        recommendation: String(body.recommendation ?? ''),
        ip: ipOf(req),
      }, (e as any).status ?? 400, 'judge');
    }
  });

  /** Side-by-side comparison. Only the current judge's own scores are shown. */
  r.get('/events/:slug/compare', async (req, res) => {
    const d = db();
    const event = (req as any).judgeEvent;
    const me = (req as any).judgeRecord;
    const ids = [req.query.a, req.query.b, req.query.c].map((v) => strParam(v, 60)).filter(Boolean);
    const { rows } = await d.listAssignments({ judgeId: me.id, limit: 2000 });
    const chosen = ids.map((id) => rows.find((a) => a.id === id)).filter(Boolean);
    if (!chosen.length) {
      const queue = rows.filter((a) => a.status !== 'submitted');
      return res.redirect(303, `/judge/events/${event.slug}`);
    }
    const { criteria } = await activeRubric(event.id);
    const cards: any[] = [];
    for (const a of chosen) {
      const project = await d.getProject(a.project_id);
      const review = await d.getReviewByAssignment(a.id);
      cards.push({
        assignment: a,
        project,
        team: await d.getTeam(a.project_id ? (project as any).team_id : ''),
        review,
        scores: review ? await d.listScores(review.id) : [],
        issues: project ? await validateSubmission(event, project) : [],
      });
    }
    const queue = rows.filter((a) => a.status !== 'submitted');
    await page(res, 'judge/compare', req, {
      pageTitle: `Compare — ${event.name}`,
      event, state: eventState(event), cards, criteria,
      available: rows.map((a) => ({ id: a.id, title: a.project_title, done: a.status === 'submitted' })),
      queue: queue.length,
    }, 200, 'judge');
  });

  r.get('/me/scores', async (req, res) => {
    const d = db();
    const events = await d.listJudgeEvents(req.actor!.id);
    const out: any[] = [];
    for (const e of events) out.push(...(await myScores(e.id, req.actor!.id)));
    res.json({ judge: req.actor!.username, reviews: out });
  });

  return wrapRouter(r);
}

export { intParam, limitWrite, safeUrl };
