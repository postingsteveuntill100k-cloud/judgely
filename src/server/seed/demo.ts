import { db } from '../db/index.js';
import { id, nowIso, isoPlusDays, slugify } from '../lib/ids.js';
import { createUser } from '../services/auth.js';
import { createRubric } from '../services/judging.js';
import { log } from '../lib/logger.js';

/**
 * Demo content for a fresh install.
 *
 * It goes through the same service functions a real organizer uses, so it
 * exercises real code paths and produces a database that looks lived in. It is
 * seed data, not runtime fallback: if the database is empty at runtime, the
 * pages say so.
 */
export async function seedDemo(): Promise<Record<string, number | string>> {
  const d = db();
  // Only skip if our own demo events are already there. The DOGFOOD fixture event
  // existing must not stop the demo set from loading.
  const existingDemo = await d.getEventBySlug('hacktron-2026');
  if (existingDemo) {
    log.info('demo seed skipped, demo events already exist', { event: existingDemo.slug });
    return { status: 'skipped', reason: 'demo events already present' };
  }

  const organizer = await ensureUser({
    email: 'meera@hackerly.dev',
    username: 'meera',
    displayName: 'Meera Raghavan',
    password: 'HackerlyDemo2026',
    bio: 'Runs build nights and student hackathons. Ask me about judging panels.',
    headline: 'Event organizer · Bengaluru',
  });
  const second = await ensureUser({
    email: 'jonas@hackerly.dev',
    username: 'jonas',
    displayName: 'Jonas Beck',
    password: 'HackerlyDemo2026',
    bio: 'Systems person. Interested in developer tooling and edge deployments.',
    headline: 'Runs the Berlin build nights',
  });

  // ------------------------------------------------------- HACKTRON 2026 --
  const hacktron = await createEventRow({
    slug: 'hacktron-2026',
    name: 'HACKTRON 2026',
    tagline: 'Build. Break. Ship.',
    description:
      'Two weeks, online, and a prize pool aimed at things people actually deploy. HACKTRON is for teams who want to finish something: a working link, a repository, a short demo video and an honest write-up. No slide decks.\n\nJudging runs against a published rubric with weights, assigned in advance, and results are published with the per-criterion breakdown. You can see the rubric before you register.',
    rules: [
      'Teams of 1–4 people. A solo entry is fine.',
      'Everything must be built during the event window. Using an API or a dataset that predates it is fine; shipping a pre-built product is not.',
      'Your repository must be public, or reachable by the judges, from the moment you submit.',
      'One submission per team. You may edit it freely until the deadline; the server refuses anything after it.',
      'Judges cannot see each other\u2019s scores, and neither can you. Only the published ranking reaches you.',
    ].map((r) => `- ${r}`).join('\n'),
    organizerName: 'NexusLabs',
    contactEmail: 'hello@hacktron.dev',
    mode: 'global',
    format: 'online',
    prizePoolCents: 50000000,
    prizeCurrency: 'INR',
    prizeHeadline: '₹5,00,000 in prizes',
    city: '',
    country: '',
    coverStyle: 'arcs',
    accent: '#d8401a',
    startsAt: isoPlusDays(13),
    endsAt: isoPlusDays(27),
    registrationClosesAt: isoPlusDays(27),
    submissionDeadline: isoPlusDays(27),
    judgingEndsAt: isoPlusDays(31),
    resultsReleaseAt: isoPlusDays(33),
    minTeamSize: 1,
    maxTeamSize: 4,
    judgingMode: 'normalized',
    lambda: 0.5,
    showcaseVisibility: 'public',
    createdBy: organizer.id,
  });

  await createTracks(d, hacktron.id, [
    { name: 'Developer tools', description: 'Anything that makes other developers faster or safer.', prize: '₹1,50,000', brief: 'A tool another team could adopt tomorrow morning.' },
    { name: 'Applied AI', description: 'Models doing real work, with a measurable outcome.', prize: '₹1,50,000', brief: 'Show the evaluation, not the demo reel.' },
    { name: 'Civic and public good', description: 'Software that a government, school or clinic would use.', prize: '₹1,00,000', brief: 'Name the institution and the person who benefits.' },
    { name: 'Wildcard', description: 'Anything that does not fit the other three.', prize: '₹1,00,000', brief: 'Convince the panel it deserves the slot.' },
  ]);

  await createRubric(hacktron, [
    { name: 'Does it work', description: 'The judge clones it and it runs. Nothing is theoretical.', weight: 35, maxScore: 10 },
    { name: 'Technical quality', description: 'Architecture, error handling, tests, sensible data modelling.', weight: 25, maxScore: 10 },
    { name: 'Originality', description: 'Is this an idea of its own, or a reskin?', weight: 15, maxScore: 10 },
    { name: 'Impact', description: 'Who uses this, how often, and what changes for them.', weight: 15, maxScore: 10 },
    { name: 'Clarity', description: 'Can a stranger understand it in ninety seconds?', weight: 10, maxScore: 10 },
  ], organizer.id);

  // ------------------------------------------- Meridian (local, in person) --
  const meridian = await createEventRow({
    slug: 'meridian-local-hack-night',
    name: 'Meridian Build Night',
    tagline: 'One evening, one room, no laptops allowed on the table unwrapped.',
    description:
      'A physical hack night at the Meridian community hall in Leipzig. Bring a laptop, plug into the hall network, and build with the people sitting next to you. Everything runs on the local install, so the night keeps working even when the venue wifi does not.',
    rules: [
      'Doors at 18:00, build from 18:30, demos from 22:00.',
      'Teams of 1–3. Meet people at the door; organizers help you form a team in the first fifteen minutes.',
      'Submission is a GitHub URL and a two-minute demo. No slides.',
      'Judging happens in the room at 22:15 on the same projected screen you just presented on.',
    ].map((r) => `- ${r}`).join('\n'),
    organizerName: second.display_name,
    contactEmail: 'jonas@meridian.build',
    mode: 'local',
    format: 'offline',
    prizePoolCents: 120000,
    prizeCurrency: 'EUR',
    prizeHeadline: '€1,200 and hardware',
    venue: 'Meridian Community Hall',
    city: 'Leipzig',
    country: 'Germany',
    coverStyle: 'strata',
    accent: '#1f6f6b',
    startsAt: isoPlusDays(6),
    endsAt: isoPlusDays(6),
    registrationClosesAt: isoPlusDays(5),
    submissionDeadline: isoPlusDays(6),
    judgingEndsAt: isoPlusDays(6),
    resultsReleaseAt: isoPlusDays(7),
    minTeamSize: 1,
    maxTeamSize: 3,
    judgingMode: 'raw',
    showcaseVisibility: 'public',
    createdBy: second.id,
  });
  await createTracks(d, meridian.id, [
    { name: 'Open floor', description: 'Anything at all. Show it in two minutes.', prize: '€600', brief: 'Two minutes, one screen, no deck.' },
    { name: 'Hardware hack', description: 'Sensors, microcontrollers, anything that blinks.', prize: '€600', brief: 'We provide the mains and the soldering irons.' },
  ]);
  await createRubric(meridian, [
    { name: 'It works', description: 'You demonstrated it live, or with a recording from tonight.', weight: 50, maxScore: 10 },
    { name: 'Craft', description: 'Care taken with the details.', weight: 30, maxScore: 10 },
    { name: 'Ambition', description: 'How far did you get in four hours?', weight: 20, maxScore: 10 },
  ], second.id);

  // ------------------------------------ Fold (closed, with public results) --
  const fold = await createEventRow({
    slug: 'fold-2026-spring',
    name: 'Fold · Spring Edition',
    tagline: 'A weekend spent making software for people who are hard to reach.',
    description:
      'Fold ran for 36 hours in May. Thirty-one teams entered, twenty-eight submitted, and the results below are the published ranking with the per-criterion breakdown. Everything on this page is the real output of the event, not a mock-up.',
    rules: ['Teams of 2\u20135 people.', 'Everything built during the weekend.', 'Judging uses a published weighted rubric; individual judge scores stay private.']
      .map((r) => `- ${r}`)
      .join('\n'),
    organizerName: organizer.display_name,
    contactEmail: 'meera@hackerly.dev',
    mode: 'global',
    format: 'online',
    prizePoolCents: 8000000,
    prizeCurrency: 'INR',
    prizeHeadline: '₹80,000 in prizes',
    coverStyle: 'mesh',
    accent: '#3b4cca',
    startsAt: isoPlusDays(-140),
    endsAt: isoPlusDays(-137),
    registrationClosesAt: isoPlusDays(-138),
    submissionDeadline: isoPlusDays(-137),
    judgingEndsAt: isoPlusDays(-135),
    resultsReleaseAt: isoPlusDays(-134),
    minTeamSize: 2,
    maxTeamSize: 5,
    allowSolo: false,
    judgingMode: 'normalized',
    lambda: 0.5,
    showcaseVisibility: 'public',
    resultsVisibility: 'public',
    publishedAt: isoPlusDays(-141),
    createdBy: organizer.id,
  });
  await createTracks(d, fold.id, [
    { name: 'Accessibility', description: 'Software that removes a barrier for someone.', prize: '₹30,000', brief: 'Name the barrier and the person it is for.' },
    { name: 'Care and health', description: 'Software for carers, patients and clinics.', prize: '₹30,000', brief: 'Clinical claims need evidence.' },
    { name: 'Open track', description: 'Everything else.', prize: '₹20,000', brief: 'Make the case yourself.' },
  ]);
  await createRubric(fold, [
    { name: 'Working software', description: 'The link loads and the core path works.', weight: 35, maxScore: 10 },
    { name: 'Depth', description: 'How far past the demo did you go?', weight: 25, maxScore: 10 },
    { name: 'Who it helps', description: 'Specificity about the beneficiary.', weight: 25, maxScore: 10 },
    { name: 'Write-up', description: 'Could a new maintainer pick this up?', weight: 15, maxScore: 10 },
  ], organizer.id);

  await seedShowcaseProjects(fold, organizer.id);
  await seedHacktronTeams(hacktron, organizer.id);
  const inFlight = await seedHacktronJudging(hacktron, organizer.id);
  await seedMeridianFloor(meridian, second.id);

  // The Fold event is presented as a finished hackathon with published
  // results. That has to be true in the database, not just in the copy, so the
  // demo panel is built, the projects are assigned, the reviews are submitted,
  // and the ranking is computed and published through the real judging engine.
  const published = await seedFoldJudging(fold, organizer.id);

  log.info('demo seed complete', { events: 3, publishedResults: published, hacktronReviews: inFlight });
  return { status: 'loaded', events: 3, publishedResults: published, hacktronReviews: inFlight };
}

