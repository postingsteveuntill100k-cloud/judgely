import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config.js';
import { csrfMiddleware, issueCsrfToken, requestLogger, securityHeaders } from './middleware/security.js';
import { sessionMiddleware } from './middleware/session.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { db } from './db/index.js';
import { log } from './lib/logger.js';

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.security.trustProxy ? 1 : false);
  app.set('etag', 'strong');

  app.use(requestLogger);
  app.use(securityHeaders);
  app.use(compression());
  app.use(express.json({ limit: config.security.maxBodyBytes }));
  app.use(express.urlencoded({ extended: false, limit: config.security.maxBodyBytes }));
  app.use(cookieParser());

  app.use(
    express.static(path.join(config.root, 'public'), {
      maxAge: config.isProd ? '7d' : 0,
      etag: true,
      index: false,
      redirect: false,
    }),
  );

  // A request for a file that does not exist is a 404, not a route. Without
  // this, a missing asset falls through to the router and gets rendered as a
  // page, which is confusing in the log and slow for the client.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    // Only under the static prefixes, so a real route like
    // /host/events/:slug/export.csv still reaches the router.
    if (!/^\/(css|js|img|fonts)\/[^/]+\.[a-z0-9]{2,5}$/i.test(req.path)) return next();
    res.status(404).type('text/plain').send(`Not found: ${req.path}`);
  });

  app.use(sessionMiddleware);

  // Every rendered page gets a CSRF token; every rendered form posts it back.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      try {
        (req as any).csrfToken = issueCsrfToken(res);
      } catch {
        (req as any).csrfToken = '';
      }
    }
    next();
  });
  app.use(csrfMiddleware);

  app.get('/healthz', async (_req, res) => {
    const health = await db()
      .health()
      .catch((e) => ({ ok: false, driver: config.db.driver, detail: (e as Error).message }));
    res.status(health.ok ? 200 : 503).json({
      status: health.ok ? 'ok' : 'degraded',
      app: 'hackerly',
      version: '1.0.0',
      mode: config.db.driver === 'firestore' ? 'global' : 'self-hosted',
      database: health,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  /**
   * Readiness for an orchestrator: a liveness check that would pass even on a
   * dead database is not useful, so this one actually pings storage. Kept
   * separate from /healthz so a crash loop can be distinguished from a slow
   * or unreachable database.
   */
  app.get('/readyz', async (_req, res) => {
    const health = await db()
      .health()
      .catch((e) => ({ ok: false, driver: config.db.driver, detail: (e as Error).message }));
    res.status(health.ok ? 200 : 503).json({ status: health.ok ? 'ready' : 'not-ready', database: health });
  });

  app.use('/', publicRoutes());
  app.use('/', participantRoutes());
  app.use('/', authRoutes());
  app.use('/', inviteRoutes());
  app.use('/host', hostRoutes());
  app.use('/judge', judgeRoutes());
  app.use('/api', apiRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// Imported after createApp so the middleware above is registered first.
import { publicRoutes } from './routes/public.js';
import { participantRoutes } from './routes/participant.js';
import { authRoutes } from './routes/auth.js';
import { inviteRoutes } from './routes/invites.js';
import { hostRoutes } from './routes/host.js';
import { judgeRoutes } from './routes/judge.js';
import { apiRoutes } from './routes/api.js';

export function describeRoutes(app: Express): string[] {
  const out: string[] = [];
  const walk = (stack: any, prefix = '') => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          out.push(`${method.toUpperCase().padEnd(6)} ${prefix}${layer.route.path}`);
        }
      } else if (layer.name === 'router' && layer.handle?.stack) {
        let seg = '';
        try {
          seg = layer.regexp.source.replace('^\\/', '/').replace('\\/?(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\$$/, '');
        } catch {
          seg = '';
        }
        walk(layer.handle.stack, prefix + (seg === '/' ? '' : seg));
      }
    }
  };
  walk(app._router?.stack ?? []);
  log.debug(`registered ${out.length} routes`);
  return out;
}
