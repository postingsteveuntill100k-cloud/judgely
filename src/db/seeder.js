const fs = require('node:fs');
const path = require('node:path');
const { hashPassword } = require('../services/passwords');
const FIXTURES_PATH = process.env.FIXTURES_PATH || path.join(__dirname, '../../fixtures.json');

// Session tokens required by .dogfood.toml
const DEMO_SESSIONS = {
  ORGANIZER: 'org_7f2a',
  JUDGE_A: 'jdg_a_91bc',
  JUDGE_B: 'jdg_b_44de',
  PARTICIPANT: 'prt_2e88'
};

function seed(dbInstance = null, fixtureData = null) {
  const db = dbInstance || require('./database').getDb();

  // Load fixtures JSON
  let fixtures = fixtureData;
  if (!fixtures) {
    if (!fs.existsSync(FIXTURES_PATH)) {
      throw new Error(`fixtures.json not found at ${FIXTURES_PATH}`);
    }
    fixtures = JSON.parse(fs.readFileSync(FIXTURES_PATH, 'utf8'));
  }

  // Derive everything dynamically from input data
  const event = fixtures.event;
  if (!event || !event.id) {
    throw new Error('fixtures.json missing valid event record');
  }

  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    // Clean old data for idempotence
    db.exec(`
      DELETE FROM review_scores;
      DELETE FROM reviews;
      DELETE FROM judge_assignments;
      DELETE FROM projects;
      DELETE FROM team_members;
      DELETE FROM teams;
      DELETE FROM judge_tracks;
      DELETE FROM judges;
      DELETE FROM rubric_criteria;
      DELETE FROM tracks;
      DELETE FROM sessions;
      DELETE FROM event_memberships;
      DELETE FROM users;
      DELETE FROM events;
      DELETE FROM audit_logs;
    `);
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('BEGIN TRANSACTION;');

    // 1. Derive & Insert Event
    const insertEvent = db.prepare(`
      INSERT INTO events (id, name, description, submissions_close, results_released, created_at)
      VALUES (?, ?, ?, ?, 0, ?)
    `);
    insertEvent.run(
      event.id,
      event.name || 'Hackathon Event',
      'The premier open-source engineering hackathon for developer infrastructure and autonomous systems.',
      event.submissions_close,
      new Date().toISOString()
    );

    // 2. Derive & Insert Tracks
    const insertTrack = db.prepare(`
      INSERT INTO tracks (id, event_id, name, description)
      VALUES (?, ?, ?, ?)
    `);
    for (const track of (fixtures.tracks || [])) {
      insertTrack.run(
        track.id,
        event.id,
        track.name,
        `Projects advancing the frontier of ${track.name.toLowerCase()}.`
      );
    }

    // 3. Derive Rubric Criteria dynamically from scores
    const criteriaSet = new Set();
    for (const s of (fixtures.scores || [])) {
      if (s.criteria) {
        for (const c of Object.keys(s.criteria)) {
          criteriaSet.add(c);
        }
      }
    }
    if (criteriaSet.size === 0) {
      criteriaSet.add('functionality');
      criteriaSet.add('quality');
      criteriaSet.add('innovation');
    }

    const insertRubric = db.prepare(`
      INSERT INTO rubric_criteria (id, event_id, name, description, weight, max_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const criteriaWeights = {
      functionality: 0.40,
      quality: 0.35,
      innovation: 0.25
    };
    for (const critName of criteriaSet) {
      const weight = criteriaWeights[critName] || (1.0 / criteriaSet.size);
      insertRubric.run(
        `crit_${critName}`,
        event.id,
        critName,
        `Evaluation criterion measuring project ${critName}`,
        weight,
        5.0
      );
    }

    // 4. Derive Demo Users & Judges
    const insertUser = db.prepare(`
      INSERT INTO users (id, email, name, role, password_hash, salt, session_token, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertSession = db.prepare(`
      INSERT INTO sessions (id, user_id, token, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertEventMembership = db.prepare(`
      INSERT INTO event_memberships (id, event_id, user_id, role, status, created_at)
      VALUES (?, ?, ?, ?, 'active', ?)
    `);

    const farFuture = '2099-01-01T00:00:00.000Z';
    const nowIso = new Date().toISOString();

    // Default passwords for deterministically seeded personas
    const orgPass = hashPassword('organizer123');
    const judgePass = hashPassword('judge123');
    const prtPass = hashPassword('participant123');

    // Seed Organizer
    insertUser.run(
      'usr_organizer',
      'organizer@judgely.local',
      'Hackathon Operations',
      'organizer',
      orgPass.hash,
      orgPass.salt,
      DEMO_SESSIONS.ORGANIZER,
      nowIso
    );
    insertSession.run('sess_org', 'usr_organizer', DEMO_SESSIONS.ORGANIZER, nowIso, farFuture);
    insertEventMembership.run('mem_usr_organizer', event.id, 'usr_organizer', 'organizer', nowIso);

    // Seed Abhinav Reddy (Platform Admin & Organizer)
    const abhinavPass = hashPassword('abhinav123');
    insertUser.run(
      'usr_abhinav',
      'quality.prashanth@gmail.com',
      'Abhinav reddy',
      'organizer',
      abhinavPass.hash,
      abhinavPass.salt,
      'sess_abhinav_admin',
      nowIso
    );
    insertSession.run('sess_abhinav', 'usr_abhinav', 'sess_abhinav_admin', nowIso, farFuture);
    insertEventMembership.run('mem_usr_abhinav', event.id, 'usr_abhinav', 'organizer', nowIso);

    // Identify Judge A and Judge B from the actual judges in fixture
    const judgeList = fixtures.judges || [];
    if (judgeList.length < 2) {
      throw new Error('fixtures.json must contain at least 2 judges for T2 check');
    }
    const fixtureJudgeA = judgeList[0];
    const fixtureJudgeB = judgeList[1];

    // Map Judge A
    const userJudgeAId = `usr_${fixtureJudgeA.id}`;
    insertUser.run(
      userJudgeAId,
      fixtureJudgeA.email,
      fixtureJudgeA.name,
      'judge',
      judgePass.hash,
      judgePass.salt,
      DEMO_SESSIONS.JUDGE_A,
      nowIso
    );
    insertSession.run(`sess_${fixtureJudgeA.id}`, userJudgeAId, DEMO_SESSIONS.JUDGE_A, nowIso, farFuture);
    insertEventMembership.run(`mem_${userJudgeAId}`, event.id, userJudgeAId, 'judge', nowIso);

    // Map Judge B
    const userJudgeBId = `usr_${fixtureJudgeB.id}`;
    insertUser.run(
      userJudgeBId,
      fixtureJudgeB.email,
      fixtureJudgeB.name,
      'judge',
      judgePass.hash,
      judgePass.salt,
      DEMO_SESSIONS.JUDGE_B,
      nowIso
    );
    insertSession.run(`sess_${fixtureJudgeB.id}`, userJudgeBId, DEMO_SESSIONS.JUDGE_B, nowIso, farFuture);
    insertEventMembership.run(`mem_${userJudgeBId}`, event.id, userJudgeBId, 'judge', nowIso);

    // Map Participant from first team
    const teamList = fixtures.teams || [];
    const firstTeam = teamList[0] || { id: 'tm_01', name: 'Team Alpha', members: ['participant@example.org'] };
    const firstMemberEmail = (firstTeam.members && firstTeam.members[0]) ? firstTeam.members[0] : 'participant@example.org';

    insertUser.run(
      'usr_participant',
      firstMemberEmail,
      `Priya Nair`,
      'participant',
      prtPass.hash,
      prtPass.salt,
      DEMO_SESSIONS.PARTICIPANT,
      nowIso
    );
    insertSession.run('sess_prt', 'usr_participant', DEMO_SESSIONS.PARTICIPANT, nowIso, farFuture);
    insertEventMembership.run('mem_usr_participant', event.id, 'usr_participant', 'participant', nowIso);

    // Insert all Judges into `judges` table and `judge_tracks` join table
    const insertJudge = db.prepare(`
      INSERT INTO judges (id, event_id, user_id, name, email)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertJudgeTrack = db.prepare(`
      INSERT OR IGNORE INTO judge_tracks (judge_id, track_id)
      VALUES (?, ?)
    `);

    for (let i = 0; i < judgeList.length; i++) {
      const j = judgeList[i];
      let userId = null;
      if (j.id === fixtureJudgeA.id) {
        userId = userJudgeAId;
      } else if (j.id === fixtureJudgeB.id) {
        userId = userJudgeBId;
      } else {
        userId = `usr_${j.id}`;
        const sessionToken = `session_${j.id}`;
        insertUser.run(userId, j.email, j.name, 'judge', judgePass.hash, judgePass.salt, sessionToken, nowIso);
        insertSession.run(`sess_${j.id}`, userId, sessionToken, nowIso, farFuture);
        insertEventMembership.run(`mem_${userId}`, event.id, userId, 'judge', nowIso);
      }

      insertJudge.run(j.id, event.id, userId, j.name, j.email);

      for (const trackId of (j.tracks || [])) {
        insertJudgeTrack.run(j.id, trackId);
      }
    }

    // 5. Derive & Insert Teams and Team Members (normalized relational join table with roles)
    const insertTeam = db.prepare(`
      INSERT INTO teams (id, event_id, name, created_by, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const insertTeamMember = db.prepare(`
      INSERT OR IGNORE INTO team_members (team_id, email, user_id, role)
      VALUES (?, ?, ?, ?)
    `);

    for (const t of teamList) {
      const isFirst = (t.id === firstTeam.id);
      insertTeam.run(t.id, event.id, t.name, isFirst ? 'usr_participant' : null, nowIso);

      const members = t.members || [];
      for (let idx = 0; idx < members.length; idx++) {
        const memberEmail = members[idx];
        const uId = (memberEmail === firstMemberEmail) ? 'usr_participant' : null;
        const memberRole = (idx === 0) ? 'lead' : 'member';
        insertTeamMember.run(t.id, memberEmail, uId, memberRole);
      }
    }

    // 6. Derive & Insert Projects
    const insertProject = db.prepare(`
      INSERT INTO projects (id, event_id, team_id, track_id, title, summary, tech_stack, repo_url, demo_url, submitted_at, updated_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')
    `);
    for (const p of (fixtures.projects || [])) {
      insertProject.run(
        p.id,
        event.id,
        p.team,
        p.track,
        p.title,
        p.summary || '',
        'Node.js, SQLite, TypeScript',
        p.repo_url || '',
        '',
        p.submitted_at || nowIso,
        nowIso
      );
    }

    // 7. Derive & Insert Scores, Reviews, and Assignments
    const insertReview = db.prepare(`
      INSERT INTO reviews (id, event_id, project_id, judge_id, comment, total_weighted_score, status, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'submitted', ?)
    `);
    const insertReviewScore = db.prepare(`
      INSERT INTO review_scores (id, review_id, criterion_name, score)
      VALUES (?, ?, ?, ?)
    `);
    const insertAssignment = db.prepare(`
      INSERT INTO judge_assignments (id, event_id, project_id, judge_id, status, assigned_at)
      VALUES (?, ?, ?, ?, 'completed', ?)
    `);

    for (const s of (fixtures.scores || [])) {
      const reviewId = `rev_${s.project}_${s.judge}`;

      let weightedSum = 0;
      let totalWeight = 0;
      for (const [crit, val] of Object.entries(s.criteria || {})) {
        const w = criteriaWeights[crit] || 1.0;
        weightedSum += val * w;
        totalWeight += w;
      }
      const totalScore = totalWeight > 0 ? (weightedSum / totalWeight) : 0;

      insertReview.run(
        reviewId,
        event.id,
        s.project,
        s.judge,
        s.comment || '',
        Number(totalScore.toFixed(3)),
        nowIso
      );

      for (const [crit, val] of Object.entries(s.criteria || {})) {
        insertReviewScore.run(
          `rs_${reviewId}_${crit}`,
          reviewId,
          crit,
          Number(val)
        );
      }

      insertAssignment.run(
        `asg_${s.project}_${s.judge}`,
        event.id,
        s.project,
        s.judge,
        nowIso
      );
    }

    // 8. Record Seeding Audit Event
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (id, event_id, user_id, role, action, resource_type, resource_id, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertAudit.run(
      'aud_init_seed',
      event.id,
      'system',
      'system',
      'system.seed_fixtures',
      'fixtures',
      event.id,
      JSON.stringify({
        derived_event: event.id,
        projects_count: (fixtures.projects || []).length,
        judges_count: judgeList.length,
        scores_count: (fixtures.scores || []).length,
        judge_a_mapped: fixtureJudgeA.id,
        judge_b_mapped: fixtureJudgeB.id
      }),
      nowIso
    );

    db.exec('COMMIT;');

    return {
      success: true,
      eventId: event.id,
      eventName: event.name,
      submissionsClose: event.submissions_close,
      judgeA: fixtureJudgeA.id,
      judgeB: fixtureJudgeB.id,
      projectsCount: (fixtures.projects || []).length,
      judgesCount: judgeList.length,
      scoresCount: (fixtures.scores || []).length
    };
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch (_) {}
    throw err;
  }
}

if (require.main === module) {
  const result = seed();
  console.log('Judgely database seeded dynamically from fixtures.json:');
  console.log(`- Event: ${result.eventName} (${result.eventId})`);
  console.log(`- Submissions Close: ${result.submissionsClose}`);
  console.log(`- Judge A: ${result.judgeA}`);
  console.log(`- Judge B: ${result.judgeB}`);
  console.log(`- Projects: ${result.projectsCount}`);
  console.log(`- Judges: ${result.judgesCount}`);
  console.log(`- Reviews: ${result.scoresCount}`);
}

module.exports = {
  seed,
  DEMO_SESSIONS
};