// ----------------------------------------------------------------- helpers

/** Nudge a timestamp to a plausible hour of the day so a schedule reads like one. */
function atHour(value: string | null | undefined, hour: number): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

async function createEventRow(input: any): Promise<any> {
  const d = db();
  const at = nowIso();
  const submissionFields = [
    { key: 'repo_url', label: 'Source code', type: 'url', required: true, placeholder: 'https://github.com/you/project' },
    { key: 'demo_url', label: 'Working demo', type: 'url', required: true, placeholder: 'https://your-project.example' },
    { key: 'video_url', label: 'Two-minute demo video', type: 'url', required: false, placeholder: 'https://www.youtube.com/watch?v=…' },
    { key: 'tech_stack', label: 'Technologies used', type: 'tags', required: true, placeholder: 'TypeScript, Postgres, Fly' },
    { key: 'problem', label: 'What problem does it solve?', type: 'textarea', required: true, help: 'Two or three sentences. The judges read this first.' },
    { key: 'how_it_works', label: 'How does it work?', type: 'textarea', required: false },
  ];
  return d.createEvent({
    id: id('evt'),
    slug: input.slug,
    name: input.name,
    tagline: input.tagline ?? '',
    description: input.description ?? '',
    rules_md: input.rules ?? '',
    organizer_name: input.organizerName ?? '',
    contact_email: input.contactEmail ?? '',
    cover_url: '',
    cover_style: input.coverStyle ?? 'auto',
    accent_color: input.accent ?? '',
    mode: input.mode,
    status: input.publishedAt ? 'closed' : 'published',
    format: input.format,
    venue: input.venue ?? '',
    city: input.city ?? '',
    country: input.country ?? '',
    timezone: 'UTC',
    prize_pool_cents: input.prizePoolCents ?? 0,
    prize_currency: input.prizeCurrency ?? 'INR',
    prize_headline: input.prizeHeadline ?? '',
    registration_opens_at: isoPlusDays(-30),
    registration_closes_at: input.registrationClosesAt ?? null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    submission_deadline: input.submissionDeadline,
    judging_starts_at: input.submissionDeadline,
    judging_ends_at: input.judgingEndsAt,
    results_release_at: input.resultsReleaseAt,
    min_team_size: input.minTeamSize ?? 1,
    max_team_size: input.maxTeamSize ?? 4,
    allow_solo: input.allowSolo === false ? 0 : 1,
    allow_cross_college: 1,
    eligibility: input.eligibility ?? 'Open to anyone. You need a Hackerly account to submit.',
    judging_mode: input.judgingMode ?? 'raw',
    normalize_lambda: input.lambda ?? 0,
    results_visibility: input.resultsVisibility ?? 'hidden',
    showcase_visibility: input.showcaseVisibility ?? 'hidden',
    public_listing: 1,
    require_approval: 0,
    submission_fields: JSON.stringify(submissionFields),
    judging_blurb: 'Assigned judges score every project against the published rubric. Scores stay private until results are released.',
    schedule: JSON.stringify([
      { label: 'Registration opens', at: atHour(isoPlusDays(-30), 9), detail: '' },
      { label: 'Build window opens', at: atHour(input.startsAt, input.mode === 'local' ? 18 : 0), detail: '' },
      { label: 'Submissions close', at: atHour(input.submissionDeadline, 18), detail: 'The server refuses anything later.' },
      { label: 'Judging closes', at: atHour(input.judgingEndsAt, 12), detail: '' },
      { label: 'Results published', at: atHour(input.resultsReleaseAt, 12), detail: '' },
    ]),
    created_by: input.createdBy,
    created_at: at,
    updated_at: at,
    published_at: input.publishedAt ?? isoPlusDays(-29),
  });
}

