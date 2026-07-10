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
const FAMILY_COLORS = ["#38bdf8", "#fb7185", "#fbbf24", "#4ade80", "#a78bfa", "#fb923c", "#22d3ee", "#e879f9", "#f87171", "#34d399"];

function principal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { id: p.userId || "", email: (p.userDetails || "").toLowerCase(), roles: p.userRoles || [] };
  } catch (e) { return null; }
}

// The PRIMARY site admin(s) come from the env var — a bootstrap failsafe that can't be
// edited from the UI (so nobody can lock themselves out). Additional site admins can be
// added in-app, but only by a primary admin, and are stored in site-admins.json.
function primaryAdminEmailList() {
  return String(process.env.SITE_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function isPrimaryAdmin(email) {
  return !!email && primaryAdminEmailList().includes(email);
}
function isSiteAdmin(email, extraAdmins) {
  if (!email) return false;
  if (primaryAdminEmailList().includes(email)) return true;
  return (extraAdmins || []).includes(email);
}
function siteAdminEmailList(extraAdmins) {
  return Array.from(new Set([...primaryAdminEmailList(), ...(extraAdmins || [])]));
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
    const container = await getContainer();
    let extraSiteAdmins = await readJsonBlob(container, "site-admins.json", []);
    if (!Array.isArray(extraSiteAdmins)) extraSiteAdmins = [];
    const meIsSiteAdmin = isSiteAdmin(me.email, extraSiteAdmins);
    const meIsPrimaryAdmin = isPrimaryAdmin(me.email);

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
        familyColors: FAMILY_COLORS,
        siteAdmin: meIsSiteAdmin,
        isPrimaryAdmin: meIsPrimaryAdmin,
        siteAdminEmails: meIsSiteAdmin ? siteAdminEmailList(extraSiteAdmins) : undefined,
        primaryAdminEmails: meIsSiteAdmin ? primaryAdminEmailList() : undefined,
        extraSiteAdmins: meIsSiteAdmin ? extraSiteAdmins : undefined,
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
      const color = FAMILY_COLORS.includes(body.color) ? body.color : FAMILY_COLORS[families.length % FAMILY_COLORS.length];
      const fam = { id: genId("fam"), name, color, createdBy: me.email, createdAt: new Date().toISOString(), approved: !!settings.autoApproveFamilies, autoApproved: !!settings.autoApproveFamilies };
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

    if (action === "setFamilyColor") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const color = FAMILY_COLORS.includes(body.color) ? body.color : null;
      if (!color) { json(400, { error: "Invalid color." }); return; }
      families = families.map((f) => f.id === body.familyId ? { ...f, color } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true, color });
      return;
    }

    if (action === "setFamilyLogo") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const logo = String(body.logo || "");
      if (logo && logo.length > 200000) { json(400, { error: "Image too large." }); return; }
      if (logo && !logo.startsWith("data:image/")) { json(400, { error: "Invalid image data." }); return; }
      families = families.map((f) => f.id === body.familyId ? { ...f, logo } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true });
      return;
    }

    if (action === "delete") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
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
      const id = body.id;
      members = members.filter((m) => {
        if (m.familyId !== familyId) return true;
        if (id) return m.id !== id;
        return m.email !== email;
      });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true });
      return;
    }

    // A "non-account" member: a name with no email/login (kids, pets, whoever) — still
    // shows up as a family member but can never sign in. Family admin or site admin only.
    if (action === "addNonAccountMember") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      const name = String(body.name || "").trim();
      if (!name) { json(400, { error: "Name required." }); return; }
      const row = { id: genId("member"), familyId, name, noAccount: true, active: true, createdAt: new Date().toISOString(), createdBy: me.email };
      members.push(row);
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true, member: row });
      return;
    }

    // Counts shown in the delete-family confirmation UI before anything is removed.
    if (action === "familyDeleteImpact") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
      const tripsData = await readJsonBlob(container, tripsBlobName, null);
      const locations = tripsData ? (Array.isArray(tripsData) ? tripsData : (tripsData.locations || [])) : [];
      const famTrips = locations.filter((t) => t.familyId === familyId);
      const famMembers = members.filter((m) => m.familyId === familyId);
      json(200, {
        trips: famTrips.length,
        images: famTrips.filter((t) => !!t.photo).length,
        nonAccounts: famMembers.filter((m) => !m.email).length,
        userAccounts: famMembers.filter((m) => !!m.email).length,
      });
      return;
    }

    // Selective/guarded family cleanup, driven by the checkbox confirmation in Settings.
    // deleteFamily only takes effect once ALL FOUR categories are also flagged — mirrors
    // the client's "all boxes checked lights up Delete Family" gating, enforced again here.
    if (action === "deleteFamilyData") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      const wantImages = !!body.images, wantTrips = !!body.trips, wantNonAccounts = !!body.nonAccounts, wantUserAccounts = !!body.userAccounts;
      const wantDeleteFamily = !!body.deleteFamily && wantImages && wantTrips && wantNonAccounts && wantUserAccounts;
      let tripsRemoved = 0, imagesCleared = 0, nonAccountsRemoved = 0, userAccountsRemoved = 0;

      if (wantImages || wantTrips) {
        const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
        const tripsData = await readJsonBlob(container, tripsBlobName, null);
        if (tripsData) {
          const locations = Array.isArray(tripsData) ? tripsData : (tripsData.locations || []);
          let out;
          if (wantTrips) {
            out = locations.filter((t) => {
              if (t.familyId !== familyId) return true;
              tripsRemoved++;
              return false;
            });
          } else {
            out = locations.map((t) => {
              if (t.familyId !== familyId || !t.photo) return t;
              imagesCleared++;
              const { photo, ...rest } = t;
              return rest;
            });
          }
          const payload = Array.isArray(tripsData) ? { app: "vacation-location", version: 1, locations: out } : { ...tripsData, locations: out };
          await writeJsonBlob(container, tripsBlobName, payload);
        }
      }

      if (wantNonAccounts || wantUserAccounts) {
        members = members.filter((m) => {
          if (m.familyId !== familyId) return true;
          const isNonAccount = !m.email;
          if (isNonAccount && wantNonAccounts) { nonAccountsRemoved++; return false; }
          if (!isNonAccount && wantUserAccounts) { userAccountsRemoved++; return false; }
          return true;
        });
        await writeJsonBlob(container, MEMBERS_BLOB, members);
      }

      if (wantDeleteFamily) {
        families = families.filter((f) => f.id !== familyId);
        members = members.filter((m) => m.familyId !== familyId);
        shares = shares.filter((s) => s.fromFamilyId !== familyId && s.toFamilyId !== familyId);
        await writeJsonBlob(container, FAMILIES_BLOB, families);
        await writeJsonBlob(container, MEMBERS_BLOB, members);
        await writeJsonBlob(container, SHARES_BLOB, shares);
      }

      json(200, { ok: true, tripsRemoved, imagesCleared, nonAccountsRemoved, userAccountsRemoved, familyDeleted: wantDeleteFamily });
      return;
    }

    // Shareable invite link: a family admin generates a one-time code for a role;
    // anyone signed in who opens it is added to the family at that role. Expires in 7 days.
    if (action === "createInviteLink") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      let role = String(body.role || "reader").toLowerCase();
      if (VALID_ROLES.indexOf(role) === -1) role = "reader";
      let invites = await readJsonBlob(container, "invite-links.json", []);
      if (!Array.isArray(invites)) invites = [];
      const code = genId("inv").replace(/[^a-z0-9]/gi, "");
      const row = { code, familyId, role, createdBy: me.email, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(), usedBy: null };
      invites.push(row);
      await writeJsonBlob(container, "invite-links.json", invites);
      json(200, { ok: true, code });
      return;
    }

    if (action === "resolveInvite") {
      const code = String(body.code || "").trim();
      if (!code) { json(400, { error: "Missing invite code." }); return; }
      let invites = await readJsonBlob(container, "invite-links.json", []);
      if (!Array.isArray(invites)) invites = [];
      const row = invites.find((i) => i.code === code);
      if (!row) { json(404, { error: "Invite not found or already used." }); return; }
      if (row.usedBy) { json(410, { error: "This invite link has already been used." }); return; }
      if (new Date(row.expiresAt).getTime() < Date.now()) { json(410, { error: "This invite link has expired." }); return; }
      const fam = families.find((f) => f.id === row.familyId);
      if (!fam) { json(404, { error: "That family no longer exists." }); return; }
      const idx = members.findIndex((m) => m.email === me.email && m.familyId === row.familyId);
      if (idx >= 0) members[idx] = { ...members[idx], role: row.role, active: true };
      else members.push({ email: me.email, familyId: row.familyId, role: row.role, active: true, createdAt: new Date().toISOString() });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      row.usedBy = me.email;
      row.usedAt = new Date().toISOString();
      await writeJsonBlob(container, "invite-links.json", invites);
      json(200, { ok: true, familyId: row.familyId, familyName: fam.name, role: row.role });
      return;
    }

 — primary (env-var) admins only, so nobody can grant
    // themselves admin rights or lock out the account that actually controls the app.
    if (action === "addSiteAdmin") {
      if (!meIsPrimaryAdmin) { json(403, { error: "Primary site admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      if (!email || email.indexOf("@") === -1) { json(400, { error: "Valid email required." }); return; }
      if (!extraSiteAdmins.includes(email) && !primaryAdminEmailList().includes(email)) extraSiteAdmins.push(email);
      await writeJsonBlob(container, "site-admins.json", extraSiteAdmins);
      json(200, { ok: true, extraSiteAdmins });
      return;
    }

    if (action === "removeSiteAdmin") {
      if (!meIsPrimaryAdmin) { json(403, { error: "Primary site admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      if (primaryAdminEmailList().includes(email)) { json(400, { error: "Can't remove a primary admin." }); return; }
      extraSiteAdmins = extraSiteAdmins.filter((e) => e !== email);
      await writeJsonBlob(container, "site-admins.json", extraSiteAdmins);
      json(200, { ok: true, extraSiteAdmins });
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
