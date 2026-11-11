/**
 * Per-account brute-force throttle (in addition to the per-IP rate limiter,
 * which does nothing against a distributed attack on one account).
 * In-memory: effective per instance. Move to Redis if you scale horizontally.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;
const failures = new Map(); // key -> { count, firstAt }

const keyOf = (email) => String(email || '').toLowerCase().trim();

export const isLocked = (email) => {
  const entry = failures.get(keyOf(email));
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) { failures.delete(keyOf(email)); return false; }
  return entry.count >= MAX_FAILURES;
};

export const recordFailure = (email) => {
  const key = keyOf(email);
  const entry = failures.get(key);
  if (!entry || Date.now() - entry.firstAt > WINDOW_MS) failures.set(key, { count: 1, firstAt: Date.now() });
  else entry.count += 1;
};

export const clearFailures = (email) => failures.delete(keyOf(email));

// Keep the map from growing without bound.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failures) if (now - v.firstAt > WINDOW_MS) failures.delete(k);
}, WINDOW_MS).unref();
