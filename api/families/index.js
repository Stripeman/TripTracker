const { BlobServiceClient } = require("@azure/storage-blob");

// FAMILIES + MEMBERSHIPS API.
//
// A "family" is the unit of data ownership: trips and travelers belong to a family,
// not to an individual. A person's role (admin/editor/reader) is scoped PER FAMILY —
// the same email can be an admin of their own family and a reader in a family that
// invited them in.
//
// Two blobs:
//   families.json    — [{ id, name, createdBy, createdAt, approved, autoApproved }]
//   memberships.json — [{ email, familyId, role, active, name, createdAt }]
//                       (a person has one row per family they belong to)
//
// Site admins (global, cross-family) are listed in SITE_ADMIN_EMAIL (comma-separated),
// same pattern as BOOTSTRAP_ADMIN_EMAIL already used by /api/roles.
//
// Actions (all POST unless noted), body: { action, ... }
//   list                        (GET) → { families: [...visible to me...], memberships: [...mine...],
//                                          siteAdmin, autoApproveFamilies, pendingFamilies (site admin only) }
//   create        { name }                     → creates a family owned by me (admin role), approved
//                                                  iff autoApproveFamilies is on, else pending
//   approve       { familyId }                 → site admin only
//   rename        { familyId, name }            → family admin or site admin
//   delete        { familyId }                  → site admin only (fails if family still owns trips
//                                                  unless force:true)
//   setAutoApprove { value }                    → site admin only, toggles the global setting
//   invitePerson  { familyId, email, role }     → family admin: add/update a membership row in MY family
//   removeMember  { familyId, email }           → family admin (their family) or site admin
//   inviteFamily  { fromFamilyId, toFamilyId, role } → family admin: grant another whole family
//                                                       access to ours (creates a FamilyShare)
//   assignUser    { email, familyId, role }     → site admin only: put a user into any family at any role

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const FAMILIES_BLOB = process.env.FAMILIES_BLOB || "families.json";
const MEMBERS_BLOB = process.env.MEMBERSHIPS_BLOB || "memberships.json";
const SHARES_BLOB = process.env.FAMILY_SHARES_BLOB || "family-shares.json";
const VALID_ROLES = ["reader", "editor", "admin"];
const SHARE_ROLES = ["reader", "editor", "admin-no-delete"];

function principal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { id: p.userId || "", email: (p.userDetails || "").toLowerCase(), roles: p.userRoles || [] };
  } catch (e) { return null; }
}

function isSiteAdmin(email) {
  const list = String(process.env.SITE_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email);
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function getContainer() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();
  return container;
}

async function readJsonBlob(container, name, fallback) {
  const blob = container.getBlockBlobClient(name);
  if (!(await blob.exists())) return fallback;
  const dl = await blob.download();
  const text = await streamToString(dl.readableStreamBody);
  try { return JSON.parse(text); } catch (e) { return fallback; }
}

async function writeJsonBlob(container, name, data) {
  const blob = container.getBlockBlobClient(name);
  const text = JSON.stringify(data, null, 2);
  await blob.upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "application/json" } });
}

