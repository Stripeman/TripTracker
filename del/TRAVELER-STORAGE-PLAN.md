# Plan: move traveler storage to per-family, server-enforced

## Status

- ✅ **Backend foundation shipped** (`api/families/index.js`): `travelers.json` blob,
  keyed by `key` (the SAME identifier trips already reference in `location.travelers[]`
  — preserved verbatim through migration, so cutting storage over never breaks existing
  trip tags). `addTraveler` / `updateTraveler` / `moveTraveler` / `deleteTraveler`
  actions (all family-admin gated), and `GET` returns a scoped `travelers` array plus a
  `travelersMigrated` flag (true once the blob has been created at all, even if empty —
  lets the frontend tell "not migrated yet" apart from "migrated, zero travelers").
- ✅ **`deleteTraveler` is now trip-usage-guarded server-side** (checks the trips blob
  for any location still tagging that key before allowing the delete) — closes the gap
  flagged in the previous status.
- ✅ **Migration action** (`migrateTravelers`, site admin only): copies
  `settings.travelers` into `travelers.json`, preserving each row's original `key`.
  Idempotent — skips rows already migrated (matched by `key`).
- ✅ **Frontend cutover shipped.** `loadFamilies()` now sets `cfgTravelers` straight from
  the server travelers list once `travelersMigrated` is true (dual-read: before that,
  it leaves whatever came from `settings.travelers` alone — zero behavior change for
  an unmigrated deployment). Every mutation path branches on
  `this.state.travelersMigrated`:
  - `addPerson`/`addPersonDone` — local optimistic row, committed via `addTraveler` on
    the "Add" click; rolled back locally (no server call) if the request fails.
  - `donePerson` (edit save) — commits the current label/color/email via
    `updateTraveler`.
  - `cancelPerson` — nothing was ever committed server-side (commit happens on Save),
    so cancelling is a pure local revert.
  - `personSetFamily` — calls `moveTraveler` in addition to the existing `assignFamily`
    membership sync.
  - `personSetParent` — commits via `updateTraveler` immediately (it's a discrete
    dropdown pick, not free typing).
  - `personRemove` — calls `deleteTraveler`; a request that was never saved (Add →
    Cancel) skips the network call entirely.
  - `confirmUserDelete` (the "Delete user…" impact-confirm flow) — also calls
    `deleteTraveler` alongside its existing `/api/trips?mode=deleteUser` call.
  - `editPerson`'s synthetic-`acct:`-row materialization (a signed-in account with no
    traveler row yet) now creates the real row via `addTraveler` instead of a local-only
    write.
  - Free typing in the label/color/email fields stays pure local state either way (no
    per-keystroke network calls) — only the explicit Save/Add commits.
  - Site Management → Site Family Management shows a live **migrated / not migrated**
    badge next to the backfill button.
- ⬜ **Known rough edges, deliberately deferred:**
  - `settings.travelers` (in the trips blob) still exists and is still written
    incidentally by the generic settings-save pipeline (`dataItemLabel/Color/Email` →
    `persistConfigNoBump` → eventual settings save) — it's just never read from once
    migrated. Harmless dead weight until a later release drops the field entirely.
  - Editing the **raw settings debug JSON**'s `travelers` array still works, but on a
    migrated deployment the next `loadFamilies()` refresh (periodic + on tab focus)
    will overwrite it back to server truth — an import/raw-edit of that one field is
    effectively a no-op once migrated. Not fixed; a niche admin power-tool path.
  - `setTravelerRole`/`setTravelerActive` were intentionally never added — role/active
    stay a membership concept (`invitePerson`/`assignFamily`), unchanged by this cutover.

## Where things stand today (after the interim fixes)

- Travelers still live in one place: `settings.travelers`, inside the single global
  trips blob written by `/api/trips`. There is no per-family partition server-side.
- As of the last round of fixes, each traveler now carries a **client-set `familyId`**
  tag (defaulted on creation, editable via the new FAMILY picker in the Users tab).
  This is real progress — it's the field the server-side model will key off — but it is
  **not enforced**. Anyone who can save settings at all (any `editor`) can still write
  any `familyId` value into any row, or omit it, via a raw API call.
