/** Below this many scored projects, a track is not scaled to 0-100. */
export const MIN_TRACK_SIZE_FOR_SCALING = 5;

/**
 * Result aggregation and optional normalization.
 *
 * The method is deliberately conservative and fully documented in JUDGING.md.
 * Everything below is deterministic: the same reviews always produce the same
 * ranking, byte for byte, on any machine.
 *
 * Step 1  review score   each review is turned into 0-100 using its own rubric
 * Step 2  project score  mean of that project's submitted review scores
 * Step 3  panel offset   each judge's mean deviation from the panel mean is
 *                       measured; `lambda` scales how much of it is removed
 * Step 4  normalization  the adjusted scores are min-max scaled inside each
 *                       track so a track is not dominated by its own scale
 * Step 5  ranking       competition ranking with deterministic tie-breaks
 */
import { db } from '../db/index.js';
import { id, nowIso, round } from '../lib/ids.js';
import { audit } from './audit.js';
import { notifyTeam } from './notify.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';

export interface ScoreDetail {
  review_id: string;
  judge_id: string;
  judge_email: string;
  score: number;
  submitted_at: string | null;
}

export interface ProjectResult {
  project_id: string;
  project_title: string;
  team_name: string;
  track_id: string | null;
  track_name: string;
  track_color: string;
  review_count: number;
  raw_score: number | null;
  adjusted_score: number | null;
  final_score: number | null;
  judge_offset: number | null;
  rank: number | null;
  track_rank: number | null;
  per_judge: ScoreDetail[];
  notes: string[];
}

export interface ResultsBundle {
  event_id: string;
  computed_at: string;
  method: 'raw' | 'normalized';
  lambda: number;
  weight_sum: number;
  judges: number;
  reviews: number;
  projects: ProjectResult[];
  diagnostics: string[];
}

/** Weighted 0-100 score of one review, recomputed from the stored criterion scores. */
function reviewScore(scores: { criterion_id: string; score: number }[], criteria: any[]): number | null {
  if (!criteria.length) return null;
  const byId = new Map(criteria.map((c) => [c.id, c]));
  const weightSum = criteria.reduce((a, c) => a + Number(c.weight || 0), 0);
  const denom = weightSum > 0 ? weightSum : criteria.length;
  let acc = 0;
  let counted = 0;
  for (const s of scores) {
    const c = byId.get(s.criterion_id);
    if (!c) continue;
    const ratio = c.max_score > 0 ? s.score / c.max_score : 0;
    acc += ratio * (weightSum > 0 ? c.weight : criteria.length);
    counted += 1;
  }
  if (!counted) return null;
  return round((acc / denom) * 100, 4);
}

