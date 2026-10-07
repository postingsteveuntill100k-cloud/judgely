import { db } from '../db/index.js';
import { id, nowIso, round } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from './audit.js';
import { slugify } from '../lib/ids.js';

export interface CriterionInput {
  key?: string;
  name: string;
  description?: string;
  weight: number;
  maxScore: number;
  required?: boolean;
  sortOrder?: number;
}

export const RUBRIC_PRESET = [
  { key: 'functionality', name: 'Functionality', description: 'Does it do what it claims, end to end?', weight: 30, maxScore: 10 },
  { key: 'technical_quality', name: 'Technical quality', description: 'Architecture, code health, use of the stack.', weight: 25, maxScore: 10 },
  { key: 'originality', name: 'Originality', description: 'Is the idea its own, or a re-skin?', weight: 15, maxScore: 10 },
  { key: 'impact', name: 'Impact', description: 'Who does this help, and how much?', weight: 20, maxScore: 10 },
  { key: 'presentation', name: 'Presentation', description: 'Can a stranger understand it in two minutes?', weight: 10, maxScore: 10 },
];

export async function activeRubric(eventId: string) {
  const d = db();
  const rubric = await d.getActiveRubric(eventId);
  if (!rubric) return { rubric: null, criteria: [] };
  return { rubric, criteria: await d.listCriteria(rubric.id) };
}

const at0 = '';
export async function createRubric(event: any, criteria: CriterionInput[], actorId: string): Promise<any> {
  const d = db();
  const normalized = normalizeCriteria(criteria);
  const existing = (await d.listRubrics(event.id)) as any[];
  if (existing.length) {
    for (const r of existing) await d.archiveRubric(r.id, at0);
  }
  const at = nowIso();
  const rubricId = id('rub');
  const version = (existing[0]?.version ?? 0) + 1;
  await d.createRubric({
    id: rubricId,
    event_id: event.id,
    name: `Rubric v${version}`,
    version,
    status: 'active',
    created_at: at,
  });
  for (const [index, c] of normalized.entries()) {
    await d.createCriterion({
      id: id('cri'),
      rubric_id: rubricId,
      key: c.key,
      name: c.name,
      description: c.description,
      weight: c.weight,
      max_score: c.maxScore,
      required: c.required ? 1 : 0,
      sort_order: index,
    });
  }
  await audit({
    eventId: event.id,
    actorId,
    action: 'rubric.created',
    entityType: 'rubric',
    entityId: rubricId,
    summary: `Created rubric v${version} with ${normalized.length} criteria`,
  });
  return d.getRubric(rubricId);
}

export async function addCriterion(event: any, rubric: any, input: CriterionInput, actorId: string): Promise<any> {
  const d = db();
  const used = await d.listReviews({ eventId: event.id });
  if (used.length) {
    throw conflict(
      'Reviews already exist against this rubric, so criteria cannot be added. Create a new rubric version instead.',
      'rubric_in_use',
    );
  }
  const criteria = await d.listCriteria(rubric.id);
  const key = slugify(input.key || input.name, '').replace(/-/g, '_').slice(0, 40);
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
    throw badRequest('A criterion needs a name made of letters, numbers or underscores.', 'bad_criterion', { field: 'name' });
  }
  if (criteria.some((c) => c.key === key)) {
    throw conflict('A criterion with that key already exists in this rubric.', 'duplicate_criterion', { field: 'key' });
  }
  const maxScore = clampInt(input.maxScore, 1, 100, 10);
  const weight = Number.isFinite(Number(input.weight)) ? Number(input.weight) : 0;
  if (weight < 0 || weight > 100) throw badRequest('Weights must be between 0 and 100.', 'bad_weight', { field: 'weight' });
  const criterion = await d.createCriterion({
    id: id('cri'),
    rubric_id: rubric.id,
    key,
    name: String(input.name).trim().slice(0, 80),
    description: String(input.description ?? '').trim().slice(0, 400),
    weight,
    max_score: maxScore,
    required: input.required === false ? 0 : 1,
    sort_order: criteria.length,
  });
  await audit({ eventId: event.id, actorId, action: 'rubric.criterion_added', entityType: 'rubric', entityId: rubric.id, summary: `Added criterion ${criterion.name}` });
  return criterion;
}

