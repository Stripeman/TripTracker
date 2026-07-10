const { BlobServiceClient } = require("@azure/storage-blob");

// Presence ("who's online") + LOGIN ANALYTICS for Trip Tracker.
//
// IMPORTANT: this uses BLOB storage (the same proven path as the trips API and the
// access list) rather than Table storage — Table writes were silently failing in the
// deployed environment, so login counts never persisted. Everything lives in one small
// JSON blob, presence.json: { users: { "<userId>": { name, email, roles, lastSeen,
// logins, firstLogin, lastLogin, sid } } }. Writes use ETag optimistic concurrency with
// a few retries so concurrent heartbeats don't clobber each other.
//
//  - POST (heartbeat)      → upsert the caller's record (lastSeen, name, email, roles).
//                            Counts a LOGIN (logins++, lastLogin=now) when the client flags
//                            login:true, the browser session id (sid) is new, or the record
//                            has no counter yet (self-heals legacy records).
//  - GET                   → everyone seen within the freshness window (the online bar).
//  - GET ?stats=1          → ADMIN ONLY: every known user with login counts + trip totals
//                            (trip counts read from the trips blob).
//
// App settings: AZURE_STORAGE_CONNECTION_STRING (required).
//   Optional: TRIPS_CONTAINER (default "data"), PRESENCE_BLOB (default "presence.json"),
//             TRIPS_BLOB (default "trip-tracker.json")

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const PRESENCE_BLOB = process.env.PRESENCE_BLOB || "presence.json";
const TRIPS_BLOB = process.env.TRIPS_BLOB || "trip-tracker.json";
const WINDOW_MS = 90 * 1000; // online if seen within the last 90s

function principal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { id: p.userId || "", email: (p.userDetails || "").toLowerCase(), roles: p.userRoles || [] };
  } catch (e) {
    return null;
  }
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function container() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  return BlobServiceClient.fromConnectionString(conn).getContainerClient(CONTAINER);
}

// Read presence.json → { doc, etag }. Missing blob → empty doc, etag null.
async function readPresence(cont) {
  const blob = cont.getBlockBlobClient(PRESENCE_BLOB);
  try {
    const dl = await blob.download();
    const text = await streamToString(dl.readableStreamBody);
    let doc = {};
    try { doc = JSON.parse(text); } catch (e) { doc = {}; }
    if (!doc || typeof doc !== "object" || !doc.users) doc = { users: {} };
    return { doc, etag: dl.etag };
  } catch (e) {
    if (e.statusCode === 404) return { doc: { users: {} }, etag: null };
    throw e;
  }
}

// Write with optimistic concurrency: only succeeds if the blob hasn't changed since read.
async function writePresence(cont, doc, etag) {
  await cont.createIfNotExists();
  const blob = cont.getBlockBlobClient(PRESENCE_BLOB);
  const body = JSON.stringify(doc);
  const opts = { blobHTTPHeaders: { blobContentType: "application/json" } };
  if (etag) opts.conditions = { ifMatch: etag };
  else opts.conditions = { ifNoneMatch: "*" }; // create-only when we think it's absent
  await blob.upload(body, Buffer.byteLength(body), opts);
}

// Apply a mutation to presence.json with retry on concurrency conflicts.
async function mutatePresence(cont, mutate) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { doc, etag } = await readPresence(cont);
    mutate(doc);
    try {
      await writePresence(cont, doc, etag);
      return doc;
    } catch (e) {
      // 412 (ifMatch failed) or 409 (ifNoneMatch failed) → someone else wrote; retry.
      if (e.statusCode === 412 || e.statusCode === 409) continue;
      throw e;
    }
  }
  throw new Error("presence write conflict — too many concurrent updates");
}

