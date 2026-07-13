const { BlobServiceClient } = require("@azure/storage-blob");
const { checkRateLimit } = require("../_shared/rateLimit");
const { notifPrefOn, sendEmail, familyAdminEmails } = require("../_shared/notify");

// Reads/writes the Trip Tracker dataset to Blob Storage, with PER-USER access control.
//
// Each trip may carry:
//   owner       — stable user id of the creator (Azure clientPrincipal.userId)
//   ownerEmail  — creator's email, for display
//   visibility  — "private" (family + shared families, per hiddenFromShares) | "all" (any signed-in user)
//   hiddenFromShares — true hides it from families you've shared with (family itself still sees it)
//   soloPrivate — true hides it from EVERYONE but the owner (not even the owner's own family)
//   sharedWith  — array of emails ADDITIVELY granted access, on top of the above tier
// Trips with no `owner` are LEGACY (created before access control) and are treated as
// visible to everyone but editable by no one via normal saves (admins manage them via Import).
//
// App settings required on the Static Web App / Function:
//   AZURE_STORAGE_CONNECTION_STRING  — connection string of your storage account
// Optional:
//   TRIPS_CONTAINER (default "data")  TRIPS_BLOB (default "trip-tracker.json")

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const BLOB = process.env.TRIPS_BLOB || "trip-tracker.json";
const MEMBERS_BLOB = process.env.MEMBERSHIPS_BLOB || "memberships.json";
const ACTIVITY_BLOB = process.env.ACTIVITY_BLOB || "activity.json";
const ACTIVITY_MAX = 300;

// Best-effort audit log write — mirrors api/families' logActivity so trip-level
// events (create/edit/delete/comment) land in the same per-family Activity Log.
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
  } catch (e) { /* best-effort — never blocks the calling action */ }
}
const SHARES_BLOB = process.env.FAMILY_SHARES_BLOB || "family-shares.json";

function principal(req) {
  const header = req.headers["x-ms-client-principal"];
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    return {
      id: p.userId || "",
      email: (p.userDetails || "").toLowerCase(),
      roles: p.userRoles || [],
    };
  } catch (e) {
    return null;
  }
}

function sameEmail(a, b) {
  a = String(a || "").toLowerCase().trim();
  b = String(b || "").toLowerCase().trim();
  return !!a && a === b;
}

// A trip is "mine" if I created it (owner id) OR my email is its ownerEmail (assigned).
function isMine(trip, me) {
  return !!(trip && ((trip.owner && trip.owner === me.id) || sameEmail(trip.ownerEmail, me.email)));
}

// FAMILY-AWARE view/edit rules. `me.familyRoles` is a Map<familyId, 'admin'|'editor'|'reader'>
// built from that person's active memberships; `me.siteAdmin` is a bool; `me.sharesIn` is
// an array of { fromFamilyId, role } describing families that have shared THEIR trips
// with one of me's families ('reader' | 'editor' | 'admin-no-delete').
//
// Trips created before the family model has no `familyId` — those are treated exactly
// as before (visible to any signed-in user, editable only by their owner) so existing
// unmigrated deployments keep working until an admin runs the migration.
function sharedDirect(trip, me) {
  return Array.isArray(trip.sharedWith) && trip.sharedWith.map((s) => String(s).toLowerCase()).includes(me.email);
}

function canView(trip, me) {
  if (!trip) return false;
  if (me.siteAdmin) return true;
  if (isMine(trip, me)) return true;
  // `sharedWith` is an ADDITIVE grant — specific people named here can always see the
  // trip, regardless of its base visibility tier (even "only me").
  if (sharedDirect(trip, me)) return true;
  // "Only me" (soloPrivate) is a hard ceiling: nobody but the owner and explicit
  // invitees above sees it — not even the owner's own family.
  if (trip.soloPrivate) return false;
  if (!trip.familyId) {
    // legacy trip (pre-family) — old rules
    if (!trip.owner && !trip.ownerEmail) return true;
    if (trip.visibility === "all") return true;
    return false;
  }
  if (me.familyRoles.has(trip.familyId)) return true; // any role in the owning family sees it
  const shareRole = me.sharesIn.get(trip.familyId);
  // A family share grants visibility into that family's trips — UNLESS this specific
  // trip has been marked private-even-when-shared (a per-trip override so one family
  // can share broadly while still keeping a handful of trips out of it).
  if (shareRole && !trip.hiddenFromShares) return true;
  if (trip.visibility === "all") return true;
  return false;
}

