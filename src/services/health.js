const { getDb } = require('../db/database');
const { calculateNormalizedRankings } = require('./normalization');

function getJudgingHealth(eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;
  if (!targetEventId) {
    throw new Error('No active event found for judging health calculation');
  }

  const normData = calculateNormalizedRankings(targetEventId);

  // 1. Fetch counts
  const totalProjects = db.prepare('SELECT COUNT(*) as count FROM projects WHERE event_id = ?').get(targetEventId).count;
  const totalJudges = db.prepare('SELECT COUNT(*) as count FROM judges WHERE event_id = ?').get(targetEventId)?.count || db.prepare('SELECT COUNT(*) as count FROM judges').get().count;
  const totalReviews = db.prepare('SELECT COUNT(*) as count FROM reviews WHERE event_id = ?').get(targetEventId).count;
  const totalAssignments = db.prepare('SELECT COUNT(*) as count FROM judge_assignments WHERE event_id = ?').get(targetEventId).count;

  // 2. Coverage breakdown
  const coverage = {
    zero: 0,
    one: 0,
    two: 0,
    threeOrMore: 0
  };

  const highDisagreementProjects = [];

  for (const p of normData.rankings) {
    if (p.review_count === 0) coverage.zero++;
    else if (p.review_count === 1) coverage.one++;
    else if (p.review_count === 2) coverage.two++;
    else coverage.threeOrMore++;

    // Calculate inter-judge score standard deviation if >= 2 reviews
    if (p.reviews_breakdown && p.reviews_breakdown.length >= 2) {
      const scores = p.reviews_breakdown.map(r => r.raw_score);
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      const variance = scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (scores.length - 1);
      const stdDev = Math.sqrt(variance);

      if (stdDev >= 1.4) {
        highDisagreementProjects.push({
          project_id: p.id,
          title: p.title,
          team_name: p.team_name,
          spread: Number(stdDev.toFixed(2)),
          scores: scores,
          reason: `High judge variance (std dev: ${stdDev.toFixed(2)}). Scores range from ${Math.min(...scores)} to ${Math.max(...scores)}.`
        });
      }
    }
  }

  // 3. Flags and Anomalies for Organizer Review
  const flags = [];

  // Flag A: Zero variance judges (e.g. jdg_07)
  for (const [judgeId, j] of Object.entries(normData.judges)) {
    if (j.is_zero_variance) {
      flags.push({
        type: 'zero_variance',
        severity: 'warning',
        resource_type: 'judge',
        resource_id: judgeId,
        title: `Identical score pattern: ${j.judge_name} (${judgeId})`,
        description: `Judge assigned the identical score (${j.mean}) across all ${j.review_count} completed reviews without distinction.`,
        action_recommended: 'Flagged for organizer review. Normalization variance regularization applied automatically.'
      });
    }
  }

  // Flag B: Duplicate project submissions by the same team
  const dupCheckStmt = db.prepare(`
    SELECT team_id, COUNT(*) AS count, GROUP_CONCAT(id, ', ') AS project_ids
    FROM projects
    WHERE event_id = ?
    GROUP BY team_id
    HAVING count > 1
  `);
  const duplicates = dupCheckStmt.all(targetEventId);
  for (const dup of duplicates) {
    const team = db.prepare('SELECT name FROM teams WHERE id = ?').get(dup.team_id);
    flags.push({
      type: 'duplicate_submission',
      severity: 'notice',
      resource_type: 'team',
      resource_id: dup.team_id,
      title: `Multiple project submissions: ${team ? team.name : dup.team_id}`,
      description: `Team submitted ${dup.count} projects: ${dup.project_ids}.`,
      action_recommended: 'Check whether secondary submission was a resubmission or intentional separate project.'
    });
  }

  // Flag C: High disagreement projects
  for (const d of highDisagreementProjects) {
    flags.push({
      type: 'score_disagreement',
      severity: 'notice',
      resource_type: 'project',
      resource_id: d.project_id,
      title: `Polarized scores: ${d.title}`,
      description: d.reason,
      action_recommended: 'Organizer may assign an additional tiebreaker judge review.'
    });
  }

  // 4. Judge workload balance summary
  const judgeWorkloadStmt = db.prepare(`
    SELECT 
      j.id,
      j.name,
      j.email,
      COUNT(a.id) AS assigned_count,
      SUM(CASE WHEN a.status = 'completed' THEN 1 ELSE 0 END) AS completed_count
    FROM judges j
    LEFT JOIN judge_assignments a ON j.id = a.judge_id AND a.event_id = ?
    GROUP BY j.id
    ORDER BY assigned_count DESC
  `);
  const judgeWorkloads = judgeWorkloadStmt.all(targetEventId).map(j => {
    const tracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(j.id).map(t => t.track_id);
    return {
      ...j,
      tracks,
      pending_count: (j.assigned_count || 0) - (j.completed_count || 0),
      completion_rate: j.assigned_count > 0 ? Number(((j.completed_count / j.assigned_count) * 100).toFixed(1)) : 100
    };
  });

  return {
    event_id: targetEventId,
    overview: {
      totalProjects,
      totalJudges,
      totalReviews,
      totalAssignments,
      coverageRate: totalProjects > 0 ? Number((((totalProjects - coverage.zero) / totalProjects) * 100).toFixed(1)) : 0
    },
    coverage,
    flags,
    judgeWorkloads
  };
}

module.exports = {
  getJudgingHealth
};
