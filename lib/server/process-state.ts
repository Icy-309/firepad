/**
 * One instance of server state per process. Next.js can load a module more than
 * once (separate route bundles, dev recompiles), so plain module-level variables
 * aren't reliably shared between API routes: a nonce issued by /api/auth/nonce
 * could be invisible to /api/launch/prepare. Keeping the state on globalThis fixes that.
 */
const g = globalThis as typeof globalThis & { __firepad?: Record<string, unknown> };
const bag = (g.__firepad ??= {});

export function processState<T>(key: string, init: () => T): T {
  if (!(key in bag)) bag[key] = init();
  return bag[key] as T;
}