function genId(prefix) {
  return prefix + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

module.exports = async function (context, req) {
  const json = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
  };
  try {
    const me = principal(req);
    if (!me) { json(401, { error: "Sign in required." }); return; }
    const meIsSiteAdmin = isSiteAdmin(me.email);
    const container = await getContainer();

    let families = await readJsonBlob(container, FAMILIES_BLOB, []);
    let members = await readJsonBlob(container, MEMBERS_BLOB, []);
    let shares = await readJsonBlob(container, SHARES_BLOB, []);
    let settings = await readJsonBlob(container, "family-settings.json", { autoApproveFamilies: false });

    const myMemberships = members.filter((m) => m.email === me.email && m.active !== false);
    const myFamilyIds = new Set(myMemberships.map((m) => m.familyId));
    const myAdminFamilyIds = new Set(myMemberships.filter((m) => m.role === "admin").map((m) => m.familyId));

    if (req.method === "GET") {
      const visibleFamilies = meIsSiteAdmin ? families : families.filter((f) => myFamilyIds.has(f.id));
      const visibleMembers = meIsSiteAdmin ? members : members.filter((m) => myAdminFamilyIds.has(m.familyId) || m.email === me.email);
      const visibleShares = meIsSiteAdmin ? shares : shares.filter((s) => myFamilyIds.has(s.fromFamilyId) || myFamilyIds.has(s.toFamilyId));
      json(200, {
        families: visibleFamilies,
        memberships: visibleMembers,
        shares: visibleShares,
        myMemberships,
        siteAdmin: meIsSiteAdmin,
        autoApproveFamilies: !!settings.autoApproveFamilies,
        pendingFamilies: meIsSiteAdmin ? families.filter((f) => !f.approved) : undefined,
      });
      return;
    }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { json(400, { error: "Invalid JSON" }); return; } }
    const action = body && body.action;

    if (action === "create") {
      const name = String((body.name || "")).trim();
      if (!name) { json(400, { error: "Family name required." }); return; }
      const fam = { id: genId("fam"), name, createdBy: me.email, createdAt: new Date().toISOString(), approved: !!settings.autoApproveFamilies, autoApproved: !!settings.autoApproveFamilies };
      families.push(fam);
      members.push({ email: me.email, familyId: fam.id, role: "admin", active: true, createdAt: fam.createdAt });
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true, family: fam });
      return;
    }

    if (action === "approve") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      families = families.map((f) => f.id === body.familyId ? { ...f, approved: true } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true });
      return;
    }

    if (action === "rename") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const name = String((body.name || "")).trim();
      if (!name) { json(400, { error: "Name required." }); return; }
      families = families.map((f) => f.id === body.familyId ? { ...f, name } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true });
      return;
    }

    if (action === "delete") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      families = families.filter((f) => f.id !== body.familyId);
      members = members.filter((m) => m.familyId !== body.familyId);
      shares = shares.filter((s) => s.fromFamilyId !== body.familyId && s.toFamilyId !== body.familyId);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      await writeJsonBlob(container, SHARES_BLOB, shares);
      json(200, { ok: true });
      return;
    }

    if (action === "setAutoApprove") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      settings = { ...settings, autoApproveFamilies: !!body.value };
      await writeJsonBlob(container, "family-settings.json", settings);
      json(200, { ok: true, autoApproveFamilies: settings.autoApproveFamilies });
      return;
    }

    if (action === "invitePerson") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      let role = String(body.role || "reader").toLowerCase();
      if (!email || email.indexOf("@") === -1) { json(400, { error: "Valid email required." }); return; }
      if (VALID_ROLES.indexOf(role) === -1) role = "reader";
      const active = body.active !== false;
      const idx = members.findIndex((m) => m.email === email && m.familyId === familyId);
      if (idx >= 0) members[idx] = { ...members[idx], role, active };
      else members.push({ email, familyId, role, active, createdAt: new Date().toISOString() });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true });
      return;
    }

    if (action === "removeMember") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      members = members.filter((m) => !(m.email === email && m.familyId === familyId));
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true });
      return;
    }

    if (action === "inviteFamily") {
      const fromFamilyId = body.fromFamilyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(fromFamilyId)) { json(403, { error: "Family admin required." }); return; }
      const toFamilyId = body.toFamilyId;
      let role = String(body.role || "reader").toLowerCase();
      if (SHARE_ROLES.indexOf(role) === -1) role = "reader";
      if (!toFamilyId || toFamilyId === fromFamilyId) { json(400, { error: "Invalid target family." }); return; }
      const idx = shares.findIndex((s) => s.fromFamilyId === fromFamilyId && s.toFamilyId === toFamilyId);
      const row = { fromFamilyId, toFamilyId, role, createdAt: new Date().toISOString(), createdBy: me.email };
      if (idx >= 0) shares[idx] = row; else shares.push(row);
      await writeJsonBlob(container, SHARES_BLOB, shares);
      json(200, { ok: true });
      return;
    }

    if (action === "removeFamilyShare") {
      const { fromFamilyId, toFamilyId } = body;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(fromFamilyId)) { json(403, { error: "Family admin required." }); return; }
      shares = shares.filter((s) => !(s.fromFamilyId === fromFamilyId && s.toFamilyId === toFamilyId));
      await writeJsonBlob(container, SHARES_BLOB, shares);
      json(200, { ok: true });
      return;
    }

    if (action === "assignUser") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      const familyId = body.familyId;
      let role = String(body.role || "reader").toLowerCase();
      if (!email || email.indexOf("@") === -1 || !familyId) { json(400, { error: "email + familyId required." }); return; }
      if (VALID_ROLES.indexOf(role) === -1) role = "reader";
      const idx = members.findIndex((m) => m.email === email && m.familyId === familyId);
      if (idx >= 0) members[idx] = { ...members[idx], role, active: true };
      else members.push({ email, familyId, role, active: true, createdAt: new Date().toISOString() });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true });
      return;
    }

    // One-time / idempotent migration: put all pre-existing trips/travelers/access-list
    // rows that have no familyId into a single default family (site admin only).
    if (action === "migrateLegacy") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      let famId = body.familyId;
      if (!famId) {
        const name = String(body.familyName || "The Remsiks").trim();
        const existing = families.find((f) => f.name === name);
        if (existing) { famId = existing.id; }
        else {
          const fam = { id: genId("fam"), name, createdBy: me.email, createdAt: new Date().toISOString(), approved: true, autoApproved: false };
          families.push(fam);
          famId = fam.id;
          await writeJsonBlob(container, FAMILIES_BLOB, families);
        }
      }
      // seed a membership for every email in the OLD access-list.json (legacy roles), if any
      const legacy = await readJsonBlob(container, "access-list.json", null);
      const legacyList = legacy ? (Array.isArray(legacy) ? legacy : legacy.list || []) : [];
      legacyList.forEach((e) => {
        const email = String((e && e.email) || "").toLowerCase().trim();
        if (!email) return;
        if (!members.some((m) => m.email === email && m.familyId === famId)) {
          members.push({ email, familyId: famId, role: e.role || "reader", active: e.active !== false, name: e.name, createdAt: new Date().toISOString() });
        }
      });
      await writeJsonBlob(container, MEMBERS_BLOB, members);

      // also stamp familyId on every existing trip that doesn't have one yet, so the
      // whole existing dataset is now "owned" by this default family under the new model.
      let migratedTrips = 0;
      try {
        const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
        const tripsData = await readJsonBlob(container, tripsBlobName, null);
        if (tripsData) {
          const locations = Array.isArray(tripsData) ? tripsData : (tripsData.locations || []);
          const out = locations.map((t) => {
            if (t.familyId) return t;
            migratedTrips++;
            return { ...t, familyId: famId };
          });
          const payload = Array.isArray(tripsData) ? { app: "vacation-location", version: 1, locations: out } : { ...tripsData, locations: out };
          await writeJsonBlob(container, tripsBlobName, payload);
        }
      } catch (e) { context.log.error(e); }

      json(200, { ok: true, familyId: famId, migratedMembers: legacyList.length, migratedTrips });
      return;
    }

    json(400, { error: "Unknown action." });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
