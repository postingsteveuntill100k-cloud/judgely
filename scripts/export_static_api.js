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

  // 7. /api/results.json (sample preview standings)
  writeJson(path.join(PUBLIC_API_DIR, 'results.json'), {
    results_released: false,
    message: "Results are currently under embargo while judging completes.",
    results: []
  });

  console.log('✅ Successfully pre-rendered static API files for Firebase Hosting!');
}

if (require.main === module) {
  exportStaticApi();
}

module.exports = { exportStaticApi };
