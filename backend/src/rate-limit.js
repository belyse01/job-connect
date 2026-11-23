/* Simple in-memory rate limiter for the endpoints that create work or check
 * credentials. Counts live in this process only, which is enough for a single
 * instance; a multi-instance deployment would back this with a shared store. */

const attempts = new Map();
const MAX_KEYS = 10_000;

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function prune(now) {
  if (attempts.size < MAX_KEYS) return;
  for (const [key, entry] of attempts) {
    if (entry.resetAt <= now) attempts.delete(key);
  }
}

/**
 * Build middleware allowing `max` requests per `windowMs` for each key.
 * Set JC_RATE_LIMIT=off to disable (the tests do this).
 */
function rateLimit({ name, max, windowMs, key = clientIp }) {
  return (req, res, next) => {
    if (process.env.JC_RATE_LIMIT === 'off') return next();

    const now = Date.now();
    const id = `${name}:${key(req)}`;
    let entry = attempts.get(id);

    if (!entry || entry.resetAt <= now) {
      prune(now);
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(id, entry);
    }
    entry.count += 1;

    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res
        .status(429)
        .json({ error: 'Too many attempts. Please wait a little while and try again.' });
    }

    next();
  };
}

// Test helper: forget every recorded attempt.
function resetRateLimits() {
  attempts.clear();
}

function emailKey(req) {
  return `${clientIp(req)}:${String(req.body?.email || '').trim().toLowerCase()}`;
}

module.exports = { rateLimit, resetRateLimits, emailKey };
