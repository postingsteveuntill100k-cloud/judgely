import { config } from '../config.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(config.log.level as Level) in ORDER ? (config.log.level as Level) : 'info'];

const COLORS: Record<Level, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
};

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  if (config.log.json) {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
    process.stdout.write(line + '\n');
    return;
  }
  const time = new Date().toISOString().slice(11, 23);
  const tail = fields && Object.keys(fields).length
    ? ' ' + Object.entries(fields).map(([k, v]) => `${k}=${format(v)}`).join(' ')
    : '';
  process.stdout.write(`${COLORS[level]}${time} ${level.toUpperCase().padEnd(5)}\u001b[0m ${msg}${tail}\n`);
}

function format(v: unknown): string {
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v.includes(' ') ? JSON.stringify(v) : v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export const log = {
  debug: (m: string, f?: Record<string, unknown>) => emit('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => emit('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => emit('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => emit('error', m, f),
};
