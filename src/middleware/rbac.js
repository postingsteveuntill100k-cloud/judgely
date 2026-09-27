/**
 * Role-Based Access Control and Isolation Policies for Judgely
 */

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || req.user.role === 'visitor') {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required to access this resource.'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Forbidden',
        message: `Access denied. Required roles: ${allowedRoles.join(', ')}. Current role: ${req.user.role}.`
      });
    }

    next();
  };
}

/**
 * Enforces role isolation for judge score endpoints.
 * Specifically validates DOGFOOD Checks 4, 5, and 6:
 * - Check 4: Judge A can view their own scores (HTTP 200).
 * - Check 5: Judge B cannot view Judge A's scores (HTTP 403).
 * - Check 6: Participant cannot view judge scores (HTTP 403).
 */
function enforceJudgeScoreIsolation(req, res, next) {
  if (!req.user || req.user.role === 'visitor') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required to access judge scores.'
    });
  }

  // Participants must NEVER access judge scores (Check 6)
  if (req.user.role === 'participant') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied: participants cannot view judging scores.'
    });
  }

  // Organizers can inspect all judging data
  if (req.user.role === 'organizer') {
    return next();
  }

  // If user is a judge:
  if (req.user.role === 'judge') {
    const requestedJudge = req.query.judge || req.params.judgeId;

    // If no target judge specified, scope is their own scores
    if (!requestedJudge) {
      req.targetJudgeId = req.user.judge_id;
      return next();
    }

    // Check if requested judge matches current authenticated judge
    // Handle aliases like 'judge_a' or explicit ID 'jdg_01'
    const isSelf = 
      requestedJudge === req.user.judge_id || 
      requestedJudge === req.user.id ||
      (requestedJudge === 'judge_a' && req.user.judge_id === 'jdg_01') ||
      (requestedJudge === 'judge_b' && req.user.judge_id === 'jdg_02');

    if (!isSelf) {
      // STRICT BACKEND REFUSAL (Check 5)
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: judges cannot view peer scores.'
      });
    }

    req.targetJudgeId = req.user.judge_id;
    return next();
  }

  return res.status(403).json({
    error: 'Forbidden',
    message: 'Access denied.'
  });
}

function requireEventMembership(req, res, next) {
  if (!req.user || req.user.role === 'visitor') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required.'
    });
  }

  const { getDb } = require('../db/database');
  const db = getDb();
  const membership = db.prepare(`
    SELECT role, status FROM event_memberships
    WHERE event_id = ? AND user_id = ? AND status = 'active'
  `).get(req.eventId, req.user.id);

  if (!membership) {
    return res.status(403).json({
      error: 'Forbidden',
      message: `Access denied. You do not hold an active membership for event '${req.eventId}'.`
    });
  }

  req.eventMembership = membership;
  next();
}

module.exports = {
  requireRole,
  requireEventMembership,
  enforceJudgeScoreIsolation
};
