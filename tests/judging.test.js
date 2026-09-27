const test = require('node:test');
const assert = require('node:assert');
const { calculateWeightedScore } = require('../src/services/judging');
const { calculateNormalizedRankings } = require('../src/services/normalization');

test('Judging - Weighted Rubric calculation correctly weights criteria', () => {
  const rubric = [
    { name: 'functionality', weight: 0.5, max_score: 5 },
    { name: 'quality', weight: 0.3, max_score: 5 },
    { name: 'innovation', weight: 0.2, max_score: 5 }
  ];

  // 4 * 0.5 + 3 * 0.3 + 5 * 0.2 = 2.0 + 0.9 + 1.0 = 3.9
  const score = calculateWeightedScore({
    functionality: 4,
    quality: 3,
    innovation: 5
  }, rubric);

  assert.strictEqual(score, 3.9);
});

test('Judging - Score clamping enforces 0 to max_score bounds', () => {
  const rubric = [
    { name: 'functionality', weight: 1.0, max_score: 5 }
  ];

  const scoreHigh = calculateWeightedScore({ functionality: 10 }, rubric);
  assert.strictEqual(scoreHigh, 5.0, 'Values above max_score must clamp to max_score');

  const scoreLow = calculateWeightedScore({ functionality: -3 }, rubric);
  assert.strictEqual(scoreLow, 0.0, 'Values below 0 must clamp to 0');
});

test('Normalization - Engine handles fixture data with zero-variance judges', () => {
  const data = calculateNormalizedRankings('evt_01');

  assert.ok(data.global.totalReviews > 100, 'Should have loaded fixture reviews');
  assert.ok(data.global.mean > 0, 'Global mean should be calculated');
  assert.ok(data.global.stdDev > 0, 'Global stdDev should be calculated');

  // Verify jdg_07 was handled without crashing or divide-by-zero
  const judge07 = data.judges['jdg_07'];
  assert.ok(judge07, 'Judge 07 should exist');
  assert.strictEqual(judge07.is_zero_variance, true, 'Judge 07 should be flagged as zero-variance');
  assert.strictEqual(judge07.effective_std_dev >= 0.35, true, 'Judge 07 effective std dev should be regularized');

  // Verify all projects have normalized scores
  assert.strictEqual(data.rankings.length, 41, 'All 41 fixture projects must be evaluated');
  for (const p of data.rankings) {
    assert.ok(p.normalized_score >= 0 && p.normalized_score <= 5, `Normalized score ${p.normalized_score} out of bounds`);
    assert.ok(p.rank >= 1 && p.rank <= 41, `Rank ${p.rank} out of bounds`);
  }
});
