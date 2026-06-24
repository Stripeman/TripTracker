const { TableClient } = require("@azure/data-tables");

// Lightweight presence ("who's online") for Trip Tracker.
//
// Each signed-in browser POSTs a heartbeat every ~30s; we store ONE row per user in
// Azure Table Storage ({ name, lastSeen }). A GET returns everyone seen within the
// freshness window. One row per user means concurrent heartbeats never clobber each
// other (unlike a shared JSON blob).
//
// Uses the same AZURE_STORAGE_CONNECTION_STRING as the trips API.
//   Optional: PRESENCE_TABLE (default "presence")

const TABLE = process.env.PRESENCE_TABLE || "presence";
const PARTITION = "online";
const WINDOW_MS = 90 * 1000; // consider a user online if seen within the last 90s

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
      await table.upsertEntity(
        { partitionKey: PARTITION, rowKey: me.id, name, email: me.email, lastSeen: now },
        "Replace"
      );
      json(200, { ok: true });
      return;
    }

    // GET — list everyone seen within the window.
    const cutoff = now - WINDOW_MS;
    const users = [];
    const iter = table.listEntities({ queryOptions: { filter: `PartitionKey eq '${PARTITION}'` } });
    for await (const e of iter) {
      if (typeof e.lastSeen === "number" && e.lastSeen >= cutoff) {
        users.push({ id: e.rowKey, name: e.name || e.email || "Someone", email: e.email || "", lastSeen: e.lastSeen, you: e.rowKey === me.id });
      }
    }
    users.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    json(200, { users, now });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
