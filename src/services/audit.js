const { getDb } = require('../db/database');

function recordAuditLog({
  eventId = 'evt_01',
  userId = 'system',
  role = 'system',
  action,
  resourceType,
  resourceId = null,
  details = null
}) {
  const db = getDb();
  const id = `aud_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const timestamp = new Date().toISOString();

  try {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (id, event_id, user_id, role, action, resource_type, resource_id, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      eventId,
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

function getAuditLogs(limit = 100, eventId = 'evt_01') {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT * FROM audit_logs
    WHERE event_id = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `);
  return stmt.all(eventId, limit);
}

module.exports = {
  recordAuditLog,
  getAuditLogs
};
