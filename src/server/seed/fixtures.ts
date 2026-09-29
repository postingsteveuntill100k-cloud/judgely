import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { id, nowIso, slugify } from '../lib/ids.js';
import { hashPassword } from '../lib/crypto.js';
import { log } from '../lib/logger.js';
import { createUser } from '../services/auth.js';
import { createRubric } from '../services/judging.js';
import { DEFAULT_SUBMISSION_FIELDS } from '../services/events.js';
import type { Page } from '../db/driver.js';

interface Fixture {
  event: { id: string; name: string; submissions_close: string; [k: string]: any };
  tracks: { id: string; name: string; [k: string]: any }[];
  judges: { id: string; name: string; email: string; tracks?: string[]; [k: string]: any }[];
  teams: { id: string; name: string; members: string[]; [k: string]: any }[];
  projects: { id: string; team: string; track: string; title: string; summary: string; repo_url?: string; demo_url?: string; video_url?: string; submitted_at: string; [k: string]: any }[];
  scores: { judge: string; project: string; criteria: Record<string, number>; comment?: string; [k: string]: any }[];
}

/**
 * Loads the shared DOGFOOD fixture file into the real database.
 *
 * Fixtures are seed data, never runtime fallback data. If this fails the
 * application shows the error; it does not quietly serve a fake site.
 */
