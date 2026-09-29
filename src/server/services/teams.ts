import { db } from '../db/index.js';
import { id, nowIso, slugify } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { randomAvatarSeed } from '../lib/crypto.js';
import { assertRegistrationOpen } from './events.js';
import { audit } from './audit.js';

export async function registerParticipant(event: any, userId: string): Promise<any> {
  const d = db();
  const existing = await d.getMembership(event.id, userId, 'participant');
  if (existing && existing.status === 'active') {
    throw conflict('You are already registered for this hackathon.', 'already_registered');
  }
  assertRegistrationOpen(event);
  const at = nowIso();
  await d.addMember(event.id, userId, 'participant', at);
  await audit({
    eventId: event.id,
    actorId: userId,
    action: 'participant.registered',
    entityType: 'event',
    entityId: event.id,
    summary: 'Registered to participate',
  });
  return d.getMembership(event.id, userId, 'participant');
}

export async function unregisterParticipant(event: any, userId: string): Promise<void> {
  const d = db();
  const team = await d.listTeamsForUser(userId);
  const inThisEvent = team.filter((t) => t.event_id === event.id);
  if (inThisEvent.length) {
    throw conflict(
      'You are on a team for this hackathon. Leave the team before withdrawing.',
      'on_team',
    );
  }
  await d.removeMember(event.id, userId, 'participant');
  await audit({ eventId: event.id, actorId: userId, action: 'participant.withdrawn', summary: 'Withdrew from the hackathon' });
}

export async function isRegistered(eventId: string, userId: string): Promise<boolean> {
  const m = await db().getMembership(eventId, userId, 'participant');
  return Boolean(m && m.status === 'active');
}