async function createTracks(d: any, eventId: string, tracks: any[]) {
  for (const [i, t] of tracks.entries()) {
    await d.createTrack({
      id: id('trk'),
      event_id: eventId,
      slug: slugify(t.name, `track-${i + 1}`),
      name: t.name,
      description: t.description ?? '',
      eligibility: '',
      prize_text: t.prize ?? '',
      brief: t.brief ?? '',
      requirements: JSON.stringify([]),
      max_teams: null,
      sort_order: i,
      created_at: nowIso(),
    });
  }
}

async function seedShowcaseProjects(event: any, ownerId: string) {
  const d = db();
  const tracks = await d.listTracks(event.id);
  const people = await ensureShowcasePeople();
  const projects = [
    { team: 'Almanac', title: 'Tidewatch', tagline: 'Flood alerts for renters, not just river gauges.', track: 0, stack: ['TypeScript', 'Fastify', 'Postgres', 'MapLibre'], repo: 'https://github.com/hackerly-demo/tidewatch', demo: 'https://tidewatch.example.org', summary: 'Turns municipal gauge data into a message a renter can act on: which streets flood, when, and what to move first.' },
    { team: 'Slow Signal', title: 'Keepsake', tagline: 'A handover tool for hospital ward rounds.', track: 1, stack: ['Python', 'Django', 'SQLite'], repo: 'https://github.com/hackerly-demo/keepsake', demo: 'https://keepsake.example.org', summary: 'Captures what a ward round actually decided, who owns the next action, and what would count as it being done.' },
    { team: 'North Kiln', title: 'Glass Signal', tagline: 'Detects a broken captcha before the user retries.', track: 0, stack: ['Rust', 'WebAssembly'], repo: 'https://github.com/hackerly-demo/glass-signal', demo: 'https://glass-signal.example.org', summary: 'Scores accessibility-tree changes between renders to find the moment a control stopped responding.' },
    { team: 'Lantern', title: 'Reading Room', tagline: 'A screen reader that survives your own components.', track: 0, stack: ['TypeScript', 'React', 'Vitest'], repo: 'https://github.com/hackerly-demo/reading-room', demo: 'https://reading-room.example.org', summary: 'A test harness that fails a pull request when a component renders something a screen reader cannot announce.' },
    { team: 'Fold Nine', title: 'Quiet Hours', tagline: 'A school timetable that respects screen time limits.', track: 2, stack: ['Kotlin', 'Jetpack Compose'], repo: 'https://github.com/hackerly-demo/quiet-hours', demo: 'https://quiet-hours.example.org', summary: 'Schedules device-heavy work outside the window a school sets, and explains the trade-off to the student.' },
    { team: 'Second Spring', title: 'Parcel Log', tagline: 'Medication deliveries, tracked by the person receiving them.', track: 1, stack: ['Ruby on Rails', 'Postgres', 'Sidekiq'], repo: 'https://github.com/hackerly-demo/parcel-log', demo: 'https://parcel-log.example.org', summary: 'A delivery record the recipient controls, with a chain of custody the pharmacy and the courier both trust.' },
  ];

  for (const [i, p] of projects.entries()) {
    // Two-person teams, drawn from the pool without repeating a pair.
    const members = [people[i % people.length], people[(i + 2) % people.length]];
    const submittedAt = isoPlusDays(-137 + i);
    const team = await d.createTeam({
      id: id('tm'),
      event_id: event.id,
      slug: slugify(p.team, `team-${i + 1}`),
      name: p.team,
      description: '',
      avatar_seed: i * 67,
      created_by: members[0].id,
      created_at: submittedAt,
      updated_at: submittedAt,
    });
    for (const [mi, m] of members.entries()) {
      await d.addTeamMember(team.id, m.id, mi === 0 ? 'owner' : 'member', submittedAt);
      await d.addMember(event.id, m.id, 'participant', submittedAt);
    }
    await d.createProject({
      id: id('prj'),
      event_id: event.id,
      team_id: team.id,
      track_id: tracks[p.track]?.id ?? null,
      slug: slugify(p.title, `project-${i + 1}`),
      title: p.title,
      tagline: p.tagline,
      summary: p.summary,
      description: `${p.summary}\n\nBuilt over 36 hours by a team of ${members.length}. The repository is public, the demo is still up, and the write-up explains what we would do differently.`,
      tech_stack: JSON.stringify(p.stack),
      image_url: '',
      repo_url: p.repo,
      demo_url: p.demo,
      video_url: '',
      docs_url: `${p.repo}#readme`,
      answers: JSON.stringify({
        problem: p.summary,
        how_it_works: 'See the write-up in the repository.',
        tech_stack: p.stack.join(', '),
      }),
      status: 'results_released',
      submitted_at: submittedAt,
      locked_at: null,
      created_at: submittedAt,
      updated_at: submittedAt,
    });
  }
}

