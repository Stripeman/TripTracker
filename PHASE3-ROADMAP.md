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
2. Itinerary / day-by-day notes.
3. Comments/discussion per trip.
4. Attachments (tickets, confirmations).

### 4. Public-facing polish
Landing page, terms/privacy, rate limiting — lower urgency since we're staying
invite-only for now, but flagged as a phase-3 interest.

### 5. Notifications
- Email when someone shares/invites your family.
- In-app activity feed / bell icon.
(Explicitly skipped: per-trip-edit emails, weekly digest.)

## Out of scope for now
- Weekly digest emails
- Revoke/audit log of shares (not requested this round)
- Public launch hardening (legal, rate limiting) — deferred until closer to real launch

---
*Update this doc as items ship — move completed entries into CHANGELOG.md and note here that they're done, or delete the line.*
