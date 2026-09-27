const { getDb } = require('../db/database');
const { recordAuditLog } = require('./audit');

/**
 * Validates criteria scores strictly against authoritative database rubric.
 * BUG 7 Fix: Reject unknown criteria, reject missing required criteria, enforce max_score.
 * No arbitrary fallback weights!
 */
function validateAndScoreCriteria(criteriaValues, rubricList) {
  if (!criteriaValues || typeof criteriaValues !== 'object') {
    throw new Error('Criteria scores object is required');
  }

  const rubricMap = {};
  for (const r of rubricList) {
    rubricMap[r.name] = {
      weight: r.weight,
      max_score: r.max_score,
      id: r.id
    };
  }

  // 1. Verify every submitted criterion is an authorized criterion for this event
  for (const name of Object.keys(criteriaValues)) {
    if (!rubricMap[name]) {
      const err = new Error(`Unknown rubric criterion '${name}'. Unknown criteria are strictly rejected.`);
      err.statusCode = 400;
      throw err;
    }
  }

  // 2. Verify all required rubric criteria are present
  for (const name of Object.keys(rubricMap)) {
    if (criteriaValues[name] === undefined || criteriaValues[name] === null) {
      const err = new Error(`Missing required rubric criterion '${name}'. All rubric criteria must be evaluated.`);
      err.statusCode = 400;
      throw err;
    }
  }

  // 3. Validate numeric value, bounds, and compute weighted sum
  let weightedSum = 0;
  let totalWeight = 0;

  for (const [name, score] of Object.entries(criteriaValues)) {
    const config = rubricMap[name];
    const numScore = Number(score);

    if (isNaN(numScore) || numScore < 0 || numScore > config.max_score) {
      const err = new Error(`Criterion '${name}' score '${score}' is invalid. Score must be a number between 0.0 and ${config.max_score}.`);
      err.statusCode = 400;
      throw err;
    }

    weightedSum += numScore * config.weight;
    totalWeight += config.weight;
  }

  if (totalWeight === 0) return 0;
  return Number((weightedSum / totalWeight).toFixed(3));
}

function getRubric(eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;
  if (!targetEventId) return [];

  const stmt = db.prepare('SELECT id, name, description, weight, max_score FROM rubric_criteria WHERE event_id = ? ORDER BY weight DESC');
  return stmt.all(targetEventId);
}

/**
 * Submit judge review with strict assignment and rubric validation.
 * BUG 1 Fix: Verify active assignment exists before scoring; return 403 if unassigned.
 * Never auto-create assignments on scoring.
 */
function submitReview({
  eventId,
  projectId,
  judgeId,
  criteria,
  comment = '',
  user = {}
}) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;

  if (!targetEventId) {
    const err = new Error('Valid eventId is required');
    err.statusCode = 400;
    throw err;
  }

  // 1. Verify project exists and belongs to this event
  const project = db.prepare('SELECT id, event_id, status FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    const err = new Error(`Project '${projectId}' does not exist.`);
    err.statusCode = 404;
    throw err;
  }
  if (project.event_id !== targetEventId) {
    const err = new Error(`Project '${projectId}' does not belong to event '${targetEventId}'.`);
    err.statusCode = 400;
    throw err;
  }
  if (project.status === 'disqualified' || project.status === 'withdrawn') {
    const err = new Error(`Cannot score project with status '${project.status}'.`);
    err.statusCode = 400;
    throw err;
  }

  // 2. BUG 1: Verify active assignment exists for this judge & project
  const assignment = db.prepare(`
    SELECT id, status
    FROM judge_assignments
    WHERE event_id = ? AND project_id = ? AND judge_id = ?
  `).get(targetEventId, projectId, judgeId);

  if (!assignment) {
    const err = new Error(`Access denied: Judge '${judgeId}' is not assigned to evaluate project '${projectId}'.`);
    err.statusCode = 403;
    throw err;
  }

  // 3. Authoritative rubric validation
  const rubric = getRubric(targetEventId);
  const totalWeightedScore = validateAndScoreCriteria(criteria, rubric);

  const reviewId = `rev_${projectId}_${judgeId}`;
  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION;');
  try {
    // 4. Insert or update review
    const insertReview = db.prepare(`
      INSERT INTO reviews (id, event_id, project_id, judge_id, comment, total_weighted_score, status, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
      ON CONFLICT(project_id, judge_id) DO UPDATE SET
        comment = excluded.comment,
        total_weighted_score = excluded.total_weighted_score,
        submitted_at = excluded.submitted_at
    `);
    insertReview.run(reviewId, targetEventId, projectId, judgeId, comment, totalWeightedScore, now);

    // 5. Delete and re-insert criterion scores
    const deleteOldScores = db.prepare('DELETE FROM review_scores WHERE review_id = ?');
    deleteOldScores.run(reviewId);

    const insertScore = db.prepare(`
      INSERT INTO review_scores (id, review_id, criterion_name, score)
      VALUES (?, ?, ?, ?)
    `);
    for (const [crit, val] of Object.entries(criteria)) {
      insertScore.run(`rs_${reviewId}_${crit}`, reviewId, crit, Number(val));
    }

    // 6. Update existing assignment status to 'completed' (DO NOT CREATE NEW ASSIGNMENT!)
    const updateAssignment = db.prepare(`
      UPDATE judge_assignments
      SET status = 'completed'
      WHERE event_id = ? AND project_id = ? AND judge_id = ?
    `);
    updateAssignment.run(targetEventId, projectId, judgeId);

    db.exec('COMMIT;');

    recordAuditLog({
      eventId: targetEventId,
      userId: user.id || judgeId,
      role: user.role || 'judge',
      action: 'review.submitted',
      resourceType: 'review',
      resourceId: reviewId,
      details: { projectId, judgeId, totalWeightedScore, criteria }
    });

    return {
      reviewId,
      totalWeightedScore,
      submittedAt: now
    };
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }
}