export async function updateCriterion(event: any, criterionId: string, patch: Partial<CriterionInput>, actorId: string): Promise<any> {
  const d = db();
  const criterion = await d.getCriterion(criterionId);
  if (!criterion) throw notFound('That criterion no longer exists.');
  const rubric = await d.getRubric(criterion.rubric_id);
  if (!rubric || rubric.event_id !== event.id) throw forbidden('That criterion belongs to a different hackathon.');
  const used = await d.listReviews({ eventId: event.id });
  if (used.length) {
    throw conflict(
      'Reviews already exist against this rubric, so criteria cannot be modified directly. Create a new rubric version instead.',
      'rubric_in_use',
    );
  }
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw badRequest('A criterion needs a name.', 'bad_criterion', { field: 'name' });
    row.name = name.slice(0, 80);
  }
  if (patch.description !== undefined) row.description = String(patch.description).trim().slice(0, 400);
  if (patch.weight !== undefined) {
    const w = Number(patch.weight);
    if (!Number.isFinite(w) || w < 0 || w > 100) throw badRequest('Weights must be between 0 and 100.', 'bad_weight', { field: 'weight' });
    row.weight = w;
  }
  if (patch.maxScore !== undefined) row.max_score = clampInt(patch.maxScore, 1, 100, criterion.max_score);
  if (patch.required !== undefined) row.required = patch.required ? 1 : 0;
  if (patch.sortOrder !== undefined) row.sort_order = clampInt(patch.sortOrder, 0, 100, criterion.sort_order);
  const updated = await d.updateCriterion(criterionId, row);
  await audit({ eventId: event.id, actorId, action: 'rubric.criterion_updated', entityType: 'rubric', entityId: rubric.id, summary: `Changed criterion ${updated.name}` });
  return updated;
}

export async function removeCriterion(event: any, criterionId: string, actorId: string): Promise<void> {
  const d = db();
  const criterion = await d.getCriterion(criterionId);
  if (!criterion) return;
  const rubric = await d.getRubric(criterion.rubric_id);
  if (!rubric || rubric.event_id !== event.id) throw forbidden('That criterion belongs to a different hackathon.');
  const used = await d.listReviews({ eventId: event.id });
  if (used.length) {
    throw conflict(
      'Reviews already exist against this rubric, so criteria cannot be deleted. Lower the weight to 0 instead, so the history stays intact.',
      'rubric_in_use',
    );
  }
  await d.deleteCriterion(criterionId);
  await audit({ eventId: event.id, actorId, action: 'rubric.criterion_removed', entityType: 'rubric', entityId: rubric.id, summary: `Removed criterion ${criterion.name}` });
}

export function validateWeights(criteria: { weight: number }[]): string[] {
  const sum = criteria.reduce((a, c) => a + Number(c.weight || 0), 0);
  const problems: string[] = [];
  if (!criteria.length) problems.push('A rubric needs at least one criterion.');
  if (Math.abs(sum) > 0.001 && Math.abs(sum - 100) > 0.001) {
    problems.push(`Weights add up to ${round(sum, 2)}. Make them total 100 (or leave them all at 0 for an equal-weight rubric).`);
  }
  return problems;
}

function normalizeCriteria(input: CriterionInput[]): (CriterionInput & { key: string })[] {
  if (!Array.isArray(input) || !input.length) {
    throw badRequest('A rubric needs at least one criterion.', 'empty_rubric');
  }
  const seen = new Set<string>();
  const out: (CriterionInput & { key: string })[] = [];
  for (const [index, raw] of input.entries()) {
    const name = String(raw.name ?? '').trim();
    if (!name) throw badRequest('Every criterion needs a name.', 'bad_criterion', { field: `criteria.${index}.name` });
    let key = slugify(raw.key || name, '').replace(/-/g, '_').slice(0, 40);
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) key = `criterion_${index + 1}`;
    if (seen.has(key)) key = `${key}_${index + 1}`;
    seen.add(key);
    out.push({
      key,
      name: name.slice(0, 80),
      description: String(raw.description ?? '').trim().slice(0, 400),
      weight: Number.isFinite(Number(raw.weight)) ? Number(raw.weight) : 0,
      maxScore: clampInt(raw.maxScore, 1, 100, 10),
      required: raw.required !== false,
      sortOrder: index,
    });
  }
  const problems = validateWeights(out);
  if (problems.length) throw badRequest(problems[0], 'bad_weights');
  return out;
}

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number.parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

// ------------------------------------------------------------- assignments

