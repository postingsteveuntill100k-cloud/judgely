/**
 * Comprehensive Security & Integrity Audit Tests.
 *
 * Verifies production hardening, fail-closed configuration, authorization
 * boundaries, rubric immutability, results determinism, CSV formula injection
 * neutralization, and transactional score replacement.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { boot, shutdown, req } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let dbModule;
let configModule;
let csvModule;
let judgingModule;
let resultsModule;

before(async () => {
  await boot();
  dbModule = await import('../dist/server/db/index.js');
  configModule = await import('../dist/server/config.js');
  csvModule = await import('../dist/server/lib/csv.js');
  judgingModule = await import('../dist/server/services/judging.js');
  resultsModule = await import('../dist/server/services/results.js');
});

after(async () => {
  await shutdown();
});

describe('1. Production Configuration Fail-Closed', () => {
  test('rejects short or placeholder SESSION_SECRET in production mode', () => {
    const { validateProductionConfig } = configModule;

    // Missing / short secret
    assert.throws(
      () => validateProductionConfig({
        env: 'production',
        security: { sessionSecret: 'too-short-secret' },
        auth: { acceptanceAccounts: false },
        seed: { onBoot: false },
      }),
      /SESSION_SECRET must be at least 32 characters/i
    );

    // Insecure placeholder secret
    assert.throws(
      () => validateProductionConfig({
        env: 'production',
        security: { sessionSecret: 'change-me-this-is-not-a-secret-placeholder-value' },
        auth: { acceptanceAccounts: false },
        seed: { onBoot: false },
      }),
      /default or placeholder/i
    );
  });

  test('rejects acceptance accounts in production mode', () => {
    const { validateProductionConfig } = configModule;
    assert.throws(
      () => validateProductionConfig({
        env: 'production',
        security: { sessionSecret: 'a-very-long-production-grade-session-secret-key-12345' },
        auth: { acceptanceAccounts: true },
        seed: { onBoot: false },
      }),
      /ACCEPTANCE_ACCOUNTS must be false/i
    );
  });

  test('rejects database seeding in production mode', () => {
    const { validateProductionConfig } = configModule;
    assert.throws(
      () => validateProductionConfig({
        env: 'production',
        security: { sessionSecret: 'a-very-long-production-grade-session-secret-key-12345' },
        auth: { acceptanceAccounts: false },
        seed: { onBoot: true },
      }),
      /SEED_ON_BOOT must be false/i
    );
  });
});

describe('2. CSV Formula Injection Neutralization', () => {
  test('neutralizes dangerous spreadsheet formula triggers', () => {
    const { csvCell } = csvModule;

    // Direct formula triggers: =, +, -, @, |, %
    assert.equal(csvCell('=CMD|\' /C CALC\'!A0'), '\'=CMD|\' /C CALC\'!A0');
    assert.equal(csvCell('@SUM(1,2)'), '"\'@SUM(1,2)"');
    assert.equal(csvCell('|pipe_cmd'), '\'|pipe_cmd');
    assert.equal(csvCell('%0a_cmd'), '\'%0a_cmd');

    // Leading whitespace before trigger character
    assert.equal(csvCell('   =SUM(1,2)'), '"\'   =SUM(1,2)"');
    assert.equal(csvCell('\t@INJECT'), '\'\t@INJECT');

    // Valid negative or positive numeric values must remain numbers
    assert.equal(csvCell(-42), '-42');
    assert.equal(csvCell(3.14), '3.14');
    assert.equal(csvCell('-42'), '\'-42');
    assert.equal(csvCell('+42'), '\'+42');
  });
});

describe('3. Rubric Immutability After Judging Has Begun', () => {
  test('refuses to add or update criterion when reviews exist', async () => {
    const d = dbModule.db();
    const event = await d.getEventBySlug('hacktron-2026');
    assert.ok(event, 'hacktron-2026 fixture event must exist');

    const rubric = await d.getActiveRubric(event.id);
    assert.ok(rubric, 'rubric must exist for fixture event');

    // Check that existing reviews are present
    const reviews = await d.listReviews({ eventId: event.id, status: 'submitted' });
    assert.ok(reviews.length > 0, 'fixture event should have existing reviews');

    // Attempting to add a new criterion should throw rubric_in_use conflict
    await assert.rejects(
      async () => {
        await judgingModule.addCriterion(
          event,
          rubric,
          {
            key: 'novelty_audit',
            name: 'Novelty Audit',
            weight: 1,
            maxScore: 5,
          },
          'usr_sample_organizer',
        );
      },
      (err) => {
        return err.status === 409 && err.code === 'rubric_in_use';
      },
      'Should throw 409 conflict with rubric_in_use when adding criterion'
    );

    // Attempting to modify an existing criterion should also throw rubric_in_use
    const criteria = await d.listCriteria(rubric.id);
    assert.ok(criteria.length > 0);
    await assert.rejects(
      async () => {
        await judgingModule.updateCriterion(
          event,
          criteria[0].id,
          {
            weight: 10,
          },
          'usr_sample_organizer',
        );
      },
      (err) => {
        return err.status === 409 && err.code === 'rubric_in_use';
      },
      'Should throw 409 conflict with rubric_in_use when modifying criterion'
    );
  });
});

describe('4. Deterministic Results Ranking', () => {
  test('computing results multiple times produces identical deterministic scores and ranks', async () => {
    const d = dbModule.db();
    const event = await d.getEventBySlug('hacktron-2026');
    assert.ok(event);

    const firstRun = await resultsModule.computeResults(event);
    const secondRun = await resultsModule.computeResults(event);

    assert.equal(firstRun.projects.length, secondRun.projects.length);
    for (let i = 0; i < firstRun.projects.length; i++) {
      assert.equal(firstRun.projects[i].project_id, secondRun.projects[i].project_id);
      assert.equal(firstRun.projects[i].rank, secondRun.projects[i].rank);
      assert.equal(firstRun.projects[i].final_score, secondRun.projects[i].final_score);
    }
  });

  test('rankBy uses deterministic fallback and does not bias by review count', () => {
    const { rankBy } = resultsModule;
    const testRows = [
      { project_id: 'prj_b', project_title: 'Beta Project', final_score: 85, review_count: 5 },
      { project_id: 'prj_a', project_title: 'Alpha Project', final_score: 85, review_count: 1 },
      { project_id: 'prj_top', project_title: 'Top Project', final_score: 95, review_count: 2 },
    ];

    const ranked = rankBy(testRows, (r) => r.final_score);
    assert.equal(ranked[0].project_id, 'prj_top');
    // For tied final_score 85, title 'Alpha Project' should rank ahead of 'Beta Project' deterministically
    assert.equal(ranked[1].project_id, 'prj_a');
    assert.equal(ranked[2].project_id, 'prj_b');
  });
});

describe('5. Transactional Review Score Replacement', () => {
  test('replaceReviewScores replaces the score set and purges stale scores', async () => {
    const d = dbModule.db();
    const event = await d.getEventBySlug('hacktron-2026');
    const reviews = await d.listReviews({ eventId: event.id, status: 'submitted' });
    const review = reviews[0];
    assert.ok(review);

    // Initial scores
    const initialScores = await d.listScores(review.id);
    assert.ok(initialScores.length > 0);

    // Replace with a single updated criterion score
    const targetCriterionId = initialScores[0].criterion_id;
    await d.replaceReviewScores(review.id, [
      { criterion_id: targetCriterionId, score: 4, note: 'Updated score in transaction' },
    ]);

    const updatedScores = await d.listScores(review.id);
    assert.equal(updatedScores.length, 1);
    assert.equal(updatedScores[0].criterion_id, targetCriterionId);
    assert.equal(updatedScores[0].score, 4);
    assert.equal(updatedScores[0].note, 'Updated score in transaction');

    // Restore original scores so other tests remain clean
    await d.replaceReviewScores(
      review.id,
      initialScores.map((s) => ({ criterion_id: s.criterion_id, score: s.score, note: s.note }))
    );
  });
});

describe('6. Authorization Boundaries & Security Policies', () => {
  test('participant cannot access organizer host routes', async () => {
    const r = await req('/host/events/hacktron-2026/judging', { as: 'participant' });
    assert.equal(r.status, 403, 'Participant must get 403 when accessing host routes');
  });

  test('participant cannot access judge routes', async () => {
    const r = await req('/judge/events/hacktron-2026', { as: 'participant' });
    assert.equal(r.status, 403, 'Participant must get 403 when accessing judge routes');
  });

  test('judge cannot access organizer results publish route', async () => {
    const r = await req('/host/events/hacktron-2026/results/publish', {
      method: 'POST',
      as: 'judge_a',
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 403, 'Judge must get 403 when accessing organizer results actions');
  });

  test('organizer can hide and unhide project comments with audit log', async () => {
    const d = dbModule.db();
    const event = await d.getEventBySlug('sample-hack-2026');
    assert.ok(event);

    const projectList = await d.listProjects({ eventId: event.id, limit: 1 });
    const project = projectList.rows[0];
    const users = await d.listUsers(1, 0);
    const user = users[0];

    // Create a test comment
    const commentId = 'cmt_audit_test_1';
    await d.addComment({
      id: commentId,
      project_id: project.id,
      user_id: user.id,
      body: 'Inappropriate or abusive comment test',
      created_at: new Date().toISOString(),
      hidden: 0,
    });

    const csrfToken = 'sec_comment_csrf';

    // Participant cannot hide comment
    const forbidRes = await req(`/host/events/${event.slug}/comments/${commentId}/hide`, {
      method: 'POST',
      as: 'participant',
      form: { _csrf: csrfToken },
    });
    assert.equal(forbidRes.status, 403, 'Participant must not be able to hide comments');

    // Organizer can hide comment
    const hideRes = await req(`/host/events/${event.slug}/comments/${commentId}/hide`, {
      method: 'POST',
      as: 'organizer',
      form: { _csrf: csrfToken },
    });
    assert.ok(hideRes.status === 200 || hideRes.status === 302 || hideRes.status === 303, `Organizer should be allowed to hide comment, got ${hideRes.status}`);

    const commentsAfterHide = await d.listComments(project.id, 50);
    const hiddenComment = commentsAfterHide.find((c) => c.id === commentId);
    assert.equal(hiddenComment, undefined, 'Comment should be filtered out and not appear when hidden');

    // Organizer can unhide comment
    const unhideRes = await req(`/host/events/${event.slug}/comments/${commentId}/unhide`, {
      method: 'POST',
      as: 'organizer',
      form: { _csrf: csrfToken },
    });
    assert.ok(unhideRes.status === 200 || unhideRes.status === 302 || unhideRes.status === 303, `Organizer should be allowed to unhide comment, got ${unhideRes.status}`);

    const commentsAfterUnhide = await d.listComments(project.id, 50);
    const unhiddenComment = commentsAfterUnhide.find((c) => c.id === commentId);
    assert.ok(unhiddenComment, 'Comment should reappear in comments list after unhide');
  });
});

describe('7. Firestore Rules Deny-By-Default Verification', () => {
  test('firestore.rules locks down client mutations and reads with deny-by-default', () => {
    const rulesPath = path.join(ROOT, 'firestore.rules');
    const rulesContent = readFileSync(rulesPath, 'utf8');

    // Must enforce deny-by-default
    assert.ok(rulesContent.includes('allow read, write: if false;'), 'Rules must contain allow read, write: if false;');
    assert.ok(!rulesContent.includes('request.auth != null'), 'Rules must not allow direct authenticated client writes');
    assert.ok(rulesContent.includes('match /{document=**}'), 'Rules must contain catch-all deny rule');
  });
});