- Family membership/role (`families.json`, `members.json`, `shares.json` via
  `/api/families`) is already correctly server-partitioned and gated per-family. That
  pattern is the template to copy.

## Target model

- New blob, `travelers.json`, holding every traveler row `{ id, familyId, label, color,
  email, createdBy, createdAt }` — same shape as today's `cfgTravelers` items plus a
  required `familyId`. Lives in `api/families` (or a small new `api/travelers`
  function) alongside `families.json`/`members.json`.
- `settings.travelers` is dropped once migration completes; `settings` keeps only
  visit/trip/status type lists (which are genuinely global, not family-scoped).

## API changes

Add to `api/families/index.js` (mirrors the existing `setFamilyColor`/`rename` gate
style):
- ✅ `GET` — returns `travelers`, scoped the same way as `families`/`memberships`.
- ✅ `addTraveler` `{ familyId, label, color, email? }` — gated to
  `meIsSiteAdmin || myAdminFamilyIds.has(familyId)`.
- ✅ `updateTraveler` `{ id, patch }` — same gate, keyed off the row's *current*
  `familyId`.
- ✅ `moveTraveler` `{ id, familyId }` — gated to admin of the **target** family (site
  admin bypasses), same rule as the existing `assignFamily` action.
- ✅ `deleteTraveler` `{ id }` — same admin gate. **Remaining:** doesn't yet re-check
  "used on a trip" / "last active admin" — those guards live client-side today
  (`personUsedOnTrip`, `isLastActiveAdmin`) and need to move server-side before this
  action is safe to wire up to the UI's delete button.
- ⬜ `setTravelerRole` / `setTravelerActive` — not added; these concepts already live on
  the membership row (`invitePerson`/`assignFamily` set role+active there). Once the
  frontend cuts over, decide whether "role" stays purely a membership concept (likely)
  or needs denormalizing onto the traveler row for display speed.

`api/trips` is untouched — trips already carry `familyId` and are already gated
correctly.

## Migration step ✅ shipped

Site-admin-triggered via **Site Administration → "Backfill travelers → per-family
storage"** (same pattern as "Migrate legacy data → default family"):
1. Reads `settings.travelers`.
2. For each row: email holders get their membership's `familyId`; name-only rows get
   their `createdBy`'s `familyId`; anything left over falls back to the first family.
3. Writes the resolved rows into `travelers.json` (skips rows already migrated, matched
   by a deterministic `trav-legacy-<oldKey>` id — safe to click more than once).
   Does **not** touch `settings.travelers` — that stays the live source until the
   frontend cutover below.

## Frontend changes

- `cfgTravelers` stops being read out of `settings` and instead comes from the new
  `GET` payload (fits naturally next to `cfgFamilies`/`cfgMemberships`, loaded by
  `loadFamilies()`).
- `dataItemLabel/Color/Email`, `personSetRole/Active/Remove`, `personSetFamily`,
  `personSetParent`, `addPerson` all switch from `setState({cfgTravelers...}) +
  persistConfig` to calling the new API actions (optimistic local update + server call,
  same pattern already used for family rename/color/logo).
- The Users tab's visibility/admin-gating logic (family scoping, grouping,
  `familyPickOptions`) stays almost exactly as it is today — it was written against
  `familyId` already, so it mostly just stops needing a client-side fallback guess.
- Bulk-edit owner picker, trip traveler-tag picker, and metrics all read `cfgTravelers`
  by reference already, so they shouldn't need changes beyond the data source swap.

## Risk / sequencing notes

- This *is* the change that finally closes the gap I flagged earlier: today's fix
  scopes the UI and gates the picker, but a raw API call can still write any
  `familyId` — real enforcement only lands once `addTraveler`/`updateTraveler`/
  `moveTraveler` exist and `/api/trips` stops accepting `settings.travelers` writes.
- Rollout order to avoid downtime: ship the new blob + API actions and have the
  frontend read from both sources for one release (new blob wins if present, else fall
  back to `settings.travelers`) → run the migration → flip writes to the new API only →
  remove the fallback and drop `travelers` from `settings` in a following release.
- No user-facing behavior changes if done right — the Users tab already looks and
  behaves the way it will after migration; this is purely moving the source of truth
  and adding the server-side lock the UI can't provide on its own.