function getScoresForJudge(judgeId, eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;

  const stmt = db.prepare(`
    SELECT
      r.id AS review_id,
      r.project_id,
      p.title AS project_title,
      p.team_id,
      t.name AS team_name,
      p.track_id,
      tr.name AS track_name,
      r.total_weighted_score,
      r.comment,
      r.submitted_at
    FROM reviews r
    JOIN projects p ON r.project_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN tracks tr ON p.track_id = tr.id
    WHERE r.judge_id = ? AND r.event_id = ?
    ORDER BY r.submitted_at DESC
  `);
  const reviews = stmt.all(judgeId, targetEventId);

  // Attach individual criteria
  const scoreStmt = db.prepare('SELECT criterion_name, score FROM review_scores WHERE review_id = ?');
  for (const r of reviews) {
    const scores = scoreStmt.all(r.review_id);
    r.criteria = {};
    for (const s of scores) {
      r.criteria[s.criterion_name] = s.score;
    }
  }

  return reviews;
}

function getJudgeAssignments(judgeId, eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;

  const stmt = db.prepare(`
    SELECT
      a.id AS assignment_id,
      a.project_id,
      a.status AS assignment_status,
      a.assigned_at,
      p.title AS project_title,
      p.summary AS project_summary,
      p.repo_url,
      p.demo_url,
      p.tech_stack,
      p.track_id,
      tr.name AS track_name,
      t.name AS team_name,
      r.id AS review_id,
      r.total_weighted_score,
      r.comment,
      r.submitted_at
    FROM judge_assignments a
    JOIN projects p ON a.project_id = p.id
    LEFT JOIN tracks tr ON p.track_id = tr.id
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN reviews r ON a.project_id = r.project_id AND a.judge_id = r.judge_id
    WHERE a.judge_id = ? AND a.event_id = ?
    ORDER BY a.assigned_at DESC
  `);
  const assignments = stmt.all(judgeId, targetEventId);

  const scoreStmt = db.prepare('SELECT criterion_name, score FROM review_scores WHERE review_id = ?');
  for (const item of assignments) {
    if (item.review_id) {
      const scores = scoreStmt.all(item.review_id);
      item.criteria = {};
      for (const s of scores) {
        item.criteria[s.criterion_name] = s.score;
      }
    } else {
      item.criteria = null;
    }
  }

  return assignments;
}

function calculateWeightedScore(criteriaValues, rubricList) {
  if (!criteriaValues || typeof criteriaValues !== 'object') return 0;
  const rubricMap = {};
  for (const r of rubricList) {
    rubricMap[r.name] = { weight: r.weight, max_score: r.max_score };
  }
  let weightedSum = 0;
  let totalWeight = 0;
  for (const [name, score] of Object.entries(criteriaValues)) {
    const config = rubricMap[name];
    if (!config) continue;
    const num = Number(score);
    const clamped = Math.max(0, Math.min(config.max_score, isNaN(num) ? 0 : num));
    weightedSum += clamped * config.weight;
    totalWeight += config.weight;
  }
  if (totalWeight === 0) return 0;
  return Number((weightedSum / totalWeight).toFixed(3));
}

module.exports = {
  validateAndScoreCriteria,
  calculateWeightedScore,
  getRubric,
  submitReview,
  getScoresForJudge,
  getJudgeAssignments
};
