// Small shared helper for best-effort courtesy emails via Resend, used by the
// per-family notification toggles (Notifications tab in My Families). Every
// call here is fire-and-forget — the action it's attached to has already
// succeeded via the data write; email delivery never blocks or fails a request.

// True unless the family has explicitly turned this notification channel off.
// fam.notifPrefs is undefined by default (all on) for families created before
// this feature existed; each key maps to { toast, bell, email }, and any missing
// sub-key also defaults to on. channel is "toast" | "bell" | "email".
function notifPrefOn(fam, key, channel) {
  if (!fam || !fam.notifPrefs || !fam.notifPrefs[key]) return true;
  return fam.notifPrefs[key][channel] !== false;
}

// Sends one email to a list of addresses. No-ops silently if Resend isn't
// configured, if there are no recipients, or if the send throws.
async function sendEmail(to, subject, text) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM;
  const list = (to || []).filter(Boolean);
  if (!key || !from || !list.length) return;
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: list, subject, text }),
    });
  } catch (e) { /* best-effort only */ }
}

// Email addresses of a family's active admins (typically the audience for
// "something happened in your family" notifications), optionally excluding
// the person who caused the event so they don't get notified of their own action.
function familyAdminEmails(members, familyId, excludeEmail) {
  const ex = (excludeEmail || "").toLowerCase().trim();
  return (members || [])
    .filter((m) => m.familyId === familyId && m.role === "admin" && m.active !== false && m.email && m.email.toLowerCase().trim() !== ex)
    .map((m) => m.email);
}

module.exports = { notifPrefOn, sendEmail, familyAdminEmails };
