const { BlobServiceClient } = require("@azure/storage-blob");
const { checkRateLimit } = require("../_shared/rateLimit");
const { notifPrefOn, sendEmail, familyAdminEmails } = require("../_shared/notify");

// ATTACHMENTS API — real files (tickets, confirmations) attached to a trip.
//
// Unlike gallery photos (small, resized, inlined as base64 directly in the trip JSON),
// attachments can be PDFs/Office docs up to MAX_BYTES and are stored as their own blobs
// in the SAME storage account/container trips already use, under an `attachments/`
// prefix — so no new storage account or container setup is required. Only lightweight
// METADATA `{ id, name, mimeType, size, blobName, uploadedBy, uploadedByEmail, uploadedAt }`
// lives on the trip's `attachments` array (in trip-tracker.json), same pattern as
// `gallery`/`comments`.
//
// Permission model matches api/trips: upload/delete require edit rights on the trip
// (canEdit); download requires view rights (canView); delete additionally allows the
// uploader themself even if their edit rights on the trip have since changed.
//
// App settings required (same as api/trips):
//   AZURE_STORAGE_CONNECTION_STRING
// Optional:
//   TRIPS_CONTAINER (default "data")   TRIPS_BLOB (default "trip-tracker.json")
//   MEMBERSHIPS_BLOB / FAMILY_SHARES_BLOB (default memberships.json / family-shares.json)

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const BLOB = process.env.TRIPS_BLOB || "trip-tracker.json";
const MEMBERS_BLOB = process.env.MEMBERSHIPS_BLOB || "memberships.json";
const SHARES_BLOB = process.env.FAMILY_SHARES_BLOB || "family-shares.json";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB, matches the app's configured cap
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);

function principal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return { id: p.userId || "", email: (p.userDetails || "").toLowerCase(), roles: p.userRoles || [] };
  } catch (e) { return null; }
}

function sameEmail(a, b) {
  a = String(a || "").toLowerCase().trim();
  b = String(b || "").toLowerCase().trim();
  return !!a && a === b;
}

function isMine(trip, me) {
  return !!(trip && ((trip.owner && trip.owner === me.id) || sameEmail(trip.ownerEmail, me.email)));
}

function sharedDirect(trip, me) {
  return Array.isArray(trip.sharedWith) && trip.sharedWith.map((s) => String(s).toLowerCase()).includes(me.email);
}

function isSiteAdmin(email) {
  const list = String(process.env.SITE_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email);
}

function canView(trip, me) {
  if (!trip) return false;
  if (me.siteAdmin) return true;
  if (isMine(trip, me)) return true;
  if (sharedDirect(trip, me)) return true;
  if (trip.soloPrivate) return false;
  if (!trip.familyId) {
    if (!trip.owner && !trip.ownerEmail) return true;
    if (trip.visibility === "all") return true;
    return false;
  }
  if (me.familyRoles.has(trip.familyId)) return true;
  const shareRole = me.sharesIn.get(trip.familyId);
  if (shareRole && !trip.hiddenFromShares) return true;
  if (trip.visibility === "all") return true;
  return false;
}

function floorOk(role, floor) {
  if (!role) return false;
  if (floor === "admin") return role === "admin";
  return role === "admin" || role === "editor";
}

function canEdit(trip, me, perm) {
  if (me.siteAdmin) return true;
  if (trip.soloPrivate) return isMine(trip, me);
  if (!trip.familyId) return isMine(trip, me);
  const myRole = me.familyRoles.get(trip.familyId);
  if (floorOk(myRole, (perm && perm.attachFloor) || "editor")) return true;
  const shareRole = me.sharesIn.get(trip.familyId);
  if (shareRole && trip.hiddenFromShares) return false;
  if (shareRole === "editor" || shareRole === "admin-no-delete") return true;
  return false;
}

const DEFAULT_TRIP_PERM = { editFloor: "editor", attachFloor: "editor", commentFloor: "editor", attachVisibleShared: true, memberDeleteAny: false, sharedCanDelete: false, itineraryEditableShared: false };
const ACTIVITY_BLOB = process.env.ACTIVITY_BLOB || "activity.json";
const ACTIVITY_MAX = 300;

