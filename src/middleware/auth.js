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

  // 3. Check custom header or query string (useful for testing/demo)
  if (!token && req.headers['x-session-token']) {
    token = req.headers['x-session-token'];
  }
  if (!token && req.query && req.query.session) {
    token = req.query.session;
  }

  if (!token) {
    req.user = { role: 'visitor' };
    return next();
  }

  // Resolve user from database
  try {
    const userStmt = db.prepare('SELECT id, email, name, role, session_token FROM users WHERE session_token = ?');
    const user = userStmt.get(token);

    if (!user) {
      req.user = { role: 'visitor' };
      return next();
    }

    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      session_token: user.session_token
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
