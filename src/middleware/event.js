const { getDb } = require('../db/database');

/**
 * Event resolution middleware.
 * Dynamically resolves event context from params, query, headers, or active database event.
 * Fails explicitly if no event context can be resolved.
 */
function eventMiddleware(req, res, next) {
  const db = getDb();
  let requestedEventId = req.params.eventId || req.query.event_id || req.headers['x-event-id'];

  let event = null;
  if (requestedEventId) {
    event = db.prepare('SELECT * FROM events WHERE id = ?').get(requestedEventId);
    if (!event) {
      return res.status(404).json({
        error: 'Event Not Found',
        message: `Event '${requestedEventId}' does not exist.`
      });
    }
  } else {
    // Select the active event from the database
    event = db.prepare('SELECT * FROM events ORDER BY created_at ASC LIMIT 1').get();
    if (!event) {
      return res.status(404).json({
        error: 'No Active Event',
        message: 'No event records exist in the database.'
      });
    }
  }

  req.event = event;
  req.eventId = event.id;
  next();
}

function getEvent(eventId) {
  const db = getDb();
  if (eventId) {
    return db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  }
  return db.prepare('SELECT * FROM events ORDER BY created_at ASC LIMIT 1').get();
}

module.exports = {
  eventMiddleware,
  getEvent
};