async function logActivity(container, { type, familyId, visibleTo, actor, message }) {
  try {
    const blob = container.getBlockBlobClient(ACTIVITY_BLOB);
    let list = [];
    if (await blob.exists()) {
      try { list = JSON.parse(await streamToString((await blob.download()).readableStreamBody)); } catch (e) { list = []; }
    }
    if (!Array.isArray(list)) list = [];
    list.push({ id: "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), type, familyId: familyId || null, visibleTo: visibleTo || [], actor, message, createdAt: new Date().toISOString() });
    if (list.length > ACTIVITY_MAX) list = list.slice(list.length - ACTIVITY_MAX);
    const text = JSON.stringify(list, null, 2);
    await blob.upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "application/json" } });
  } catch (e) { /* best-effort */ }
}

async function loadPermByFamily(container) {
  const map = new Map();
  const approved = new Map();
  try {
    const familiesBlob = container.getBlockBlobClient(process.env.FAMILIES_BLOB || "families.json");
    if (await familiesBlob.exists()) {
      const list = JSON.parse(await streamToString((await familiesBlob.download()).readableStreamBody));
      (Array.isArray(list) ? list : []).forEach((f) => { map.set(f.id, { ...DEFAULT_TRIP_PERM, ...(f.permTrip || {}) }); approved.set(f.id, !!f.approved); });
    }
  } catch (e) { /* fail open */ }
  const permFor = (familyId) => (familyId && map.get(familyId)) || DEFAULT_TRIP_PERM;
  permFor.isApproved = (familyId) => !familyId || !approved.has(familyId) || approved.get(familyId);
  return permFor;
}