export async function assignJudge(event: any, judge: any, projectIds: string[], actorId: string): Promise<number> {
  const d = db();
  if (judge.event_id !== event.id) throw forbidden('That judge belongs to a different hackathon.');
  const at = nowIso();
  let created = 0;
  for (const pid of projectIds) {
    const project = await d.getProject(pid);
    if (!project || project.event_id !== event.id) continue;
    const existing = (await d.listAssignments({ eventId: event.id, projectId: pid, limit: 500 })).rows;
    if (existing.some((a) => a.event_judge_id === judge.id)) continue;
    await d.createAssignment({
      id: id('asg'),
      event_id: event.id,
      project_id: pid,
      event_judge_id: judge.id,
      status: 'pending',
      assigned_at: at,
      submitted_at: null,
    });
    created += 1;
  }
  if (created) {
    await d.createNotification({
      id: id('ntf'),
      user_id: judge.user_id ?? 'anonymous',
      event_id: event.id,
      kind: 'assignment',
      title: `${created} new ${created === 1 ? 'project' : 'projects'} to review`,
      body: `The organizers of ${event.name} assigned you work.`,
      link: `/judge/events/${event.slug}`,
      read_at: null,
      created_at: at,
    });
    await audit({
      eventId: event.id,
      actorId,
      action: 'assignment.created',
      entityType: 'event_judge',
      entityId: judge.id,
      summary: `Assigned ${created} ${created === 1 ? 'project' : 'projects'} to ${judge.email}`,
      meta: { count: created },
    });
  }
  return created;
}

export async function removeAssignment(event: any, assignmentId: string, actorId: string): Promise<void> {
  const d = db();
  const assignment = await d.getAssignment(assignmentId);
  if (!assignment || assignment.event_id !== event.id) throw notFound('That assignment no longer exists.');
  const project = await d.getProject(assignment.project_id);
  const judge = await d.getEventJudge(assignment.event_judge_id);
  await d.deleteAssignment(assignmentId);
  await audit({
    eventId: event.id,
    actorId,
    action: 'assignment.deleted',
    entityType: 'assignment',
    entityId: assignmentId,
    summary: `Removed ${judge?.email ?? 'judge'} from ${project?.title ?? assignment.project_id}`,
  });
}

// ----------------------------------------------------------------- reviews

export interface ScoreInput {
  criterionId: string;
  score: number;
  note?: string;
}

/**
 * Save a review.
 *
 * Authorization happens here and only here:
 *  - the actor must hold an active judge record on this event
 *  - the actor must own the assignment they are submitting under
 *  - criterion ids must belong to the event's *current* rubric
 * A client cannot invent a criterion, and cannot read or write another judge's
 * review, because the judge id never comes from the request body.
 */
