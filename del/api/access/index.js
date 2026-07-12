const { BlobServiceClient } = require("@azure/storage-blob");

// ACCESS-LIST admin API. GET returns the email→role allowlist; POST/PUT replaces it.
// Gated to the `admin` role both by the SWA route rule (staticwebapp.config.json) and
// defensively here. The list is what /api/roles reads to grant access, so editing it
// is how an admin lets people in or out — no Azure portal invitations needed.
//
// App settings:  AZURE_STORAGE_CONNECTION_STRING (required)
// Optional:      TRIPS_CONTAINER (default "data")   ACCESS_BLOB (default "access-list.json")

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const ACCESS_BLOB = process.env.ACCESS_BLOB || "access-list.json";
const VALID = ["reader", "editor", "admin"];

function principal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { id: p.userId || "", email: (p.userDetails || "").toLowerCase(), roles: p.userRoles || [] };
  } catch (e) { return null; }
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function getBlob() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();
  return container.getBlockBlobClient(ACCESS_BLOB);
}

async function readList(blob) {
  if (!(await blob.exists())) return [];
  const dl = await blob.download();
  const text = await streamToString(dl.readableStreamBody);
  try { const d = JSON.parse(text); return Array.isArray(d) ? d : (Array.isArray(d.list) ? d.list : []); }
  catch (e) { return []; }
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
    if (!me) { json(401, { error: "Sign in required." }); return; }
    if (!me.roles.includes("admin")) { json(403, { error: "Admin role required." }); return; }

    const blob = await getBlob();

    if (req.method === "GET") {
      json(200, { list: await readList(blob) });
      return;
    }

    // POST / PUT — replace the whole list
    let payload = req.body;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { json(400, { error: "Invalid JSON" }); return; } }
    const incoming = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.list) ? payload.list : null);
    if (!incoming) { json(400, { error: "Expected { list: [...] }" }); return; }

    const seen = new Set();
    const clean = [];
    for (const e of incoming) {
      const email = String((e && e.email) || "").trim().toLowerCase();
      let role = String((e && e.role) || "").trim().toLowerCase();
      if (!email || email.indexOf("@") === -1) continue;
      if (VALID.indexOf(role) === -1) role = "reader";
      if (seen.has(email)) continue;
      seen.add(email);
      const row = { email, role, active: e.active !== false };
      if (e.name && String(e.name).trim()) row.name = String(e.name).trim();
      clean.push(row);
    }

    const text = JSON.stringify({ app: "trip-tracker", kind: "access-list", list: clean }, null, 2);
    await blob.upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "application/json" } });
    json(200, { ok: true, count: clean.length });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
