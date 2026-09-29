/**
 * Deterministic artwork.
 *
 * Every hackathon and every project gets real, distinct imagery with no network
 * call and no uploaded asset. Two generators, one system:
 *
 *   eventCover  — a geometric poster, seeded by the event slug
 *   projectCover — a typographic plate, seeded by the project slug
 *
 * Both are inline SVG, so they cost nothing to serve, never 404, work offline,
 * and look the same in every browser. An organizer can still paste an image URL,
 * which takes precedence.
 */

const INKS = ['#141416', '#1b1b1f', '#20201d', '#171a1c', '#1a1719', '#12161a'];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function rng(seed: number): () => number {
  let s = (seed || 1) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function safeHex(v?: string): string {
  return v && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : '';
}

const ACCENTS = ['#d8401a', '#1f6f6b', '#3b4cca', '#a8761f', '#7a3e9d', '#0f7a4a', '#c2410c', '#2b6cb0'];

export function accentFor(seed: string): string {
  return ACCENTS[hash(seed) % ACCENTS.length];
}

export type CoverStyle = 'grid' | 'arcs' | 'strata' | 'orbit' | 'bars' | 'mesh';

const STYLES: CoverStyle[] = ['grid', 'arcs', 'strata', 'orbit', 'bars', 'mesh'];

const W = 1200;
const H = 675;

export interface EventCoverOptions {
  seed: string;
  style?: string;
  accent?: string;
  label?: string;
}

/** Poster-style artwork for a hackathon. */
export function eventCover(opts: EventCoverOptions): string {
  const seed = hash(opts.seed || 'hackerly');
  const style = (STYLES.includes(opts.style as CoverStyle) ? opts.style : STYLES[seed % STYLES.length]) as CoverStyle;
  const accent = safeHex(opts.accent) || ACCENTS[seed % ACCENTS.length];
  const bg = INKS[seed % INKS.length];
  const r = rng(seed);
  const p: string[] = [];

  p.push(`<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${shade(bg, -14)}"/></linearGradient></defs>`);
  p.push(`<rect width="${W}" height="${H}" fill="url(#g)"/>`);

  if (style === 'grid') {
    // A field of thin rules with one bold accent block. Lots of negative space.
    const rows = 7;
    const gap = H / rows;
    for (let i = 0; i <= rows; i += 1) {
      const y = i * gap;
      p.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="1" fill="#ffffff" opacity="0.09"/>`);
    }
    const col = Math.floor(r() * 9);
    const cw = W / 9;
    p.push(`<rect x="${(col * cw).toFixed(0)}" y="0" width="${cw.toFixed(0)}" height="${H}" fill="${accent}" opacity="0.9"/>`);
    p.push(`<rect x="${(col * cw).toFixed(0)}" y="0" width="${cw.toFixed(0)}" height="${H}" fill="#000" opacity="0.18"/>`);
    const blockRow = Math.floor(r() * rows);
    p.push(`<rect x="0" y="${(blockRow * gap).toFixed(0)}" width="${W}" height="${gap.toFixed(0)}" fill="#ffffff" opacity="0.05"/>`);
  } else if (style === 'arcs') {
    // Concentric rings anchored off-canvas so the composition stays open.
    const cx = W * (r() > 0.5 ? -0.1 : 1.1);
    const cy = H * (0.25 + r() * 0.5);
    const rings = 6 + Math.floor(r() * 3);
    for (let i = rings; i > 0; i -= 1) {
      const rad = (i / rings) * W * 0.72;
      p.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${rad.toFixed(0)}" fill="none" stroke="#fbfaf7" stroke-width="1.4" opacity="${(0.06 + (i / rings) * 0.16).toFixed(2)}"/>`);
    }
    p.push(`<circle cx="${cx.toFixed(0)}" cy="${cy.toFixed(0)}" r="${(W * 0.06).toFixed(0)}" fill="${accent}"/>`);
    p.push(`<rect x="0" y="${(H * 0.62).toFixed(0)}" width="${W}" height="2" fill="${accent}" opacity="0.85"/>`);
  } else if (style === 'strata') {
    // Five or six clean bands from the bottom, one of them the accent.
    const bands = 5 + Math.floor(r() * 3);
    const accentBand = 1 + Math.floor(r() * (bands - 1));
    let y = H;
    for (let i = 0; i < bands; i += 1) {
      const t = (H / bands) * (0.45 + r() * 0.7);
      y -= t;
      const isAccent = i === accentBand;
      p.push(`<rect x="0" y="${y.toFixed(0)}" width="${W}" height="${Math.min(t, H).toFixed(0)}" fill="${isAccent ? accent : '#fbfaf7'}" opacity="${isAccent ? 0.92 : 0.05 + i * 0.018}"/>`);
    }
    p.push(`<circle cx="${(W * (0.15 + r() * 0.7)).toFixed(0)}" cy="${(H * 0.22).toFixed(0)}" r="${(44 + r() * 40).toFixed(0)}" fill="none" stroke="#fbfaf7" stroke-width="1.6" opacity="0.35"/>`);
  } else if (style === 'orbit') {
    // A scatter of dots on an ellipse, one accent dot much larger.
    const cx = W / 2;
    const cy = H / 2;
    const dots = 26 + Math.floor(r() * 20);
    const big = 0.35 + r() * 0.5;
    for (let i = 0; i < dots; i += 1) {
      const ang = r() * Math.PI * 2;
      const rad = 0.35 + r() * 0.65;
      const x = cx + Math.cos(ang) * W * 0.42 * rad;
      const y = cy + Math.sin(ang) * H * 0.4 * rad;
      const isBig = r() > 0.88;
      p.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(isBig ? 16 : 3).toFixed(0)}" fill="${isBig ? accent : '#fbfaf7'}" opacity="${isBig ? 0.95 : 0.28}"/>`);
    }
    p.push(`<ellipse cx="${cx}" cy="${cy}" rx="${(W * 0.42).toFixed(0)}" ry="${(H * 0.4).toFixed(0)}" fill="none" stroke="#fbfaf7" stroke-width="1.2" opacity="0.18"/>`);
  } else if (style === 'bars') {
    // A bar chart silhouette with exactly one accent bar.
    const n = 18 + Math.floor(r() * 10);
    const gap = W / n;
    const accentBar = Math.floor(r() * n);
    for (let i = 0; i < n; i += 1) {
      const bh = H * (0.14 + r() * 0.62);
      p.push(`<rect x="${(i * gap + gap * 0.26).toFixed(1)}" y="${(H - bh).toFixed(0)}" width="${(gap * 0.48).toFixed(1)}" height="${bh.toFixed(0)}" fill="${i === accentBar ? accent : '#fbfaf7'}" opacity="${i === accentBar ? 0.95 : 0.12}"/>`);
    }
  } else {
    // A sparse dot matrix with a diagonal accent line.
    const cols = 11;
    const rows = 6;
    const cw = W / cols;
    const ch = H / rows;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const v = r();
        if (v < 0.42) continue;
        p.push(`<circle cx="${(x * cw + cw / 2).toFixed(0)}" cy="${(y * ch + ch / 2).toFixed(0)}" r="${(Math.min(cw, ch) * (v > 0.9 ? 0.34 : 0.15)).toFixed(0)}" fill="#fbfaf7" opacity="${v > 0.9 ? 0.75 : 0.16}"/>`);
      }
    }
    const from = Math.floor(r() * cols);
    p.push(`<rect x="${(from * cw).toFixed(0)}" y="0" width="10" height="${H}" fill="${accent}" transform="rotate(18 ${(from * cw).toFixed(0)} ${H / 2})" opacity="0.9"/>`);
  }

  // A consistent baseline so every poster reads as one family.
  p.push(`<rect x="0" y="${H - 6}" width="${W}" height="6" fill="${accent}"/>`);
  p.push(
    `<text x="56" y="86" font-family="Inter, Helvetica, Arial, sans-serif" font-size="24" font-weight="700" letter-spacing="7" fill="#fbfaf7" opacity="0.92">HACKERLY</text>`,
  );
  p.push(`<rect x="56" y="104" width="64" height="3" fill="${accent}"/>`);

  return wrap(p.join(''), 'Event artwork');
}

