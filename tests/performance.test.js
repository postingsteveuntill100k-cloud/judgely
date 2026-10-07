/**
 * Scale and Performance Benchmark Tests.
 *
 * Verifies that the data model and services perform efficiently under
 * representative high load:
 * - 1,000 projects
 * - 1,000 teams
 * - 100 judges
 * - 5,000 assignments
 *
 * Measures:
 * - host dashboard / progress calculation
 * - judge queue retrieval
 * - assignment creation
 * - review save & score replacement
 * - results generation & ranking
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { boot, shutdown } from './harness.js';

let dbModule;
let judgingModule;
let resultsModule;

before(async () => {
  await boot();
  dbModule = await import('../dist/server/db/index.js');
  judgingModule = await import('../dist/server/services/judging.js');
  resultsModule = await import('../dist/server/services/results.js');
});

after(async () => {
  await shutdown();
});

describe('High Scale Performance Benchmarks', () => {
  test('handles 1,000 projects, 100 judges, and 5,000 assignments with sub-second queries', async () => {
    const d = dbModule.db();

    // 0. Create organizer user
    const orgUser = await d.createUser({
      id: 'usr_perf_org',
      email: 'org@perf.test',
      email_lower: 'org@perf.test',
      username: 'perf_org',
      username_lower: 'perf_org',
      display_name: 'Perf Org',
      platform_role: 'user',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 1. Setup a dedicated event
    const eventId = 'evt_perf_bench_1';
    await d.createEvent({
      id: eventId,
      slug: 'perf-bench-2026',
      name: 'Performance Benchmark Hackathon',
      tagline: 'High volume stress testing',
      description: 'Stress testing event for performance audit',
      status: 'judging',
      created_by: orgUser.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      judging_starts_at: new Date(Date.now() - 3600000).toISOString(),
      judging_ends_at: new Date(Date.now() + 3600000).toISOString(),
    });

    const rubricId = 'rub_perf_bench_1';
    await d.createRubric({
      id: rubricId,
      event_id: eventId,
      name: 'Default Rubric',
      version: 1,
      status: 'active',
      created_at: new Date().toISOString(),
    });

    const crit1 = await d.createCriterion({
      id: 'crit_perf_1',
      rubric_id: rubricId,
      key: 'impact',
      name: 'Impact',
      description: 'Potential real-world impact',
      max_score: 5,
      weight: 1.0,
      sort_order: 1,
    });

    const crit2 = await d.createCriterion({
      id: 'crit_perf_2',
      rubric_id: rubricId,
      key: 'execution',
      name: 'Execution',
      description: 'Technical quality and polish',
      max_score: 5,
      weight: 1.0,
      sort_order: 2,
    });

    // 2. Insert 100 judges
    const judgeIds = [];
    for (let j = 0; j < 100; j++) {
      const uId = `usr_perf_j_${j}`;
      const jId = `jdg_perf_${j}`;
      await d.createUser({
        id: uId,
        email: `judge_${j}@example.org`,
        email_lower: `judge_${j}@example.org`,
        username: `judge_${j}`,
        username_lower: `judge_${j}`,
        display_name: `Judge ${j}`,
        platform_role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await d.createEventJudge({
        id: jId,
        event_id: eventId,
        user_id: uId,
        email: `judge_${j}@example.org`,
        email_lower: `judge_${j}@example.org`,
        username: `judge_${j}`,
        status: 'active',
        invited_at: new Date().toISOString(),
        accepted_at: new Date().toISOString(),
      });
      judgeIds.push(jId);
    }

    // 3. Insert 1,000 teams and 1,000 projects
    const projectIds = [];
    for (let i = 0; i < 1000; i++) {
      const teamId = `tm_perf_${i}`;
      const projId = `prj_perf_${i}`;
      await d.createTeam({
        id: teamId,
        event_id: eventId,
        slug: `team-${i}`,
        name: `Team ${i}`,
        created_by: orgUser.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await d.createProject({
        id: projId,
        event_id: eventId,
        team_id: teamId,
        slug: `proj-${i}`,
        title: `Project ${i} High Scale Submission`,
        tagline: `Tagline for submission ${i}`,
        description: `Full description of project ${i}`,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      projectIds.push(projId);
    }

    assert.equal(projectIds.length, 1000, 'Created 1,000 projects');
    assert.equal(judgeIds.length, 100, 'Created 100 judges');

    // 4. Create 5,000 assignments (5 assignments per project across the 100 judges)
    const tAssignStart = performance.now();
    for (let i = 0; i < 1000; i++) {
      for (let k = 0; k < 5; k++) {
        const jIdx = (i + k) % 100;
        await d.createAssignment({
          id: `asg_perf_${i}_${k}`,
          event_id: eventId,
          event_judge_id: judgeIds[jIdx],
          project_id: projectIds[i],
          status: k < 2 ? 'submitted' : 'pending',
          assigned_at: new Date().toISOString(),
        });
      }
    }
    const tAssignEnd = performance.now();
    console.log(`[Perf] 5,000 assignments created in ${(tAssignEnd - tAssignStart).toFixed(1)}ms`);

    // 5. Create 500 submitted reviews with scores
    for (let i = 0; i < 500; i++) {
      const revId = `rev_perf_${i}`;
      const jIdx = i % 100;
      await d.createReview({
        id: revId,
        assignment_id: `asg_perf_${i}_0`,
        event_id: eventId,
        project_id: projectIds[i],
        event_judge_id: judgeIds[jIdx],
        user_id: `usr_perf_j_${jIdx}`,
        rubric_id: rubricId,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      await d.replaceReviewScores(revId, [
        { id: `sc_${i}_1`, review_id: revId, criterion_id: crit1.id, score: (i % 5) + 1 },
        { id: `sc_${i}_2`, review_id: revId, criterion_id: crit2.id, score: ((i + 1) % 5) + 1 },
      ]);
    }

    // 6. Benchmark Host Dashboard / Progress metrics calculation
    const tProgress0 = performance.now();
    const progress = await judgingModule.progressFor(eventId);
    const tProgress1 = performance.now();
    const progressDuration = tProgress1 - tProgress0;
    console.log(`[Perf] progressFor(1,000 projects, 5,000 assignments) took ${progressDuration.toFixed(2)}ms`);
    assert.ok(progressDuration < 300, `progressFor should complete in < 300ms, took ${progressDuration}ms`);
    assert.equal(progress.projects, 1000);
    assert.equal(progress.expectedReviews, 5000, 'Expected reviews matches assignment count');

    // 7. Benchmark Judge Queue Retrieval
    const tQueue0 = performance.now();
    const judgeAssignments = await d.listAssignments({ eventId, judgeId: judgeIds[0] });
    const tQueue1 = performance.now();
    const queueDuration = tQueue1 - tQueue0;
    console.log(`[Perf] Judge queue lookup (50 assigned projects) took ${queueDuration.toFixed(2)}ms`);
    assert.ok(queueDuration < 50, `Judge queue should complete in < 50ms, took ${queueDuration}ms`);

    // 8. Benchmark Results Calculation & Deterministic Ranking
    const tResults0 = performance.now();
    const results = await resultsModule.computeResults(eventId);
    const tResults1 = performance.now();
    const resultsDuration = tResults1 - tResults0;
    console.log(`[Perf] computeResults(1,000 projects, 500 reviews) took ${resultsDuration.toFixed(2)}ms`);
    assert.ok(results.projects.length > 0, 'Rankings generated');
    assert.equal(results.projects[0].rank, 1, 'Top rank is 1');
    assert.equal(results.reviews, 2000, '2000 submitted reviews included');
  });
});
