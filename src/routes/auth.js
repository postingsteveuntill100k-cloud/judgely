const express = require('express');
const router = express.Router();
const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const { verifyPassword } = require('../services/passwords');

const DEMO_USERS = {
  organizer: 'usr_organizer',
  judge_a: 'usr_jdg_01',
  judge_b: 'usr_jdg_02',
  participant: 'usr_participant'
};

function createSession(userId, res) {
  const db = getDb();
  const token = `sess_${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const sessionId = `sid_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  db.prepare(`
    INSERT INTO sessions (id, user_id, token, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, userId, token, now.toISOString(), expiresAt.toISOString());

  // Set secure HttpOnly cookie
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = [
    `session=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
    isProd ? 'Secure' : ''
  ].filter(Boolean).join('; ');

  res.setHeader('Set-Cookie', cookieOptions);
  return token;
}

// GET /api/auth/config - Expose runtime capabilities (e.g. demo mode status)
router.get('/api/auth/config', (req, res) => {
  res.json({
    demo_mode: process.env.DEMO_MODE === 'true'
  });
});

// POST /api/auth/login - Real local authentication requiring email and password
router.post('/api/auth/login', (req, res) => {
  const db = getDb();
  const { email, password } = req.body || {};

  if (!email || typeof email !== 'string' || !email.trim()) {
    return res.status(400).json({ error: 'Valid email address is required' });
  }

  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Password is required' });
  }

  const user = db.prepare('SELECT id, email, name, role, password_hash, salt FROM users WHERE email = ? COLLATE NOCASE').get(email.trim());
  if (!user || !user.password_hash || !user.salt) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const isValid = verifyPassword(password, user.password_hash, user.salt);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  createSession(user.id, res);

  res.json({
    message: 'Authenticated successfully',
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role
    }
  });
});

// POST /api/auth/demo-login - Strictly gated to development / demo environments
router.post('/api/auth/demo-login', (req, res) => {
  // CRITICAL SECURITY ENFORCEMENT: Demo login is strictly forbidden in production
  if (process.env.DEMO_MODE !== 'true') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Demo login is disabled in production environments. Please use credentials to sign in.'
    });
  }

  const db = getDb();
  const { role } = req.body || {};

  if (role === 'visitor') {
    res.setHeader('Set-Cookie', 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    return res.json({
      message: 'Switched to Visitor mode',
      user: { role: 'visitor' }
    });
  }

  let targetUserId = DEMO_USERS[role];

  // If specific judge alias or id passed
  if (!targetUserId) {
    if (role === 'organizer') targetUserId = 'usr_organizer';
    else if (role === 'participant') targetUserId = 'usr_participant';
    else {
      const judgeUser = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get(role);
      if (judgeUser) targetUserId = judgeUser.id;
    }
  }

  if (!targetUserId) {
    const userByRole = db.prepare('SELECT id FROM users WHERE role = ? LIMIT 1').get(role);
    if (userByRole) targetUserId = userByRole.id;
  }

  if (!targetUserId) {
    return res.status(404).json({ error: `Demo identity for role '${role}' not found` });
  }

  const user = db.prepare('SELECT id, email, name, role FROM users WHERE id = ?').get(targetUserId);
  if (!user) {
    return res.status(404).json({ error: 'User record not found' });
  }

  createSession(user.id, res);

  // Load detailed role context for response
  const userPayload = { ...user };
  if (user.role === 'judge') {
    const judge = db.prepare('SELECT id FROM judges WHERE user_id = ?').get(user.id);
    if (judge) {
      userPayload.judge_id = judge.id;
      userPayload.tracks = db.prepare('SELECT track_id FROM judge_tracks WHERE judge_id = ?').all(judge.id).map(t => t.track_id);
    }
  } else if (user.role === 'participant') {
    const team = db.prepare(`
      SELECT t.id, t.name, tm.role AS member_role
      FROM team_members tm
      JOIN teams t ON tm.team_id = t.id
      WHERE tm.user_id = ?
    `).get(user.id);
    if (team) {
      userPayload.team_id = team.id;
      userPayload.team_name = team.name;
      userPayload.team_role = team.member_role;
    }
  }

  res.json({
    message: `Authenticated as ${user.name} (${user.role})`,
    user: userPayload
  });
});

// POST /api/auth/logout
router.post('/api/auth/logout', (req, res) => {
  const db = getDb();
  if (req.user && req.user.session_token) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.user.session_token);
  }
  res.setHeader('Set-Cookie', 'session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  res.json({
    message: 'Logged out successfully',
    user: { role: 'visitor' }
  });
});

// GET /api/auth/me - Clean profile query (zero sensitive tokens exposed)
router.get('/api/auth/me', (req, res) => {
  if (!req.user || req.user.role === 'visitor') {
    return res.json({ user: { role: 'visitor' } });
  }
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role,
      judge_id: req.user.judge_id,
      tracks: req.user.tracks,
      team_id: req.user.team_id,
      team_name: req.user.team_name,
      team_role: req.user.team_role,
      project_id: req.user.project_id,
      project_title: req.user.project_title,
      project_status: req.user.project_status
    }
  });
});

module.exports = router;
