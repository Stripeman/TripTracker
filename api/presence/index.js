const { TableClient } = require("@azure/data-tables");
const { BlobServiceClient } = require("@azure/storage-blob");

// Presence ("who's online") + lightweight LOGIN ANALYTICS for Trip Tracker.
//
// Each signed-in browser POSTs a heartbeat every ~30s; we store ONE row per user in
// Azure Table Storage ({ name, email, roles, lastSeen, logins, firstLogin, lastLogin }).
// One row per user means concurrent heartbeats never clobber each other.
//
//  - POST (heartbeat)        → Merge-upsert lastSeen/name/email/roles (login counters survive)
//  - POST { login: true }    → ALSO increments `logins`, sets lastLogin (+ firstLogin once).
//                              Sent once per page-load so we can tell who actually signed in
//                              and how many times.
//  - GET                     → everyone seen within the freshness window (the online bar)
//  - GET ?stats=1            → ADMIN ONLY: every known user with login counts + how many
//                              trips they own (read from the trips blob), for the admin
//                              hover stat bubble in the access list.
//
// Uses the same AZURE_STORAGE_CONNECTION_STRING as the trips API.
//   Optional: PRESENCE_TABLE (default "presence"), TRIPS_CONTAINER (default "data"),
//             TRIPS_BLOB (default "trip-tracker.json")

const TABLE = process.env.PRESENCE_TABLE || "presence";
const PARTITION = "online";
const WINDOW_MS = 90 * 1000; // consider a user online if seen within the last 90s
const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const TRIPS_BLOB = process.env.TRIPS_BLOB || "trip-tracker.json";

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

async function getTable() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  const client = TableClient.fromConnectionString(conn, TABLE);
  try { await client.createTable(); } catch (e) { /* already exists */ }
  return client;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

// Count how many trips each email owns, from the shared trips blob.
async function tripCountsByEmail() {
  const counts = {};
  try {
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!conn) return counts;
    const svc = BlobServiceClient.fromConnectionString(conn);
    const blob = svc.getContainerClient(CONTAINER).getBlockBlobClient(TRIPS_BLOB);
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

    const table = await getTable();
    const now = Date.now();

    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
      const name = (body && typeof body.name === "string" && body.name.trim())
        ? body.name.trim().slice(0, 120)
        : (me.email || "Someone");
      const isLogin = !!(body && body.login);

      // Base fields written on every heartbeat. Merge mode preserves the login counters.
      const entity = { partitionKey: PARTITION, rowKey: me.id, name, email: me.email, roles: (me.roles || []).join(","), lastSeen: now };

      if (isLogin) {
        // read existing counters so we can increment without a race-prone read-modify loop
        let prevLogins = 0, firstLogin = now;
        try {
          const ex = await table.getEntity(PARTITION, me.id);
          if (ex && typeof ex.logins === "number") prevLogins = ex.logins;
          if (ex && typeof ex.firstLogin === "number") firstLogin = ex.firstLogin;
        } catch (e) { /* first time for this user */ }
        entity.logins = prevLogins + 1;
        entity.firstLogin = firstLogin;
        entity.lastLogin = now;
      }

      await table.upsertEntity(entity, "Merge");
      json(200, { ok: true });
      return;
    }

    // ---- GET ----
    const wantStats = req.query && (req.query.stats === "1" || req.query.stats === "true");

    if (wantStats) {
      // Admin-only: full roster with login analytics + trip counts.
      if (!(me.roles || []).includes("admin")) { json(403, { error: "Admin role required." }); return; }
      const counts = await tripCountsByEmail();
      const seenEmails = new Set();
      const stats = [];
      const iter = table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } });
      for await (const e of iter) {
        const email = (e.email || "").toLowerCase();
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
      }
      // include people who own trips but have never signed in (trips but no presence row)
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
    const users = [];
    const iter = table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } });
    for await (const e of iter) {
      if (typeof e.lastSeen === "number" && e.lastSeen >= cutoff) {
        users.push({ id: e.rowKey, name: e.name || e.email || "Someone", email: e.email || "", roles: (typeof e.roles === "string" && e.roles) ? e.roles.split(",").filter(Boolean) : [], lastSeen: e.lastSeen, you: e.rowKey === me.id });
      }
    }
    users.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    json(200, { users, now });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
