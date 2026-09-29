import { db } from '../db/index.js';
import { id, nowIso, slugify } from '../lib/ids.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { assertSubmissionsOpen } from './events.js';
import { requireTeamAccess } from './teams.js';
import { audit } from './audit.js';
import { safeUrl } from '../lib/format.js';

export type ProjectStatus = 'draft' | 'submitted' | 'under_review' | 'results_released';

async function uniqueProjectSlug(eventId: string, base: string, excludeId?: string): Promise<string> {
  const d = db();
  const root = slugify(base, 'project');
  let slug = root;
  let n = 1;
  for (;;) {
    const existing = await d.getProjectBySlug(eventId, slug);
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${root}-${n}`;
  }
}

export interface ProjectInput {
  title: string;
  tagline?: string;
  summary?: string;
  description?: string;
  trackId?: string | null;
  techStack?: string[];
  imageUrl?: string;
  repoUrl?: string;
  demoUrl?: string;
  videoUrl?: string;
  docsUrl?: string;
  answers?: Record<string, string>;
}

function cleanStack(input: unknown): string[] {
  const list = Array.isArray(input) ? input : String(input ?? '').split(/[,\n]/);
  const out: string[] = [];
  for (const raw of list) {
    const t = String(raw).trim().slice(0, 40);
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
    if (out.length >= 16) break;
  }
  return out;
}

function cleanAnswers(input: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object') return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = String(k).slice(0, 40);
    if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) continue;
    const value = String(v ?? '').trim();
    out[key] = value.length > 4000 ? `${value.slice(0, 3999)}…` : value;
  }
  return out;
}

export async function createProject(event: any, team: any, input: ProjectInput, actorId: string): Promise<any> {
  const d = db();
  const title = String(input.title ?? '').trim();
  if (title.length < 2) throw badRequest('Give the project a name of at least 2 characters.', 'bad_title', { field: 'title' });
  if (title.length > 90) throw badRequest('Project names can be up to 90 characters.', 'bad_title', { field: 'title' });

  const existing = await d.listProjectsForTeam(team.id);
  if (existing.length) {
    throw conflict('This team already has a project. Open it and edit it instead.', 'team_already_has_project');
  }
  if (input.trackId) {
    const track = await d.getTrack(input.trackId);
    if (!track || track.event_id !== event.id) throw badRequest('Pick a track from this hackathon.', 'bad_track', { field: 'track_id' });
  }
  const at = nowIso();
  const slug = await uniqueProjectSlug(event.id, title);
  const project = await d.createProject({
    id: id('prj'),
    event_id: event.id,
    team_id: team.id,
    track_id: input.trackId || null,
    slug,
    title,
    tagline: String(input.tagline ?? '').trim().slice(0, 160),
    summary: String(input.summary ?? '').trim().slice(0, 400),
    description: String(input.description ?? '').trim().slice(0, 8000),
    tech_stack: JSON.stringify(cleanStack(input.techStack)),
    image_url: safeUrl(input.imageUrl),
    repo_url: safeUrl(input.repoUrl),
    demo_url: safeUrl(input.demoUrl),
    video_url: safeUrl(input.videoUrl),
    docs_url: safeUrl(input.docsUrl),
    answers: JSON.stringify(cleanAnswers(input.answers)),
    status: 'draft',
    submitted_at: null,
    locked_at: null,
    created_at: at,
    updated_at: at,
  });
  await audit({
    eventId: event.id,
    actorId,
    action: 'project.created',
    entityType: 'project',
    entityId: project.id,
    summary: `Created the project ${project.title} (draft)`,
  });
  return project;
}

export async function updateProject(event: any, project: any, actorId: string, patch: ProjectInput): Promise<any> {
  const d = db();
  // A team may edit its submission only while the event is open for
  // submissions. This is deliberately unconditional: gating it on
  // `status === 'submitted'` left a hole, because judging moves projects to
  // `under_review` and an edit after that point would rewrite the very thing
  // the panel is scoring — including the repository and demo URLs.
  // Organizer edits go through the driver directly and are unaffected; an
  // organizer who needs to reopen an event moves its deadline.
  assertSubmissionsOpen(event);
  if (patch.trackId) {
    const track = await d.getTrack(patch.trackId);
    if (!track || track.event_id !== event.id) throw badRequest('Pick a track from this hackathon.', 'bad_track', { field: 'track_id' });
  }
  const row: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (title.length < 2) throw badRequest('Give the project a name of at least 2 characters.', 'bad_title', { field: 'title' });
    if (title.length > 90) throw badRequest('Project names can be up to 90 characters.', 'bad_title', { field: 'title' });
    row.title = title;
    row.slug = await uniqueProjectSlug(event.id, title, project.id);
  }
  if (patch.tagline !== undefined) row.tagline = String(patch.tagline).trim().slice(0, 160);
  if (patch.summary !== undefined) row.summary = String(patch.summary).trim().slice(0, 400);
  if (patch.description !== undefined) row.description = String(patch.description).trim().slice(0, 8000);
  if (patch.trackId !== undefined) row.track_id = patch.trackId || null;
  if (patch.techStack !== undefined) row.tech_stack = JSON.stringify(cleanStack(patch.techStack));
  if (patch.imageUrl !== undefined) row.image_url = safeUrl(patch.imageUrl);
  if (patch.repoUrl !== undefined) row.repo_url = safeUrl(patch.repoUrl);
  if (patch.demoUrl !== undefined) row.demo_url = safeUrl(patch.demoUrl);
  if (patch.videoUrl !== undefined) row.video_url = safeUrl(patch.videoUrl);
  if (patch.docsUrl !== undefined) row.docs_url = safeUrl(patch.docsUrl);
  if (patch.answers !== undefined) row.answers = JSON.stringify(cleanAnswers(patch.answers));

  const updated = await d.updateProject(project.id, row);
  await audit({
    eventId: event.id,
    actorId,
    action: 'project.updated',
    entityType: 'project',
    entityId: project.id,
    summary: `Edited the project ${updated.title}`,
    meta: { fields: Object.keys(row).filter((k) => k !== 'updated_at') },
  });
  return updated;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

/** Server-side completeness check. The client renders the same rules. */
export async function validateSubmission(event: any, project: any): Promise<ValidationIssue[]> {
  const d = db();
  const issues: ValidationIssue[] = [];
  const fields: any[] = Array.isArray(event.submission_fields) ? event.submission_fields : [];
  for (const f of fields) {
    const value =
      f.key === 'repo_url' ? project.repo_url
      : f.key === 'demo_url' ? project.demo_url
      : f.key === 'video_url' ? project.video_url
      : f.key === 'docs_url' ? project.docs_url
      : f.key === 'tech_stack' ? (project.tech_stack || []).join(', ')
      : (project.answers ?? {})[f.key] ?? '';
    if (f.required && !String(value ?? '').trim()) {
      issues.push({ field: f.key, message: `${f.label} is required.` });
    }
  }
  if (!project.title?.trim()) issues.push({ field: 'title', message: 'The project needs a name.' });
  const tracks = await d.listTracks(event.id);
  if (tracks.length && !project.track_id) {
    issues.push({ field: 'track_id', message: 'Choose which track this project belongs to.' });
  }
  return issues;
}

export async function submitProject(event: any, project: any, actorId: string): Promise<any> {
  const d = db();
  assertSubmissionsOpen(event);
  const issues = await validateSubmission(event, project);
  if (issues.length) {
    throw badRequest(
      `This submission is not complete yet: ${issues[0].message}`,
      'submission_incomplete',
      { field: issues[0].field, meta: { issues } },
    );
  }
  if (project.status !== 'draft') {
    throw conflict('This project is already submitted. Edit it until the deadline if you need to.', 'already_submitted');
  }
  const at = nowIso();
  const updated = await d.updateProject(project.id, {
    status: 'submitted',
    submitted_at: at,
    updated_at: at,
  });
  await audit({
    eventId: event.id,
    actorId,
    action: 'project.submitted',
    entityType: 'project',
    entityId: project.id,
    summary: `Submitted ${project.title}`,
  });
  return updated;
}

export async function withdrawSubmission(event: any, project: any, actorId: string): Promise<any> {
  const d = db();
  assertSubmissionsOpen(event);
  if (project.status !== 'submitted') throw conflict('Only a submitted project can be withdrawn.', 'not_submitted');
  const at = nowIso();
  const updated = await d.updateProject(project.id, { status: 'draft', submitted_at: null, updated_at: at });
  await audit({
    eventId: event.id,
    actorId,
    action: 'project.withdrawn',
    entityType: 'project',
    entityId: project.id,
    summary: `Withdrew the submission for ${project.title}`,
  });
  return updated;
}

export async function loadProjectForActor(event: any, projectId: string, userId: string): Promise<{ project: any; role: string }> {
  const d = db();
  const project = await d.getProject(projectId);
  if (!project) throw notFound('That project no longer exists.');
  if (project.event_id !== event.id) throw forbidden('That project belongs to a different hackathon.');
  const team = await d.getTeam(project.team_id);
  const member = await d.getTeamMember(project.team_id, userId);
  if (!member) throw forbidden('You are not on the team that owns this project.');
  void team;
  return { project, role: member.role };
}

export async function teamProjectsFor(event: any, teamId: string, userId: string): Promise<any[]> {
  await requireTeamAccess(event, teamId, userId);
  return db().listProjectsForTeam(teamId);
}

export function projectStatusLabel(status: string): string {
  return { draft: 'Draft', submitted: 'Submitted', under_review: 'Under review', results_released: 'Results released' }[status] ?? status;
}
