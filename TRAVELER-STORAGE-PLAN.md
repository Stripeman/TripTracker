# Plan: move traveler storage to per-family, server-enforced

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
- `GET` (already returns `families`/`memberships`/`shares` scoped to caller) — add
  `travelers`, filtered the same way: site admin gets all, everyone else gets rows
  whose `familyId` is in their `myFamilyIds`.
- `addTraveler` `{ familyId, label, color, email? }` — requires
  `meIsSiteAdmin || myAdminFamilyIds.has(familyId)`.
- `updateTraveler` `{ id, patch }` — same gate, keyed off the row's *current*
  `familyId`.
- `moveTraveler` `{ id, familyId }` — requires admin of **both** the source and target
  family (site admin bypasses); this is the server-side version of the client's
  `personSetFamily`/`assignFamily` pair, unified into one call instead of two.
- `deleteTraveler` `{ id }` — same admin gate; keep the existing "used on a trip" /
  "last active admin" guards, just re-homed here.
- `setTravelerRole` / `setTravelerActive` — same shape as today's `personSetRole`/
  `personSetActive`, just validated against `myAdminFamilyIds` server-side instead of
  trusting the client.

`api/trips` is untouched — trips already carry `familyId` and are already gated
correctly.

## Migration step

One-time, admin-triggered (same pattern as "Migrate legacy data → default family"):
1. Read `settings.travelers`.
2. For each row: if it already has a `familyId`, keep it. Otherwise resolve one —
   email holders get their membership's `familyId`; name-only rows get their
   `createdBy`'s `familyId`; anything left over goes to the legacy/default family.
3. Write the resolved rows to the new `travelers.json`, drop `travelers` from
   `settings`, bump a migration-version flag so it only runs once.

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
