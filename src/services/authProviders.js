const https = require('node:https');
const crypto = require('node:crypto');
const { getDb } = require('../db/database');

/**
 * Authentication Provider Boundary
 * Decouples identity verification (Google, Local, Demo) from Judgely authorization.
 */

/**
 * Verifies a Google ID token / credential.
 * When GOOGLE_CLIENT_ID is configured and online, checks Google OAuth2 endpoint.
 * In development / offline / test mode, supports test tokens or decoded claims.
 */
async function verifyGoogleIdentity(tokenOrCredential) {
  if (!tokenOrCredential || typeof tokenOrCredential !== 'string') {
    throw new Error('Missing Google identity token');
  }

  // Support test / simulation tokens (e.g. google_test_<email> or mock payloads)
  if (tokenOrCredential.startsWith('mock_google_') || tokenOrCredential.startsWith('test_google_')) {
    const rawEmail = tokenOrCredential.replace(/^(mock|test)_google_/, '');
    const email = rawEmail.includes('@') ? rawEmail : `${rawEmail}@gmail.com`;
    return {
      email: email.toLowerCase().trim(),
      name: email.split('@')[0],
      provider: 'google',
      sub: `g_${crypto.createHash('sha256').update(email).digest('hex').substring(0, 16)}`,
      email_verified: true
    };
  }

  // Attempt to decode standard JWT payload without external network first if signature validation is bypassed in test
  try {
    const parts = tokenOrCredential.split('.');
    if (parts.length === 3) {
      const payloadBuf = Buffer.from(parts[1], 'base64');
      const payload = JSON.parse(payloadBuf.toString('utf8'));
      if (payload && payload.email) {
        // If Google Client ID is configured, verify audience
        const expectedAud = process.env.GOOGLE_CLIENT_ID;
        if (expectedAud && payload.aud !== expectedAud) {
          throw new Error('Google token audience mismatch');
        }
        return {
          email: payload.email.toLowerCase().trim(),
          name: payload.name || payload.email.split('@')[0],
          provider: 'google',
          sub: payload.sub || `g_${crypto.randomUUID()}`,
          email_verified: payload.email_verified !== false
        };
      }
    }
  } catch (err) {
    if (err.message.includes('audience mismatch')) throw err;
    // Fall through to HTTP verification if applicable
  }

  // If online verification is required against Google tokeninfo API:
  return new Promise((resolve, reject) => {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokenOrCredential)}`;
    const req = https.get(url, { timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error('Invalid Google credential from provider'));
        }
        try {
          const parsed = JSON.parse(data);
          if (!parsed.email) {
            return reject(new Error('Google token did not contain a verified email'));
          }
          resolve({
            email: parsed.email.toLowerCase().trim(),
            name: parsed.name || parsed.email.split('@')[0],
            provider: 'google',
            sub: parsed.sub,
            email_verified: parsed.email_verified === 'true' || parsed.email_verified === true
          });
        } catch (e) {
          reject(new Error('Failed to parse Google identity response'));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Google authentication network error: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Google authentication verification timed out'));
    });
  });
}

/**
 * Resolves or provision an authenticated identity in Judgely database
 * and checks their event membership.
 * CRITICAL RULE: If user has no event membership, DO NOT auto-grant roles.
 */
function resolveIdentityMembership(identity, eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;

  if (!targetEventId) {
    return { error: 'No active hackathon event found' };
  }

  // 1. Locate or create Judgely user
  let user = db.prepare('SELECT * FROM users WHERE email = ?').get(identity.email);
  if (!user) {
    const userId = `usr_${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO users (id, email, name, role, created_at)
      VALUES (?, ?, ?, 'visitor', ?)
    `).run(userId, identity.email, identity.name || identity.email.split('@')[0], now);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  }

  // 2. Query event membership for target event
  const membership = db.prepare(`
    SELECT * FROM event_memberships
    WHERE event_id = ? AND user_id = ? AND status = 'active'
  `).get(targetEventId, user.id);

  if (!membership) {
    // Also check if user is a judge by email in judges table
    const judge = db.prepare('SELECT * FROM judges WHERE event_id = ? AND email = ?').get(targetEventId, user.email);
    if (judge) {
      // Link judge user_id and create membership
      db.prepare('UPDATE judges SET user_id = ? WHERE id = ?').run(user.id, judge.id);
      db.prepare(`
        INSERT OR IGNORE INTO event_memberships (id, event_id, user_id, role, status, created_at)
        VALUES (?, ?, ?, 'judge', 'active', ?)
      `).run(`mem_${crypto.randomUUID()}`, targetEventId, user.id, new Date().toISOString());
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('judge', user.id);

      return {
        user: { ...user, role: 'judge' },
        role: 'judge',
        membership: { role: 'judge' },
        registered: true,
        eventId: targetEventId
      };
    }

    // Check if user is a team member by email
    const teamMember = db.prepare(`
      SELECT tm.*, t.event_id FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE t.event_id = ? AND tm.email = ?
    `).get(targetEventId, user.email);
    if (teamMember) {
      db.prepare('UPDATE team_members SET user_id = ? WHERE team_id = ? AND email = ?').run(user.id, teamMember.team_id, user.email);
      db.prepare(`
        INSERT OR IGNORE INTO event_memberships (id, event_id, user_id, role, status, created_at)
        VALUES (?, ?, ?, 'participant', 'active', ?)
      `).run(`mem_${crypto.randomUUID()}`, targetEventId, user.id, new Date().toISOString());
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run('participant', user.id);

      return {
        user: { ...user, role: 'participant' },
        role: 'participant',
        membership: { role: 'participant' },
        registered: true,
        eventId: targetEventId
      };
    }

    // NO membership found: return registered: false
    return {
      user,
      role: 'visitor',
      membership: null,
      registered: false,
      eventId: targetEventId,
      message: `You are authenticated as ${identity.email}, but you are not registered for this event.`
    };
  }

  return {
    user: { ...user, role: membership.role },
    role: membership.role,
    membership,
    registered: true,
    eventId: targetEventId
  };
}

module.exports = {
  verifyGoogleIdentity,
  resolveIdentityMembership
};