export async function computeResults(eventOrId: any, opts: { publish?: boolean } = {}): Promise<ResultsBundle> {
  const d = db();
  const event = typeof eventOrId === 'string' ? await d.getEventById(eventOrId) : eventOrId;
  if (!event) throw conflict('Hackathon not found', 'not_found');
  const rubric = await d.getActiveRubric(event.id);
  const criteria = rubric ? await d.listCriteria(rubric.id) : [];
  const assignments = (await d.listAssignments({ eventId: event.id, limit: 5000 })).rows;
  const judges = await d.listEventJudges(event.id);
  const judgeById = new Map(judges.map((j) => [j.id, j]));
  const projectRows = (await d.listProjects({ eventId: event.id, status: ['submitted', 'under_review', 'results_released'], limit: 5000 })).rows;
  const tracks = await d.listTracks(event.id);
  const trackById = new Map(tracks.map((t) => [t.id, t]));

  const diagnostics: string[] = [];
  if (!criteria.length) diagnostics.push('No rubric is configured, so scores are unweighted averages of raw criterion marks.');
  if (!projectRows.length) throw conflict('There are no submitted projects to score yet.', 'no_projects');

  // --- Step 1 & 2: per-review and per-project means -------------------------
  const perJudgeScores = new Map<string, number[]>();
  const projectMeans = new Map<string, { sum: number; n: number }>();

  const allReviews = await d.listReviews({ eventId: event.id, status: 'submitted' });
  const reviewByAssignment = new Map(allReviews.map((r: any) => [r.assignment_id, r]));
  const rawScores = await d.listAllScoresForEvent(event.id);
  const scoresByReview = new Map<string, any[]>();
  for (const s of rawScores) {
    if (!scoresByReview.has(s.review_id)) scoresByReview.set(s.review_id, []);
    scoresByReview.get(s.review_id)!.push(s);
  }

  for (const a of assignments) {
    if (a.status !== 'submitted') continue;
    const review = reviewByAssignment.get(a.id);
    if (!review || review.status !== 'submitted') continue;
    const scores = scoresByReview.get(review.id) ?? [];
    const value = reviewScore(scores, criteria) ?? (review.weighted_score ?? null);
    if (value === null) {
      diagnostics.push(`${a.project_title}: a review had no usable scores and was skipped.`);
      continue;
    }
    const jid = review.event_judge_id;
    if (!perJudgeScores.has(jid)) perJudgeScores.set(jid, []);
    perJudgeScores.get(jid)!.push(value);
    const cur = projectMeans.get(a.project_id) ?? { sum: 0, n: 0 };
    projectMeans.set(a.project_id, { sum: cur.sum + value, n: cur.n + 1 });
  }

  // --- Step 3: panel difficulty offsets -------------------------------------
  const allScores = [...perJudgeScores.values()].flat();
  const grandMean = allScores.length ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0;
  const offsets = new Map<string, number>();
  for (const [jid, list] of perJudgeScores) {
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    offsets.set(jid, round(mean - grandMean, 4));
  }
  const spread = offsets.size ? Math.max(...[...offsets.values()].map(Math.abs)) : 0;
  if (spread < 0.5) {
    diagnostics.push('Judges are scoring within half a point of each other, so the panel offset is effectively zero.');
  }

  const lambda = event.judging_mode === 'normalized' ? Number(event.normalize_lambda ?? 0) : 0;
  if (event.judging_mode === 'normalized' && lambda === 0) {
    diagnostics.push('Normalization is on but λ is 0, so adjusted and raw scores are identical. Set λ above 0 to remove judge harshness.');
  }

  const projects: ProjectResult[] = [];
  for (const p of projectRows) {
    const mean = projectMeans.get(p.id);
    const track = p.track_id ? trackById.get(p.track_id) : null;
    const mine = assignments.filter((a) => a.project_id === p.id && a.status === 'submitted');
    const perJudge: ScoreDetail[] = [];
    const judgeOffsetsForProject: number[] = [];
    for (const a of mine) {
      const review = await d.getReviewByAssignment(a.id);
      if (!review) continue;
      const scores = await d.listScores(review.id);
      const value = reviewScore(scores, criteria) ?? review.weighted_score;
      if (value === null) continue;
      perJudge.push({
        review_id: review.id,
        judge_id: a.event_judge_id,
        judge_email: judgeById.get(a.event_judge_id)?.email ?? 'unknown',
        score: round(value, 2),
        submitted_at: review.submitted_at,
      });
      judgeOffsetsForProject.push(offsets.get(a.event_judge_id) ?? 0);
    }
    const notes: string[] = [];
    if (!mean) {
      notes.push('No submitted review yet.');
    } else if (mean.n === 1) {
      notes.push('One review only. Treat this rank as provisional.');
    }
    const meanJudgeOffset = judgeOffsetsForProject.length
      ? judgeOffsetsForProject.reduce((a, b) => a + b, 0) / judgeOffsetsForProject.length
      : 0;
    const raw = mean ? round(mean.sum / mean.n, 4) : null;
    const adjusted = raw === null ? null : round(raw + lambda * meanJudgeOffset, 4);
    projects.push({
      project_id: p.id,
      project_title: p.title,
      team_name: p.team_name ?? '',
      track_id: p.track_id ?? null,
      track_name: track?.name ?? 'Open track',
      track_color: track ? colorFor(track.id) : '#8A8A8A',
      review_count: mean?.n ?? 0,
      raw_score: raw,
      adjusted_score: adjusted,
      final_score: null,
      judge_offset: mean ? round(meanJudgeOffset, 4) : null,
      rank: null,
      track_rank: null,
      per_judge: perJudge,
      notes,
    });
  }

  // --- Step 4: min-max scale inside each track ------------------------------
  if (event.judging_mode === 'normalized') {
    const byTrack = new Map<string, ProjectResult[]>();
    for (const p of projects) {
      const key = p.track_id ?? '__open__';
      if (!byTrack.has(key)) byTrack.set(key, []);
      byTrack.get(key)!.push(p);
    }
    for (const [key, group] of byTrack) {
      const values = group.map((p) => p.adjusted_score).filter((v): v is number => v !== null);
      if (key === '__open__' || values.length === 0) {
        for (const p of group) p.final_score = p.adjusted_score;
        continue;
      }
      // Min-max scaling needs a group to be meaningful. With two projects it
      // turns every track into "winner gets 100, loser gets 0", which says
      // nothing about quality. Below MIN_TRACK_SIZE_FOR_SCALING we keep the
      // adjusted 0-100 score, which already comes from the rubric.
      if (values.length < MIN_TRACK_SIZE_FOR_SCALING) {
        for (const p of group) p.final_score = p.adjusted_score;
        diagnostics.push(
          `${group[0].track_name}: only ${values.length} scored ${values.length === 1 ? 'project' : 'projects'}, so the raw adjusted score is kept rather than scaled to 0-100.`,
        );
        continue;
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      if (max - min < 1e-9) {
        // Zero variance: scaling would divide by zero. All projects tie, so they
        // all receive the same neutral score and share a rank.
        for (const p of group) p.final_score = round(values[0], 2);
        diagnostics.push(`${group[0].track_name}: every project scored the same, so they share a rank.`);
      } else {
        for (const p of group) {
          p.final_score = p.adjusted_score === null ? null : round(((p.adjusted_score - min) / (max - min)) * 100, 2);
        }
      }
    }
  } else {
    for (const p of projects) p.final_score = p.raw_score;
  }

  // --- Step 5: ranking ------------------------------------------------------
  const sorted = rankBy(projects, (p) => p.final_score);
  let lastScore: number | null = null;
  let lastRank = 0;
  sorted.forEach((p, i) => {
    const score = p.final_score;
    if (score === null) {
      p.rank = null;
      return;
    }
    if (lastScore !== null && Math.abs(score - lastScore) < 1e-9) {
      p.rank = lastRank; // competition ranking: ties share a rank, next rank skips
    } else {
      p.rank = i + 1;
      lastRank = p.rank;
      lastScore = score;
    }
  });
  for (const [trackId, group] of groupByTrack(sorted)) {
    let last: number | null = null;
    let lastTrackRank = 0;
    group.forEach((p, i) => {
      if (p.final_score === null) return;
      if (last !== null && Math.abs(p.final_score - last) < 1e-9) p.track_rank = lastTrackRank;
      else { p.track_rank = i + 1; lastTrackRank = i + 1; last = p.final_score; }
    });
    void trackId;
  }

  const at = nowIso();
  await d.replaceResults(
    event.id,
    projects.map((p) => ({
      id: id('res'),
      project_id: p.project_id,
      review_count: p.review_count,
      raw_score: p.raw_score,
      adjusted_score: p.adjusted_score,
      final_score: p.final_score === null ? null : round(p.final_score, 2),
      rank: p.rank,
      track_rank: p.track_rank,
      track_name: p.track_name,
      track_color: p.track_color,
      breakdown: JSON.stringify({
        per_judge: p.per_judge,
        notes: p.notes,
        judge_offset: p.judge_offset,
        method: event.judging_mode,
        lambda: event.judging_mode === 'normalized' ? lambda : 0,
      }),
      published_at: opts.publish ? at : null,
    })),
    at,
  );

  const bundle: ResultsBundle = {
    event_id: event.id,
    computed_at: at,
    method: event.judging_mode,
    lambda: event.judging_mode === 'normalized' ? lambda : 0,
    weight_sum: round(criteria.reduce((a, c) => a + Number(c.weight || 0), 0), 2),
    judges: judges.filter((j) => j.status === 'active').length,
    reviews: assignments.filter((a) => a.status === 'submitted').length,
    projects: sorted,
    diagnostics,
  };
  await audit({
    eventId: event.id,
    action: 'results.computed',
    entityType: 'event',
    entityId: event.id,
    summary: `Computed results for ${projects.length} projects (${bundle.method} mode)`,
    meta: { published: Boolean(opts.publish) },
  });
  return bundle;
}

function* groupByTrack(list: ProjectResult[]): Generator<[string, ProjectResult[]]> {
  const map = new Map<string, ProjectResult[]>();
  for (const p of list) {
    const k = p.track_id ?? '__open__';
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(p);
  }
  for (const [k, v] of map) yield [k, v];
}

const TRACK_COLORS = ['#E24A1C', '#1F6F6B', '#3B4CCA', '#B8860B', '#7A3E9D', '#0F7A4A', '#C2410C', '#334155'];
function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TRACK_COLORS[Math.abs(h) % TRACK_COLORS.length];
}

