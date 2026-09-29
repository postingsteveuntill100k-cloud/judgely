import { db } from '../db/index.js';
import { config } from '../config.js';
import { id, nowIso, isoPlusDays, secret, sha256, slugify } from '../lib/ids.js';
import { signAcceptanceToken } from '../lib/crypto.js';
import { createUser } from '../services/auth.js';
import { log } from '../lib/logger.js';
import { round } from '../lib/ids.js';

/**
 * Fixed-header accounts for the DOGFOOD acceptance checker.
 *
 * These are ordinary users with ordinary sessions. Nothing about them is a
 * bypass: the judge accounts are real judges on the fixture event whose reviews
 * came from the real scoring path, and the participant is a real participant on
 * a real team. Only the session tokens are deterministic, so `.dogfood.toml`
 * does not have to be regenerated on every restart.
 */
export interface AcceptanceHeader {
  role: string;
  header: string;
  user: string;
  email: string;
}

const ACCOUNTS = [
  { role: 'organizer', token: 'dogfood_organizer_token_v1', email: 'organizer@sample-hack.test', username: 'sampleorg', name: 'Sample Organizer' },
  { role: 'judge_a', token: 'dogfood_judge_a_token_v1', email: 'priya.nair@example.org', username: 'priya.nair', name: 'Priya Nair' },
  { role: 'judge_b', token: 'dogfood_judge_b_token_v1', email: 'tomas.varga@example.org', username: 'tomas.varga', name: 'Tomas Varga' },
  { role: 'participant', token: 'dogfood_participant_token_v1', email: 'participant@hackerly.test', username: 'participant', name: 'Acceptance Participant' },
];

export async function seedAcceptanceAccounts(): Promise<AcceptanceHeader[]> {
  const d = db();
  const out: AcceptanceHeader[] = [];
  const event = await d.getEventBySlug('sample-hack-2026');
  if (!event) {
    log.warn('acceptance accounts skipped: fixture event not loaded');
    return out;
  }

  for (const account of ACCOUNTS) {
    let user = await d.getUserByEmail(account.email);
    if (!user) {
      user = await createUser({
        email: account.email,
        username: account.username,
        displayName: account.name,
        password: 'HackerlyDemo2026',
        emailVerified: true,
      });
    }

    if (account.role === 'participant') {
      // Registered for exactly one hackathon, so the submission endpoint can
      // resolve the event without being told which one.
      await d.addMember(event.id, user.id, 'participant', nowIso());
      const judges = await d.listEventJudges(event.id);
      if (!judges.some((j) => j.user_id === user.id)) {
        const teams = await d.listTeams(event.id, { limit: 1, offset: 0 });
        if (teams.rows[0]) {
          const existing = await d.getTeamMember(teams.rows[0].id, user.id);
          if (!existing) await d.addTeamMember(teams.rows[0].id, user.id, 'member', nowIso());
        }
      }
    }

    const token = signAcceptanceToken(account.token);
    const existing = await d.getSessionByTokenHash(sha256(account.token));
    const at = nowIso();
    if (existing) {
      await d.updateUser(user.id, { updated_at: at });
    } else {
      await d.createSession({
        id: id('ses'),
        user_id: user.id,
        token_hash: sha256(account.token),
        label: `acceptance:${account.role}`,
        user_agent: 'dogfood-acceptance',
        ip: '127.0.0.1',
        created_at: at,
        last_seen_at: at,
        expires_at: isoPlusDays(3650),
      });
    }
    out.push({
      role: account.role,
      header: `Cookie: ${config.session.cookieName}=${token}`,
      user: user.username,
      email: user.email,
    });
  }

  log.info('acceptance accounts ready', { count: out.length });
  return out;
}

export function acceptanceAccountInfo() {
  return ACCOUNTS.map((a) => ({ role: a.role, email: a.email, username: a.username, password: 'HackerlyDemo2026' }));
}

export { round, secret, slugify };