async function tripCountsByEmail(cont) {
  const counts = {};
  try {
    const blob = cont.getBlockBlobClient(TRIPS_BLOB);
    if (!(await blob.exists())) return counts;
    const dl = await blob.download();
    const data = JSON.parse(await streamToString(dl.readableStreamBody));
    const locs = Array.isArray(data) ? data : (Array.isArray(data.locations) ? data.locations : []);
    for (const t of locs) {
      const em = String((t && t.ownerEmail) || "").toLowerCase().trim();
      if (em) counts[em] = (counts[em] || 0) + 1;
    }
  } catch (e) { /* best-effort */ }
  return counts;
}

module.exports = async function (context, req) {
  const json = (status, body) => {
    context.res = {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  };

  try {
    const me = principal(req);
    if (!me || !me.id) { json(401, { error: "Sign in required." }); return; }

    const cont = container();
    const now = Date.now();

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const name = (body && typeof body.name === "string" && body.name.trim())
        ? body.name.trim().slice(0, 120)
        : (me.email || "Someone");
      const isLogin = !!(body && body.login);
      const sid = (body && typeof body.sid === "string" && body.sid) ? body.sid.slice(0, 64) : "";

      let recordedLogins = 0;
      await mutatePresence(cont, (doc) => {
        const prev = doc.users[me.id] || {};
        const hasCounter = typeof prev.logins === "number";
        const newSession = sid && prev.sid !== sid;
        const countLogin = isLogin || newSession || !hasCounter;
        const rec = {
          name,
          email: me.email,
          roles: me.roles || [],
          lastSeen: now,
          logins: hasCounter ? prev.logins : 0,
          firstLogin: typeof prev.firstLogin === "number" ? prev.firstLogin : now,
          lastLogin: typeof prev.lastLogin === "number" ? prev.lastLogin : null,
          sid: sid || prev.sid || "",
        };
        if (countLogin) { rec.logins += 1; rec.lastLogin = now; }
        recordedLogins = rec.logins;
        doc.users[me.id] = rec;
      });
      json(200, { ok: true, logins: recordedLogins });
      return;
    }

    // ---- GET ----
    const wantStats = req.query && (req.query.stats === "1" || req.query.stats === "true");
    const { doc } = await readPresence(cont);
    const users = doc.users || {};

    if (wantStats) {
      if (!(me.roles || []).includes("admin")) { json(403, { error: "Admin role required." }); return; }
      const counts = await tripCountsByEmail(cont);
      const seenEmails = new Set();
      const stats = [];
      Object.keys(users).forEach((id) => {
        const e = users[id] || {};
        const email = String(e.email || "").toLowerCase();
        if (email) seenEmails.add(email);
        stats.push({
          email,
          name: e.name || email || "Someone",
          logins: typeof e.logins === "number" ? e.logins : 0,
          firstLogin: typeof e.firstLogin === "number" ? e.firstLogin : null,
          lastLogin: typeof e.lastLogin === "number" ? e.lastLogin : null,
          lastSeen: typeof e.lastSeen === "number" ? e.lastSeen : null,
          online: typeof e.lastSeen === "number" && e.lastSeen >= now - WINDOW_MS,
          trips: counts[email] || 0,
        });
      });
      // people who own trips but have never signed in
      Object.keys(counts).forEach((email) => {
        if (!seenEmails.has(email)) {
          stats.push({ email, name: email, logins: 0, firstLogin: null, lastLogin: null, lastSeen: null, online: false, trips: counts[email] });
        }
      });
      json(200, { stats, now });
      return;
    }

    // Default GET — everyone seen within the window (the online bar).
    const cutoff = now - WINDOW_MS;
    const online = [];
    Object.keys(users).forEach((id) => {
      const e = users[id] || {};
      if (typeof e.lastSeen === "number" && e.lastSeen >= cutoff) {
        online.push({ id, name: e.name || e.email || "Someone", email: e.email || "", roles: Array.isArray(e.roles) ? e.roles : [], lastSeen: e.lastSeen, you: id === me.id });
      }
    });
    online.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    json(200, { users: online, now });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