export async function saveReview(
  event: any,
  assignmentId: string,
  actor: { id: string; name: string; email: string },
  input: {
    scores: ScoreInput[];
    comment: string;
    strengths: string;
    improvements: string;
    recommendation: string;
    submit: boolean;
  },
): Promise<{ review: any; created: boolean }> {
  const d = db();
  const { rubric, criteria } = await activeRubric(event.id);
  if (!rubric) throw conflict('The organizer has not set a judging rubric yet.', 'no_rubric');
  if (rubric.event_id !== event.id) throw forbidden('That rubric belongs to a different hackathon.');

  const assignment = await d.getAssignment(assignmentId);
  if (!assignment || assignment.event_id !== event.id) throw notFound('That assignment no longer exists.');

  const myJudge = await d.getEventJudgeForUser(event.id, actor.id);
  if (!myJudge || myJudge.status !== 'active') throw forbidden('You are not an invited judge for this hackathon.');
  if (assignment.event_judge_id !== myJudge.id) {
    throw forbidden('That review belongs to another judge.');
  }

  const project = await d.getProject(assignment.project_id);
  if (!project || project.event_id !== event.id) throw notFound('That project no longer exists.');
  if (project.status === 'draft') {
    throw conflict('This project has not been submitted yet, so it cannot be judged.', 'not_submitted');
  }

  const byId = new Map(criteria.map((c) => [c.id, c]));
  const clean: ScoreInput[] = [];
  for (const raw of input.scores) {
    const criterion = byId.get(raw.criterionId);
    if (!criterion) {
      // Unknown criteria are rejected outright rather than silently dropped.
      throw badRequest('That criterion is not part of this hackathon’s rubric.', 'unknown_criterion', {
        field: `criterion:${raw.criterionId}`,
      });
    }
    const score = Number(raw.score);
    if (!Number.isFinite(score)) {
      throw badRequest(`Give ${criterion.name} a number between 0 and ${criterion.max_score}.`, 'bad_score', {
        field: `criterion:${criterion.id}`,
      });
    }
    if (score < 0 || score > criterion.max_score) {
      throw badRequest(
        `${criterion.name} must be between 0 and ${criterion.max_score}. You sent ${score}.`,
        'score_out_of_range',
        { field: `criterion:${criterion.id}`, meta: { max: criterion.max_score } },
      );
    }
    if (!Number.isInteger(score)) {
      throw badRequest(`${criterion.name} must be a whole number.`, 'score_not_integer', {
        field: `criterion:${criterion.id}`,
      });
    }
    clean.push({ criterionId: criterion.id, score, note: String(raw.note ?? '').slice(0, 600) });
  }

  const seen = new Set<string>();
  for (const s of clean) {
    if (seen.has(s.criterionId)) {
      throw badRequest('You sent the same criterion twice.', 'duplicate_criterion_score');
    }
    seen.add(s.criterionId);
  }
  const missing = criteria.filter((c) => c.required && !seen.has(c.id));
  if (input.submit && missing.length) {
    throw badRequest(
      `Score every required criterion before submitting. Still missing: ${missing.map((m) => m.name).join(', ')}.`,
      'incomplete_review',
      { meta: { missing: missing.map((m) => m.name) } },
    );
  }

  const weightSum = criteria.reduce((a, c) => a + Number(c.weight || 0), 0);
  const weighted = clean.reduce((acc, s) => {
    const c = byId.get(s.criterionId)!;
    const ratio = c.max_score > 0 ? s.score / c.max_score : 0;
    return acc + ratio * (weightSum > 0 ? c.weight : criteria.length);
  }, 0);
  const denom = weightSum > 0 ? weightSum : criteria.length;
  const weightedScore = denom > 0 ? round((weighted / denom) * 100, 2) : null;

  const at = nowIso();
  let review = await d.getReviewByAssignment(assignmentId);
  const row: Record<string, unknown> = {
    comment: String(input.comment ?? '').slice(0, 4000),
    strengths: String(input.strengths ?? '').slice(0, 2000),
    improvements: String(input.improvements ?? '').slice(0, 2000),
    recommendation: ['strong_yes', 'yes', 'neutral', 'no'].includes(input.recommendation) ? input.recommendation : '',
    weighted_score: weightedScore,
    updated_at: at,
  };
  if (input.submit) {
    row.status = 'submitted';
    row.submitted_at = at;
  }

  let created = false;
  if (!review) {
    created = true;
    review = await d.createReview({
      id: id('rev'),
      assignment_id: assignmentId,
      event_id: event.id,
      project_id: project.id,
      event_judge_id: myJudge.id,
      user_id: actor.id,
      rubric_id: rubric.id,
      status: 'draft',
      comment: '',
      strengths: '',
      improvements: '',
      recommendation: '',
      weighted_score: null,
      submitted_at: null,
      created_at: at,
      updated_at: at,
    });
  } else if (!review.rubric_id) {
    row.rubric_id = rubric.id;
  }
  const updated = await d.updateReview(review.id, row);

  await d.replaceReviewScores(
    review.id,
    clean.map((s) => ({
      criterion_id: s.criterionId,
      score: s.score,
      note: s.note,
    })),
  );

  if (input.submit) {
    await d.updateAssignment(assignmentId, { status: 'submitted', submitted_at: at });
    if (project.status === 'submitted') {
      await d.updateProject(project.id, { status: 'under_review', updated_at: at });
    }
    await audit({
      eventId: event.id,
      actorId: actor.id,
      action: 'review.submitted',
      entityType: 'project',
      entityId: project.id,
      summary: `Submitted a review for ${project.title}`,
    });
  } else if (assignment.status === 'pending') {
    await d.updateAssignment(assignmentId, { status: 'in_progress' });
  }

  return { review: updated, created };
}

export async function reopenReview(event: any, reviewId: string, actorId: string): Promise<void> {
  const d = db();
  const review = await d.getReview(reviewId);
  if (!review || review.event_id !== event.id) throw notFound('That review no longer exists.');
  const project = await d.getProject(review.project_id);
  await d.updateReview(reviewId, { status: 'draft', updated_at: nowIso() });
  await d.updateAssignment(review.assignment_id, { status: 'reopened', submitted_at: null });
  await audit({
    eventId: event.id,
    actorId,
    action: 'review.reopened',
    entityType: 'project',
    entityId: review.project_id,
    summary: `Reopened the review for ${project?.title ?? review.project_id}`,
  });
}

/**
 * The only path that returns review scores to a judge, and it is always
 * scoped to the caller. There is no parameter a client can use to widen it.
 */
