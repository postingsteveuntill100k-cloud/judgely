const { getDb } = require('../db/database');

/**
 * Cross-Judge Normalization Engine for Judgely
 * Implements Z-Score Standardized Rescaling with Variance Regularization
 * and Bayesian Sample-Size Smoothing.
 */
function calculateNormalizedRankings(eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;
  if (!targetEventId) {
    throw new Error('No active event found for normalization');
  }

  // 1. Fetch all projects
  const projectsStmt = db.prepare(`
    SELECT 
      p.id,
      p.title,
      p.summary,
      p.repo_url,
      p.team_id,
      t.name AS team_name,
      p.track_id,
      tr.name AS track_name,
      p.status
    FROM projects p
    LEFT JOIN teams t ON p.team_id = t.id
    LEFT JOIN tracks tr ON p.track_id = tr.id
    WHERE p.event_id = ? AND p.status != 'draft' AND p.status != 'withdrawn'
  `);
  const projects = projectsStmt.all(targetEventId);

  // 2. Fetch all reviews
  const reviewsStmt = db.prepare(`
    SELECT 
      r.id,
      r.project_id,
      r.judge_id,
      j.name AS judge_name,
      r.total_weighted_score AS score,
      r.comment
    FROM reviews r
    JOIN judges j ON r.judge_id = j.id
    WHERE r.event_id = ? AND r.total_weighted_score IS NOT NULL
  `);
  const allReviews = reviewsStmt.all(targetEventId);

  if (allReviews.length === 0) {
    return {
      global: { mean: 0, stdDev: 0, totalReviews: 0, totalProjects: projects.length },
      judges: {},
      rankings: projects.map((p, idx) => ({
        ...p,
        raw_score: null,
        normalized_score: null,
        rank: idx + 1,
        rank_delta: 0,
        review_count: 0,
        explanation: 'Pending judging evaluation',
        reviews_breakdown: []
      }))
    };
  }

  // 3. Compute Global Statistics
  const allScores = allReviews.map(r => r.score);
  const globalSum = allScores.reduce((acc, val) => acc + val, 0);
  const globalMean = globalSum / allScores.length;

  const globalVarianceSum = allScores.reduce((acc, val) => acc + Math.pow(val - globalMean, 2), 0);
  const globalStdDev = allScores.length > 1
    ? Math.sqrt(globalVarianceSum / (allScores.length - 1))
    : 1.0;

  // 4. Compute Per-Judge Empirical Distributions
  const judgeGroups = {};
  for (const r of allReviews) {
    if (!judgeGroups[r.judge_id]) {
      judgeGroups[r.judge_id] = {
        judge_id: r.judge_id,
        judge_name: r.judge_name,
        scores: []
      };
    }
    judgeGroups[r.judge_id].scores.push(r.score);
  }

  const judgeStats = {};
  for (const [judgeId, data] of Object.entries(judgeGroups)) {
    const n = data.scores.length;
    const mean = data.scores.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1
      ? data.scores.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / (n - 1)
      : 0;
    const rawStdDev = Math.sqrt(variance);

    // Regularize standard deviation to prevent division by zero or extreme z-scores
    // Judges who gave all identical scores will have rawStdDev = 0
    const regularizedStdDev = Math.max(rawStdDev, 0.35);

    judgeStats[judgeId] = {
      judge_id: judgeId,
      judge_name: data.judge_name,
      review_count: n,
      mean: Number(mean.toFixed(3)),
      raw_std_dev: Number(rawStdDev.toFixed(3)),
      effective_std_dev: Number(regularizedStdDev.toFixed(3)),
      is_zero_variance: rawStdDev < 0.001 && n > 1,
      bias_vs_global: Number((mean - globalMean).toFixed(3)) // positive = lenient, negative = harsh
    };
  }

  // 5. Group reviews by project
  const projectReviews = {};
  for (const p of projects) {
    projectReviews[p.id] = [];
  }
  for (const r of allReviews) {
    if (projectReviews[r.project_id]) {
      projectReviews[r.project_id].push(r);
    }
  }

  // 6. Calculate Normalized Scores for each project
  const PRIOR_WEIGHT_K = 1.0; // Bayesian shrinkage parameter

  const scoredProjects = projects.map(p => {
    const reviews = projectReviews[p.id] || [];
    const reviewCount = reviews.length;

    if (reviewCount === 0) {
      return {
        ...p,
        raw_score: 0,
        normalized_score: 0,
        review_count: 0,
        reviews_breakdown: [],
        explanation: 'No reviews submitted yet.'
      };
    }

    let rawScoreSum = 0;
    let normalizedScoreSum = 0;
    const breakdown = [];

    for (const r of reviews) {
      rawScoreSum += r.score;
      const jStat = judgeStats[r.judge_id];

      // Z-score calculation
      const zScore = (r.score - jStat.mean) / jStat.effective_std_dev;

      // Project onto global distribution and clamp to [0, 5]
      const scaledScore = Math.max(0, Math.min(5, globalMean + zScore * globalStdDev));
      normalizedScoreSum += scaledScore;

      breakdown.push({
        judge_id: r.judge_id,
        judge_name: r.judge_name,
        raw_score: r.score,
        judge_mean: jStat.mean,
        judge_bias: jStat.bias_vs_global,
        z_score: Number(zScore.toFixed(3)),
        normalized_score: Number(scaledScore.toFixed(3)),
        comment: r.comment
      });
    }

    const rawMean = rawScoreSum / reviewCount;
    const normalizedMean = normalizedScoreSum / reviewCount;

    // Apply Bayesian shrinkage towards global mean for projects with few reviews
    const finalScore = (PRIOR_WEIGHT_K * globalMean + reviewCount * normalizedMean) / (PRIOR_WEIGHT_K + reviewCount);

    // Build human explanation
    let explanation = '';
    const biasSum = breakdown.reduce((acc, b) => acc + b.judge_bias, 0);
    const avgBias = biasSum / reviewCount;

    if (Math.abs(avgBias) < 0.15) {
      explanation = `Balanced judging panel (average judge bias ${avgBias > 0 ? '+' : ''}${avgBias.toFixed(2)}). Score aligns closely with raw score.`;
    } else if (avgBias < -0.15) {
      explanation = `Assigned to harsher judges (${avgBias.toFixed(2)} below average). Normalization appropriately lifted the ranking to restore fairness.`;
    } else {
      explanation = `Assigned to more lenient judges (+${avgBias.toFixed(2)} above average). Normalization corrected for grading leniency.`;
    }

    return {
      ...p,
      raw_score: Number(rawMean.toFixed(3)),
      normalized_score: Number(finalScore.toFixed(3)),
      raw_normalized_mean: Number(normalizedMean.toFixed(3)),
      review_count: reviewCount,
      reviews_breakdown: breakdown,
      explanation
    };
  });

  // 7. Calculate Rankings and Rank Deltas
  // Raw ranking
  const rawRanked = [...scoredProjects].sort((a, b) => b.raw_score - a.raw_score);
  const rawRankMap = {};
  rawRanked.forEach((p, index) => {
    rawRankMap[p.id] = index + 1;
  });

  // Normalized ranking
  const normalizedRanked = [...scoredProjects].sort((a, b) => b.normalized_score - a.normalized_score);
  const finalRankings = normalizedRanked.map((p, index) => {
    const rank = index + 1;
    const rawRank = rawRankMap[p.id];
    const rankDelta = rawRank - rank; // positive = moved up, negative = moved down

    return {
      ...p,
      rank,
      raw_rank: rawRank,
      rank_delta: rankDelta
    };
  });

  return {
    global: {
      mean: Number(globalMean.toFixed(3)),
      stdDev: Number(globalStdDev.toFixed(3)),
      totalReviews: allReviews.length,
      totalProjects: projects.length,
      evaluatedProjects: scoredProjects.filter(p => p.review_count > 0).length
    },
    judges: judgeStats,
    rankings: finalRankings
  };
}

module.exports = {
  calculateNormalizedRankings
};