// Normal saves may create/modify/delete trips in a family where I'm editor/admin, or
// trips I personally own (legacy path). Read-only family shares never grant edit.
function canEdit(trip, me, perm) {
  if (me.siteAdmin) return true;
  if (trip.soloPrivate) return isMine(trip, me); // truly-private trips: owner only, even for family editors
  if (!trip.familyId) return isMine(trip, me); // legacy path unchanged
  const myRole = me.familyRoles.get(trip.familyId);
  if (floorOk(myRole, (perm && perm.editFloor) || "editor")) return true;
  const shareRole = me.sharesIn.get(trip.familyId);
  if (shareRole && trip.hiddenFromShares) return false; // per-trip override also blocks edit via a share
  if (shareRole === "editor" || shareRole === "admin-no-delete") return true;
  return false;
}

// Delete is stricter than edit: only a family admin (not a shared "admin-no-delete"
// role, and not a plain editor) or the trip's own owner may delete it.
function canDelete(trip, me, perm) {
  if (me.siteAdmin) return true;
  if (trip.soloPrivate) return isMine(trip, me);
  if (!trip.familyId) return isMine(trip, me);
  const myRole = me.familyRoles.get(trip.familyId);
  if (myRole === "admin") return true;
  if (isMine(trip, me) && myRole === "editor") return true;
  if (perm && perm.memberDeleteAny && (myRole === "editor" || myRole === "reader")) return true;
  const shareRole = me.sharesIn.get(trip.familyId);
  if (perm && perm.sharedCanDelete && shareRole === "editor" && !trip.hiddenFromShares) return true;
  return false;
}

function floorOk(role, floor) {
  if (!role) return false;
  if (floor === "admin") return role === "admin";
  return role === "admin" || role === "editor";
}

const DEFAULT_TRIP_PERM = { editFloor: "editor", attachFloor: "editor", commentFloor: "editor", attachVisibleShared: true, memberDeleteAny: false, sharedCanDelete: false, itineraryEditableShared: false };

function sameExceptKeys(a, b, keys) {
  const strip = (o) => { const c = { ...(o || {}) }; keys.forEach((k) => delete c[k]); return c; };
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

async function getContainer() {
  const conn = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!conn) throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
  const svc = BlobServiceClient.fromConnectionString(conn);
  const container = svc.getContainerClient(CONTAINER);
  await container.createIfNotExists();
  return container;
}

