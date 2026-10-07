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

export async function fanoutAnnouncement(
  event: any,
  audience: string,
  input: { title: string; body?: string; link?: string },
): Promise<void> {
  const d = db();
  const at = nowIso();
  const notifs: any[] = [];
  try {
    const userIds = new Set<string>();
    if (audience === 'everyone' || audience === 'participants') {
      const teams = await d.listTeams(event.id, { limit: 5000 });
      for (const t of teams.rows) {
        const members = await d.listTeamMembers(t.id);
        for (const m of members) userIds.add(m.id);
      }
    }
    if (audience === 'everyone' || audience === 'judges') {
      const judges = await d.listEventJudges(event.id);
      for (const j of judges) {
        if (j.user_id) userIds.add(j.user_id);
      }
    }
    for (const uid of userIds) {
      notifs.push({
        id: id('ntf'),
        user_id: uid,
        event_id: event.id,
        kind: 'announcement',
        title: input.title.slice(0, 160),
        body: (input.body ?? '').slice(0, 400),
        link: input.link ?? '',
        read_at: null,
        created_at: at,
      });
    }
    if (notifs.length > 0) {
      await d.createNotifications(notifs);
    }
  } catch (e) {
    log.error('fanoutAnnouncement failed', { error: (e as Error).message });
  }
}
