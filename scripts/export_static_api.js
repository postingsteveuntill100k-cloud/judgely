#!/usr/bin/env node
/**
 * Export Static API Endpoints for Firebase Hosting
 * Generates genuine JSON payloads from the database into public/api/
 * ensuring that the hosted showcase shell serves authentic event data.
 */

const fs = require('node:fs');
const path = require('node:path');
const { getDb } = require('../src/db/database');

const PUBLIC_API_DIR = path.join(__dirname, '../public/api');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[Export] Wrote ${path.relative(path.join(__dirname, '..'), filePath)}`);
}

function exportStaticApi() {
  const db = getDb();

  // 1. /api/auth/config.json
  writeJson(path.join(PUBLIC_API_DIR, 'auth/config.json'), {
    demo_mode: false,
    google_auth: true,
    google_client_id: "",
    environment: "production"
  });

  // 2. /api/auth/me.json (visitor state)
  writeJson(path.join(PUBLIC_API_DIR, 'auth/me.json'), {
    user: {
      id: "usr_guest",
      name: "Guest Explorer",
      role: "visitor"
    }
  });

  // 3. /api/event.json
  const event = db.prepare('SELECT * FROM events ORDER BY created_at ASC LIMIT 1').get();
  if (event) {
    const isClosed = Boolean(event.submissions_close && new Date(event.submissions_close) < new Date());
    writeJson(path.join(PUBLIC_API_DIR, 'event.json'), {
      id: event.id,
      name: event.name,
      description: event.description,
      submissions_close: event.submissions_close,
      results_released: Boolean(event.results_released),
      created_at: event.created_at,
      is_closed: isClosed
    });
  }

  // 4. /api/tracks.json
  const tracks = db.prepare('SELECT id, name, description FROM tracks ORDER BY id ASC').all();
  writeJson(path.join(PUBLIC_API_DIR, 'tracks.json'), { tracks });

  // 5. /api/projects.json
  const projects = db.prepare(`
    SELECT 
      p.id, p.event_id, p.team_id, p.track_id, p.title, p.summary,
      p.tech_stack, p.repo_url, p.demo_url, p.status, p.submitted_at,
      t.name AS track_name,
      tm.name AS team_name
    FROM projects p
    LEFT JOIN tracks t ON p.track_id = t.id
    LEFT JOIN teams tm ON p.team_id = tm.id
    WHERE p.status != 'withdrawn'
    ORDER BY p.submitted_at DESC
  `).all();
  writeJson(path.join(PUBLIC_API_DIR, 'projects.json'), { projects });

  // 6. Individual /api/project_details/:id.json
  const detailsDir = path.join(PUBLIC_API_DIR, 'project_details');
  ensureDir(detailsDir);

  projects.forEach(p => {
    const members = db.prepare(`
      SELECT 
        u.name,
        tm.role
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
    `).all(p.team_id).map(m => ({
      name: m.name || 'Participant',
      role: m.role || 'member'
    }));

    writeJson(path.join(detailsDir, `${p.id}.json`), {
      project: {
        ...p,
        members
      }
    });
  });

  // 7. /api/results.json
  writeJson(path.join(PUBLIC_API_DIR, 'results.json'), {
    results_released: false,
    message: "Results are currently under embargo while judging completes.",
    results: []
  });

  // 8. /api/organizer endpoints
  const organizerDir = path.join(PUBLIC_API_DIR, 'organizer');
  ensureDir(organizerDir);

  const eventRow = db.prepare('SELECT id, name, description, submissions_close, results_released FROM events ORDER BY created_at ASC LIMIT 1').get();
  const eventId = eventRow ? eventRow.id : 'evt_dogfood_2026';

  const { getJudgingHealth } = require('../src/services/health');
  const { getAuditLogs } = require('../src/services/audit');
  const { getRubric, getJudgeAssignments } = require('../src/services/judging');

  const health = getJudgingHealth(eventId);
  const audits = getAuditLogs(50, eventId);
  const rubric = getRubric(eventId);

  writeJson(path.join(organizerDir, 'overview.json'), {
    event: eventRow,
    health,
    recent_audits: audits
  });

  writeJson(path.join(organizerDir, 'health.json'), { health });

  const orgProjects = db.prepare(`
    SELECT 
      p.id, p.event_id, p.team_id, p.track_id, p.title, p.summary,
      p.tech_stack, p.repo_url, p.demo_url, p.status, p.submitted_at,
      t.name AS track_name,
      tm.name AS team_name,
      COUNT(DISTINCT a.id) AS assignments_count,
      COUNT(DISTINCT r.id) AS reviews_count
    FROM projects p
    LEFT JOIN tracks t ON p.track_id = t.id
    LEFT JOIN teams tm ON p.team_id = tm.id
    LEFT JOIN judge_assignments a ON a.project_id = p.id
    LEFT JOIN reviews r ON r.project_id = p.id
    WHERE p.event_id = ?
    GROUP BY p.id
    ORDER BY p.submitted_at DESC
  `).all(eventId);
  writeJson(path.join(organizerDir, 'projects.json'), { projects: orgProjects });

  const teams = db.prepare(`
    SELECT 
      t.id, t.name, t.created_at,
      u.name AS lead_name,
      u.email AS lead_email,
      COUNT(DISTINCT tm.email) AS member_count,
      p.id AS project_id,
      p.title AS project_title,
      p.status AS project_status
    FROM teams t
    LEFT JOIN users u ON t.created_by = u.id
    LEFT JOIN team_members tm ON tm.team_id = t.id
    LEFT JOIN projects p ON p.team_id = t.id AND p.status != 'withdrawn'
    WHERE t.event_id = ?
    GROUP BY t.id
    ORDER BY t.name ASC
  `).all(eventId);
  writeJson(path.join(organizerDir, 'teams.json'), { teams });

  const judges = db.prepare(`
    SELECT 
      j.id, j.name, j.email, j.user_id,
      COUNT(DISTINCT a.id) AS assignments_count,
      COUNT(DISTINCT r.id) AS completed_reviews
    FROM judges j
    LEFT JOIN judge_assignments a ON a.judge_id = j.id AND a.event_id = j.event_id
    LEFT JOIN reviews r ON r.judge_id = j.id AND r.event_id = j.event_id
    WHERE j.event_id = ?
    GROUP BY j.id
    ORDER BY j.name ASC
  `).all(eventId).map(j => {
    const tracks = db.prepare(`
      SELECT t.id, t.name FROM judge_tracks jt
      JOIN tracks t ON jt.track_id = t.id
      WHERE jt.judge_id = ?
    `).all(j.id);
    return { ...j, tracks };
  });
  writeJson(path.join(organizerDir, 'judges.json'), { judges });

  const assignments = db.prepare(`
    SELECT 
      a.id,
      a.project_id,
      p.title AS project_title,
      p.track_id AS project_track,
      p.status AS project_status,
      p.team_id,
      t.name AS team_name,
      a.judge_id,
      j.name AS judge_name,
      j.email AS judge_email,
      a.status,
      a.assigned_at,
      r.total_weighted_score
    FROM judge_assignments a
    JOIN projects p ON a.project_id = p.id
    LEFT JOIN teams t ON p.team_id = t.id
    JOIN judges j ON a.judge_id = j.id
    LEFT JOIN reviews r ON a.project_id = r.project_id AND a.judge_id = r.judge_id
    WHERE a.event_id = ?
    ORDER BY a.assigned_at DESC
  `).all(eventId).map(a => {
    const judgeTracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(a.judge_id).map(t => t.track_id);
    const trackMatch = judgeTracks.includes(a.project_track);
    return { ...a, judge_tracks: judgeTracks, track_match: trackMatch };
  });
  writeJson(path.join(organizerDir, 'assignments.json'), { assignments });

  const criteria = db.prepare(`
    SELECT id, name, description, weight, max_score
    FROM rubric_criteria
    WHERE event_id = ?
    ORDER BY weight DESC, name ASC
  `).all(eventId);
  writeJson(path.join(organizerDir, 'rubric.json'), { criteria });
  writeJson(path.join(organizerDir, 'audit.json'), { audits });

  // 9. /api/judge endpoints (e.g. for jdg_01 Tomas Varga)
  const judgeDir = path.join(PUBLIC_API_DIR, 'judge');
  ensureDir(judgeDir);
  const judgeAssignments = getJudgeAssignments('jdg_01', eventId);
  writeJson(path.join(judgeDir, 'assignments.json'), {
    event_id: eventId,
    judge_id: 'jdg_01',
    assignments: judgeAssignments,
    rubric
  });

  // 10. Copy fixtures.json into public/
  const rootFixtures = path.join(__dirname, '../fixtures.json');
  if (fs.existsSync(rootFixtures)) {
    fs.copyFileSync(rootFixtures, path.join(__dirname, '../public/fixtures.json'));
    console.log('[Export] Copied fixtures.json -> public/fixtures.json');
  }

  console.log('✅ Successfully pre-rendered static API files for Firebase Hosting!');
}

if (require.main === module) {
  exportStaticApi();
}

module.exports = { exportStaticApi };