async function seedHacktronTeams(event: any, ownerId: string) {
  const d = db();
  const people = await ensureShowcasePeople();
  const teams = [
    { name: 'Patched', note: 'Two backend people, looking for a frontend and a designer.', size: 2 },
    { name: 'Cold Brew', note: 'Design and frontend, want someone who likes databases.', size: 2 },
    { name: 'Overtime', note: 'Solo. Happy to pair with anyone on the developer tools track.', size: 1 },
  ];
  for (const t of teams) {
    const members = people.slice(0, t.size);    const team = await d.createTeam({
      id: id('tm'),
      event_id: event.id,
      slug: slugify(t.name, 'team'),
      name: t.name,
      description: t.note,
      avatar_seed: t.name.length * 31,
      created_by: members[0].id,
      created_at: isoPlusDays(-5),
      updated_at: isoPlusDays(-5),
    });
    for (const [mi, m] of members.entries()) {
      await d.addTeamMember(team.id, m.id, mi === 0 ? 'owner' : 'member', isoPlusDays(-5));
      await d.addMember(event.id, m.id, 'participant', isoPlusDays(-5));
    }
  }
  void ownerId;
}

/**
 * HACKTRON is the event that is still running, so it is seeded mid-flight: a
 * real panel (one invitation still unopened, so the organizer has a genuine
 * follow-up), projects in mixed states, and a few reviews already submitted.
 * The reviews again go through saveReview, so the seeded scores were produced
 * by the same validation a judge's own scores are.
 */
