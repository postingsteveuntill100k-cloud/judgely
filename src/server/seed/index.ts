import { appendFileSync } from 'node:fs';
import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { seedDemo } from './demo.js';
import { loadFixtures } from './fixtures.js';
import { seedAcceptanceAccounts, type AcceptanceHeader } from './acceptance.js';

let lastHeaders: AcceptanceHeader[] = [];

export async function runSeed(opts: { demo?: boolean; fixtures?: boolean } = {}): Promise<void> {
  const demo = opts.demo ?? config.seed.demo;
  const fixtures = opts.fixtures ?? config.seed.fixtures;

  if (fixtures) {
    try {
      const report = await loadFixtures();
      log.info('fixtures', report as Record<string, unknown>);
    } catch (e) {
      log.error('fixture load failed', { message: (e as Error).message });
      throw e;
    }
  }

  if (demo) {
    try {
      const report = await seedDemo();
      log.info('demo seed', report as Record<string, unknown>);
    } catch (e) {
      log.error('demo seed failed', { message: (e as Error).message });
      throw e;
    }
  }

  if (config.acceptance.enabled) {
    lastHeaders = await seedAcceptanceAccounts();
    if (lastHeaders.length) {
      printAcceptanceHeaders();
    }
  }
}

/** The DOGFOOD spec asks the seed to print working headers. Here they are. */
export function printAcceptanceHeaders(): void {
  const lines = [
    '',
    '  ┌─ DOGFOOD acceptance accounts ─────────────────────────────────────',
  ];
  for (const h of lastHeaders) {
    lines.push(`  │ ${h.role.padEnd(11)} ${h.header}`);
    lines.push(`  │ ${''.padEnd(11)} user ${h.user} <${h.email}>`);
  }
  lines.push('  └───────────────────────────────────────────────────────────────────');
  lines.push('');
  const out = lines.join('\n') + '\n';
  process.stdout.write(out);
  // Also mirror to a file when one is configured, so a test harness can read
  // the headers without scraping stdout.
  const file = process.env.LOG_FILE;
  if (file) {
    try { appendFileSync(file, out); } catch { /* best effort */ }
  }
}

export function acceptanceHeaders(): AcceptanceHeader[] {
  return lastHeaders;
}

export { seedDemo, loadFixtures, seedAcceptanceAccounts };