export function rankBy<T extends { project_id: string; project_title: string }>(
  items: T[],
  scoreFn: (item: T) => number | null | undefined,
): T[] {
  return [...items].sort((a, b) => {
    const av = scoreFn(a) ?? -Infinity;
    const bv = scoreFn(b) ?? -Infinity;
    if (av !== bv) return bv - av;
    const titleCmp = a.project_title.localeCompare(b.project_title);
    if (titleCmp !== 0) return titleCmp;
    return a.project_id.localeCompare(b.project_id);
  });
}

export async function publishResults(event: any, actorId: string): Promise<{ published: number }> {
  const d = db();
  const existing = await d.listResults(event.id, false);
  if (!existing.length) {
    throw conflict('Compute the results first. There is nothing to publish yet.', 'no_results');
  }
  const at = nowIso();
  await d.publishResults(event.id, at);
  await d.updateEvent(event.id, { results_visibility: 'public', updated_at: at });
  for (const r of existing) {
    const p = await d.getProject(r.project_id);
    if (p && p.status !== 'results_released') {
      await d.updateProject(p.id, { status: 'results_released', updated_at: at });
    }
  }
  // Tell the people who took part, not a magic broadcast row: notifications
  // belong to a user, and the foreign key means a placeholder would either
  // crash the publish or become a row that belongs to nobody.
  const teams = (await d.listTeams(event.id, { limit: 1000, offset: 0 })).rows;
  for (const team of teams) {
    await notifyTeam(event, team, {
      kind: 'results',
      title: `Results are out for ${event.name}`,
      body: 'The organizers published the final ranking.',
      link: `/hackathons/${event.slug}/results`,
    });
  }
  await audit({ eventId: event.id, actorId, action: 'results.published', entityType: 'event', entityId: event.id, summary: 'Published results' });
  return { published: existing.length };
}