export async function loadFixtures(opts: { force?: boolean } = {}): Promise<Record<string, number | string>> {
  const file = config.seed.fixturesFile;
  if (!existsSync(file)) {
    log.warn('fixtures.json not found, skipping', { file });
    return { status: 'skipped', reason: 'fixtures.json not found' };
  }
  const d = db();
  const existing = await d.getEventBySlug('sample-hack-2026');
  if (existing && !opts.force) {
    log.info('fixtures already loaded', { event: existing.slug });
    return { status: 'skipped', reason: 'already loaded', event: existing.id };
  }

  const raw: Fixture = JSON.parse(readFileSync(file, 'utf8'));
  const at = nowIso();
  const organizer = await ensureUser({
    email: 'organizer@sample-hack.test',
    username: 'sampleorg',
    displayName: 'Sample Organizer',
    password: 'SamplePass2026',
    bio: 'Runs Sample Hack every spring.',
  });

  const closeAt = new Date(raw.event.submissions_close).toISOString();
  const openAt = new Date(new Date(closeAt).getTime() - 30 * 86400_000).toISOString();
  const startAt = new Date(new Date(closeAt).getTime() - 14 * 86400_000).toISOString();
  const endAt = new Date(new Date(closeAt).getTime() + 86400_000).toISOString();
  const judgeEnd = new Date(new Date(closeAt).getTime() + 5 * 86400_000).toISOString();

  const event = await d.createEvent({
    id: raw.event.id || id('evt'),
    slug: 'sample-hack-2026',
    name: raw.event.name || 'Sample Hack 2026',
    tagline: 'A sample event used to exercise a judging portal end to end.',
    description:
      'This event comes from the shared DOGFOOD fixture set. It exists so a portal can be checked against realistic, awkward data: forty projects, thirty judges, uneven review batches and a scoring pattern that never varies.',
    rules_md: '- Submissions closed on the date shown on this page.\n- The backend refuses any submission after the deadline, whatever the browser does.\n- Judges cannot see each other\'s scores.',
    organizer_name: 'Sample Organizer',
    contact_email: 'organizer@sample-hack.test',
    cover_url: '',
    cover_style: 'auto',
    accent_color: '',
    mode: 'global',
    status: 'closed',
    format: 'online',
    venue: '',
    city: 'Remote',
    country: '',
    timezone: 'UTC',
    prize_pool_cents: 0,
    prize_currency: 'USD',
    prize_headline: 'No prize pool',
    registration_opens_at: openAt,
    registration_closes_at: closeAt,
    starts_at: startAt,
    ends_at: endAt,
    submission_deadline: closeAt,
    judging_starts_at: closeAt,
    judging_ends_at: judgeEnd,
    results_release_at: null,
    min_team_size: 1,
    max_team_size: 4,
    allow_solo: 1,
    allow_cross_college: 1,
    eligibility: 'Open to anyone with an account on Hackerly.',
    judging_mode: 'raw',
    normalize_lambda: 0,
    results_visibility: 'hidden',
    showcase_visibility: 'public',
    public_listing: 1,
    require_approval: 0,
    submission_fields: JSON.stringify(DEFAULT_SUBMISSION_FIELDS),
    judging_blurb: 'Each project is scored against the published rubric by the assigned judges.',
    schedule: JSON.stringify([
      { label: 'Registration opens', at: openAt, detail: '' },
      { label: 'Hacking starts', at: startAt, detail: '' },
      { label: 'Submissions close', at: closeAt, detail: 'The server refuses anything later.' },
      { label: 'Judging ends', at: judgeEnd, detail: '' },
    ]),
    created_by: organizer.id,
    created_at: at,
    updated_at: at,
    published_at: new Date(startAt).toISOString(),
  });

  // --- tracks
  const trackId = new Map<string, string>();
  for (const [i, t] of (raw.tracks ?? []).entries()) {
    const track = await d.createTrack({
      id: t.id || id('trk'),
      event_id: event.id,
      slug: slugify(t.name, `track-${i + 1}`),
      name: t.name,
      description: t.description ?? '',
      eligibility: t.eligibility ?? '',
      prize_text: t.prize ?? '',
      brief: t.brief ?? '',
      requirements: JSON.stringify([]),
      max_teams: null,
      sort_order: i,
      created_at: at,
    });
    trackId.set(t.id, track.id);
    trackId.set(t.name, track.id);
  }

  // --- judges (real users, so a score has an author)
  const judgeByFixtureId = new Map<string, any>();
  for (const [i, j] of (raw.judges ?? []).entries()) {
    const email = j.email || `judge${i + 1}@sample-hack.test`;
    const username = slugify((j.name || email).toLowerCase().replace(/[^a-z0-9]+/g, '.'), `judge${i + 1}`).slice(0, 24);
    const user = await ensureUser({
      email,
      username: username.replace(/^[^a-z]/, 'j'),
      displayName: j.name || email,
      password: 'SamplePass2026',
      bio: j.bio ?? '',
    });
    const judge = await d.createEventJudge({
      id: j.id || id('jdg'),
      event_id: event.id,
      user_id: user.id,
      email,
      email_lower: email.toLowerCase(),
      username: user.username,
      status: 'active',
      invited_by: organizer.id,
      invited_at: at,
      accepted_at: at,
      removed_at: null,
    });
    judgeByFixtureId.set(j.id, { ...judge, user });
  }

  // --- teams + members + projects
  const teamByFixtureId = new Map<string, any>();
  const usedTeamSlugs = new Set<string>();
  for (const t of raw.teams ?? []) {
    const members: string[] = [];
    for (const email of t.members ?? []) {
      const user = await ensureUser({
        email,
        username: slugify(email.split('@')[0], 'member').slice(0, 24),
        displayName: prettyName(email),
        password: 'SamplePass2026',
      });
      members.push(user.id);
    }
    // The fixture reuses a few team names on purpose; slugs still have to be
    // unique inside the event, because that is what URLs use.
    const base = slugify(t.name, 'team');
    let teamSlug = base;
    let n = 1;
    while (usedTeamSlugs.has(teamSlug)) { n += 1; teamSlug = `${base}-${n}`; }
    usedTeamSlugs.add(teamSlug);
    const team = await d.createTeam({
      id: t.id || id('tm'),
      event_id: event.id,
      slug: teamSlug,
      name: t.name,
      description: t.description ?? '',
      avatar_seed: i32(t.name),
      created_by: members[0] ?? organizer.id,
      created_at: t.created_at ?? at,
      updated_at: at,
    });
    for (const [i, uid] of members.entries()) {
      await d.addTeamMember(team.id, uid, i === 0 ? 'owner' : 'member', at);
      await d.addMember(event.id, uid, 'participant', at);
    }
    teamByFixtureId.set(t.id, team);
  }

  const projectByFixtureId = new Map<string, any>();
  const usedProjectSlugs = new Set<string>();
  const teamWithProject = new Set<string>();
  let skippedDuplicates = 0;
  for (const [i, p] of (raw.projects ?? []).entries()) {
    const team = teamByFixtureId.get(p.team);
    if (!team) continue;
    // A team gets exactly one project per event: that is a product rule, and the
    // database enforces it with a unique index. The fixture file contains one
    // team with two entries on purpose, so the second is reported rather than
    // silently dropped.
    if (teamWithProject.has(team.id)) {
      skippedDuplicates += 1;
      log.warn('fixture project skipped: team already has a submission', { project: p.id, team: p.team });
      continue;
    }
    teamWithProject.add(team.id);
    const submittedAt = p.submitted_at ? new Date(p.submitted_at).toISOString() : at;
    const base = slugify(p.title, `project-${i + 1}`);
    let projectSlug = base;
    let n = 1;
    while (usedProjectSlugs.has(projectSlug)) { n += 1; projectSlug = `${base}-${n}`; }
    usedProjectSlugs.add(projectSlug);
    const project = await d.createProject({
      id: p.id || id('prj'),
      event_id: event.id,
      team_id: team.id,
      track_id: trackId.get(p.track) ?? null,
      slug: projectSlug,
      title: p.title,
      tagline: p.tagline ?? firstSentence(p.summary),
      summary: p.summary ?? '',
      description: p.description ?? p.summary ?? '',
      tech_stack: JSON.stringify(p.tech_stack ?? ['TypeScript', 'Node.js']),
      image_url: '',
      repo_url: p.repo_url ?? '',
      demo_url: p.demo_url ?? '',
      video_url: p.video_url ?? '',
      docs_url: p.docs_url ?? '',
      answers: JSON.stringify({
        problem: p.summary ?? '',
        how_it_works: p.description ?? '',
        tech_stack: (p.tech_stack ?? []).join(', '),
      }),
      status: 'under_review',
      submitted_at: submittedAt,
      locked_at: null,
      created_at: submittedAt,
      updated_at: submittedAt,
    });
    projectByFixtureId.set(p.id, project);
  }

  // --- rubric + scores
  // The fixture file scores on functionality / quality / innovation out of 5, so
  // the rubric mirrors that shape rather than inventing its own scale.
  const preset = [
    { key: 'functionality', name: 'Functionality', description: 'Does it do what it claims, end to end?', weight: 40, maxScore: 5 },
    { key: 'quality', name: 'Quality', description: 'Is the code and the structure sound?', weight: 35, maxScore: 5 },
    { key: 'innovation', name: 'Innovation', description: 'Is the idea its own?', weight: 25, maxScore: 5 },
  ];
  const rubric = await createRubric(
    { id: event.id },
    preset.map((c) => ({ ...c, required: true })),
    organizer.id,
  );
  const criterionRows: any[] = await db().listCriteria(rubric.id);
  const byKey = new Map(criterionRows.map((c) => [c.key, c]));

  let assignmentsMade = 0;
  let reviewsMade = 0;
  const seen = new Set<string>();
  for (const s of raw.scores ?? []) {
    const judge = judgeByFixtureId.get(s.judge);
    const project = projectByFixtureId.get(s.project);
    if (!judge || !project) continue;
    const dedupeKey = `${judge.id}:${project.id}`;
    // The fixture file deliberately contains a duplicate entry. Real systems
    // have to tolerate that, so the second one updates rather than duplicating.
    if (seen.has(dedupeKey)) {
      const existing = (await d.listAssignments({ eventId: event.id, projectId: project.id, judgeId: judge.id, limit: 10 })).rows[0];
      if (existing && existing.rows && existing.rows[0]) {
        const review = await d.getReviewByAssignment(existing.rows[0].id);
        if (review) {
          for (const [k, v] of Object.entries(s.criteria ?? {})) {
            const c = byKey.get(k);
            if (c) await d.upsertScore({ id: id('sc'), review_id: review.id, criterion_id: c.id, score: Number(v), note: '' });
          }
        }
      }
      continue;
    }
    seen.add(dedupeKey);
    const assignment = await d.createAssignment({
      id: id('asg'),
      event_id: event.id,
      project_id: project.id,
      event_judge_id: judge.id,
      status: 'submitted',
      assigned_at: new Date(new Date(project.submitted_at ?? at).getTime() + 3600_000).toISOString(),
      submitted_at: new Date(new Date(project.submitted_at ?? at).getTime() + 7200_000).toISOString(),
    });
    assignmentsMade += 1;
    const review = await d.createReview({
      id: id('rev'),
      assignment_id: assignment.id,
      event_id: event.id,
      project_id: project.id,
      event_judge_id: judge.id,
      user_id: judge.user_id,
      status: 'submitted',
      comment: s.comment ?? '',
      strengths: '',
      improvements: '',
      recommendation: '',
      weighted_score: null,
      submitted_at: assignment.submitted_at,
      created_at: assignment.submitted_at,
      updated_at: assignment.submitted_at,
    });
    let acc = 0;
    let wsum = 0;
    for (const [k, v] of Object.entries(s.criteria ?? {})) {
      const c = byKey.get(k);
      if (!c) continue;
      await d.upsertScore({ id: id('sc'), review_id: review.id, criterion_id: c.id, score: Number(v), note: '' });
      acc += (Number(v) / c.max_score) * c.weight;
      wsum += c.weight;
    }
    await d.updateReview(review.id, { weighted_score: wsum ? Math.round((acc / wsum) * 10000) / 10000 : 0 });
    reviewsMade += 1;
  }

  // Give every judge at least one assignment so a panel member always has work,
  // including the deliberately unfinished batches the fixture describes.
  const projectList = [...projectByFixtureId.values()];
  const judgeList = [...judgeByFixtureId.values()];
  for (const [i, judge] of judgeList.entries()) {
    if (i % 4 === 3) continue; // some judges intentionally have nothing assigned
    const existing = (await d.listAssignments({ eventId: event.id, judgeId: judge.id, limit: 5000 })).rows;
    if (existing.length >= 2) continue;
    let guard = 0;
    while (existing.length + guard < 2 && guard < 4) {
      const p = projectList[(i * 3 + guard) % projectList.length];
      const dup = await d.listAssignments({ eventId: event.id, projectId: p.id, judgeId: judge.id, limit: 10 });
      if (dup.total === 0) {
        await d.createAssignment({
          id: id('asg'),
          event_id: event.id,
          project_id: p.id,
          event_judge_id: judge.id,
          status: 'pending',
          assigned_at: at,
          submitted_at: null,
        });
        assignmentsMade += 1;
      }
      guard += 1;
    }
  }

  await d.addAudit({
    id: id('aud'),
    event_id: event.id,
    actor_id: null,
    actor_label: 'seed',
    action: 'event.created',
    entity_type: 'event',
    entity_id: event.id,
    summary: `Loaded DOGFOOD fixtures: ${(raw.projects ?? []).length} projects, ${(raw.judges ?? []).length} judges`,
    meta: '{}',
    ip: '',
    created_at: at,
  });

  log.info('fixtures loaded', {
    event: event.slug,
    projects: projectByFixtureId.size,
    judges: judgeList.length,
    assignments: assignmentsMade,
    reviews: reviewsMade,
    skippedDuplicates,
  });
  return {
    status: 'loaded',
    event: event.id,
    slug: event.slug,
    projects: projectByFixtureId.size,
    judges: judgeList.length,
    assignments: assignmentsMade,
    reviews: reviewsMade,
    skipped_duplicate_projects: skippedDuplicates,
  };
}

async function ensureUser(input: {
  email: string;
  username: string;
  displayName: string;
  password: string;
  bio?: string;
}): Promise<any> {
  const d = db();
  const existing = await d.getUserByEmail(input.email);
  if (existing) return existing;
  let username = input.username;
  let n = 0;
  while (await d.getUserByUsername(username)) {
    n += 1;
    username = `${input.username.slice(0, 20)}${n}`;
  }
  return createUser({
    email: input.email,
    username,
    displayName: input.displayName,
    password: input.password,
    emailVerified: true,
  });
}

function i32(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

function prettyName(email: string): string {
  const local = email.split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ') || local;
}

function firstSentence(text: string): string {
  if (!text) return '';
  const m = String(text).match(/^[^.!?]+[.!?]?/);
  return (m ? m[0] : text).slice(0, 160);
}

export { hashPassword, path };
