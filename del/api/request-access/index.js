// Sends an access-request email via Resend when a visitor without access
// submits their email on the Trip Tracker sign-in screen, AND persists the
// request to blob storage so site admins can approve/decline it from the
// People & Family Management → Pending Actions pane (independent of whether
// email delivery is configured/working).
//
// Optional app settings (Static Web App → Settings → Environment variables):
//   RESEND_API_KEY     — your Resend API key (starts with "re_")
//   RESEND_FROM        — a VERIFIED Resend sender, e.g. "Trip Tracker <noreply@yourdomain.com>"
//   ACCESS_REQUEST_TO  — where email notifications are delivered (your email address)
//   AZURE_STORAGE_CONNECTION_STRING — required to persist the request for admin approval
//
// The recipient is taken ONLY from ACCESS_REQUEST_TO on the server — never from
// the request body — so this endpoint cannot be abused as an open mail relay.

const { BlobServiceClient } = require("@azure/storage-blob");
const { checkRateLimit } = require("../_shared/rateLimit");

const CONTAINER = process.env.TRIPS_CONTAINER || "data";
const ACCESS_REQUESTS_BLOB = process.env.ACCESS_REQUESTS_BLOB || "access-requests.json";

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

// Best-effort: records/refreshes a pending request. Never throws — a storage
// hiccup here shouldn't block the (separate) email notification.
async function recordPendingRequest(email, note) {
  try {
    const container = await getContainer();
    let list = await readJsonBlob(container, ACCESS_REQUESTS_BLOB, []);
    if (!Array.isArray(list)) list = [];
    const idx = list.findIndex((r) => r && String(r.email || "").toLowerCase() === email.toLowerCase());
    const row = { email: email.toLowerCase(), message: note || "", requestedAt: new Date().toISOString() };
    if (idx >= 0) list[idx] = { ...list[idx], ...row };
    else list.push(row);
    await writeJsonBlob(container, ACCESS_REQUESTS_BLOB, list);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = async function (context, req) {
  const json = (status, body) => {
    context.res = {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  };

  if (req.method !== "POST") { json(405, { error: "Use POST" }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const requester = (body && typeof body.email === "string" ? body.email : "").trim().slice(0, 200);
  const note = (body && typeof body.message === "string" ? body.message : "").trim().slice(0, 2000);

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(requester)) { json(400, { error: "A valid email is required." }); return; }

  // Rate-limited per requester email (not IP — anonymous route) so one address can't
  // spam the mailbox/admin queue by resubmitting.
  const rl = checkRateLimit("access-req:" + requester.toLowerCase(), { max: 5, windowMs: 10 * 60000 });
  if (!rl.ok) { json(429, { error: "Too many requests from this address — please wait a bit before trying again." }); return; }

  const persisted = await recordPendingRequest(requester, note);

  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const to = process.env.ACCESS_REQUEST_TO;
  if (!key || !from || !to) {
    // No email configured — if we at least persisted the request for admin
    // approval, tell the client it succeeded; otherwise fall back to mailto.
    if (persisted) { json(200, { ok: true, persisted: true }); return; }
    json(501, { error: "Email sending is not configured on the server." });
    return;
  }

  const subject = "Trip Tracker — access request from " + requester;
  const text =
    "A visitor requested access to Trip Tracker.\n\n" +
    "Email: " + requester + "\n" +
    (note ? ("Message:\n" + note + "\n\n") : "\n") +
    (persisted
      ? "Approve or decline this request from People & Family Management → Pending Actions in the app.\n"
      : "To grant access, add this address as a reader (view) or editor (edit) role in your identity provider.");

  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], reply_to: requester, subject, text }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      context.log.error("Resend error", r.status, detail);
      // Email failed, but if the request was persisted, the admin can still see
      // and approve it in-app — don't surface this as a hard failure.
      if (persisted) { json(200, { ok: true, persisted: true, emailFailed: true }); return; }
      let reason = "";
      try { reason = (JSON.parse(detail).message) || ""; } catch (e) { reason = (detail || "").slice(0, 300); }
      json(502, { error: "Email service rejected the request.", status: r.status, reason });
      return;
    }
    json(200, { ok: true, persisted });
  } catch (err) {
    context.log.error(err);
    if (persisted) { json(200, { ok: true, persisted: true, emailFailed: true }); return; }
    json(500, { error: String((err && err.message) || err) });
  }
};
