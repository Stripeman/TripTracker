const { BlobServiceClient } = require("@azure/storage-blob");

// CUSTOM ROLES function (Azure Static Web Apps `rolesSource`).
//
// After ANY user signs in, Azure SWA POSTs their identity here and expects back the
// list of roles to grant them (used for static route gating in staticwebapp.config.json,
// e.g. /api/trips requires "reader"/"editor"). Per-FAMILY authorization is enforced
// separately inside /api/trips and /api/families — this function only answers "does
// this person have ANY membership anywhere, and at what ceiling role".
//
// Roles are read from memberships.json (family-scoped: { email, familyId, role, active }),
// which replaces the old flat access-list.json. A user's SWA role = the highest role
// across all of their ACTIVE memberships (any family). Site admins (SITE_ADMIN_EMAIL /
// BOOTSTRAP_ADMIN_EMAIL) always get admin.
//
// App settings:
//   AZURE_STORAGE_CONNECTION_STRING  (required)
//   BOOTSTRAP_ADMIN_EMAIL / SITE_ADMIN_EMAIL — comma-separated emails that always get admin
// Optional:
//   TRIPS_CONTAINER (default "data")   MEMBERSHIPS_BLOB (default "memberships.json")

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const MEMBERS_BLOB = process.env.MEMBERSHIPS_BLOB || "memberships.json";
const LEGACY_ACCESS_BLOB = process.env.ACCESS_BLOB || "access-list.json";

function rolesFor(role) {
  switch (String(role || "").toLowerCase()) {
    case "admin":  return ["admin", "editor", "reader"];
    case "editor": return ["editor", "reader"];
    case "reader": return ["reader"];
    default:       return [];
  }
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBlob(container, name, fallback) {
  const blob = container.getBlockBlobClient(name);
  if (!(await blob.exists())) return fallback;
  const dl = await blob.download();
  const text = await streamToString(dl.readableStreamBody);
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

module.exports = async function (context, req) {
  const email = String((req.body && req.body.userDetails) || "").toLowerCase().trim();
  const roles = new Set();

  const boot = String(process.env.SITE_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (email && boot.includes(email)) rolesFor("admin").forEach((r) => roles.add(r));

  try {
    const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (conn) {
      const svc = BlobServiceClient.fromConnectionString(conn);
      const container = svc.getContainerClient(CONTAINER);
      await container.createIfNotExists();

      const members = await readJsonBlob(container, MEMBERS_BLOB, null);
      if (Array.isArray(members)) {
        const mine = members.filter((m) => m && String(m.email || "").toLowerCase().trim() === email && m.active !== false);
        // ceiling role across all of this person's family memberships
        let best = "";
        mine.forEach((m) => { if (m.role === "admin") best = "admin"; else if (m.role === "editor" && best !== "admin") best = "editor"; else if (!best) best = m.role || "reader"; });
        if (best) rolesFor(best).forEach((r) => roles.add(r));
      } else {
        // memberships.json doesn't exist yet (pre-migration) — fall back to the old
        // flat access-list.json so existing deployments keep working unmigrated.
        const legacy = await readJsonBlob(container, LEGACY_ACCESS_BLOB, []);
        const legacyList = Array.isArray(legacy) ? legacy : (legacy.list || []);
        const hit = legacyList.find((e) => e && String(e.email || "").toLowerCase().trim() === email);
        if (hit && hit.active !== false) rolesFor(hit.role).forEach((r) => roles.add(r));
      }
    }
  } catch (e) {
    context.log.error(e);
  }

  context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roles: Array.from(roles) }),
  };
};
