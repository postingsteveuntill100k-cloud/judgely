/**
 * Presentation helpers shared by views and CSV exports.
 * Everything is UTC-based internally; the browser localises with <time>.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function fmtDate(value: string | Date | null | undefined, fallback = '—'): string {
  const d = parseDate(value);
  if (!d) return fallback;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function fmtDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = parseDate(value);
  if (!d) return fallback;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function fmtShortDateTime(value: string | Date | null | undefined, fallback = '—'): string {
  const d = parseDate(value);
  if (!d) return fallback;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${hh}:${mm}`;
}

export function fmtRange(a: string | Date | null | undefined, b: string | Date | null | undefined): string {
  const s = parseDate(a);
  const e = parseDate(b);
  if (!s && !e) return 'Dates to be announced';
  if (s && !e) return fmtDate(s);
  if (!s && e) return fmtDate(e);
  const sd = s as Date;
  const ed = e as Date;
  const sameMonth = sd.getUTCMonth() === ed.getUTCMonth() && sd.getUTCFullYear() === ed.getUTCFullYear();
  if (sameMonth) {
    return `${sd.getUTCDate()}–${ed.getUTCDate()} ${MONTHS[ed.getUTCMonth()]} ${ed.getUTCFullYear()}`;
  }
  return `${fmtDate(s)} — ${fmtDate(e)}`;
}

export function durationHours(a: string | Date | null, b: string | Date | null): number | null {
  const s = parseDate(a);
  const e = parseDate(b);
  if (!s || !e) return null;
  return Math.round(((e.getTime() - s.getTime()) / 3600_000) * 10) / 10;
}

export function fmtMoney(cents: number, currency = 'INR'): string {
  const symbols: Record<string, string> = { INR: '₹', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
  const sym = symbols[currency] ?? `${currency} `;
  const major = Math.abs(cents) / 100;
  const grouped = major.toLocaleString('en-US', { maximumFractionDigits: major % 1 === 0 ? 0 : 2 });
  return `${cents < 0 ? '-' : ''}${sym}${grouped}`;
}

export function fmtPrizePool(cents: number, currency: string, headline: string): string {
  if (headline) return headline;
  if (!cents) return 'Prize pool to be announced';
  return fmtMoney(cents, currency);
}

export function relTime(value: string | Date | null | undefined): string {
  const d = parseDate(value);
  if (!d) return '';
  const diff = d.getTime() - Date.now();
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [1000, 'second'],
    [60_000, 'minute'],
    [3600_000, 'hour'],
    [86400_000, 'day'],
    [604800_000, 'week'],
    [2592000_000, 'month'],
  ];
  let chosen: [number, string] = units[0];
  for (const u of units) if (abs >= u[0]) chosen = u;
  const n = Math.round(abs / chosen[0]);
  const label = `${n} ${chosen[1]}${n === 1 ? '' : 's'}`;
  return diff >= 0 ? `in ${label}` : `${label} ago`;
}

export function timeAgo(value: string | Date | null | undefined): string {
  const r = relTime(value);
  return r.startsWith('in ') ? 'just now' : r;
}

export function countdown(value: string | Date | null | undefined): { days: number; hours: number; minutes: number; seconds: number; past: boolean } | null {
  const d = parseDate(value);
  if (!d) return null;
  let ms = d.getTime() - Date.now();
  const past = ms <= 0;
  ms = Math.abs(ms);
  return {
    days: Math.floor(ms / 86400_000),
    hours: Math.floor((ms % 86400_000) / 3600_000),
    minutes: Math.floor((ms % 3600_000) / 60_000),
    seconds: Math.floor((ms % 60_000) / 1000),
    past,
  };
}

export function fmtBytesLabel(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length <= n ? s : s.slice(0, n - 1).trimEnd() + '…';
}

export function stripHtml(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Minimal, allow-listed markdown for organizer-authored rules.
 * Anything not listed is escaped. No raw HTML, no javascript: URLs.
 */
export function renderRichText(src: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const blocks = (src || '').split(/\n{2,}/);
  const html: string[] = [];
  for (const raw of blocks) {
    const block = raw.trim();
    if (!block) continue;
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      html.push('<ul>' + lines.map((l) => `<li>${inline(esc(l.replace(/^\s*[-*]\s+/, '')))}</li>`).join('') + '</ul>');
    } else if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) {
      html.push('<ol>' + lines.map((l) => `<li>${inline(esc(l.replace(/^\s*\d+[.)]\s+/, '')))}</li>`).join('') + '</ol>');
    } else if (lines.every((l) => /^\s*#{1,4}\s+/.test(l)) && lines.length === 1) {
      const level = (lines[0].match(/^#+/) || ['#'])[0].length;
      const h = Math.min(4, Math.max(2, level + 1));
      html.push(`<h${h}>${inline(esc(lines[0].replace(/^\s*#{1,4}\s+/, '')))}</h${h}>`);
    } else if (lines.every((l) => /^\s*>\s?/.test(l))) {
      html.push(`<blockquote>${inline(esc(lines.map((l) => l.replace(/^\s*>\s?/, '')).join(' ')))}</blockquote>`);
    } else {
      html.push(`<p>${lines.map((l) => inline(esc(l))).join('<br>')}</p>`);
    }
  }
  return html.join('\n');
}

function inline(escaped: string): string {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

const SAFE_LINK = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}([/?#][^\s]*)?$/i;

/** Accepts only https links to real hosts. Everything else becomes an empty string. */
export function safeUrl(value: string | null | undefined, allow = ['https:']): string {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return '';
  }
  if (!allow.includes(parsed.protocol)) return '';
  if (parsed.protocol === 'https:' && !SAFE_LINK.test(parsed.href)) return '';
  return parsed.href;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}