async function uniqueTeamSlug(eventId: string, base: string, excludeId?: string): Promise<string> {
  const d = db();
  const root = slugify(base, 'team');
  let slug = root;
  let n = 1;
  for (;;) {
    const existing = await d.getTeamBySlug(eventId, slug);
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

export async function createTeam(event: any, user: any, input: { name: string; description?: string }): Promise<any> {
  const d = db();
  const name = String(input.name ?? '').trim();
  if (name.length < 2) throw badRequest('Give the team a name of at least 2 characters.', 'bad_team_name', { field: 'name' });
  if (name.length > 60) throw badRequest('Team names can be up to 60 characters.', 'bad_team_name', { field: 'name' });
  if (!event.allow_solo && event.min_team_size > 1) {
    throw conflict('This hackathon does not allow solo entries, so you need teammates. Create a team and invite them.', 'solo_not_allowed');
  }
  if (!(await isRegistered(event.id, user.id))) {
    await registerParticipant(event, user.id);
  }
  const existing = (await d.listTeamsForUser(user.id)).filter((t) => t.event_id === event.id);
  if (existing.length) {
    throw conflict(`You are already on a team for this hackathon (${existing[0].name}). Leave it before creating another.`, 'already_on_team');
  }
  const at = nowIso();
  const slug = await uniqueTeamSlug(event.id, name);
  const team = await d.createTeam({
    id: id('tm'),
    event_id: event.id,
    slug,
    name,
    description: String(input.description ?? '').slice(0, 400),
    avatar_seed: randomAvatarSeed(slug),
    created_by: user.id,
    created_at: at,
    updated_at: at,
  });
  await audit({
    eventId: event.id,
    actorId: user.id,
    action: 'team.created',
    entityType: 'team',
    entityId: team.id,
    summary: `Created team ${team.name}`,
  });
  return team;
}

export async function joinTeam(event: any, user: any, teamId: string): Promise<any> {
  const d = db();
  const team = await d.getTeam(teamId);
  if (!team) throw notFound('That team no longer exists.');
  // Cross-event access is refused before anything else happens.
  if (team.event_id !== event.id) {
    throw forbidden('That team belongs to a different hackathon.');
  }
  if (team.event_id !== event.id) throw forbidden('That team belongs to a different hackathon.');

  const mine = (await d.listTeamsForUser(user.id)).filter((t) => t.event_id === event.id);
  if (mine.some((t) => t.id === teamId)) throw conflict('You are already on this team.', 'already_member');
  if (mine.length) {
    throw conflict(`You are already on ${mine[0].name} for this hackathon. Leave it before joining another.`, 'already_on_team');
  }
  const count = await d.countTeamMembers(teamId);
  if (count >= event.max_team_size) {
    throw conflict(`${team.name} is full (${event.max_team_size} members is the limit).`, 'team_full');
  }
  if (!event.allow_solo && count + 1 < event.min_team_size) {
    // Not blocking: a team can be created small and filled later.
  }
  if (!(await isRegistered(event.id, user.id))) await registerParticipant(event, user.id);
  await d.addTeamMember(teamId, user.id, 'member', nowIso());
  await audit({
    eventId: event.id,
    actorId: user.id,
    action: 'team.joined',
    entityType: 'team',
    entityId: teamId,
    summary: `Joined ${team.name}`,
  });
  return d.getTeamMember(teamId, user.id);
}

export async function leaveTeam(event: any, user: any, teamId: string): Promise<void> {
  const d = db();
  const team = await d.getTeam(teamId);
  if (!team) throw notFound('That team no longer exists.');
  if (team.event_id !== event.id) throw forbidden('That team belongs to a different hackathon.');
  const membership = await d.getTeamMember(teamId, user.id);
  if (!membership) throw forbidden('You are not on that team.');
  if (membership.role === 'owner') {
    throw conflict('You own this team. Transfer ownership or delete the team instead.', 'owner_cannot_leave');
  }
  await d.removeTeamMember(teamId, user.id);
  await audit({ eventId: event.id, actorId: user.id, action: 'team.left', entityType: 'team', entityId: teamId, summary: `Left ${team.name}` });
}

export async function updateTeam(event: any, team: any, actorId: string, patch: { name?: string; description?: string }): Promise<any> {
  const d = db();
  const member = await d.getTeamMember(team.id, actorId);
  if (!member) throw forbidden('Only team members can change team details.');
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (name.length < 2) throw badRequest('Give the team a name of at least 2 characters.', 'bad_team_name', { field: 'name' });
    if (name.length > 60) throw badRequest('Team names can be up to 60 characters.', 'bad_team_name', { field: 'name' });
    patch.name = name;
  }
  const row: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.name !== undefined) {
    row.name = patch.name;
    row.slug = await uniqueTeamSlug(team.event_id, patch.name, team.id);
  }
  if (patch.description !== undefined) row.description = String(patch.description).slice(0, 400);
  const updated = await d.updateTeam(team.id, row);
  await audit({ eventId: event.id, actorId, action: 'team.updated', entityType: 'team', entityId: team.id, summary: `Updated ${updated.name}` });
  return updated;
}

export async function deleteTeam(event: any, team: any, actorId: string): Promise<void> {
  const d = db();
  const membership = await d.getTeamMember(team.id, actorId);
  if (!membership || membership.role !== 'owner') {
    throw forbidden('Only the team owner can delete the team.');
  }
  const projects = await d.listProjectsForTeam(team.id);
  if (projects.some((p) => p.status !== 'draft')) {
    throw conflict('This team already submitted a project, so it cannot be deleted. Ask the organizer if something is wrong.', 'team_has_submission');
  }
  await d.deleteTeam(team.id);
  await audit({ eventId: event.id, actorId, action: 'team.deleted', entityType: 'team', entityId: team.id, summary: `Deleted team ${team.name}` });
}

export async function requireTeamAccess(event: any, teamId: string, userId: string): Promise<{ team: any; role: string }> {
  const d = db();
  const team = await d.getTeam(teamId);
  if (!team) throw notFound('That team no longer exists.');
  if (team.event_id !== event.id) throw forbidden('That team belongs to a different hackathon.');
  const member = await d.getTeamMember(teamId, userId);
  if (!member) throw forbidden('You are not a member of that team.');
  return { team, role: member.role };
}