async function seedHacktronJudging(event: any, organizerId: string): Promise<number> {
  const d = db();
  const { assignJudge, saveReview, activeRubric } = await import('../services/judging.js');
  const { criteria } = await activeRubric(event.id);
  if (!criteria.length) return 0;

  const people = await ensureShowcasePeople();
  const tracks = await d.listTracks(event.id);
  const { rows: existing } = await d.listProjects({ eventId: event.id, limit: 100, offset: 0 });
  if (existing.length) return 0;

  // Projects mid-build: a couple submitted, one still a draft, one registered
  // team that has not started anything. The host dashboard reads these counts.
  const drafts = [
    { team: 'Patched', title: 'Greenhouse', track: 2, state: 'submitted', stack: ['TypeScript', 'Postgres', 'Fastify'], repo: 'https://github.com/hackerly-demo/greenhouse', demo: 'https://greenhouse.example.org', summary: 'A clinic intake form that a nurse can finish on a phone in ninety seconds, and that still validates the data properly.' },
    { team: 'Cold Brew', title: 'Render Ledger', track: 0, state: 'submitted', stack: ['Rust', 'WebGPU'], repo: 'https://github.com/hackerly-demo/render-ledger', demo: 'https://render-ledger.example.org', summary: 'Records what a shader actually cost to compile so a team can tell a slow build from a slow shader.' },
    { team: 'Overtime', title: 'Backlog Roulette', track: 3, state: 'draft', stack: ['Python', 'SQLite'], repo: 'https://github.com/hackerly-demo/backlog-roulette', demo: '', summary: 'Picks the one ticket nobody wants and explains why it is the one that matters.' },
  ];
  const teamRows = await d.listTeams(event.id, { limit: 100, offset: 0 });
  const byName = new Map(teamRows.rows.map((t: any) => [t.name, t]));

  const created: any[] = [];
  for (const [i, p] of drafts.entries()) {
    const team = byName.get(p.team);
    if (!team) continue;
    const submittedAt = p.state === 'submitted' ? isoPlusDays(-1 - i / 10) : null;
    const project = await d.createProject({
      id: id('prj'),
      event_id: event.id,
      team_id: team.id,
      track_id: tracks[p.track]?.id ?? null,
      slug: slugify(p.title, `project-${i + 1}`),
      title: p.title,
      tagline: p.summary.split('.')[0] + '.',
      summary: p.summary,
      description: p.summary,
      tech_stack: JSON.stringify(p.stack),
      image_url: '',
      repo_url: p.repo,
      demo_url: p.demo,
      video_url: '',
      docs_url: `${p.repo}#readme`,
      answers: JSON.stringify({ problem: p.summary, how_it_works: '', tech_stack: p.stack.join(', ') }),
      status: p.state,
      submitted_at: submittedAt,
      locked_at: null,
      created_at: isoPlusDays(-4),
      updated_at: submittedAt ?? isoPlusDays(-1),
    });
    created.push(project);
  }

  // A panel of three, one of whom has not opened the invitation yet. These are
  // deliberately nobody from the DOGFOOD acceptance set: those accounts are a
  // fixed contract, and a demo judge must not quietly acquire access to an
  // event the acceptance suite expects them to be locked out of.
  const panelSpec = [
    { email: 'sana.rahman@hackerly.dev', name: 'Sana Rahman', headline: 'Backend and payments', status: 'active' },
    { email: 'tomas.reyes@hackerly.dev', name: 'Tomás Reyes', headline: 'Design systems', status: 'active' },
    { email: 'noor.haddad@hackerly.dev', name: 'Noor Haddad', headline: 'Public sector delivery', status: 'invited' },
  ];
  const judges: any[] = [];
  for (const [i, p] of panelSpec.entries()) {
    const user = await ensureUser({ email: p.email, username: p.name.split(' ')[0].toLowerCase(), displayName: p.name, headline: p.headline });
    const existing = await d.getEventJudgeByEmail(event.id, p.email);
    if (existing) {
      judges.push(await d.updateEventJudge(existing.id, { status: p.status, user_id: user.id, username: user.username }));
    } else {
      judges.push(await d.createEventJudge({
        id: id('jdg'),
        event_id: event.id,
        user_id: user.id,
        email: p.email,
        email_lower: p.email,
        username: user.username,
        status: p.status,
        invited_by: organizerId,
        invited_at: isoPlusDays(-3 - i / 10),
        accepted_at: p.status === 'active' ? isoPlusDays(-3) : null,
        removed_at: null,
      }));
    }
  }

  const active = judges.filter((j) => j.status === 'active');
  const submittable = created.filter((p) => p.status === 'submitted');
  let reviews = 0;
  for (const [pi, project] of submittable.entries()) {
    for (const judge of active) {
      const made = await assignJudge(event, judge, [project.id], organizerId);
      if (!made) continue;
      const row = (await d.listAssignments({ eventId: event.id, projectId: project.id, judgeId: judge.id, limit: 5 })).rows[0];
      if (!row) continue;
      // Two of the four possible reviews are left unfinished on purpose, so the
      // judging screen shows a genuine "in progress" state.
      const done = (pi + active.indexOf(judge)) % 2 === 0;
      const base = 6.2 + ((pi * 5 + active.indexOf(judge)) % 30) / 10;
      await saveReview(
        event,
        row.id,
        { id: judge.user_id, name: judge.username, email: judge.email },
        {
          scores: criteria.map((c: any, ci: number) => ({
            criterionId: c.id,
            score: Math.max(1, Math.min(c.max_score, Math.round(base - ci * 0.4))),
            note: '',
          })),
          comment: done ? COMMENTS[(pi + 2) % COMMENTS.length] : '',
          strengths: done ? 'Runs without setup, which is half the battle.' : '',
          improvements: done ? 'A test for the intake validation would round it off.' : '',
          recommendation: done ? 'yes' : 'unsure',
          submit: done,
        },
      );
      if (done) reviews += 1;
    }
  }
  void people;
  return reviews;
}

