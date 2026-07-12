# Phase 3 Roadmap — Multi Family Trip Tracker

Captured from the phase-3 planning questionnaire. Not yet started unless noted in CHANGELOG.md.

## Scope for this phase

Public readiness: staying invite-only (just you + invited families) for now — no rush on
legal/rate-limit/launch-hardening work. Target scale: ~320 families comfortably.

## Priorities (in the order raised)

### 1. Cross-family sharing UX
Shares already exist server-side (invite a family, grant read/edit/admin, never delete)
but the UX around them is bare-bones. Needed:
- ✅ **DONE (1.10.0-beta)** — A view of **"families who can see us"** vs **"families we
  can see"** — two-sided visibility, not just a flat share list.
- ✅ **DONE (1.10.0-beta)** — **Per-trip visibility overrides** — a per-trip "keep
  private even from shares" checkbox, enforced server-side.

### 2. Mobile / responsive polish
No specifics given yet — general pass across the app (left panel, forms, modals,
metrics) for small screens.
- ✅ **DONE (1.10.1-beta)** — left panel, form, config panel, detail card, and metrics
  already had a ≤720px treatment; the People & Family Management modal (sidebar+detail
  split) was the one gap, now fixed. All other modals were already responsive.

### 3. Richer trip content
In priority order:
1. ✅ **DONE (1.11.0-beta)** — Multiple photos per trip (gallery), with a lightbox
   viewer on the detail card. Cover photo stays the card thumbnail; gallery photos
   are extra.
2. ✅ **DONE (1.12.0-beta)** — Itinerary / day-by-day notes, with a per-day note
   field on the form (auto-generated from the trip's date range) and a read-only
   itinerary viewer on the detail card.
3. ✅ **DONE (unreleased)** — Comments/discussion per trip.
4. ✅ **DONE (unreleased)** — Attachments (tickets, confirmations) — PDF/image/Word/Excel up to
   25MB, stored in Blob Storage, gated by the same view/edit rules as trips.

### 4. Public-facing polish
- ✅ **DONE (unreleased)** — Landing page (`Landing Page.dc.html`, two options) and a
  draft Terms of Service (`Terms.dc.html` — placeholders for entity name/contact/
  jurisdiction still need filling in before real use).
- ✅ **DONE (unreleased)** — Basic per-user API rate limiting on `/api/trips`,
  `/api/attachments`, `/api/request-access` (in-memory, per-instance — not a hard
  guarantee at scale, but blunts retry storms/casual abuse).
- ⬜ Privacy Policy page — not written yet.

### 5. Notifications
- ✅ **DONE (unreleased)** — Email when someone shares/invites your family (Resend;
  covers person-invite courtesy emails, access-approval emails, and now whole-family
  share notifications to the receiving family's admins).
- ✅ **DONE (unreleased)** — In-app activity feed / bell icon — header bell shows a
  dot for unseen events, dropdown lists recent invites/shares/approvals.
(Explicitly skipped: per-trip-edit emails, weekly digest.)

## Out of scope for now
- Weekly digest emails
- Revoke/audit log of shares (not requested this round)
- Public launch hardening (legal, rate limiting) — deferred until closer to real launch

---
*Update this doc as items ship — move completed entries into CHANGELOG.md and note here that they're done, or delete the line.*