async function loadFamiliesAndMembers(container) {
  let families = [];
  let members = [];
  try {
    const familiesBlob = container.getBlockBlobClient(process.env.FAMILIES_BLOB || "families.json");
    if (await familiesBlob.exists()) families = JSON.parse(await streamToString((await familiesBlob.download()).readableStreamBody));
  } catch (e) { /* fail open */ }
  try {
    const membersBlob = container.getBlockBlobClient(MEMBERS_BLOB);
    if (await membersBlob.exists()) members = JSON.parse(await streamToString((await membersBlob.download()).readableStreamBody));
  } catch (e) { /* fail open */ }
  return { families: Array.isArray(families) ? families : [], members: Array.isArray(members) ? members : [] };
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
async function streamToBuffer(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

async function getContainer() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();
  return container;
}

async function enrichMe(container, me) {
  me.siteAdmin = isSiteAdmin(me.email);
  me.familyRoles = new Map();
  me.sharesIn = new Map();
  try {
    const membersBlob = container.getBlockBlobClient(MEMBERS_BLOB);
    if (await membersBlob.exists()) {
      const members = JSON.parse(await streamToString((await membersBlob.download()).readableStreamBody));
      if (Array.isArray(members)) {
        members.filter((m) => m && String(m.email || "").toLowerCase().trim() === me.email && m.active !== false)
          .forEach((m) => me.familyRoles.set(m.familyId, m.role));
      }
    }
    const sharesBlob = container.getBlockBlobClient(SHARES_BLOB);
    if (await sharesBlob.exists()) {
      const shares = JSON.parse(await streamToString((await sharesBlob.download()).readableStreamBody));
      const myFamilyIds = new Set(me.familyRoles.keys());
      if (Array.isArray(shares)) shares.filter((s) => s && myFamilyIds.has(s.toFamilyId)).forEach((s) => me.sharesIn.set(s.fromFamilyId, s.role));
    }
  } catch (e) { /* best-effort */ }
  return me;
}

async function readDataset(blob) {
  if (!(await blob.exists())) return { locations: [], settings: null };
  const text = await streamToString((await blob.download()).readableStreamBody);
  let data;
  try { data = JSON.parse(text); } catch (e) { return { locations: [], settings: null }; }
  if (Array.isArray(data)) return { locations: data, settings: null };
  return { locations: Array.isArray(data.locations) ? data.locations : [], settings: data.settings || null };
}
async function writeDataset(blob, locations, settings) {
  const payload = { app: "vacation-location", version: 1, locations };
  if (settings) payload.settings = settings;
  const text = JSON.stringify(payload, null, 2);
  await blob.upload(text, Buffer.byteLength(text), { blobHTTPHeaders: { blobContentType: "application/json" } });
}

function safeName(name) {
  return String(name || "file").replace(/[^\w.\- ]+/g, "_").slice(0, 140);
}
function newId() {
  return "att-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
}

module.exports = async function (context, req) {
  const json = (status, body) => {
    context.res = { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: body === undefined ? undefined : JSON.stringify(body) };
  };

  try {
    const me = principal(req);
    if (!me) { json(401, { error: "Sign in required." }); return; }

    const container = await getContainer();
    await enrichMe(container, me);
    const dataBlob = container.getBlockBlobClient(BLOB);
    const permFor = await loadPermByFamily(container);
    let auditDetailed = false;
    let emailKillSwitch = false;
    try {
      const settingsBlob = container.getBlockBlobClient("family-settings.json");
      if (await settingsBlob.exists()) {
        const fs = JSON.parse(await streamToString((await settingsBlob.download()).readableStreamBody));
        auditDetailed = fs.auditLevel === "detailed" || fs.auditLevel === "verbose";
        emailKillSwitch = !!fs.emailKillSwitch;
      }
    } catch (e) { /* fail open (no audit) */ }

    // ---- download (GET) ----
    if (req.method === "GET") {
      const rl = checkRateLimit("attach-dl:" + me.email, { max: 120, windowMs: 60000 });
      if (!rl.ok) { json(429, { error: "Too many requests, slow down." }); return; }

      const tripId = req.query && req.query.tripId;
      const attId = req.query && req.query.id;
      if (!tripId || !attId) { json(400, { error: "tripId and id are required." }); return; }
      const { locations } = await readDataset(dataBlob);
      const trip = locations.find((t) => String(t.id) === String(tripId));
      if (!trip) { json(404, { error: "Trip not found." }); return; }
      if (!canView(trip, me)) { json(403, { error: "No access to this trip." }); return; }
      if (trip.familyId && !me.siteAdmin && !isMine(trip, me) && !me.familyRoles.has(trip.familyId) && !permFor(trip.familyId).attachVisibleShared) {
        json(403, { error: "This family has kept attachments private." }); return;
      }
      const att = (trip.attachments || []).find((a) => a.id === attId);
      if (!att) { json(404, { error: "Attachment not found." }); return; }

      const blob = container.getBlockBlobClient(att.blobName);
      if (!(await blob.exists())) { json(404, { error: "File missing from storage." }); return; }
      const dl = await blob.download();
      const buf = await streamToBuffer(dl.readableStreamBody);
      context.res = {
        status: 200,
        headers: {
          "Content-Type": att.mimeType || "application/octet-stream",
          "Content-Disposition": 'attachment; filename="' + (att.name || "file").replace(/"/g, "") + '"',
          "Cache-Control": "private, max-age=0, no-cache",
        },
        isRaw: true,
        body: buf,
      };
      return;
    }

    if (req.method !== "POST") { json(405, { error: "Use GET, POST, or DELETE." }); return; }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { json(400, { error: "Invalid JSON" }); return; } }
    const action = (body && body.action) || "upload";

    // ---- delete ----
    if (action === "delete") {
      const rl = checkRateLimit("attach-del:" + me.email, { max: 40, windowMs: 60000 });
      if (!rl.ok) { json(429, { error: "Too many requests, slow down." }); return; }

      const { tripId, id } = body;
      if (!tripId || !id) { json(400, { error: "tripId and id are required." }); return; }
      const stored = await readDataset(dataBlob);
      const trip = stored.locations.find((t) => String(t.id) === String(tripId));
      if (!trip) { json(404, { error: "Trip not found." }); return; }
      const att = (trip.attachments || []).find((a) => a.id === id);
      if (!att) { json(404, { error: "Attachment not found." }); return; }
      const uploadedByMe = sameEmail(att.uploadedByEmail, me.email);
      if (!uploadedByMe && !canEdit(trip, me, permFor(trip.familyId))) { json(403, { error: "No permission to remove this attachment." }); return; }

      try { await container.getBlockBlobClient(att.blobName).deleteIfExists(); } catch (e) { /* best-effort */ }
      const updated = stored.locations.map((t) => t.id === trip.id ? { ...t, attachments: (t.attachments || []).filter((a) => a.id !== id) } : t);
      await writeDataset(dataBlob, updated, stored.settings);
      if (auditDetailed && trip.familyId) {
        const { families } = await loadFamiliesAndMembers(container);
        const fam = families.find((f) => f.id === trip.familyId);
        if (notifPrefOn(fam, "attachmentUploads", "bell")) {
          const place = [trip.city, trip.country].filter(Boolean).join(", ") || "a trip";
          await logActivity(container, { type: "deleteAttachment", familyId: trip.familyId, visibleTo: [trip.familyId], actor: me.email, message: "Removed attachment \"" + att.name + "\" from " + place });
        }
      }
      json(200, { ok: true });
      return;
    }

    // ---- upload ----
    {
      const rl = checkRateLimit("attach-up:" + me.email, { max: 20, windowMs: 60000 });
      if (!rl.ok) { json(429, { error: "Too many uploads, slow down and try again shortly." }); return; }

      const { tripId, filename, mimeType, dataBase64 } = body || {};
      if (!tripId || !filename || !dataBase64) { json(400, { error: "tripId, filename, and dataBase64 are required." }); return; }
      if (!ALLOWED_MIME.has(mimeType)) { json(400, { error: "Unsupported file type. Allowed: PDF, images, Word, Excel." }); return; }

      // Reject oversized payloads before decoding (base64 is ~4/3 the byte size).
      const approxBytes = Math.floor(dataBase64.length * 0.75);
      if (approxBytes > MAX_BYTES) { json(413, { error: "File too large. Max " + Math.round(MAX_BYTES / 1024 / 1024) + "MB." }); return; }

      const stored = await readDataset(dataBlob);
      const trip = stored.locations.find((t) => String(t.id) === String(tripId));
      if (!trip) { json(404, { error: "Trip not found." }); return; }
      if (!canEdit(trip, me, permFor(trip.familyId))) { json(403, { error: "No permission to add attachments to this trip." }); return; }
      if (trip.familyId && !me.siteAdmin && !permFor.isApproved(trip.familyId)) { json(403, { error: "This family is pending site-admin approval — attachments can't be added yet." }); return; }

      let buf;
      try { buf = Buffer.from(dataBase64, "base64"); } catch (e) { json(400, { error: "Invalid file data." }); return; }
      if (buf.length > MAX_BYTES) { json(413, { error: "File too large. Max " + Math.round(MAX_BYTES / 1024 / 1024) + "MB." }); return; }

      const id = newId();
      const cleanName = safeName(filename);
      const blobName = "attachments/" + tripId + "/" + id + "-" + cleanName;
      const blockBlob = container.getBlockBlobClient(blobName);
      await blockBlob.upload(buf, buf.length, { blobHTTPHeaders: { blobContentType: mimeType } });

      const record = {
        id, name: cleanName, mimeType, size: buf.length, blobName,
        uploadedBy: me.id, uploadedByEmail: me.email, uploadedAt: new Date().toISOString(),
      };
      const updated = stored.locations.map((t) => t.id === trip.id ? { ...t, attachments: [...(t.attachments || []), record] } : t);
      await writeDataset(dataBlob, updated, stored.settings);
      if (trip.familyId) {
        const { families, members } = await loadFamiliesAndMembers(container);
        const fam = families.find((f) => f.id === trip.familyId);
        const place = [trip.city, trip.country].filter(Boolean).join(", ") || "a trip";
        if (auditDetailed && notifPrefOn(fam, "attachmentUploads", "bell")) {
          await logActivity(container, { type: "uploadAttachment", familyId: trip.familyId, visibleTo: [trip.familyId], actor: me.email, message: "Added attachment \"" + cleanName + "\" to " + place });
        }
        if (fam && !emailKillSwitch && notifPrefOn(fam, "attachmentUploads", "email")) {
          const ownerEmail = (trip.ownerEmail || "").toLowerCase().trim();
          const actorEmail = (me.email || "").toLowerCase().trim();
          const to = new Set(familyAdminEmails(members, trip.familyId, me.email));
          if (ownerEmail && ownerEmail !== actorEmail) to.add(ownerEmail);
          sendEmail([...to], "New attachment \u2014 " + fam.name, me.email + " added \"" + cleanName + "\" to " + place + ".").catch(() => {});
        }
      }
      json(200, { ok: true, attachment: record });
      return;
    }
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