/** A build night two weeks out: a handful of teams forming, nothing submitted. */
async function seedMeridianFloor(event: any, organizerId: string): Promise<number> {
  const d = db();
  const people = await ensureShowcasePeople();
  const { rows } = await d.listTeams(event.id, { limit: 50, offset: 0 });
  if (rows.length) return 0;
  const tracks = await d.listTracks(event.id);
  const teams = [
    { name: 'Mains', members: [0, 1], note: 'Bringing two ESP32 boards and a bag of sensors.', track: 1 },
    { name: 'Kettle', members: [2, 4], note: 'Two designers, no hardware. Happy to be paired.', track: 0 },
    { name: 'Nightbus', members: [5], note: 'Solo, doing the transit times board.', track: 0 },
  ];
  for (const [i, t] of teams.entries()) {
    const members = t.members.map((mi) => people[mi]);
    const team = await d.createTeam({
      id: id('tm'),
      event_id: event.id,
      slug: slugify(t.name, `team-${i + 1}`),
      name: t.name,
      description: t.note,
      avatar_seed: t.name.length * 47,
      created_by: members[0].id,
      created_at: isoPlusDays(-2),
      updated_at: isoPlusDays(-2),
    });
    for (const [mi, m] of members.entries()) {
      await d.addTeamMember(team.id, m.id, mi === 0 ? 'owner' : 'member', isoPlusDays(-2));
      await d.addMember(event.id, m.id, 'participant', isoPlusDays(-2));
    }
    await d.createProject({
      id: id('prj'),
      event_id: event.id,
      team_id: team.id,
      track_id: tracks[t.track]?.id ?? null,
      slug: slugify(`${t.name} sketch`, `project-${i + 1}`),
      title: `${t.name} sketch`,
      tagline: t.note,
      summary: t.note,
      description: '',
      tech_stack: JSON.stringify([]),
      image_url: '',
      repo_url: '',
      demo_url: '',
      video_url: '',
      docs_url: '',
      answers: JSON.stringify({}),
      status: 'draft',
      submitted_at: null,
      locked_at: null,
      created_at: isoPlusDays(-2),
      updated_at: isoPlusDays(-2),
    });
  }
  void organizerId;
  return teams.length;
}

