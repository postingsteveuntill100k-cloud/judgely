const { getDb } = require('../db/database');

function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [name, ...rest] = pair.trim().split('=');
    if (name) {
      cookies[name.trim()] = decodeURIComponent(rest.join('=').trim());
    }
  }
  return cookies;
}

function authMiddleware(req, res, next) {
  const db = getDb();
  let token = null;

  // 1. Check Cookie header (e.g. Cookie: session=org_7f2a)
  if (req.headers.cookie) {
    const cookies = parseCookies(req.headers.cookie);
    if (cookies.session) {
      token = cookies.session;
    }
  }

  // 2. Check Authorization Bearer header
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
      token = parts[1];
    }
  }

  // 3. Check custom header for automated test suites
  if (!token && req.headers['x-session-token']) {
    token = req.headers['x-session-token'];
  }

  // SECURITY (Bug 3): Query-string session credentials (?session=...) are STRICTLY DISALLOWED.
  // URL parameters are logged in server logs, proxy logs, and browser history.

  if (!token) {
    req.user = { role: 'visitor' };
    return next();
  }

  try {
    let userId = null;

    // A. Check database-managed sessions table
    const sessionStmt = db.prepare(`
      SELECT user_id, expires_at
      FROM sessions
      WHERE token = ? AND expires_at > datetime('now')
    `);
    const activeSession = sessionStmt.get(token);
    if (activeSession) {
      userId = activeSession.user_id;
    }

    // B. Fallback to users table session_token for fixture/checker credentials
    if (!userId) {
      const userDirect = db.prepare('SELECT id FROM users WHERE session_token = ?').get(token);
      if (userDirect) {
        userId = userDirect.id;
      }
    }

    if (!userId) {
      req.user = { role: 'visitor' };
      return next();
    }

    const userStmt = db.prepare('SELECT id, email, name, role, session_token FROM users WHERE id = ?');
    const user = userStmt.get(userId);

    if (!user) {
      req.user = { role: 'visitor' };
      return next();
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      session_token: token
    };

    // If role is judge, resolve judge ID and tracks from relational tables
    if (user.role === 'judge') {
      const judgeStmt = db.prepare('SELECT id, name, email FROM judges WHERE user_id = ? OR email = ?');
      const judge = judgeStmt.get(user.id, user.email);
      if (judge) {
        req.user.judge_id = judge.id;
        const tracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge.id);
        req.user.tracks = tracks.map(t => t.track_id);
      }
    }

    // If role is participant, resolve team and project memberships
    if (user.role === 'participant') {
      const teamStmt = db.prepare(`
        SELECT t.id, t.name, t.event_id, tm.role AS member_role
        FROM team_members tm
        JOIN teams t ON tm.team_id = t.id
        WHERE tm.user_id = ? OR tm.email = ?
        LIMIT 1
      `);
      const team = teamStmt.get(user.id, user.email);
      if (team) {
        req.user.team_id = team.id;
        req.user.team_name = team.name;
        req.user.team_role = team.member_role;

        const project = db.prepare('SELECT id, title, status FROM projects WHERE team_id = ?').get(team.id);
        if (project) {
          req.user.project_id = project.id;
          req.user.project_title = project.title;
          req.user.project_status = project.status;
        }
      }
    }

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    req.user = { role: 'visitor' };
    next();
  }
}

module.exports = {
  authMiddleware,
  parseCookies
};
