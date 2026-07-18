const { BlobServiceClient } = require("@azure/storage-blob");
const { notifPrefOn, sendEmail, familyAdminEmails } = require("../_shared/notify");

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
//   approveAccess { email, role, familyId }     → site admin only: grants a pending access request (from
//                                                  /api/request-access) and clears it
//   declineAccess { email }                     → site admin only: clears a pending access request
//   transferOwnership { familyId, toEmail }     → current owner (family.createdBy) or site admin only
//   addTraveler / updateTraveler / moveTraveler / deleteTraveler → per-family traveler storage
//                                                  (see TRAVELER-STORAGE-PLAN.md); family-admin gated
//   migrateTravelers { fallbackFamilyId? }      → site admin only: one-time backfill from
//                                                  settings.travelers into travelers.json

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const FAMILIES_BLOB = process.env.FAMILIES_BLOB || "families.json";
const MEMBERS_BLOB = process.env.MEMBERSHIPS_BLOB || "memberships.json";
const SHARES_BLOB = process.env.FAMILY_SHARES_BLOB || "family-shares.json";
const ACCESS_REQUESTS_BLOB = process.env.ACCESS_REQUESTS_BLOB || "access-requests.json";
const TRAVELERS_BLOB = process.env.TRAVELERS_BLOB || "travelers.json";
const ACTIVITY_BLOB = process.env.ACTIVITY_BLOB || "activity.json";
const ACTIVITY_MAX = 300; // bounded ring buffer — old entries drop off, no admin UI needed
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

// In-app activity feed — a small, bounded, best-effort log of share/invite/approval
// events. `visibleTo` names which familyIds should see the entry (usually the acting
// family, plus the other side of an invite/share). Read back and filtered in the GET
// handler below; never throws — a logging hiccup shouldn't break the action it's
// attached to.
async function logActivity(container, { type, familyId, visibleTo, actor, message }) {
  try {
    let list = await readJsonBlob(container, ACTIVITY_BLOB, []);
    if (!Array.isArray(list)) list = [];
    // Dedupe guard: identical consecutive events (same type/family/actor/message)
    // within 10 minutes collapse into one entry — stray double-clicks or repeated
    // no-op-ish saves can't flood the feed with copies of the same line.
    const last = list[list.length - 1];
    if (last && last.type === type && last.familyId === (familyId || null) && last.actor === (actor || "") && last.message === (message || "")) {
      const age = Date.now() - new Date(last.createdAt || 0).getTime();
      if (isFinite(age) && age < 10 * 60 * 1000) return;
    }
    list.push({
      id: genId("act"),
      type,
      familyId: familyId || null,
      visibleTo: Array.isArray(visibleTo) ? visibleTo.filter(Boolean) : [familyId].filter(Boolean),
      actor: actor || "",
      message: message || "",
      createdAt: new Date().toISOString(),
    });
    if (list.length > ACTIVITY_MAX) list = list.slice(list.length - ACTIVITY_MAX);
    await writeJsonBlob(container, ACTIVITY_BLOB, list);
  } catch (e) { /* best-effort — never blocks the calling action */ }
}


// Best-effort courtesy email when a site admin approves a pending access request.
// Uses the same Resend env vars as /api/request-access; silently no-ops if unset
// or if the send fails — approval itself already succeeded via the membership write.
async function notifyApproved(email, familyName, role, isNewFamily) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from) return;
  const roleLabel = role === "admin" ? "Admin" : role === "editor" ? "Editor" : "Reader";
  const site = process.env.SITE_URL || "";
  let body = "Your access request was approved.\n\nFamily: " + (familyName || "\u2014") + "\nRole: " + roleLabel + "\n\nSign in with this email address to get started.";
  if (isNewFamily) {
    body += "\n\nA new family, \"" + (familyName || "") + "\", was created for you and you're its admin. A couple of things to do first:\n"
      + "  1. Rename your family \u2014 open People & Family Management and click Rename next to the family name.\n"
      + "  2. Add the rest of your family \u2014 from the same screen, invite people by email (or generate a shareable invite link) and set their role.";
  }
  if (site) body += "\n\n" + site;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email],
        subject: "You now have access to Trip Tracker",
        text: body,
      }),
    });
  } catch (e) {
    // best-effort only
  }
}

