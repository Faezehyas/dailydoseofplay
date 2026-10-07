// Limits keyed by who is asking: a client address today, an account later.
// Everything is in memory, and keys are never logged.

// The first address in the client-IP header (X-Forwarded-For unless
// overridden), else the socket's. Used only as a limit key, never logged.
export function clientIp(req, header = "x-forwarded-for") {
  const first = String(req?.headers?.[header.toLowerCase()] || "").split(",")[0].trim();
  return first || req?.socket?.remoteAddress || null;
}

// At most `max` live things (connections, rooms) per key. A null key is never
// limited: one shared bucket for unknown clients would lock everyone out.
export function createQuota(max) {
  const counts = new Map();
  return {
    take(key) {
      if (key == null) return true;
      const n = counts.get(key) || 0;
      if (n >= max) return false;
      counts.set(key, n + 1);
      return true;
    },
    give(key) {
      if (key == null) return;
      const n = (counts.get(key) || 0) - 1;
      if (n > 0) counts.set(key, n);
      else counts.delete(key);
    },
    count: (key) => counts.get(key) || 0,
  };
}

// Refills `rate` tokens a second and holds at most `burst`; take() spends one.
export function createTokenBucket({ rate, burst, now = Date.now }) {
  let tokens = burst;
  let last = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(burst, tokens + ((t - last) * rate) / 1000);
      last = t;
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}