function isSiteAdmin(email) {
  const list = String(process.env.SITE_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(email);
}

// Enriches `me` (from the SWA principal) with family-scoped info read fresh from
// memberships.json / family-shares.json: familyRoles (Map<familyId, role> for MY active
// memberships) and sharesIn (Map<familyId, role> — families that shared THEIR trips with
// one of my families). Cheap at this scale (two small JSON blobs).
async function enrichMe(container, me) {
  me.siteAdmin = isSiteAdmin(me.email);
  me.familyRoles = new Map();
  me.sharesIn = new Map();
  try {
    const membersBlob = container.getBlockBlobClient(MEMBERS_BLOB);
    if (await membersBlob.exists()) {
      const dl = await membersBlob.download();
      const text = await streamToString(dl.readableStreamBody);
      const members = JSON.parse(text);
      if (Array.isArray(members)) {
        members.filter((m) => m && String(m.email || "").toLowerCase().trim() === me.email && m.active !== false)
          .forEach((m) => me.familyRoles.set(m.familyId, m.role));
      }
    }
    const sharesBlob = container.getBlockBlobClient(SHARES_BLOB);
    if (await sharesBlob.exists()) {
      const dl = await sharesBlob.download();
      const text = await streamToString(dl.readableStreamBody);
      const shares = JSON.parse(text);
      const myFamilyIds = new Set(me.familyRoles.keys());
      if (Array.isArray(shares)) {
        shares.filter((s) => s && myFamilyIds.has(s.toFamilyId)).forEach((s) => me.sharesIn.set(s.fromFamilyId, s.role));
      }
    }
  } catch (e) { /* best-effort — missing blobs just mean no family scoping yet */ }
  return me;
}

async function streamToString(readable) {
  const chunks = [];
  for await (const chunk of readable) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function readDataset(blob) {
  if (!(await blob.exists())) return { locations: [], settings: null };
  const dl = await blob.download();
  const text = await streamToString(dl.readableStreamBody);
  let data;
  try { data = JSON.parse(text); } catch (e) { return { locations: [], settings: null }; }
  if (Array.isArray(data)) return { locations: data, settings: null };
  return { locations: Array.isArray(data.locations) ? data.locations : [], settings: data.settings || null };
}

async function writeDataset(blob, locations, settings) {
  const payload = { app: "vacation-location", version: 1, locations };
  if (settings) payload.settings = settings;
  const text = JSON.stringify(payload, null, 2);
  await blob.upload(text, Buffer.byteLength(text), {
    blobHTTPHeaders: { blobContentType: "application/json" },
  });
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
    // The SWA routes already require a role, so a principal should always be present.
    if (!me) { json(401, { error: "Sign in required." }); return; }

    // Basic per-user rate limiting — generous enough for normal use (autosave, tab
    // focus refresh), tight enough to blunt a runaway retry loop or scripted abuse.
    const rlLimits = req.method === "GET" ? { max: 90, windowMs: 60000 } : { max: 30, windowMs: 60000 };
    const rl = checkRateLimit("trips:" + req.method + ":" + me.email, rlLimits);
    if (!rl.ok) { json(429, { error: "Too many requests, slow down and try again shortly." }); return; }

    const container = await getContainer();
    await enrichMe(container, me);
    const blob = container.getBlockBlobClient(BLOB);

    // Effective image-uploads permission per family: a family's own `imagesEnabled`
    // (true/false) overrides the site-wide default; unset inherits the site default.
    // Best-effort / fail-open — if either blob is unreadable, uploads stay allowed.
    let imagesAllowedByFamily = new Map();
    let permByFamily = new Map();
    let approvedByFamily = new Map();
    let familyById = new Map();
    let siteImagesOn = true;
    let sitePublicSharingOn = true;
    let auditLevel = "essential";
    let emailKillSwitch = false;
    try {
      const settingsBlob = container.getBlockBlobClient("family-settings.json");
      if (await settingsBlob.exists()) {
        const dl = await settingsBlob.download();
        const fs = JSON.parse(await streamToString(dl.readableStreamBody));
        siteImagesOn = fs.imageUploadsEnabled !== false;
        sitePublicSharingOn = fs.publicSharingEnabled !== false;
        auditLevel = ["essential", "detailed", "verbose"].includes(fs.auditLevel) ? fs.auditLevel : "essential";
        emailKillSwitch = !!fs.emailKillSwitch;
      }
      const familiesBlob = container.getBlockBlobClient(process.env.FAMILIES_BLOB || "families.json");
      if (await familiesBlob.exists()) {
        const dl = await familiesBlob.download();
        const list = JSON.parse(await streamToString(dl.readableStreamBody));
        (Array.isArray(list) ? list : []).forEach((f) => {
          imagesAllowedByFamily.set(f.id, f.imagesEnabled === undefined || f.imagesEnabled === null ? siteImagesOn : !!f.imagesEnabled);
          permByFamily.set(f.id, { ...DEFAULT_TRIP_PERM, ...(f.permTrip || {}) });
          approvedByFamily.set(f.id, !!f.approved);
          familyById.set(f.id, f);
        });
      }
    } catch (e) { /* fail open */ }
    const permFor = (familyId) => (familyId && permByFamily.get(familyId)) || DEFAULT_TRIP_PERM;
    const auditDetailed = auditLevel === "detailed" || auditLevel === "verbose";
    const imagesAllowed = (familyId) => familyId && imagesAllowedByFamily.has(familyId) ? imagesAllowedByFamily.get(familyId) : siteImagesOn;
    const stripImagesIfBlocked = (t) => {
      if (imagesAllowed(t.familyId)) return t;
      if (!t.photo && !(Array.isArray(t.gallery) && t.gallery.length)) return t;
      const { photo, gallery, ...rest } = t;
      return { ...rest, gallery: [] };
    };

    if (req.method === "GET") {
      const { locations, settings } = await readDataset(blob);
      const viewTrip = (t) => (t.visibility === "all" && !sitePublicSharingOn) ? { ...t, visibility: "private" } : t;
      const stripAttachmentsIfHidden = (t) => {
        if (!t.familyId || !Array.isArray(t.attachments) || !t.attachments.length) return t;
        if (me.siteAdmin || isMine(t, me) || me.familyRoles.has(t.familyId)) return t; // owning-family always sees them
        if (permFor(t.familyId).attachVisibleShared) return t;
        return { ...t, attachments: [] };
      };
      const visible = locations.filter((t) => canView(viewTrip(t), me)).map(stripAttachmentsIfHidden);
      json(200, {
        app: "vacation-location",
        version: 1,
        locations: visible,
        settings: settings || undefined,
        me: { id: me.id, email: me.email, roles: me.roles, siteAdmin: me.siteAdmin, familyRoles: Object.fromEntries(me.familyRoles) },
        total: locations.length,
        visible: visible.length,
      });
      return;
    }

    // ---- writes ----
    let payload = req.body;
    if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch (e) { json(400, { error: "Invalid JSON" }); return; } }
    if (!payload || !Array.isArray(payload.locations)) { json(400, { error: "Expected { locations: [...] }" }); return; }

    const mode = (req.query && req.query.mode) || "";

    // Admin-only single/bulk owner assignment — used by the Trip Management tab. Sets
    // ownerEmail on the targeted trips in the STORED dataset (never touches other trips,
    // so it's safe even though the admin's own GET is filtered). Body:
    //   { ownerEmail, ids: [...] }  → assign those trip ids
    //   { ownerEmail }              → assign ALL currently-unassigned (no ownerEmail) trips
    if (mode === "assign") {
      if (!me.roles.includes("admin")) { json(403, { error: "Admin role required to assign owners." }); return; }
      const em = String(payload.ownerEmail || "").toLowerCase().trim();
      const ids = Array.isArray(payload.ids) ? payload.ids : (payload.id != null ? [payload.id] : null);
      const stored = await readDataset(blob);
      let n = 0;
      const out = stored.locations.map((t) => {
        const target = ids ? ids.indexOf(t.id) !== -1 : !t.ownerEmail;
        if (target) { n++; return { ...t, ownerEmail: em }; }
        return t;
      });
      await writeDataset(blob, out, stored.settings);
      json(200, { ok: true, mode: "assign", assigned: n, ownerEmail: em });
      return;
    }

    // Admin-only delete-user — removes a person's footprint across ALL trips safely.
    // Body: { email, key, deleteTrips }
    //   deleteTrips:true  → delete every trip owned by this email
    //   deleteTrips:false → keep those trips but unassign them (owner cleared)
    //   always            → strip this person's traveler key from every trip (disassociate)
    if (mode === "deleteUser") {
      if (!me.roles.includes("admin")) { json(403, { error: "Admin role required to delete a user." }); return; }
      const em = String(payload.email || "").toLowerCase().trim();
      const key = payload.key || "";
      const deleteTrips = !!payload.deleteTrips;
      const stored = await readDataset(blob);
      let out = stored.locations;
      if (deleteTrips && em) out = out.filter((t) => String(t.ownerEmail || "").toLowerCase().trim() !== em);
      out = out.map((t) => {
        let n = t;
        if (key && Array.isArray(t.travelers) && t.travelers.indexOf(key) !== -1) n = { ...n, travelers: t.travelers.filter((k) => k !== key) };
        if (em && String((n.ownerEmail || "")).toLowerCase().trim() === em) n = { ...n, ownerEmail: "", owner: "" };
        return n;
      });
      await writeDataset(blob, out, stored.settings);
      json(200, { ok: true, mode: "deleteUser", remaining: out.length });
      return;
    }

    // Admin-only full replace — used by Import and Clear data.
    if (mode === "replace") {
      if (!me.roles.includes("admin")) { json(403, { error: "Admin role required to replace all data." }); return; }
      await writeDataset(blob, payload.locations, payload.settings || null);
      json(200, { ok: true, mode: "replace", count: payload.locations.length });
      return;
    }

    // Normal save: reconcile the caller's working set against stored data so a user
    // can only ever add/change/delete trips they OWN. Everything else is preserved.
    const stored = await readDataset(blob);
    const storedById = new Map(stored.locations.map((t) => [t.id, t]));
    const result = [];

    // Reconcile the caller's working set against stored data:
    //  - trips they OWN  → updated from payload (or deleted if omitted)
    //  - other people's  → always kept untouched
    //  - LEGACY (no owner): if the payload version carries owner==me.id the caller is
    //    CLAIMING + editing it (stamp owner/ownerEmail, save all props); otherwise keep
    //    the stored copy unchanged (legacy trips are never auto-dropped by a normal save).
    const incomingById = new Map(payload.locations.map((t) => [t.id, t]));

    const normalize = (t, owner, ownerEmail) => {
      let visibility = t.visibility;
      if (["private", "shared", "all"].indexOf(visibility) === -1) visibility = "private";
      if (visibility === "shared") visibility = "private"; // legacy tier folded into the additive sharedWith model
      if (visibility === "all" && !sitePublicSharingOn) visibility = "private"; // site admin disabled public sharing
      const sharedWith = Array.isArray(t.sharedWith)
        ? t.sharedWith.map((s) => String(s).trim().toLowerCase()).filter(Boolean)
        : [];
      return stripImagesIfBlocked({ ...t, owner, ownerEmail, visibility, sharedWith, hiddenFromShares: !!t.hiddenFromShares, soloPrivate: !!t.soloPrivate });
    };

    for (const s of stored.locations) {
      const perm = permFor(s.familyId);
      const incoming = incomingById.get(s.id);
      const editable = s.familyId ? canEdit(s, me, perm) : isMine(s, me);
      const deletable = s.familyId ? canDelete(s, me, perm) : isMine(s, me);
      const place = () => [s.city, s.country].filter(Boolean).join(", ") || "a trip";
      if (s.familyId || s.owner || s.ownerEmail) {
        if (editable) {
          if (incoming) {
            if (auditDetailed && s.familyId && !sameExceptKeys(incoming, s, []) && notifPrefOn(familyById.get(s.familyId), "tripEdits", "bell")) {
              await logActivity(container, { type: "editTrip", familyId: s.familyId, visibleTo: [s.familyId], actor: me.email, message: me.email + " edited " + place() });
            }
            result.push(normalize(incoming, s.owner || me.id, s.ownerEmail || me.email));
          } else if (!deletable) result.push(s); // editor without delete rights can't drop it by omission
          else if (auditDetailed && s.familyId && notifPrefOn(familyById.get(s.familyId), "tripDeletes", "bell")) {
            await logActivity(container, { type: "deleteTrip", familyId: s.familyId, visibleTo: [s.familyId], actor: me.email, message: me.email + " deleted " + place() });
          }
          // else: omitted by someone with delete rights → deleted
        } else if (incoming && s.familyId && canView(s, me)) {
          // Narrow carve-outs for people without full edit rights on this trip:
          // commenting (gated by the owning family's comment floor for their own
          // members; always allowed for shared/other viewers) and itinerary edits
          // (only for shared-family viewers, only if this family opted them in).
          const iAmFamilyMember = me.familyRoles.has(s.familyId);
          const commentOk = !iAmFamilyMember || floorOk(me.familyRoles.get(s.familyId), perm.commentFloor);
          const shareRole = me.sharesIn.get(s.familyId);
          const itineraryOk = !iAmFamilyMember && perm.itineraryEditableShared && !!shareRole && !s.hiddenFromShares;
          if (commentOk && sameExceptKeys(incoming, s, ["comments"])) {
            if (auditDetailed && Array.isArray(incoming.comments) && incoming.comments.length > (s.comments || []).length && notifPrefOn(familyById.get(s.familyId), "comments", "bell")) {
              await logActivity(container, { type: "comment", familyId: s.familyId, visibleTo: [s.familyId], actor: me.email, message: me.email + " commented on " + place() });
            }
            result.push({ ...s, comments: incoming.comments });
          } else if (itineraryOk && sameExceptKeys(incoming, s, ["itinerary"])) {
            if (auditDetailed) {
              await logActivity(container, { type: "editItinerary", familyId: s.familyId, visibleTo: [s.familyId], actor: me.email, message: me.email + " edited the itinerary for " + place() });
            }
            result.push({ ...s, itinerary: incoming.itinerary });
          } else {
            result.push(s); // no edit rights — untouchable
          }
        } else {
          result.push(s);                                  // no edit rights — untouchable
        }
      } else {
        // legacy / unassigned
        if (incoming && isMine(incoming, me)) {
          result.push(normalize(incoming, me.id, me.email)); // claim + edit
        } else {
          result.push(s);                                  // keep legacy as-is
        }
      }
    }
    // brand-new trips the caller created this session — stamp their active family
    // (first family where they're editor/admin) if the client didn't already set one.
    const myEditableFamilyId = [...me.familyRoles.entries()].find(([, r]) => r === "admin" || r === "editor");
    for (const t of payload.locations) {
      if (storedById.has(t.id)) continue;
      const withFamily = t.familyId ? t : (myEditableFamilyId ? { ...t, familyId: myEditableFamilyId[0] } : t);
      // A family pending site-admin approval can't add new trips yet (site admin bypasses).
      if (withFamily.familyId && !me.siteAdmin && approvedByFamily.has(withFamily.familyId) && !approvedByFamily.get(withFamily.familyId)) {
        json(403, { error: "This family is pending site-admin approval — trips can't be added yet." });
        return;
      }
      if (auditDetailed && withFamily.familyId && notifPrefOn(familyById.get(withFamily.familyId), "tripAdds", "bell")) {
        const place = [t.city, t.country].filter(Boolean).join(", ") || "a trip";
        await logActivity(container, { type: "createTrip", familyId: withFamily.familyId, visibleTo: [withFamily.familyId], actor: me.email, message: me.email + " added " + place });
      }
      if (withFamily.familyId) {
        const fam = familyById.get(withFamily.familyId);
        if (fam && !emailKillSwitch && notifPrefOn(fam, "tripAdds", "email")) {
          const place = [t.city, t.country].filter(Boolean).join(", ") || "a trip";
          try {
            const membersBlob2 = container.getBlockBlobClient(MEMBERS_BLOB);
            const memberList = (await membersBlob2.exists()) ? JSON.parse(await streamToString((await membersBlob2.download()).readableStreamBody)) : [];
            const to = familyAdminEmails(memberList, withFamily.familyId, me.email);
            sendEmail(to, "New trip added \u2014 " + fam.name, me.email + " added " + place + " to " + fam.name + ".").catch(() => {});
          } catch (e) { /* best-effort */ }
        }
      }
      result.push(normalize(withFamily, t.owner || me.id, t.ownerEmail || me.email));
    }

    const settings = payload.settings || stored.settings || null;
    await writeDataset(blob, result, settings);
    json(200, { ok: true, count: result.length });
  } catch (err) {
    context.log.error(err);
    json(500, { error: String((err && err.message) || err) });
  }
};