// Best-effort courtesy email when one family shares their trips with another
// (inviteFamily). Notifies every admin of the RECEIVING family. Silently no-ops if
// Resend isn't configured — the share itself already succeeded via the blob write.
async function notifyFamilyShare(members, toFamily, fromFamily, role) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  if (!key || !from || !toFamily) return;
  const admins = members.filter((m) => m.familyId === toFamily.id && m.role === "admin" && m.active !== false && m.email);
  if (!admins.length) return;
  const roleLabel = role === "admin-no-delete" ? "Admin (no delete)" : role === "editor" ? "Editor" : "Reader";
  const site = process.env.SITE_URL || "";
  let body = (fromFamily ? fromFamily.name : "Another family") + " just shared their trips with " + toFamily.name
    + ".\n\nYour access level: " + roleLabel + "\n\nSign in to see their trips on your globe.";
  if (site) body += "\n\n" + site;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: admins.map((a) => a.email), subject: (fromFamily ? fromFamily.name : "A family") + " shared their trips with you", text: body }),
    });
  } catch (e) { /* best-effort only */ }
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
    let settings = await readJsonBlob(container, "family-settings.json", { autoApproveFamilies: false, imageUploadsEnabled: true, publicSharingEnabled: true });
    if (settings.imageUploadsEnabled === undefined) settings.imageUploadsEnabled = true;
    if (settings.publicSharingEnabled === undefined) settings.publicSharingEnabled = true;
    const travelersBlobExists = await container.getBlockBlobClient(TRAVELERS_BLOB).exists();
    let travelers = travelersBlobExists ? await readJsonBlob(container, TRAVELERS_BLOB, []) : [];
    if (!Array.isArray(travelers)) travelers = [];

    const myMemberships = members.filter((m) => m.email === me.email && m.active !== false);
    const myFamilyIds = new Set(myMemberships.map((m) => m.familyId));
    const myAdminFamilyIds = new Set(myMemberships.filter((m) => m.role === "admin").map((m) => m.familyId));
    // A family pending site-admin approval can't invite/share yet (site admin bypasses).
    // "Pending" only applies once the family actually exists with approved:false — a
    // family not found at all is a different error, handled by each action itself.
    const requireApprovedFamily = (familyId) => {
      if (meIsSiteAdmin) return true;
      const fam = families.find((f) => f.id === familyId);
      if (fam && !fam.approved) { json(403, { error: "This family is pending site-admin approval — invites and sharing aren't available yet." }); return false; }
      return true;
    };

    if (req.method === "GET") {
      // A family that only shares its trips with mine (I'm not a member) still needs
      // its name/record to reach the client — otherwise every UI that looks up a
      // family by id (the Metrics scope picker, family-name labels on shared trips,
      // etc.) silently can't resolve it even after the trips/travelers themselves are
      // visible. Mirrors the client's myAccessibleFamilyIds exactly.
      const sharedInFamilyIds = new Set(shares.filter((s) => myFamilyIds.has(s.toFamilyId)).map((s) => s.fromFamilyId));
      const accessibleFamilyIds = new Set([...myFamilyIds, ...sharedInFamilyIds]);
      const visibleFamilies = meIsSiteAdmin ? families : families.filter((f) => accessibleFamilyIds.has(f.id));
      const visibleMembers = meIsSiteAdmin ? members : members.filter((m) => myAdminFamilyIds.has(m.familyId) || m.email === me.email);
      const visibleShares = meIsSiteAdmin ? shares : shares.filter((s) => myFamilyIds.has(s.fromFamilyId) || myFamilyIds.has(s.toFamilyId));
      // Travelers use the same accessible-family set (own families + anyone who
      // shared with one of mine) — otherwise a shared family's people never reach
      // the client, so filters/metrics that key off traveler rows (e.g. the Metrics
      // traveler picker) silently can't show them.
      const visibleTravelers = meIsSiteAdmin ? travelers : travelers.filter((t) => accessibleFamilyIds.has(t.familyId));
      const responseBody = {
        families: visibleFamilies,
        memberships: visibleMembers,
        shares: visibleShares,
        travelers: visibleTravelers,
        travelersMigrated: travelersBlobExists,
        myMemberships,
        familyColors: FAMILY_COLORS,
        siteAdmin: meIsSiteAdmin,
        isPrimaryAdmin: meIsPrimaryAdmin,
        siteAdminEmails: meIsSiteAdmin ? siteAdminEmailList(extraSiteAdmins) : undefined,
        primaryAdminEmails: meIsSiteAdmin ? primaryAdminEmailList() : undefined,
        extraSiteAdmins: meIsSiteAdmin ? extraSiteAdmins : undefined,
        autoApproveFamilies: !!settings.autoApproveFamilies,
        imageUploadsEnabled: settings.imageUploadsEnabled !== false,
        publicSharingEnabled: settings.publicSharingEnabled !== false,
        defaultNotifPrefs: settings.defaultNotifPrefs || {},
        emailKillSwitch: !!settings.emailKillSwitch,
        landingVariant: ["signin", "a", "b", "c"].includes(settings.landingVariant) ? settings.landingVariant : "signin",
        showPricingSection: !!settings.showPricingSection,
        auditLevel: ["essential", "detailed", "verbose"].includes(settings.auditLevel) ? settings.auditLevel : "essential",
        familyCatLimit: Number.isFinite(settings.familyCatLimit) && settings.familyCatLimit > 0 ? Math.min(200, Math.floor(settings.familyCatLimit)) : 40,
        showTestimonials: !!settings.showTestimonials,
        testimonials: Array.isArray(settings.testimonials) ? settings.testimonials : [],
        pendingFamilies: meIsSiteAdmin ? families.filter((f) => !f.approved) : undefined,
        accessRequests: meIsSiteAdmin ? (await readJsonBlob(container, ACCESS_REQUESTS_BLOB, [])) : undefined,
        activity: (await readJsonBlob(container, ACTIVITY_BLOB, []))
          .filter((a) => meIsSiteAdmin || (Array.isArray(a.visibleTo) && a.visibleTo.some((fid) => myFamilyIds.has(fid))))
          .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
          .slice(0, 300),
      };
      // Cheap ETag so the client's 30s poll costs ~nothing when nothing changed:
      // hash the serialized payload; if it matches the client's If-None-Match,
      // reply 304 with no body (client keeps its current state untouched).
      const bodyText = JSON.stringify(responseBody);
      let h = 5381;
      for (let i = 0; i < bodyText.length; i++) h = ((h * 33) ^ bodyText.charCodeAt(i)) >>> 0;
      const etag = '"fam-' + h.toString(36) + "-" + bodyText.length + '"';
      const inm = (req.headers && (req.headers["if-none-match"] || req.headers["If-None-Match"])) || "";
      if (inm === etag) {
        context.res = { status: 304, headers: { "ETag": etag, "Cache-Control": "no-cache" } };
        return;
      }
      context.res = { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "ETag": etag }, body: bodyText };
      return;
    }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { json(400, { error: "Invalid JSON" }); return; } }
    const action = body && body.action;

    if (action === "create") {
      const name = String((body.name || "")).trim();
      if (!name) { json(400, { error: "Family name required." }); return; }
      const color = FAMILY_COLORS.includes(body.color) ? body.color : FAMILY_COLORS[families.length % FAMILY_COLORS.length];
      const fam = { id: genId("fam"), name, color, createdBy: me.email, createdAt: new Date().toISOString(), approved: !!settings.autoApproveFamilies, autoApproved: !!settings.autoApproveFamilies, notifPrefs: settings.defaultNotifPrefs || undefined };
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
      families = families.map((f) => f.id === body.familyId ? { ...f, name, autoNamed: false } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true });
      return;
    }

    // Transfer the "owner" record (family.createdBy) to another active member of the
    // family. Only the CURRENT owner or a site admin may do this — a regular family
    // admin who isn't the owner cannot reassign it out from under the owner. The new
    // owner is promoted to admin if they weren't already (ownership implies admin
    // rights); the outgoing owner keeps whatever role they already had.
    if (action === "transferOwnership") {
      const familyId = body.familyId;
      const toEmail = String(body.toEmail || "").toLowerCase().trim();
      const fam = families.find((f) => f.id === familyId);
      if (!fam) { json(404, { error: "Family not found." }); return; }
      if (!toEmail) { json(400, { error: "Recipient email required." }); return; }
      if (!meIsSiteAdmin && fam.createdBy !== me.email) { json(403, { error: "Only the current owner (or a site admin) can transfer ownership." }); return; }
      const targetIdx = members.findIndex((m) => m.email === toEmail && m.familyId === familyId && m.active !== false);
      if (targetIdx === -1) { json(400, { error: "That person isn't an active member of this family." }); return; }
      if (members[targetIdx].role !== "admin") members[targetIdx] = { ...members[targetIdx], role: "admin" };
      families = families.map((f) => f.id === familyId ? { ...f, createdBy: toEmail } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      if (notifPrefOn(fam, "ownerTransfers", "bell")) {
        logActivity(container, { type: "transferOwnership", familyId, visibleTo: [familyId], actor: me.email, message: "Transferred ownership of " + fam.name + " to " + toEmail });
      }
      if (!settings.emailKillSwitch && notifPrefOn(fam, "ownerTransfers", "email")) {
        const to = Array.from(new Set([toEmail, ...familyAdminEmails(members, familyId, me.email)]));
        sendEmail(to, "Ownership transferred \u2014 " + fam.name, me.email + " transferred ownership of " + fam.name + " to " + toEmail + ".").catch(() => {});
      }
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
      logActivity(container, { type: "setAutoApprove", familyId: null, visibleTo: [], actor: me.email, message: "Turned auto-approve for new families " + (settings.autoApproveFamilies ? "ON" : "OFF") });
      json(200, { ok: true, autoApproveFamilies: settings.autoApproveFamilies });
      return;
    }

    // Site-wide kill switch for photo/gallery uploads — site admin only. A family admin
    // can still override this for their OWN family via setFamilyImageUploads below; this
    // just sets the default every family inherits until it explicitly opts in/out.
    // Site-wide kill switch for the "Public (everyone)" visibility tier — site admin only.
    if (action === "setPublicSharingEnabled") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      settings = { ...settings, publicSharingEnabled: !!body.value };
      await writeJsonBlob(container, "family-settings.json", settings);
      logActivity(container, { type: "setPublicSharingEnabled", familyId: null, visibleTo: [], actor: me.email, message: "Turned the Public sharing tier " + (settings.publicSharingEnabled ? "ON" : "OFF") + " site-wide" });
      json(200, { ok: true, publicSharingEnabled: settings.publicSharingEnabled });
      return;
    }

    if (action === "setImageUploadsEnabled") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      settings = { ...settings, imageUploadsEnabled: !!body.value };
      await writeJsonBlob(container, "family-settings.json", settings);
      logActivity(container, { type: "setImageUploadsEnabled", familyId: null, visibleTo: [], actor: me.email, message: "Turned photo uploads " + (settings.imageUploadsEnabled ? "ON" : "OFF") + " site-wide (default)" });
      json(200, { ok: true, imageUploadsEnabled: settings.imageUploadsEnabled });
      return;
    }

    // Which landing-page variant (a/b/c) the public site shows — site admin picks,
    // Landing.dc.html reads it back via the anonymous /api/site-settings endpoint.
    if (action === "setLandingVariant") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const v = ["signin", "a", "b", "c"].includes(body.value) ? body.value : "signin";
      settings = { ...settings, landingVariant: v };
      await writeJsonBlob(container, "family-settings.json", settings);
      json(200, { ok: true, landingVariant: v });
      return;
    }

    // Whether the public landing page shows a testimonials section — site admin only.
    if (action === "setShowTestimonials") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      settings = { ...settings, showTestimonials: !!body.value };
      await writeJsonBlob(container, "family-settings.json", settings);
      json(200, { ok: true, showTestimonials: settings.showTestimonials });
      return;
    }

    // Replace the full testimonials list shown on the public landing page — site admin only.
    // Each: { quote, name, family }. Landing.dc.html reads these back via /api/site-settings.
    if (action === "setTestimonials") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const list = Array.isArray(body.value) ? body.value.slice(0, 12).map((t) => ({
        quote: String((t && t.quote) || "").slice(0, 500),
        name: String((t && t.name) || "").slice(0, 80),
        family: String((t && t.family) || "").slice(0, 80),
      })).filter((t) => t.quote) : [];
      settings = { ...settings, testimonials: list };
      await writeJsonBlob(container, "family-settings.json", settings);
      json(200, { ok: true, testimonials: list });
      return;
    }

    // Whether the public landing page shows its pricing section — site admin only.
    // Landing.dc.html reads it back via the anonymous /api/site-settings endpoint.
    if (action === "setShowPricingSection") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      settings = { ...settings, showPricingSection: !!body.value };
      await writeJsonBlob(container, "family-settings.json", settings);
      json(200, { ok: true, showPricingSection: settings.showPricingSection });
      return;
    }

    // How much detail the audit/activity log records, site-wide. "essential" (default)
    // = people/roles/family/sharing/ownership/permission changes only. "detailed" adds
    // trip create/edit/delete and comments. "verbose" adds sign-ins too. Read by
    // api/trips and api/attachments (and api/presence for logins) before logging.
    if (action === "setAuditLevel") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const v = ["essential", "detailed", "verbose"].includes(body.value) ? body.value : "essential";
      settings = { ...settings, auditLevel: v };
      await writeJsonBlob(container, "family-settings.json", settings);
      logActivity(container, { type: "setAuditLevel", familyId: null, visibleTo: [], actor: me.email, message: "Set the site-wide audit log detail to " + v });
      json(200, { ok: true, auditLevel: v });
      return;
    }

    // Site-wide cap on how many items a family's custom Visit Type / Trip Type /
    // Status list can hold (setFamilyCategories reads this instead of a hardcoded
    // number). Site admin only. 1–200, default 40.
    if (action === "setFamilyCatLimit") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const raw = Number(body.value);
      const v = Math.min(200, Math.max(1, Math.floor(Number.isFinite(raw) && raw > 0 ? raw : 40)));
      settings = { ...settings, familyCatLimit: v };
      await writeJsonBlob(container, "family-settings.json", settings);
      logActivity(container, { type: "setFamilyCatLimit", familyId: null, visibleTo: [], actor: me.email, message: "Set the per-family category limit to " + v + " items" });
      json(200, { ok: true, familyCatLimit: v });
      return;
    }

    // Per-family Notifications tab: on/off for one (event, channel) pair. channel
    // is "toast" (live in-app toast to other members) | "bell" (persisted to the
    // Activity Log / bell feed) | "email" (courtesy email). Missing = on, so
    // pre-existing families keep every notification until someone opts out.
    // Site-wide default notification prefs applied to brand-new families at creation
    // time (site admin only). Same shape as a family's own notifPrefs — per-key
    // {toast,bell,email}. Doesn't retroactively change existing families.
    if (action === "setDefaultNotifPrefs") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const NOTIF_KEYS = ["categoryChanges", "attachmentUploads", "ownerTransfers", "tripAdds", "tripEdits", "tripDeletes", "comments"];
      const CHANNELS = ["toast", "bell", "email"];
      const key = NOTIF_KEYS.includes(body.key) ? body.key : null;
      const channel = CHANNELS.includes(body.channel) ? body.channel : null;
      if (!key || !channel) { json(400, { error: "Invalid notification key or channel." }); return; }
      const defaultNotifPrefs = { ...(settings.defaultNotifPrefs || {}), [key]: { ...((settings.defaultNotifPrefs && settings.defaultNotifPrefs[key]) || {}), [channel]: !!body.value } };
      settings = { ...settings, defaultNotifPrefs };
      await writeJsonBlob(container, "family-settings.json", settings);
      logActivity(container, { type: "setDefaultNotifPrefs", familyId: null, visibleTo: [], actor: me.email, message: "Set the default " + channel + " notification for " + key + " (new families) to " + (body.value ? "on" : "off") });
      json(200, { ok: true });
      return;
    }

    // Site-wide kill switch: when on, EVERY courtesy email in the app is suppressed
    // regardless of any per-family notification preference — for abuse/incident
    // response. Toasts and the Activity Log (bell) are unaffected. Site admin only.
    // Site-wide kill switch: when turned ON, every family's Email toggle (all 7
    // notification keys) is force-written to OFF right now — not just visually
    // locked — and stays locked/unclickable while the switch is on. Turning it back
    // OFF only removes the lock; it deliberately does NOT restore anyone's previous
    // value, so families come back to an all-off state and must re-enable Email
    // for themselves if they want it. Site admin only.
    if (action === "setEmailKillSwitch") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const turningOn = !!body.value;
      settings = { ...settings, emailKillSwitch: turningOn };
      await writeJsonBlob(container, "family-settings.json", settings);
      if (turningOn) {
        const NOTIF_KEYS = ["categoryChanges", "attachmentUploads", "ownerTransfers", "tripAdds", "tripEdits", "tripDeletes", "comments"];
        families = families.map((f) => {
          const notifPrefs = { ...(f.notifPrefs || {}) };
          NOTIF_KEYS.forEach((k) => { notifPrefs[k] = { ...(notifPrefs[k] || {}), email: false }; });
          return { ...f, notifPrefs };
        });
        await writeJsonBlob(container, FAMILIES_BLOB, families);
      }
      logActivity(container, { type: "setEmailKillSwitch", familyId: null, visibleTo: [], actor: me.email, message: turningOn ? "Disabled email notifications site-wide (forced every family's Email toggle off)" : "Re-enabled email notifications site-wide (families' Email toggles stay off until they turn them back on)" });
      json(200, { ok: true, emailKillSwitch: settings.emailKillSwitch });
      return;
    }

    if (action === "setFamilyNotifPrefs") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const NOTIF_KEYS = ["categoryChanges", "attachmentUploads", "ownerTransfers", "tripAdds", "tripEdits", "tripDeletes", "comments"];
      const CHANNELS = ["toast", "bell", "email"];
      const key = NOTIF_KEYS.includes(body.key) ? body.key : null;
      const channel = CHANNELS.includes(body.channel) ? body.channel : null;
      if (!key || !channel) { json(400, { error: "Invalid notification key or channel." }); return; }
      families = families.map((f) => f.id === body.familyId ? { ...f, notifPrefs: { ...(f.notifPrefs || {}), [key]: { ...((f.notifPrefs && f.notifPrefs[key]) || {}), [channel]: !!body.value } } } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true });
      return;
    }

    // Per-family override of the site-wide image-uploads setting. value: true | false | null
    // (null clears the override so the family goes back to inheriting the site default).
    if (action === "setFamilyImageUploads") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const value = body.value === null ? null : !!body.value;
      families = families.map((f) => f.id === body.familyId ? { ...f, imagesEnabled: value } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      json(200, { ok: true });
      return;
    }

    // Per-family override of the site's Visit Type / Trip Type / Status lists —
    // family admin/owner only (site admin bypasses like everywhere else). cat is
    // "visit" | "trip" | "status"; list is null to clear the override (family goes
    // back to inheriting the site-wide default list) or an array of
    // {key,label,color[,short]} to set a custom list for just this family.
    if (action === "setFamilyCategories") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const cat = ["visit", "trip", "status"].includes(body.cat) ? body.cat : null;
      if (!cat) { json(400, { error: "Invalid category." }); return; }
      const catLimit = Number.isFinite(settings.familyCatLimit) && settings.familyCatLimit > 0 ? Math.min(200, Math.floor(settings.familyCatLimit)) : 40;
      let list = null;
      if (Array.isArray(body.list)) {
        list = body.list.slice(0, catLimit).map((o) => {
          const item = {
            key: String((o && o.key) || "").slice(0, 60) || ("item" + Math.random().toString(36).slice(2, 8)),
            label: String((o && o.label) || "").slice(0, 60),
            color: /^#[0-9a-f]{3,8}$/i.test((o && o.color) || "") ? o.color : "#5fd3ff",
          };
          if (cat === "status" && o && o.short) item.short = String(o.short).slice(0, 20);
          return item;
        }).filter((o) => o.label);
      }
      const fam0 = families.find((f) => f.id === body.familyId);
      const catOverrides = { ...(fam0 && fam0.catOverrides) || {} };
      if (list && list.length) catOverrides[cat] = list; else delete catOverrides[cat];
      families = families.map((f) => f.id === body.familyId ? { ...f, catOverrides } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      const CATLABEL = { visit: "visit types", trip: "trip types", status: "statuses" };
      if (fam0 && notifPrefOn(fam0, "categoryChanges", "bell")) {
        logActivity(container, { type: "setFamilyCategories", familyId: body.familyId, visibleTo: [body.familyId], actor: me.email, message: (list && list.length ? "Set a custom " : "Reverted ") + CATLABEL[cat] + " list for " + (fam0 ? fam0.name : "the family") + (list && list.length ? "" : " to the site default") });
      }
      if (fam0 && !settings.emailKillSwitch && notifPrefOn(fam0, "categoryChanges", "email")) {
        const to = familyAdminEmails(members, body.familyId, me.email);
        sendEmail(to, "Category list updated \u2014 " + fam0.name, me.email + " " + (list && list.length ? "set a custom " : "reverted the ") + CATLABEL[cat] + (list && list.length ? " list" : " to the site default") + " for " + fam0.name + ".").catch(() => {});
      }
      json(200, { ok: true });
      return;
    }

    // Per-family trip-permission floors — controls who among THIS family's own
    // members (owner/admin always qualify) can edit trips, manage/view attachments,
    // and post comments on trips this family owns. Shared families never get edit/
    // attachment-management rights regardless of these settings; comment visibility
    // stays open to everyone who can see the trip — only posting is floor-gated, and
    // only for this family's own members.
    if (action === "setFamilyTripPerms") {
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(body.familyId)) { json(403, { error: "Family admin required." }); return; }
      const floor = (v) => (v === "admin" ? "admin" : "editor");
      const famBefore = families.find((f) => f.id === body.familyId);
      const before = famBefore && famBefore.permTrip ? famBefore.permTrip : {};
      const patch = {
        editFloor: floor(body.editFloor),
        attachFloor: floor(body.attachFloor),
        commentFloor: floor(body.commentFloor),
        attachVisibleShared: body.attachVisibleShared !== false,
        memberDeleteAny: !!body.memberDeleteAny,
        sharedCanDelete: !!body.sharedCanDelete,
        itineraryEditableShared: !!body.itineraryEditableShared,
      };
      const LABELS = {
        editFloor: "who can edit trips", attachFloor: "who can manage attachments",
        commentFloor: "who can comment", attachVisibleShared: "attachments visible to shared families",
        memberDeleteAny: "any member can delete trips", sharedCanDelete: "shared families can delete trips",
        itineraryEditableShared: "shared families can edit itinerary",
      };
      const changes = Object.keys(patch).filter((k) => (before[k] === undefined ? (k === "attachVisibleShared" ? true : (k === "editFloor" || k === "attachFloor" || k === "commentFloor" ? "editor" : false)) : before[k]) !== patch[k])
        .map((k) => LABELS[k] + " → " + (typeof patch[k] === "boolean" ? (patch[k] ? "on" : "off") : patch[k]));
      // No-op saves (clicking the already-selected segment, or the client re-sending
      // the same perm object) skip the blob write AND the audit entry — otherwise
      // every stray click produced an "Updated trip permissions" activity item.
      if (!changes.length) { json(200, { ok: true, unchanged: true }); return; }
      families = families.map((f) => f.id === body.familyId ? { ...f, permTrip: patch } : f);
      await writeJsonBlob(container, FAMILIES_BLOB, families);
      const fam1 = families.find((f) => f.id === body.familyId);
      logActivity(container, { type: "setFamilyTripPerms", familyId: body.familyId, visibleTo: [body.familyId], actor: me.email, message: "Updated trip permissions for " + (fam1 ? fam1.name : "the family") + ": " + changes.join("; ") });
      json(200, { ok: true });
      return;
    }

    if (action === "invitePerson") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      if (!requireApprovedFamily(familyId)) return;
      const email = String(body.email || "").toLowerCase().trim();
      let role = String(body.role || "reader").toLowerCase();
      if (!email || email.indexOf("@") === -1) { json(400, { error: "Valid email required." }); return; }
      if (VALID_ROLES.indexOf(role) === -1) role = "reader";
      const active = body.active !== false;
      const idx = members.findIndex((m) => m.email === email && m.familyId === familyId);
      if (idx >= 0) members[idx] = { ...members[idx], role, active };
      else members.push({ email, familyId, role, active, createdAt: new Date().toISOString() });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      const fam0 = families.find((f) => f.id === familyId);
      logActivity(container, { type: "invitePerson", familyId, visibleTo: [familyId], actor: me.email, message: "Added " + email + " to " + (fam0 ? fam0.name : "the family") + " as " + role });
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

    // Self-service account deletion: counts shown in the confirmation UI before
    // anything is removed. Any family where I'm the sole active admin blocks the
    // whole operation — I'd have to transfer ownership/promote another admin first,
    // otherwise that family would be orphaned with no one able to administer it.
    if (action === "myAccountDeleteImpact") {
      const myEmail = me.email.toLowerCase();
      const myMemberships = members.filter((m) => m.email === myEmail && m.active !== false);
      const blockedFamilies = [];
      myMemberships.forEach((m) => {
        if (m.role !== "admin") return;
        const otherActiveAdmins = members.some((x) => x.familyId === m.familyId && x.email !== myEmail && x.active !== false && x.role === "admin");
        if (!otherActiveAdmins) {
          const fam = families.find((f) => f.id === m.familyId);
          blockedFamilies.push({ id: m.familyId, name: (fam && fam.name) || "a family" });
        }
      });
      const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
      const tripsData = await readJsonBlob(container, tripsBlobName, null);
      const locations = tripsData ? (Array.isArray(tripsData) ? tripsData : (tripsData.locations || [])) : [];
      const myTrips = locations.filter((t) => String(t.ownerEmail || "").toLowerCase().trim() === myEmail);
      const myTravelerKeys = travelers.filter((t) => String(t.email || "").toLowerCase().trim() === myEmail).map((t) => t.key);
      const tagged = locations.filter((t) => Array.isArray(t.travelers) && t.travelers.some((k) => myTravelerKeys.includes(k)) && String(t.ownerEmail || "").toLowerCase().trim() !== myEmail);
      const nonAccountsCreated = members.filter((m) => !m.email && String(m.createdBy || "").toLowerCase().trim() === myEmail);
      json(200, {
        families: myMemberships.length,
        familyNames: myMemberships.map((m) => { const f = families.find((x) => x.id === m.familyId); return (f && f.name) || "a family"; }),
        trips: myTrips.length,
        images: myTrips.filter((t) => !!t.photo).length,
        tagged: tagged.length,
        nonAccountsCreated: nonAccountsCreated.length,
        blockedFamilies,
      });
      return;
    }

    // Delete my own account — removes my membership from EVERY family, my traveler
    // record(s), and my tag from other people's trips. mode 'keep' leaves my own
    // trips in place (ownerless); mode 'withTrips' deletes them (and their photos)
    // too. Refuses if I'm the sole active admin of any family (see impact check above).
    if (action === "deleteMyAccount") {
      const myEmail = me.email.toLowerCase();
      const myMemberships = members.filter((m) => m.email === myEmail && m.active !== false);
      const blocked = myMemberships.some((m) => {
        if (m.role !== "admin") return false;
        return !members.some((x) => x.familyId === m.familyId && x.email !== myEmail && x.active !== false && x.role === "admin");
      });
      if (blocked) { json(409, { error: "You're the sole admin of at least one family — transfer ownership or promote another admin first." }); return; }
      const mode = body.mode === "withTrips" ? "withTrips" : "keep";
      const myTravelerKeys = travelers.filter((t) => String(t.email || "").toLowerCase().trim() === myEmail).map((t) => t.key);

      const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
      const tripsData = await readJsonBlob(container, tripsBlobName, null);
      let tripsRemoved = 0;
      if (tripsData) {
        const locations = Array.isArray(tripsData) ? tripsData : (tripsData.locations || []);
        let out = locations;
        if (mode === "withTrips") {
          out = out.filter((t) => {
            if (String(t.ownerEmail || "").toLowerCase().trim() !== myEmail) return true;
            tripsRemoved++;
            return false;
          });
        } else {
          out = out.map((t) => (String(t.ownerEmail || "").toLowerCase().trim() === myEmail ? { ...t, ownerEmail: "", owner: "" } : t));
        }
        // remove my tag from everyone else's trips regardless of mode
        out = out.map((t) => (Array.isArray(t.travelers) && t.travelers.some((k) => myTravelerKeys.includes(k)))
          ? { ...t, travelers: t.travelers.filter((k) => !myTravelerKeys.includes(k)) }
          : t);
        const payload = Array.isArray(tripsData) ? { app: "vacation-location", version: 1, locations: out } : { ...tripsData, locations: out };
        await writeJsonBlob(container, tripsBlobName, payload);
      }

      members = members.filter((m) => m.email !== myEmail);
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      travelers = travelers.filter((t) => String(t.email || "").toLowerCase().trim() !== myEmail);
      await writeJsonBlob(container, TRAVELERS_BLOB, travelers);
      json(200, { ok: true, tripsRemoved });
      return;
    }

    // A "non-account" member: a name with no email/login (kids, pets, whoever) — still
    // shows up as a family member but can never sign in. Family admin or site admin only.
    if (action === "addNonAccountMember") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      if (!requireApprovedFamily(familyId)) return;
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
        nonAccountNames: famMembers.filter((m) => !m.email).map((m) => m.name || "Unnamed"),
        userAccountNames: famMembers.filter((m) => !!m.email).map((m) => m.email),
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
      if (!requireApprovedFamily(familyId)) return;
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

    // Site-admin roster management — primary (env-var) admins only, so nobody can grant
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

    // Full JSON backup of every family/membership/share/invite-link/site-admin row —
    // site admin only. Import REPLACES all of it (confirmed client-side before calling).
    if (action === "exportFamiliesBackup") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const invites = await readJsonBlob(container, "invite-links.json", []);
      json(200, {
        app: "vacation-location-families", version: 1, exportedAt: new Date().toISOString(),
        families, memberships: members, shares, extraSiteAdmins, inviteLinks: Array.isArray(invites) ? invites : [],
      });
      return;
    }

    if (action === "importFamiliesBackup") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const data = body.data;
      if (!data || typeof data !== "object") { json(400, { error: "Invalid backup file." }); return; }
      const newFamilies = Array.isArray(data.families) ? data.families : null;
      const newMembers = Array.isArray(data.memberships) ? data.memberships : null;
      if (!newFamilies || !newMembers) { json(400, { error: "Backup file is missing families or memberships." }); return; }
      const newShares = Array.isArray(data.shares) ? data.shares : [];
      const newExtraAdmins = Array.isArray(data.extraSiteAdmins) ? data.extraSiteAdmins : [];
      const newInvites = Array.isArray(data.inviteLinks) ? data.inviteLinks : [];
      await writeJsonBlob(container, FAMILIES_BLOB, newFamilies);
      await writeJsonBlob(container, MEMBERS_BLOB, newMembers);
      await writeJsonBlob(container, SHARES_BLOB, newShares);
      await writeJsonBlob(container, "site-admins.json", newExtraAdmins);
      await writeJsonBlob(container, "invite-links.json", newInvites);
      json(200, { ok: true, families: newFamilies.length, memberships: newMembers.length, shares: newShares.length });
      return;
    }

    // Sends an actual invite email via Resend (same service/env vars as /api/request-access).
    // Access is granted immediately regardless of whether the email succeeds — email
    // delivery is a courtesy notification, not the access-control mechanism.
    if (action === "sendInviteEmail") {
      const familyId = body.familyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      if (!requireApprovedFamily(familyId)) return;
      const email = String(body.email || "").toLowerCase().trim();
      if (!email || email.indexOf("@") === -1) { json(400, { error: "Valid email required." }); return; }
      if (settings.emailKillSwitch) { json(403, { error: "Email sending is currently disabled site-wide by a site admin." }); return; }
      const key = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM;
      if (!key || !from) { json(501, { error: "Email sending is not configured on the server." }); return; }
      const subject = String(body.subject || "You've been invited").slice(0, 200);
      const text = String(body.message || "").slice(0, 5000);
      if (!text) { json(400, { error: "Message body required." }); return; }
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to: [email], reply_to: me.email, subject, text }),
        });
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          context.log.error("Resend error", r.status, detail);
          let reason = "";
          try { reason = (JSON.parse(detail).message) || ""; } catch (e) { reason = (detail || "").slice(0, 300); }
          json(502, { error: "Email service rejected the request.", status: r.status, reason });
          return;
        }
      } catch (err) {
        context.log.error(err);
        json(500, { error: "Internal server error." });
        return;
      }
      json(200, { ok: true });
      return;
    }

    if (action === "inviteFamily") {
      const fromFamilyId = body.fromFamilyId;
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(fromFamilyId)) { json(403, { error: "Family admin required." }); return; }
      if (!requireApprovedFamily(fromFamilyId)) return;
      const toFamilyId = body.toFamilyId;
      let role = String(body.role || "reader").toLowerCase();
      if (SHARE_ROLES.indexOf(role) === -1) role = "reader";
      if (!toFamilyId || toFamilyId === fromFamilyId) { json(400, { error: "Invalid target family." }); return; }
      const idx = shares.findIndex((s) => s.fromFamilyId === fromFamilyId && s.toFamilyId === toFamilyId);
      const row = { fromFamilyId, toFamilyId, role, createdAt: new Date().toISOString(), createdBy: me.email };
      if (idx >= 0) shares[idx] = row; else shares.push(row);
      await writeJsonBlob(container, SHARES_BLOB, shares);
      const famFrom = families.find((f) => f.id === fromFamilyId), famTo = families.find((f) => f.id === toFamilyId);
      logActivity(container, {
        type: "inviteFamily", familyId: fromFamilyId, visibleTo: [fromFamilyId, toFamilyId], actor: me.email,
        message: (famFrom ? famFrom.name : "A family") + " shared their trips with " + (famTo ? famTo.name : "another family") + " (" + role + ")",
      });
      // Courtesy email to the invited family's admins, same Resend env vars as the
      // rest of the app. Access is granted immediately regardless of delivery.
      if (!settings.emailKillSwitch) notifyFamilyShare(members, famTo, famFrom, role).catch(() => {});
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

    // Site-admin approves a pending access request: creates/updates a membership
    // row (same effect as invitePerson) and clears the request.
    if (action === "approveAccess") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      let familyId = body.familyId;
      let role = String(body.role || "reader").toLowerCase();
      if (!email) { json(400, { error: "Email is required." }); return; }
      if (VALID_ROLES.indexOf(role) === -1) role = "reader";
      let newFam = null;
      if (!familyId || familyId === "__new__") {
        // No family picked: create a brand-new family for this person (same effect
        // as them using "create family" themselves) and make them its admin.
        const local = email.split("@")[0] || "New";
        const label = local.charAt(0).toUpperCase() + local.slice(1);
        const color = FAMILY_COLORS[families.length % FAMILY_COLORS.length];
        newFam = { id: genId("fam"), name: label + "'s Family", color, createdBy: email, createdAt: new Date().toISOString(), approved: true, autoApproved: true, autoNamed: true, notifPrefs: settings.defaultNotifPrefs || undefined };
        families.push(newFam);
        await writeJsonBlob(container, FAMILIES_BLOB, families);
        familyId = newFam.id;
        role = "admin"; // sole member of their own new family
      }
      const idx = members.findIndex((m) => m.email === email && m.familyId === familyId);
      if (idx >= 0) members[idx] = { ...members[idx], role, active: true };
      else members.push({ email, familyId, role, active: true, createdAt: new Date().toISOString() });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      let requests = await readJsonBlob(container, ACCESS_REQUESTS_BLOB, []);
      if (!Array.isArray(requests)) requests = [];
      requests = requests.filter((r) => r && String(r.email || "").toLowerCase() !== email);
      await writeJsonBlob(container, ACCESS_REQUESTS_BLOB, requests);
      const fam = newFam || families.find((f) => f.id === familyId);
      if (!settings.emailKillSwitch) notifyApproved(email, fam ? fam.name : "", role, !!newFam); // fire-and-forget, best-effort
      logActivity(container, { type: "approveAccess", familyId: fam ? fam.id : null, visibleTo: [fam ? fam.id : null], actor: me.email, message: email + " was granted access (" + role + ")" + (fam ? " to " + fam.name : "") });
      json(200, { ok: true });
      return;
    }

    if (action === "declineAccess") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const email = String(body.email || "").toLowerCase().trim();
      let requests = await readJsonBlob(container, ACCESS_REQUESTS_BLOB, []);
      if (!Array.isArray(requests)) requests = [];
      requests = requests.filter((r) => r && String(r.email || "").toLowerCase() !== email);
      await writeJsonBlob(container, ACCESS_REQUESTS_BLOB, requests);
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

    // Family admin (of the TARGET family) or site admin moves/adds a person into a
    // family — used by the Users tab's family picker. Additive: does not remove any
    // existing membership the person has in other families.
    if (action === "assignFamily") {
      const email = String(body.email || "").toLowerCase().trim();
      const familyId = body.familyId;
      let role = String(body.role || "reader").toLowerCase();
      if (!email || email.indexOf("@") === -1 || !familyId) { json(400, { error: "email + familyId required." }); return; }
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Admin of that family required." }); return; }
      if (VALID_ROLES.indexOf(role) === -1) role = "reader";
      const idx = members.findIndex((m) => m.email === email && m.familyId === familyId);
      if (idx >= 0) members[idx] = { ...members[idx], role, active: true };
      else members.push({ email, familyId, role, active: true, createdAt: new Date().toISOString() });
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true });
      return;
    }

    // A person picks ONE of their own families as the default that loads on sign-in —
    // purely a per-user preference, stored as a flag on their own membership rows (only
    // ever touches rows for the CALLER's own email, never anyone else's).
    if (action === "setDefaultFamily") {
      const familyId = body.familyId;
      if (!familyId) { json(400, { error: "familyId required." }); return; }
      const mine = members.filter((m) => m.email === me.email && m.active !== false);
      if (!mine.some((m) => m.familyId === familyId)) { json(403, { error: "You're not a member of that family." }); return; }
      members = members.map((m) => m.email === me.email ? { ...m, isDefault: m.familyId === familyId } : m);
      await writeJsonBlob(container, MEMBERS_BLOB, members);
      json(200, { ok: true });
      return;
    }

    // ---- Per-family traveler storage (new — see TRAVELER-STORAGE-PLAN.md) ----
    // Row shape: { key, familyId, label, color, email, createdBy, createdAt }. `key` is
    // the SAME identifier trips reference in location.travelers[] — preserved verbatim
    // through migration — so cutting storage over never breaks existing trip tags.
    // This is additive: settings.travelers (in the trips blob) keeps working as the
    // fallback source until the frontend fully cuts over and a later release drops it.
    if (action === "addTraveler") {
      const familyId = body.familyId;
      if (!familyId) { json(400, { error: "familyId required." }); return; }
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Family admin required." }); return; }
      let key = String(body.key || "").trim() || genId("trav");
      // If the client's proposed short key ("p", "p1"...) collides with one already in
      // storage (e.g. it was generated against a stale/locally-scoped view of the
      // list), don't hard-fail the add — just make it unique. Key uniqueness is what
      // matters, not the specific short form.
      if (travelers.some((t) => t.key === key)) key = key + "-" + genId("x");
      const label = String(body.label || "New person").trim() || "New person";
      const color = String(body.color || "#5fd3ff");
      const email = String(body.email || "").toLowerCase().trim();
      const row = { key, familyId, label, color, email, createdBy: me.email, createdAt: new Date().toISOString() };
      travelers.push(row);
      await writeJsonBlob(container, TRAVELERS_BLOB, travelers);
      json(200, { ok: true, traveler: row });
      return;
    }

    if (action === "updateTraveler") {
      const key = body.key;
      const idx = travelers.findIndex((t) => t.key === key);
      if (idx === -1) { json(404, { error: "Traveler not found." }); return; }
      const row = travelers[idx];
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(row.familyId)) { json(403, { error: "Family admin required." }); return; }
      const patch = body.patch || {};
      const next = { ...row };
      if (typeof patch.label === "string") next.label = patch.label.trim() || row.label;
      if (typeof patch.color === "string") next.color = patch.color;
      if (typeof patch.email === "string") next.email = patch.email.toLowerCase().trim();
      if (typeof patch.createdBy === "string") next.createdBy = patch.createdBy.toLowerCase().trim();
      travelers[idx] = next;
      await writeJsonBlob(container, TRAVELERS_BLOB, travelers);
      json(200, { ok: true, traveler: next });
      return;
    }

    // Move a traveler tag to a different family. Requires admin of the TARGET family
    // (mirrors assignFamily) — site admin bypasses.
    if (action === "moveTraveler") {
      const key = body.key;
      const familyId = body.familyId;
      const idx = travelers.findIndex((t) => t.key === key);
      if (idx === -1) { json(404, { error: "Traveler not found." }); return; }
      if (!familyId) { json(400, { error: "familyId required." }); return; }
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(familyId)) { json(403, { error: "Admin of that family required." }); return; }
      travelers[idx] = { ...travelers[idx], familyId };
      await writeJsonBlob(container, TRAVELERS_BLOB, travelers);
      json(200, { ok: true });
      return;
    }

    if (action === "deleteTraveler") {
      const key = body.key;
      const row = travelers.find((t) => t.key === key);
      if (!row) { json(200, { ok: true }); return; } // already gone
      if (!meIsSiteAdmin && !myAdminFamilyIds.has(row.familyId)) { json(403, { error: "Family admin required." }); return; }
      // Guard against deleting a traveler still tagged on a trip (mirrors the client-side
      // personUsedOnTrip check, enforced here so a raw API call can't bypass it) — unless
      // the caller passes force:true, used only by the admin "Delete user…" confirm flow,
      // which already showed the trip impact and disassociates them from those trips as
      // part of the same confirmed operation.
      if (!body.force) {
        try {
          const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
          const tripsData = await readJsonBlob(container, tripsBlobName, null);
          const locations = (tripsData && Array.isArray(tripsData.locations)) ? tripsData.locations : [];
          const usedOnTrip = locations.some((l) => Array.isArray(l.travelers) && l.travelers.includes(key));
          if (usedOnTrip) { json(409, { error: "Tagged on one or more trips — remove it from those first." }); return; }
        } catch (e) {
          // If the trips blob can't be read, fail safe by refusing the delete rather than
          // silently allowing an orphaned reference.
          json(409, { error: "Could not verify trip usage — try again." }); return;
        }
      }
      travelers = travelers.filter((t) => t.key !== key);
      await writeJsonBlob(container, TRAVELERS_BLOB, travelers);
      json(200, { ok: true });
      return;
    }

    // One-time, idempotent backfill: copy settings.travelers (in the trips blob) into
    // the new per-family travelers.json, resolving a familyId for each row that lacks
    // one. Safe to re-run — skips rows already migrated (matched by their original
    // `key`, preserved verbatim so existing trip tags never break). Does NOT touch or
    // remove settings.travelers; the frontend still reads from there until a later
    // release cuts it over.
    if (action === "migrateTravelers") {
      if (!meIsSiteAdmin) { json(403, { error: "Site admin required." }); return; }
      const tripsBlobName = process.env.TRIPS_BLOB || "trip-tracker.json";
      const tripsData = await readJsonBlob(container, tripsBlobName, null);
      const settingsTravelers = (tripsData && tripsData.settings && Array.isArray(tripsData.settings.travelers)) ? tripsData.settings.travelers : [];
      const membershipFamilyByEmail = {};
      members.filter((m) => m.active !== false && m.email).forEach((m) => {
        const e = String(m.email).toLowerCase().trim();
        if (!membershipFamilyByEmail[e]) membershipFamilyByEmail[e] = m.familyId;
      });
      const fallbackFamilyId = body.fallbackFamilyId || (families[0] && families[0].id) || null;
      const existingKeys = new Set(travelers.map((t) => t.key));
      let migrated = 0, skipped = 0, unresolved = 0;
      settingsTravelers.forEach((o) => {
        const key = String(o.key || "");
        if (!key || existingKeys.has(key)) { skipped++; return; }
        const email = String(o.email || "").toLowerCase().trim();
        const createdBy = String(o.createdBy || "").toLowerCase().trim();
        let familyId = o.familyId || (email && membershipFamilyByEmail[email]) || (createdBy && membershipFamilyByEmail[createdBy]) || fallbackFamilyId;
        if (!familyId) { unresolved++; return; }
        travelers.push({ key, familyId, label: o.label || "Unnamed", color: o.color || "#5fd3ff", email, createdBy, createdAt: new Date().toISOString() });
        existingKeys.add(key);
        migrated++;
      });
      await writeJsonBlob(container, TRAVELERS_BLOB, travelers);
      json(200, { ok: true, migrated, skipped, unresolved, total: settingsTravelers.length });
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
          const fam = { id: genId("fam"), name, createdBy: me.email, createdAt: new Date().toISOString(), approved: true, autoApproved: false, notifPrefs: settings.defaultNotifPrefs || undefined };
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
    json(500, { error: "Internal server error." });
  }
};
