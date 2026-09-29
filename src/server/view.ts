import ejs from 'ejs';
import type { Response } from 'express';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import * as H from './lib/viewhelp.js';
import { eventCover, projectCover, allowedAccents, COVER_STYLES, accentFor } from './lib/cover.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const VIEWS_DIR = path.resolve(config.root, 'src/views');

const compiled = new Map<string, ejs.TemplateFunction>();

/** Helper bag injected into every template. */
export const h: any = {
  ...H,
  cover: eventCover,
  projectCover,
  accentFor,
  coverStyles: COVER_STYLES,
  get accents() { return allowedAccents(); },
  get fmt() { return H.fmt; },
  queueOpen: H.queueOpen,
};

function load(view: string): ejs.TemplateFunction {
  const file = path.join(VIEWS_DIR, `${view}.ejs`);
  let t = compiled.get(file);
  if (!t) {
    t = ejs.compile(readFileSync(file, 'utf8'), { filename: file, rmWhitespace: false });
    compiled.set(file, t);
  }
  return t;
}

export interface ViewData {
  [key: string]: any;
}

/** Render a view into the shared layout. */
export function render(res: Response, view: string, data: ViewData, status = 200): void {
  const content = load(view)({ h, ...data });
  const html = load('layouts/base')({ h, ...data, content, bodyClass: data.bodyClass ?? '' });
  res.status(status).type('html').send(html);
}

/** Render a view with no layout (error pages, email bodies). */
export function renderBare(view: string, data: ViewData): string {
  return load(view)({ h, ...data });
}

export function clearViewCache(): void {
  compiled.clear();
}

void HERE;
