import { config } from '../config.js';

interface Entry {
  value: unknown;
  expires: number;
  hits: number;
}

const store = new Map<string, Entry>();

/**
 * Small in-process cache for read-heavy public pages (discovery, gallery,
 * event detail). Single-process by design: a multi-instance deployment simply
 * runs several independent caches, which is correct, only less effective.
 */
export function cacheGet<T>(key: string): T | undefined {
  if (!config.cache.enabled) return undefined;
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.expires) {
    store.delete(key);
    return undefined;
  }
  e.hits += 1;
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlSeconds = config.cache.ttlSeconds): void {
  if (!config.cache.enabled) return;
  if (store.size > 5000) {
    // Cheap eviction: drop expired first, then the least recently used entries.
    const now = Date.now();
    for (const [k, v] of store) if (now > v.expires) store.delete(k);
    while (store.size > 5000) {
      const first = store.keys().next();
      if (first.done) break;
      store.delete(first.value);
    }
  }
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000, hits: 0 });
}

/** Bump the namespace of a family of keys, e.g. `event:evt_1` -> generation 2. */
const generations = new Map<string, number>();

export function cacheBump(prefix: string): void {
  generations.set(prefix, (generations.get(prefix) ?? 1) + 1);
  for (const k of [...store.keys()]) {
    if (k.startsWith(`${prefix}#`)) store.delete(k);
  }
}

export function cacheKey(prefix: string, ...parts: (string | number)[]): string {
  const gen = generations.get(prefix) ?? 1;
  return `${prefix}#${gen}:${parts.join(':')}`;
}

export function cacheStats(): { keys: number; generations: number } {
  return { keys: store.size, generations: generations.size };
}

export function cacheClear(): void {
  store.clear();
  generations.clear();
}
