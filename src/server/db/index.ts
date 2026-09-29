import { config } from '../config.js';
import { log } from '../lib/logger.js';
import type { Driver } from './driver.js';

let instance: Driver | null = null;

export async function getDb(): Promise<Driver> {
  if (instance) return instance;
  if (config.db.driver === 'firestore') {
    const { FirestoreDriver } = await import('./firestore.js');
    instance = new FirestoreDriver();
  } else {
    const { SqliteDriver } = await import('./sqlite.js');
    instance = new SqliteDriver();
  }
  await instance.init();
  return instance;
}

export function db(): Driver {
  if (!instance) throw new Error('Database not initialised. Call getDb() during boot.');
  return instance;
}

export async function closeDb(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}

export type { Driver } from './driver.js';

export async function dbHealth() {
  try {
    return await db().health();
  } catch (e) {
    return { ok: false, driver: config.db.driver, detail: (e as Error).message };
  }
}

export { log as dbLog };

export { db as default };
export const countUnread = (userId: string) => db().countUnread(userId);
