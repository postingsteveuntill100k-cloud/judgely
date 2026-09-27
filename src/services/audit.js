const crypto = require('node:crypto');
const { getDb } = require('../db/database');

function recordAuditLog({
  eventId,
  userId = 'system',
  role = 'system',
  action,
  resourceType,
  resourceId = null,
  details = null
}) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id || 'evt_default';
  const id = `aud_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();

  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, event_id, user_id, role, action, resource_type, resource_id, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      targetEventId,
      userId,
      role,
      action,
      resourceType,
      resourceId,
      typeof details === 'object' ? JSON.stringify(details) : details,
      timestamp
    );
    return { id, timestamp };
  } catch (err) {
    console.error('Audit log write failure:', err);
    return null;
  }
}

function getAuditLogs(limit = 100, eventId) {
  const db = getDb();
  const targetEventId = eventId || db.prepare('SELECT id FROM events ORDER BY created_at ASC LIMIT 1').get()?.id;
  if (!targetEventId) return [];

  const stmt = db.prepare(`
    SELECT * FROM audit_logs
    WHERE event_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(targetEventId, limit);
}

module.exports = {
  recordAuditLog,
  getAuditLogs
};