export async function withdrawResults(event: any, actorId: string): Promise<void> {
  const d = db();
  await d.unpublishResults(event.id);
  await d.updateEvent(event.id, { results_visibility: 'hidden', updated_at: nowIso() });
  await audit({ eventId: event.id, actorId, action: 'results.unpublished', entityType: 'event', entityId: event.id, summary: 'Withdrew published results' });
}

export async function loadStoredResults(eventId: string, publishedOnly: boolean): Promise<any[]> {
  return db().listResults(eventId, publishedOnly);
}

export async function assertOrganizerCanSeeResults(event: any, userId: string | undefined | null): Promise<void> {
  if (!userId) throw forbidden();
  if (!(await db().isOrganizer(event.id, userId))) throw forbidden('Only organizers can see unpublished results.');
}

export async function resultsArePublic(event: any): Promise<boolean> {
  if (event.results_visibility !== 'public') return false;
  if (event.status === 'draft' || event.status === 'archived') return false;
  const rows = await db().listResults(event.id, true);
  return rows.length > 0;
}

export async function requirePublicResults(event: any): Promise<any[]> {
  const rows = await loadStoredResults(event.id, true);
  if (!rows.length) throw notFound('Results for this hackathon have not been published.');
  return rows;
}

export function explainMethod(event: any, criteria: any[]): string {
  const weightSum = criteria.reduce((a, c) => a + Number(c.weight || 0), 0);
  if (event.judging_mode !== 'normalized') {
    return `Each review is turned into a 0–100 score${
      weightSum > 0 ? ' using the rubric weights' : ' as a plain average, because every criterion has weight 0'
    }. A project's score is the mean of its submitted reviews.`;
  }
  return `Each review becomes a 0–100 score${
    weightSum > 0 ? ' using the rubric weights' : ' as a plain average (all weights are 0)'
  }. A project's score is the mean of its reviews. Judges who run systematically harsh or generous are measured against the panel mean, and λ = ${event.normalize_lambda} decides how much of that offset is removed. The adjusted scores are then scaled to 0–100 inside each track, because tracks can have very different score distributions.`;
}
