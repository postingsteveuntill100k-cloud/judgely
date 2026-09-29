import { db } from '../db/index.js';
import { id, nowIso } from '../lib/ids.js';
import { log } from '../lib/logger.js';

export interface AuditInput {
  eventId?: string | null;
  actorId?: string | null;
  actorLabel?: string;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  meta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Operational record of who did what to which event.
 * Never contains private judge scores or session tokens.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    let actorLabel = input.actorLabel ?? 'system';
    if (!actorLabel && input.actorId) {
      const u = await db().getUserById(input.actorId);
      actorLabel = u ? `${u.display_name} (@${u.username})` : 'unknown user';
    }
    await db().addAudit({
      id: id('aud'),
      event_id: input.eventId ?? null,
      actor_id: input.actorId ?? null,
      actor_label: actorLabel,
      action: input.action,
      entity_type: input.entityType ?? '',
      entity_id: input.entityId ?? '',
      summary: input.summary ?? '',
      meta: JSON.stringify(input.meta ?? {}),
      ip: input.ip ?? '',
      created_at: nowIso(),
    });
  } catch (e) {
    // Auditing must never break the operation it is recording.
    log.warn('audit write failed', { action: input.action, error: (e as Error).message });
  }
}

export const AUDIT_LABELS: Record<string, string> = {
  'event.created': 'Hackathon created',
  'event.updated': 'Settings changed',
  'event.published': 'Hackathon published',
  'event.unpublished': 'Moved back to draft',
  'event.live': 'Hackathon went live',
  'event.closed': 'Submissions closed',
  'event.archived': 'Hackathon archived',
  'track.created': 'Track created',
  'track.updated': 'Track updated',
  'track.deleted': 'Track deleted',
  'rubric.created': 'Rubric created',
  'rubric.updated': 'Rubric changed',
  'rubric.criterion_added': 'Rubric criterion added',
  'rubric.criterion_updated': 'Rubric criterion changed',
  'rubric.criterion_removed': 'Rubric criterion removed',
  'judge.invited': 'Judge invited',
  'judge.resent': 'Judge invitation resent',
  'judge.accepted': 'Judge accepted the invitation',
  'judge.declined': 'Judge declined',
  'judge.removed': 'Judge removed',
  'assignment.created': 'Judge assigned',
  'assignment.bulk_created': 'Judges assigned in bulk',
  'assignment.updated': 'Assignment changed',
  'assignment.deleted': 'Assignment removed',
  'review.submitted': 'Review submitted',
  'review.reopened': 'Review reopened',
  'results.computed': 'Results computed',
  'results.published': 'Results published',
  'results.unpublished': 'Results withdrawn',
  'export.csv': 'CSV export generated',
  'announcement.created': 'Announcement posted',
  'announcement.deleted': 'Announcement removed',
};