export interface ProjectCoverOptions {
  seed: string;
  title?: string;
  monogram?: string;
  label?: string;
}

/**
 * Typographic plate for a project card. No illustration: a big monogram, one
 * accent shape, and a rule. It should read as a title card, not a placeholder.
 */
export function projectCover(opts: ProjectCoverOptions): string {
  const seed = hash(opts.seed || 'project');
  const r = rng(seed);
  const bg = INKS[(seed + 2) % INKS.length];
  const accent = ACCENTS[seed % ACCENTS.length];
  const p: string[] = [];
  const mono = (opts.monogram || (opts.title || '?').slice(0, 2)).toUpperCase().slice(0, 3);
  const label = (opts.label || 'PROJECT').toUpperCase().slice(0, 22);

  p.push(`<defs><linearGradient id="pg" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${shade(bg, 8)}"/><stop offset="1" stop-color="${bg}"/></linearGradient></defs>`);
  p.push(`<rect width="${W}" height="${H}" fill="url(#pg)"/>`);

  const variant = seed % 4;
  if (variant === 0) {
    p.push(`<circle cx="${(W * (0.72 + r() * 0.2)).toFixed(0)}" cy="${(H * 0.3).toFixed(0)}" r="${(150 + r() * 90).toFixed(0)}" fill="${accent}" opacity="0.9"/>`);
    p.push(`<rect x="0" y="${(H * 0.74).toFixed(0)}" width="${W}" height="2" fill="#fbfaf7" opacity="0.2"/>`);
  } else if (variant === 1) {
    p.push(`<rect x="${(W * 0.6).toFixed(0)}" y="0" width="${(W * 0.4).toFixed(0)}" height="${H}" fill="${accent}" opacity="0.9"/>`);
    p.push(`<rect x="0" y="${(H * 0.2).toFixed(0)}" width="${(W * 0.6).toFixed(0)}" height="2" fill="#fbfaf7" opacity="0.24"/>`);
    p.push(`<rect x="0" y="${(H * 0.8).toFixed(0)}" width="${(W * 0.6).toFixed(0)}" height="2" fill="#fbfaf7" opacity="0.24"/>`);
  } else if (variant === 2) {
    for (let i = 0; i < 5; i += 1) {
      p.push(`<rect x="0" y="${(H * (0.16 + i * 0.17)).toFixed(0)}" width="${W}" height="${(18 + r() * 26).toFixed(0)}" fill="${i === 2 ? accent : '#fbfaf7'}" opacity="${i === 2 ? 0.9 : 0.08}"/>`);
    }
  } else {
    const n = 9;
    const gap = W / n;
    for (let i = 0; i < n; i += 1) {
      if (i === Math.floor(r() * n)) continue;
      p.push(`<rect x="${(i * gap).toFixed(0)}" y="0" width="2" height="${H}" fill="#fbfaf7" opacity="0.1"/>`);
    }
    p.push(`<rect x="0" y="${(H * 0.5).toFixed(0)}" width="${W}" height="6" fill="${accent}"/>`);
  }

  p.push(
    `<text x="56" y="${(H * 0.62).toFixed(0)}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="200" font-weight="800" letter-spacing="-10" fill="#fbfaf7" opacity="0.94">${escapeXml(mono)}</text>`,
  );
  p.push(
    `<text x="60" y="${(H - 54).toFixed(0)}" font-family="Inter, Helvetica, Arial, sans-serif" font-size="22" font-weight="600" letter-spacing="6" fill="#fbfaf7" opacity="0.6">${escapeXml(label)}</text>`,
  );
  return wrap(p.join(''), 'Project artwork');
}

function wrap(inner: string, label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label}">${inner}</svg>`;
}

function escapeXml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amount);
  const g = clamp(((n >> 8) & 0xff) + amount);
  const b = clamp((n & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** The accent an organizer may apply, restricted so readability is preserved. */
export function allowedAccents(): { value: string; label: string }[] {
  return [
    { value: '', label: 'Hackerly default' },
    { value: '#d8401a', label: 'Vermilion' },
    { value: '#1f6f6b', label: 'Teal' },
    { value: '#3b4cca', label: 'Indigo' },
    { value: '#a8761f', label: 'Ochre' },
    { value: '#7a3e9d', label: 'Plum' },
    { value: '#0f7a4a', label: 'Forest' },
    { value: '#2b6cb0', label: 'Cobalt' },
  ];
}

export const COVER_STYLES: { value: string; label: string }[] = [
  { value: 'auto', label: 'Pick one for me' },
  { value: 'grid', label: 'Grid' },
  { value: 'arcs', label: 'Arcs' },
  { value: 'strata', label: 'Bands' },
  { value: 'orbit', label: 'Orbit' },
  { value: 'bars', label: 'Bars' },
  { value: 'mesh', label: 'Mesh' },
];
