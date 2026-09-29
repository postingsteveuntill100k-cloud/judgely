import { db } from '../db/index.js';
import { config } from '../config.js';
import { id, nowIso, secret, slugify } from '../lib/ids.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { emailField, parse } from '../lib/validate.js';
import { audit } from './audit.js';
import { deliver } from './mailer.js';
import { notify } from './notify.js';
import { linkFirebaseUser } from './auth.js';

export interface InviteResult {
  judge: any;
  invitation: any;
  delivery: { mode: string; delivered: boolean; detail: string };
  link: string;
}

/**
 * Inviting a judge creates three real things:
 *   1. an invitation row with a single-use token
 *   2. a judge record scoped to this event
 *   3. a real delivery attempt (SMTP if configured, otherwise an outbox file
 *      the organizer can open). Nothing is ever marked "sent" when it was not.
 */
export async function inviteJudge(
  event: any,
  actor: { id: string; displayName?: string; name?: string },
  input: { email: string; message?: string },
): Promise<InviteResult> {
  const d = db();
  const email = parse(emailField, input.email);
  const existingJudge = await d.getEventJudgeByEmail(event.id, email);
  if (existingJudge && existingJudge.status !== 'removed') {
    throw conflict(`${email} is already a judge on this hackathon.`, 'already_judge');
  }

  const at = nowIso();
  const token = secret(24);
  const link = `${config.baseUrl}/invite/${token}`;
  const judge = existingJudge
    ? await d.updateEventJudge(existingJudge.id, { status: 'invited', invited_by: actor.id, invited_at: at, email })
    : await d.createEventJudge({
        id: id('jdg'),
        event_id: event.id,
        user_id: null,
        email,
        email_lower: email,
        username: '',
        status: 'invited',
        invited_by: actor.id,
        invited_at: at,
        accepted_at: null,
        removed_at: null,
      });

  const invitation = await d.createInvitation({
    id: id('inv'),
    event_id: event.id,
    email,
    email_lower: email,
    role: 'judge',
    token,
    status: 'sent',
    delivery: config.mail.mode,
    message: String(input.message ?? '').slice(0, 1000),
    created_by: actor.id,
    created_at: at,
    accepted_at: null,
    accepted_by: null,
  });

  const delivery = await deliver({
    to: email,
    subject: `You are judging ${event.name} on Hackerly`,
    text: [
      `${event.name} — judging invitation`,
      '',
      `${actor.displayName ?? actor.name ?? 'An organizer'} invited you to judge this hackathon.`,
      event.submission_deadline ? `Submissions closed: ${new Date(event.submission_deadline).toUTCString()}` : '',
      '',
      'Open your assignments, read the rubric and review each project:',
      link,
      '',
      `If you were not expecting this, ignore the message. The link only works once, and only for ${email}.`,
    ]
      .filter(Boolean)
      .join('\n'),
  });

  await audit({
    eventId: event.id,
    actorId: actor.id,
    action: 'judge.invited',
    entityType: 'event_judge',
    entityId: judge.id,
    summary: `Invited ${email} as a judge`,
    meta: { delivery: delivery.mode, delivered: delivery.delivered },
  });
  return { judge, invitation, delivery, link };
}

export async function acceptInvitation(token: string, user: any): Promise<{ event: any; judge: any }> {
  const d = db();
  const invitation = await d.getInvitationByToken(token);
  if (!invitation) throw notFound('That invitation link is not valid.');
  if (invitation.status === 'accepted') throw conflict('This invitation has already been used. Sign in to see your assignments.', 'invitation_used');
  if (invitation.status === 'revoked') throw conflict('The organizer withdrew this invitation.', 'invitation_revoked');
  const event = await d.getEventById(invitation.event_id);
  if (!event) throw notFound('That hackathon no longer exists.');
  if (invitation.email_lower !== String(user.email).toLowerCase()) {
    throw badRequest(
      `This invitation was sent to ${invitation.email}. Sign in with that email address to accept it.`,
      'invitation_wrong_account',
    );
  }
  const at = nowIso();
  let judge = await d.getEventJudgeByEmail(event.id, invitation.email);
  judge = judge
    ? await d.updateEventJudge(judge.id, { status: 'active', user_id: user.id, username: user.username, accepted_at: at })
    : await d.createEventJudge({
        id: id('jdg'),
        event_id: event.id,
        user_id: user.id,
        email: invitation.email,
        email_lower: invitation.email,
        username: user.username,
        status: 'active',
        invited_by: invitation.created_by,
        invited_at: invitation.created_at,
        accepted_at: at,
        removed_at: null,
      });
  await d.updateInvitation(invitation.id, { status: 'accepted', accepted_at: at, accepted_by: user.id });
  await d.addMember(event.id, user.id, 'judge', at);
  await notify({
    userId: user.id,
    eventId: event.id,
    kind: 'judge',
    title: `You are judging ${event.name}`,
    body: 'Open your assignments to start reviewing.',
    link: `/judge/events/${event.slug}`,
  });
  await audit({
    eventId: event.id,
    actorId: user.id,
    action: 'judge.accepted',
    entityType: 'event_judge',
    entityId: judge.id,
    summary: `${user.display_name} accepted the judging invitation`,
  });
  return { event, judge };
}

export async function removeJudge(event: any, judgeId: string, actorId: string): Promise<void> {
  const d = db();
  const judges = await d.listEventJudges(event.id);
  const judge = judges.find((j) => j.id === judgeId);
  if (!judge) throw notFound('That judge is not on this hackathon.');
  const assignments = (await d.listAssignments({ eventId: event.id, judgeId: judgeId, limit: 5000 })).rows;
  const open = assignments.filter((a) => a.status !== 'submitted');
  if (open.length) {
    throw conflict(
      `${judge.email} still has ${open.length} unfinished ${open.length === 1 ? 'review' : 'reviews'}. Reassign them first.`,
      'judge_has_open_work',
    );
  }
  await d.updateEventJudge(judgeId, { status: 'removed', removed_at: nowIso() });
  if (judge.user_id) await d.removeMember(event.id, judge.user_id, 'judge');
  await audit({ eventId: event.id, actorId, action: 'judge.removed', entityType: 'event_judge', entityId: judgeId, summary: `Removed ${judge.email} from the panel` });
}

export async function resendInvitation(event: any, judgeId: string, actor: { id: string; displayName?: string; name?: string }): Promise<InviteResult> {
  const d = db();
  const judges = await d.listEventJudges(event.id);
  const judge = judges.find((j) => j.id === judgeId);
  if (!judge) throw notFound('That judge is not on this hackathon.');
  return inviteJudge(event, actor, { email: judge.email });
}

/** Bulk import: one email per line, ignores blanks and # comments. */
export async function parseBulkEmails(raw: string): Promise<string[]> {
  const out = new Set<string>();
  for (const line of String(raw ?? '').split(/[\n,;]/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    try {
      out.add(parse(emailField, value));
    } catch {
      throw badRequest(`"${value.slice(0, 40)}" is not a valid email address.`, 'bad_email');
    }
  }
  if (!out.size) throw badRequest('Add at least one email address.', 'no_emails');
  return [...out];
}

export function judgeDisplay(judge: any): string {
  return judge.display_name || judge.username || judge.email;
}

export function initialsOf(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function judgeSlug(judge: any): string {
  return slugify(judge.username || judge.email.split('@')[0], 'judge');
}
