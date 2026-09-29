import { createApp, describeRoutes } from './app.js';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { log } from './lib/logger.js';
import { runSeed } from './seed/index.js';
import { sessionCookie, clearedSessionCookie } from './services/auth.js';

async function main(): Promise<void> {
  log.info('starting Hackerly', {
    env: config.nodeEnv,
    driver: config.db.driver,
    port: config.port,
  });

  await getDb();
  if (config.seed.onBoot) {
    await runSeed({ demo: config.seed.demo, fixtures: config.seed.fixtures });
  }

  const app = createApp();
  const server = app.listen(config.port, config.host, () => {
    log.info(`Hackerly is listening on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
    if (!config.isProd) log.info(`open ${config.baseUrl}`);
  });
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  server.requestTimeout = 0;

  const routes = describeRoutes(app);
  log.info('routes ready', { count: routes.length });

  const shutdown = async (signal: string) => {
    log.info('shutting down', { signal });
    server.close(() => {
      closeDb()
        .catch(() => undefined)
        .finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    log.error('unhandled rejection', { reason: String(reason) });
  });
  process.on('uncaughtException', (err) => {
    log.error('uncaught exception', { message: err.message, stack: String(err.stack).split('\n')[1] });
  });
}

main().catch((e) => {
  log.error('failed to start', { message: (e as Error).message, stack: String((e as Error).stack) });
  process.exit(1);
});

export { sessionCookie, clearedSessionCookie };
