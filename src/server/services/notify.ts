import { db } from '../db/index.js';
import { id, nowIso } from '../lib/ids.js';
import { log } from '../lib/logger.js';

export async function notify(input: {
  userId: string;
  eventId?: string | null;
  kind: string;
  title: string;
  body?: string;
  link?: string;
}): Promise<void> {
  try {
    await db().createNotification({
      id: id('ntf'),
      user_id: input.userId,
      event_id: input.eventId ?? null,
      kind: input.kind,
      title: input.title.slice(0, 160),
      body: (input.body ?? '').slice(0, 400),
      link: input.link ?? '',
      read_at: null,
      created_at: nowIso(),
    });
  } catch (e) {
    log.warn('notification failed', { error: (e as Error).message });
  }
}

export async function notifyTeam(event: any, team: any, input: { kind: string; title: string; body?: string; link?: string }): Promise<void> {
  const members = await db().listTeamMembers(team.id);
  for (const m of members) {
    await notify({ userId: m.id, eventId: event.id, ...input });
  }
}
