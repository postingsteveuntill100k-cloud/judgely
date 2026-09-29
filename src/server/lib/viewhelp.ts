import {
  fmtDate, fmtDateTime, fmtShortDateTime, fmtRange, fmtMoney, fmtPrizePool, timeAgo, relTime, countdown,
  durationHours, truncate, hostOf, safeUrl, pluralize, renderRichText, parseDate,
} from './format.js';

export const fmt = {
  date: fmtDate,
  dateTime: fmtDateTime,
  shortDateTime: fmtShortDateTime,
  range: fmtRange,
  money: fmtMoney,
  prize: fmtPrizePool,
  ago: timeAgo,
  rel: relTime,
  countdown,
  hours: durationHours,
  truncate,
  host: hostOf,
  safe: safeUrl,
  plural: pluralize,
  renderRichText,
  parseDate,
};

export { renderRichText, parseDate, truncate, hostOf, safeUrl, pluralize, countdown, durationHours, relTime, timeAgo };

export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((p) => [...p][0] ?? '').join('');
  return (letters || '?').toUpperCase();
}

/** Deterministic hue so a person or event always looks the same. */
export function hue(seed: number | string): number {
  if (typeof seed === 'number') return Math.abs(Math.round(seed)) % 360;
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function avatarColor(seed: number | string, s = 46, l = 42): string {
  return `hsl(${hue(seed)} ${s}% ${l}%)`;
}

export function formatLabel(format: string): string {
  return { online: 'Online', offline: 'In person', hybrid: 'Hybrid' }[format] ?? format;
}

export function modeLabel(mode: string): string {
  return mode === 'local' ? 'Local event' : 'Global event';
}

export function statusLabel(status: string): string {
  return {
    draft: 'Draft',
    published: 'Published',
    live: 'Live',
    closed: 'Closed',
    archived: 'Archived',
  }[status] ?? status;
}

export function statusTone(status: string): string {
  return {
    draft: 'tag',
    published: 'tag--info',
    live: 'tag--accent',
    closed: 'tag',
    archived: 'tag',
  }[status] ?? 'tag';
}

export function projectStatusTone(status: string): string {
  return {
    draft: 'tag--warn',
    submitted: 'tag--info',
    under_review: 'tag--accent',
    results_released: 'tag--ok',
  }[status] ?? 'tag';
}

export function projectStatusLabel(status: string): string {
  return {
    draft: 'Draft',
    submitted: 'Submitted',
    under_review: 'Under review',
    results_released: 'Results released',
  }[status] ?? status;
}

export function fieldIcon(type: string): string {
  return { url: 'link', text: 'text', textarea: 'text', tags: 'tag' }[type] ?? 'text';
}

export function techList(stack: unknown): string[] {
  if (Array.isArray(stack)) return stack.map(String).slice(0, 8);
  if (typeof stack === 'string') {
    try {
      const v = JSON.parse(stack);
      return Array.isArray(v) ? v.map(String).slice(0, 8) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function answersOf(project: any): Record<string, string> {
  const a = project?.answers;
  if (a && typeof a === 'object') return a;
  if (typeof a === 'string') {
    try {
      const v = JSON.parse(a);
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function scheduleOf(event: any): { label: string; at: string | null; detail: string }[] {
  const s = event?.schedule;
  let list: any[] = [];
  if (Array.isArray(s)) list = s;
  else if (typeof s === 'string') {
    try { list = JSON.parse(s); } catch { list = []; }
  }
  return list
    .filter((x) => x && (x.label || x.at))
    .map((x) => ({ label: String(x.label ?? ''), at: x.at ?? null, detail: String(x.detail ?? '') }));
}

export function submissionFields(event: any): any[] {
  const f = event?.submission_fields;
  if (Array.isArray(f)) return f;
  if (typeof f === 'string') {
    try {
      const v = JSON.parse(f);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function breakdownOf(result: any): { per_judge: any[]; notes: string[]; judge_offset: number | null; method?: string; lambda?: number } {
  const b = result?.breakdown;
  if (b && typeof b === 'object') return b as any;
  if (typeof b === 'string') {
    try {
      const v = JSON.parse(b);
      return v && typeof v === 'object' ? v : { per_judge: [], notes: [], judge_offset: null };
    } catch {
      return { per_judge: [], notes: [], judge_offset: null };
    }
  }
  return { per_judge: [], notes: [], judge_offset: null };
}

export function rankSuffix(rank: number | null | undefined): string {
  if (!rank) return '';
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

export function viewGlobals(req: any) {
  return {
    actor: req.actor ?? null,
    csrfToken: req.csrfToken ?? '',
    nav: req.nav ?? '',
    assetVersion: req.assetVersion ?? '1',
    flash: req.flash ?? null,
  };
}

export function queueOpen(assignments: any[]): number {
  return assignments.filter((a) => a.status !== 'submitted').length;
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

/** Case-insensitive contains for list filtering. */
export function matches(haystack: unknown, needle: string): boolean {
  if (!needle) return true;
  return String(haystack ?? '').toLowerCase().includes(needle.toLowerCase());
}
