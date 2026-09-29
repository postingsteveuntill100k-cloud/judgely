import { AppError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { render, renderBare } from '../view.js';

/**
 * Express 4 does not catch a rejected promise from an async handler, so an
 * exception in a template would leave the request hanging forever. This wraps
 * every route handler on a router so a rejected promise becomes next(err).
 */
export function wrapRouter<R extends { get: any; post: any; put: any; patch: any; delete: any; all: any; param: any }>(router: R): R {
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all'] as const) {
    const original = router[method].bind(router);
    (router as any)[method] = (routePath: string, ...handlers: any[]) =>
      (original as any)(
        routePath,
        ...handlers.map((handler: any) => {
          if (typeof handler !== 'function' || handler.length >= 4) return handler;
          return (req: any, res: any, next: any) => {
            try {
              const out = handler(req, res, next);
              if (out && typeof out.catch === 'function') out.catch(next);
            } catch (e) {
              next(e);
            }
          };
        }),
      );
  }
  return router;
}

/**
 * Render a page. If the template itself throws we still owe the browser a
 * response, so this falls back to the error page rather than dropping the
 * connection.
 */
export function safeRender(
  res: any,
  view: string,
  data: Record<string, unknown>,
  status = 200,
  next?: (e: unknown) => void,
): void {
  try {
    render(res, view, data, status);
  } catch (e) {
    const err = e as Error;
    log.error('template failed', { view, message: err.message });
    if (next) {
      next(e);
      return;
    }
    if (res.headersSent) return;
    res.status(500);
    try {
      res.type('html').send(
        renderBare('errors/error', {
          title: 'Something went wrong',
          status: 500,
          code: 'template_error',
          message: 'This page could not be rendered. The error has been logged.',
          detail: config_isProd() ? null : err.message,
          issues: null,
          backTo: null,
        }),
      );
    } catch {
      res.type('text/plain').send('Internal server error. The error has been logged.');
    }
  }
}

function config_isProd(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

export { AppError };
