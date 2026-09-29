/**
 * Cloud Function entry point for Firebase Hosting.
 *
 * This is the same application the self-hosted install runs. Nothing here is a
 * second implementation: it boots the real Express app from dist/ and exports
 * it in the shape the Functions runtime expects. The only Firebase-specific
 * behaviour is the auth bridge in /auth/firebase, which exchanges a Firebase
 * ID token for a Hackerly session; see DEPLOYMENT.md.
 */
import { createApp } from '../../dist/server/app.js';
import { getDb, closeDb } from '../../dist/server/db/index.js';
import { runSeed } from '../../dist/server/seed/index.js';
import { config } from '../../dist/server/config.js';
import { log } from '../../dist/server/lib/logger.js';

let app = null;
let ready = null;

/**
 * Idempotent, concurrency-safe boot. The Functions runtime reuses a container
 * across invocations, so the database connection and the seed are done once and
 * every later request waits on the same promise rather than opening a second
 * Firestore client.
 */
async function ensureApp() {
  if (app) return app;
  if (!ready) {
    ready = (async () => {
      await getDb();
      if (config.seed.onBoot) {
        await runSeed({ demo: config.seed.demo, fixtures: config.seed.fixtures });
      }
      app = createApp();
      log.info('hackerly function ready', { driver: config.db.driver });
      return app;
    })().catch((e) => {
      ready = null; // let the next invocation retry a failed boot
      throw e;
    });
  }
  return ready;
}

/** Cloud Functions (2nd gen) passes (req, res). */
export const hackerly = async (req, res) => {
  try {
    const a = await ensureApp();
    // The runtime sets PORT=8080; nothing else about the app should change.
    return a(req, res);
  } catch (e) {
    log.error('function boot failed', { message: String(e?.message ?? e) });
    res.status(503).type('text/plain').send('Hackerly is starting. Try again in a moment.');
  }
};

/** Firebase calls this on instance shutdown to release the Firestore client. */
export const shutdown = async () => {
  try { await closeDb(); } catch { /* nothing to close */ }
};

export default { hackerly, shutdown };