export async function myScores(eventId: string, userId: string): Promise<any[]> {
  const d = db();
  const myJudge = await d.getEventJudgeForUser(eventId, userId);
  if (!myJudge) return [];
  const assignments = (await d.listAssignments({ eventId, judgeId: myJudge.id, limit: 5000 })).rows;
  const reviews = await d.listReviews({ eventId, judgeId: myJudge.id });
  const reviewByAssignment = new Map(reviews.map((r: any) => [r.assignment_id, r]));
  const out: any[] = [];
  for (const a of assignments) {
    const review = reviewByAssignment.get(a.id);
    if (!review) continue;
    out.push({
      assignment_id: a.id,
      review_id: review.id,
      project_id: a.project_id,
      project_title: a.project_title,
      project_slug: a.project_slug,
      status: review.status,
      submitted_at: review.submitted_at,
      updated_at: review.updated_at,
      weighted_score: review.weighted_score,
      comment: review.comment,
      recommendation: review.recommendation,
      scores: await d.listScores(review.id),
    });
  }
  return out;
}

export interface ProgressSnapshot {
  projects: number;
  submittedProjects: number;
  assignments: number;
  submittedReviews: number;
  judges: number;
  activeJudges: number;
  coverage: number;
  expectedReviews: number;
  attention: { kind: string; message: string }[];
  perJudge: { id: string; email: string; name: string; assigned: number; done: number; status: string }[];
  perProject: { projectId: string; title: string; reviews: number; judges: number }[];
}

export async function progressFor(event: any): Promise<ProgressSnapshot> {
  const d = db();
  const eventId = typeof event === 'string' ? event : event.id;
  const [projectPage, assignmentPage, judges] = await Promise.all([
    d.listProjects({ eventId, limit: 5000 }),
    d.listAssignments({ eventId, limit: 5000 }),
    d.listEventJudges(eventId),
  ]);
  const projects = projectPage.rows;
  const assignments = assignmentPage.rows;
  const submitted = projects.filter((p) => p.status !== 'draft');
  const activeJudges = judges.filter((j) => j.status === 'active');
  const done = assignments.filter((a) => a.status === 'submitted').length;

  // Single-pass O(M) indexing of assignments by judge and project
  const byJudge = new Map<string, any[]>();
  const byProject = new Map<string, any[]>();
  for (const a of assignments) {
    let jList = byJudge.get(a.event_judge_id);
    if (!jList) {
      jList = [];
      byJudge.set(a.event_judge_id, jList);
    }
    jList.push(a);

    let pList = byProject.get(a.project_id);
    if (!pList) {
      pList = [];
      byProject.set(a.project_id, pList);
    }
    pList.push(a);
  }

  const perJudge = judges.map((j) => {
    const mine = byJudge.get(j.id) ?? [];
    return {
      id: j.id,
      email: j.email,
      name: j.display_name || j.email,
      assigned: mine.length,
      done: mine.filter((a) => a.status === 'submitted').length,
      status: j.status,
    };
  });

  const perProject = submitted.map((p) => {
    const mine = byProject.get(p.id) ?? [];
    return {
      projectId: p.id,
      title: p.title,
      reviews: mine.filter((a) => a.status === 'submitted').length,
      judges: new Set(mine.map((a) => a.event_judge_id)).size,
    };
  });

  const attention: { kind: string; message: string }[] = [];
  const uncovered = perProject.filter((p) => p.judges === 0);
  const thin = perProject.filter((p) => p.judges === 1);
  const behind = perJudge.filter((j) => j.status === 'active' && j.assigned > 0 && j.done < j.assigned);
  const idle = perJudge.filter((j) => j.status === 'invited');
  if (uncovered.length) attention.push({ kind: 'uncovered', message: `${uncovered.length} submitted ${uncovered.length === 1 ? 'project has' : 'projects have'} no judge assigned.` });
  if (thin.length) attention.push({ kind: 'thin', message: `${thin.length} ${thin.length === 1 ? 'project is' : 'projects are'} covered by a single judge.` });
  if (behind.length) attention.push({ kind: 'behind', message: `${behind.length} ${behind.length === 1 ? 'judge has' : 'judges have'} an unfinished batch.` });
  if (idle.length) attention.push({ kind: 'unaccepted', message: `${idle.length} ${idle.length === 1 ? 'invitation is' : 'invitations are'} still unaccepted.` });
  if (submitted.length > 0 && assignmentPage.total > 0 && done === assignmentPage.total) {
    attention.push({ kind: 'ready_for_results', message: `All ${done} assigned reviews are submitted! Results are ready to review and publish.` });
  }

  return {
    projects: projectPage.total,
    submittedProjects: submitted.length,
    assignments: assignmentPage.total,
    submittedReviews: done,
    judges: judges.length,
    activeJudges: activeJudges.length,
    coverage: submitted.length ? Math.round((perProject.filter((p) => p.judges > 0).length / submitted.length) * 100) : 0,
    expectedReviews: assignmentPage.total,
    attention,
    perJudge,
    perProject,
  };
}
