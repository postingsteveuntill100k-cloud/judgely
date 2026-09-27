const { getDb } = require('../db/database');
const { recordAuditLog } = require('./audit');

/**
 * Calculates weighted score from criteria values and rubric weights.
 */
function calculateWeightedScore(criteriaValues, rubricList) {
  let weightedSum = 0;
  let totalWeight = 0;

  const rubricMap = {};
  for (const r of rubricList) {
    rubricMap[r.name] = { weight: r.weight, max_score: r.max_score };
  }

  for (const [name, score] of Object.entries(criteriaValues)) {
    const config = rubricMap[name] || { weight: 1.0, max_score: 5.0 };
    // clamp score between 0 and max_score
    const clampedScore = Math.max(0, Math.min(config.max_score, Number(score) || 0));
    weightedSum += clampedScore * config.weight;
    totalWeight += config.weight;
  }

  if (totalWeight === 0) return 0;
  return Number((weightedSum / totalWeight).toFixed(3));
}

function getRubric(eventId = 'evt_01') {
  const db = getDb();
  const stmt = db.prepare('SELECT id, name, description, weight, max_score FROM rubric_criteria WHERE event_id = ?');
  return stmt.all(eventId);
}

function submitReview({
  eventId = 'evt_01',
  projectId,
  judgeId,
  criteria,
  comment = '',
  user = {}
}) {
  const db = getDb();
  const rubric = getRubric(eventId);
  const totalWeightedScore = calculateWeightedScore(criteria, rubric);
  const reviewId = `rev_${projectId}_${judgeId}`;
  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION;');
  try {
    // 1. Insert or update review
    const insertReview = db.prepare(`
      INSERT INTO reviews (id, event_id, project_id, judge_id, comment, total_weighted_score, status, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
      ON CONFLICT(project_id, judge_id) DO UPDATE SET
        comment = excluded.comment,
        total_weighted_score = excluded.total_weighted_score,
        submitted_at = excluded.submitted_at
    `);
    insertReview.run(reviewId, eventId, projectId, judgeId, comment, totalWeightedScore, now);

    // 2. Delete and re-insert criterion scores
    const deleteOldScores = db.prepare('DELETE FROM review_scores WHERE review_id = ?');
    deleteOldScores.run(reviewId);

    const insertScore = db.prepare(`
      INSERT INTO review_scores (id, review_id, criterion_name, score)
      VALUES (?, ?, ?, ?)
    `);
    for (const [crit, val] of Object.entries(criteria)) {
      insertScore.run(`rs_${reviewId}_${crit}`, reviewId, crit, Number(val));
    }

    // 3. Mark assignment as completed
    const updateAssignment = db.prepare(`
      INSERT INTO judge_assignments (id, event_id, project_id, judge_id, status, assigned_at)
      VALUES (?, ?, ?, ?, 'completed', ?)
      ON CONFLICT(project_id, judge_id) DO UPDATE SET status = 'completed'
    `);
    updateAssignment.run(`asg_${projectId}_${judgeId}`, eventId, projectId, judgeId, now);

    db.exec('COMMIT;');

    recordAuditLog({
      eventId,
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

function getScoresForJudge(judgeId, eventId = 'evt_01') {
  const db = getDb();
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
  const reviews = stmt.all(judgeId, eventId);

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

function getJudgeAssignments(judgeId, eventId = 'evt_01') {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT 
      a.id AS assignment_id,
      a.project_id,
      a.status AS assignment_status,
      a.assigned_at,
      p.title AS project_title,
      p.summary AS project_summary,
      p.repo_url,
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
  const assignments = stmt.all(judgeId, eventId);

  // Attach criteria scores if completed
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

module.exports = {
  calculateWeightedScore,
  getRubric,
  submitReview,
  getScoresForJudge,
  getJudgeAssignments
};
