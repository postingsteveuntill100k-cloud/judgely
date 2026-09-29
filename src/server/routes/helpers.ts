import type { Request, Response } from 'express';
import { db } from '../db/index.js';
import { safeRender } from './safe.js';
import { config } from '../config.js';
import { AppError } from '../lib/errors.js';
import { eventState } from '../services/events.js';
import { countUnread } from '../db/index.js';

export function assetVersion(): string {
  return String(config.isProd ? 'prod' : 'dev');
}

/** Everything the layout needs on every page. */
export async function baseData(req: Request, nav = ''): Promise<Record<string, unknown>> {
  const actor = req.actor ?? null;
  let unread = 0;
  if (actor) {
    unread = await countUnread(actor.id).catch(() => 0);
  }
  return {
    actor,
    nav,
    unread,
    csrfToken: (req as any).csrfToken ?? '',
    assetVersion: assetVersion(),
    bodyClass: '',
    baseUrl: config.baseUrl,
    req,
    extraCss: 'workspace',
    pageTitle: '',
    metaDescription: '',
  };
}

export async function page(res: Response, view: string, req: Request, data: Record<string, unknown>, status = 200, nav = ''): Promise<void> {
  const base = await baseData(req, nav);
  // Workspace shells (host / judge) attach their own navigation and counts.
  const reqAny = req as any;
  safeRender(
    res,
    view,
    {
      ...base,
      ...(reqAny.hostEvent
        ? { hostEvent: reqAny.hostEvent, counts: reqAny.hostCounts ?? {}, hostNav: reqAny.hostNav ?? 'overview' }
        : {}),
      ...(reqAny.judgeEvent ? { judgeEvent: reqAny.judgeEvent, judgeMe: reqAny.judgeRecord } : {}),
      ...data,
    },
    status,
  );
}

export function intParam(value: unknown, fallback: number, lo = 1, hi = 500): number {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function strParam(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

export function boolParam(value: unknown): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  return ['1', 'true', 'on', 'yes'].includes(String(value).toLowerCase());
}

export function eventWithState(event: any) {
  return { ...event, state: eventState(event) };
}

export async function loadPublicEvent(slug: string) {
  const d = db();
  const event = await d.getEventBySlug(slug);
  if (!event) throw new AppError(404, 'event_not_found', 'We could not find that hackathon.');
  if (event.status === 'draft') {
    throw new AppError(404, 'event_not_public', 'That hackathon has not been published yet.');
  }
  return event;
}

/** A signed-in viewer's relationship with an event, computed once per request. */
export async function viewerContext(event: any, req: Request) {
  const d = db();
  const actor = req.actor;
  const base = {
    registered: false,
    team: null,
    project: null,
    isOrganizer: false,
    isJudge: false,
    judgeStatus: null as string | null,
  };
  if (!actor) return base;

  base.isOrganizer = await d.isOrganizer(event.id, actor.id).catch(() => false);
  const membership = await d.getMembership(event.id, actor.id, 'participant').catch(() => null);
  base.registered = Boolean(membership && membership.status === 'active');

  const teams = await d.listTeamsForUser(actor.id).catch(() => []);
  const myTeam = teams.find((t) => t.event_id === event.id) ?? null;
  base.team = myTeam;
  if (myTeam) {
    const projects = await d.listProjectsForTeam(myTeam.id);
    base.project = projects[0] ?? null;
  }

  const judges = await d.listEventJudges(event.id).catch(() => []);
  const myJudge = judges.find((j) => j.user_id === actor.id) ?? null;
  base.isJudge = Boolean(myJudge && myJudge.status === 'active');
  base.judgeStatus = myJudge?.status ?? null;
  return base;
}

/** Nav highlight helper for the sub-workspaces. */
export function navFor(pathname: string): string {
  if (pathname.startsWith('/host')) return 'host';
  if (pathname.startsWith('/judge')) return 'judge';
  if (pathname.startsWith('/hackathons') || pathname.startsWith('/projects')) return 'hackathons';
  if (pathname === '/' ) return 'home';
  return '';
}