/**
 * Build a real judging history for the finished demo event: a panel, balanced
 * assignments, submitted reviews, then a computed and published ranking.
 * Nothing here writes a score directly — it goes through saveReview, so the
 * demo data proves the same code path a real judge uses.
 */
async function seedFoldJudging(event: any, organizerId: string): Promise<number> {
  const d = db();
  const { inviteJudge } = await import('../services/invites.js');
  const { activeRubric, assignJudge, saveReview } = await import('../services/judging.js');
  const { computeResults, publishResults } = await import('../services/results.js');

  const { criteria } = await activeRubric(event.id);
  if (!criteria.length) return 0;
  // The showcase projects were seeded as results_released; fold them back to
  // submitted so the judging engine treats them as genuinely unreviewed work.
  const all = (await d.listProjects({ eventId: event.id, limit: 500, offset: 0 })).rows;
  for (const p of all) {
    if (p.status !== 'draft') await d.updateProject(p.id, { status: 'submitted', updated_at: nowIso() });
  }
  const projects = all;
  if (!projects.length) return 0;

  const panel = [
    { email: 'yusuf.demir@hackerly.dev', name: 'Yusuf Demir', headline: 'Infrastructure, payments' },
    { email: 'clara.mensah@hackerly.dev', name: 'Clara Mensah', headline: 'Product and research' },
    { email: 'henrik.olsen@hackerly.dev', name: 'Henrik Olsen', headline: 'Hardware and accessibility' },
  ];

  const judges: any[] = [];
  for (const [i, p] of panel.entries()) {
    const user = await ensureUser({ email: p.email, username: p.name.split(' ')[0].toLowerCase(), displayName: p.name, headline: p.headline });
    const existing = await d.getEventJudgeByEmail(event.id, p.email);
    if (existing) {
      judges.push(await d.updateEventJudge(existing.id, { status: 'active', user_id: user.id, username: user.username, accepted_at: nowIso() }));
    } else {
      judges.push(
        await d.createEventJudge({
          id: id('jdg'),
          event_id: event.id,
          user_id: user.id,
          email: p.email,
          email_lower: p.email,
          username: user.username,
          status: 'active',
          invited_by: organizerId,
          invited_at: isoPlusDays(-140),
          accepted_at: isoPlusDays(-139),
          removed_at: null,
        }),
      );
    }
    void i;
  }

  // A deterministic but uneven panel: two judges see every project, the third
  // sees a subset, and one judge is systematically harsher than the others.
  // That is what the normalization option exists for.
  let assigned = 0;
  for (const [pi, project] of projects.entries()) {
    const seats = pi === 0 ? judges : pi % 3 === 0 ? [judges[0], judges[1], judges[2]] : [judges[0], judges[1]];
    for (const judge of seats) {
      const created = await assignJudge(event, judge, [project.id], organizerId);
      if (!created) continue;
      assigned += created;
      const row = (await d.listAssignments({ eventId: event.id, projectId: project.id, judgeId: judge.id, limit: 5 })).rows[0];
      if (!row) continue;
      const harshness = judge.id === judges[2].id ? -1.4 : 0.2;
      const base = 5.6 + ((pi * 7 + criteria.length) % 40) / 10;
      const scores: any[] = criteria.map((c: any, ci: number) => ({
        criterionId: c.id,
        score: Math.max(0, Math.min(c.max_score, Math.round(base + harshness - ci * 0.3))),
        note: '',
      }));
      await saveReview(
        event,
        row.id,
        { id: judge.user_id, name: judge.username, email: judge.email },
        {
          scores,
          comment: pickComment(pi, judge.id === judges[2].id),
          strengths: 'Clear problem statement and a repository that runs.',
          improvements: 'A short architecture note would have saved me time.',
          recommendation: 'yes',
          submit: true,
        },
      );
    }
  }

  const bundle = await computeResults(event, { publish: false });
  await publishResults(event, organizerId);
  log.info('fold results published', { projects: bundle.projects.length, assignments: assigned });
  return bundle.projects.length;
}

