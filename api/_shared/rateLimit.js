// Minimal in-memory rate limiter shared by API functions.
//
// This is per-instance (resets on cold start / scale-out to a new instance), which is
// a real limitation on Azure's consumption plan — it is NOT a substitute for a proper
// distributed limiter (Azure Front Door / API Management rate limiting, or a Redis-backed
// counter) if you need hard guarantees at scale. For an invite-only app of ~320 families
// this is enough to blunt accidental loops and casual abuse (bad client retry storms,
// a leaked token hammering the API) without adding infrastructure.
//
// Usage:
//   const { checkRateLimit } = require("../_shared/rateLimit");
//   const rl = checkRateLimit("trips:" + (me.email || req.ip), { max: 60, windowMs: 60000 });
//   if (!rl.ok) { json(429, { error: "Too many requests, slow down.", retryAfterMs: rl.retryAfterMs }); return; }

const buckets = new Map(); // key -> { count, resetAt }

function checkRateLimit(key, { max = 60, windowMs = 60000 } = {}) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  // Opportunistic cleanup so the map doesn't grow unbounded across a long-lived instance.
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) if (now >= v.resetAt) buckets.delete(k);
  }
  if (b.count > max) return { ok: false, retryAfterMs: b.resetAt - now };
  return { ok: true, remaining: max - b.count };
}

module.exports = { checkRateLimit };