const COMMENTS = [
  'Runs the first time I cloned it. The demo link was still up.',
  'Good instinct for the problem. The evaluation is the strongest part.',
  'Solid submission. I would want a short architecture note before shipping this.',
  'Reads like a weekend project, but the parts that are there are correct.',
  'Difficult to evaluate without the demo. The repository compensates.',
  'Genuinely useful idea, well executed. My only note is the missing tests.',
];

function pickComment(projectIndex: number, harsh: boolean): string {
  if (harsh) return 'Technically fine, but the problem framing is thin.';
  return COMMENTS[projectIndex % COMMENTS.length];
}

async function ensureShowcasePeople(): Promise<any[]> {
  const spec = [
    { email: 'ada.nwosu@hackerly.dev', username: 'ada.nwosu', name: 'Ada Nwosu', headline: 'Backend, mostly Postgres' },
    { email: 'rui.tanaka@hackerly.dev', username: 'rui.tanaka', name: 'Rui Tanaka', headline: 'Design systems and typography' },
    { email: 'sam.oyelaran@hackerly.dev', username: 'sam.oyelaran', name: 'Sam Oyelaran', headline: 'Accessibility engineering' },
    { email: 'ines.moreau@hackerly.dev', username: 'ines.moreau', name: 'Ines Moreau', headline: 'Mobile, Kotlin' },
    { email: 'dev.kaur@hackerly.dev', username: 'dev.kaur', name: 'Dev Kaur', headline: 'Rails and background jobs' },
    { email: 'lukas.weber@hackerly.dev', username: 'lukas.weber', name: 'Lukas Weber', headline: 'Rust, WASM, compilers' },
  ];
  const out: any[] = [];
  for (const s of spec) {
    out.push(await ensureUser({
      email: s.email,
      username: s.username,
      displayName: s.name,
      password: 'HackerlyDemo2026',
      headline: s.headline,
    }));
  }
  return out;
}

async function ensureUser(input: any): Promise<any> {
  const d = db();
  const existing = await d.getUserByEmail(input.email);
  if (existing) return existing;
  const ascii = String(input.username).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]/g, '');
  const base = /^[a-z]/.test(ascii) ? ascii.toLowerCase() : `u${ascii.toLowerCase()}`;
  let username = base.slice(0, 24);
  let n = 0;
  while (await d.getUserByUsername(username)) {
    n += 1;
    username = `${base.slice(0, 20)}${n}`;
  }
  return createUser({
    email: input.email,
    username,
    displayName: input.displayName,
    password: input.password ?? 'HackerlyDemo2026',
    emailVerified: true,
  });
}
