# Changelog

All notable changes to **Multi Family Trip Tracker** are recorded here. The newest release is at the top.

---

## 1.8.3-beta

### Bug
- **Cross-family privilege escalation via the legacy global role claim.** `cloudRoles`
  (`reader`/`editor`/`admin`) is the ceiling role across ALL of a user's family
  memberships — so anyone who is admin of even their own self-created solo family got a
  global `admin` claim. Several actions still gated on that legacy claim instead of a
  per-family check, letting any family admin reach across every other family's data:
  bulk-edit / bulk-reassign-owner (`bulkTargets`/`applyBulk`), claim-all-unowned-trips,
  site-wide login-stats/analytics export, and `personRemove`. All now require true site
  admin status or admin membership in the specific family being acted on.

### Cleaned up
- Deleted ~474 lines of dead template: a pre-redesign "Config" settings tab (the old
  People/Families UI) that no button could reach anymore, plus its orphaned renderVals
  entries.
- Deleted `api-mftt/`, a stale duplicate of `api/` missing recent actions and unused by
  the deployed app.

## 1.8.2-beta

### Fixed
- **Online presence could show a person's email instead of their name.** The stored
  heartbeat name lags behind (it's whatever that person's browser knew before their
  traveler record existed). The presence chip now always resolves the display name from
  the current viewer's own traveler list, self-correcting immediately regardless of the
  other person's session timing.

## 1.8.1-beta

### Changed
- **People & Family Management nav restructured.** "Site User Management" and "Site
  Family Mgmt" (renamed "Site Family Management") are no longer separate top-level
  items — they're now two sub-tabs under a single **"Site Management"** entry
  (site-admin only). "Families" is renamed **"My Family Management"**. Non-site-admin
  family admins no longer see a standalone Site User Management tab — they manage their
  own family's people from My Family Management → their family's detail panel, which
  already shows the same rich people list scoped to that family.

## 1.8.0-beta

### Fixed
- **Signed-in accounts with no traveler record were invisible in Site User Management**
  (even to site admins) — e.g. a brand-new user who'd only ever signed in. Any active
  membership without a matching traveler entry is now synthesized into the list
  automatically.
- **Metrics ignored families you had real access to.** "All families I have access to"
  now includes families shared with you via FamilyShare, not just direct memberships.
- **Metrics was silently tied to the left panel's selected family** — switching the
  left-panel family changed (or broke) the metrics default. Metrics now computes a
  stable "home family" independent of `activeFamilyId`.
- **Role/active status could show the wrong value** when a person belonged to a family
  other than the one selected in the left panel — role/active is now resolved per-row
  against that row's own family membership, not a flat map keyed to the active family.
- **Anyone who could see a person could rename them.** The Edit button is now gated to
  site admins, that person's family admin, or the person themselves.

### Added
- **Rename (alias) any user** you administer — family admins for their own families,
  site admins for anyone. Editing a synthesized account-only row now creates a real
  traveler record for it automatically so the rename has somewhere to save.
- **Site User Management renamed** from "Users", with a family-scope dropdown (same
  pattern as Trip Metrics) — site admins can filter to a specific family or see
  everyone; other users see their own family plus every family they have access to.
- **"My Families" member list unified with Site User Management** — the family detail
  panel's plain email list is now the same rich per-person card (name, color, email,
  role, active/inactive, edit, delete), scoped to that one family.
- **Transfer family ownership**, from the family detail panel: the current owner (or a
  site admin) can hand ownership to another active member.
- **Traveler storage migration, phase 1 (backend foundation)** — new per-family
  `travelers.json` storage with gated add/update/move/delete actions and a one-time
  backfill button; not yet wired into the running app (additive only — see
  `TRAVELER-STORAGE-PLAN.md`).

## 1.7.0-beta

### Added
- **Transfer family ownership.** The family detail panel now shows its **Owner**; the
  current owner (or a site admin) can transfer ownership to any other active member,
  who's promoted to admin if they weren't already, via a new gated `transferOwnership`
  action. Confirmed with a popup before it takes effect.
- **Traveler storage migration, phase 1 (backend).** New `travelers.json` blob with
  family-admin-gated `addTraveler`/`updateTraveler`/`moveTraveler`/`deleteTraveler`
  actions, plus a site-admin **"Backfill travelers → per-family storage"** one-time
  migration button. This is additive — the app still runs entirely on the existing
  shared `settings.travelers` for now; nothing user-facing changes yet. See
  `TRAVELER-STORAGE-PLAN.md` for what's shipped vs. the remaining (riskier) cutover.

## 1.6.0-beta

### Fixed
- **Site admins couldn't see the Users tab at all, in some cases.** Its nav item was
  gated on a legacy global `editor` role claim instead of site-admin/family-role
  status — a site admin without that old claim was locked out of the tab entirely.

### Added
- **New person defaults to your family.** Adding a person now stamps your active
  family (and you as owner) automatically.
- **FAMILY picker on add/edit.** Choose which family a person belongs to from any
  family you administer (or any family, for site admins) — both when adding someone
  and when editing an existing person. Changing it moves their membership via a new
  gated `assignFamily` action (requires admin of the target family).
- **"Owned by" (non-account people) is now scoped** to the same family instead of
  listing every account-holder in the system.
- Wrote `TRAVELER-STORAGE-PLAN.md` scoping the follow-up work to move traveler storage
  fully server-side per family (closes the remaining gap where family assignment is
  UI-enforced but not yet API-enforced against raw calls).

## 1.5.0-beta

### Fixed
- **Users tab was showing everyone in the system, not just your family.** The People
  roster was pulling from a global, unscoped list gated only by a legacy global admin
  role — any signed-in person could see (and, if they had that legacy role, edit or
  rename) users outside their own family. It's now scoped so you only see people who
  share a family with you or yourself; editing/renaming a role, activating/deactivating,
  or deleting someone now requires being a site admin or an admin of *that person's*
  family.

### Added
- **Users tab grouped by family (site admins).** Site admins still see every user, now
  grouped under each family's name, with a "No family" group for anyone unassigned.
- **Family name is read-only with a Rename button**, replacing the previous
  click-to-edit field, in the People & Family Management detail panel.
- **Onboarding after an admin-created family.** When a site admin approves an access
  request without picking an existing family (a solo family gets auto-created for that
  person), their first login now takes them straight to People & Family Management with
  renaming already in progress and a tip about adding the rest of their family. The
  approval email includes the same instructions.

## 1.4.0-beta

### Added
- **Create family → popup.** "Create a new family" moved off the inline panel onto a
  button in People & Family Management, opening a small focused popup.
- **Rename a family.** Family admins can click the family name in the detail panel to
  rename it inline (Enter to save, Escape to cancel).
- **Approve access without picking a family.** Approving a pending access request now
  defaults to **"+ New family for them"** — it auto-creates a solo family and makes
  that person its admin, instead of requiring an admin to choose an existing family
  first. Picking an existing family from the dropdown still works as before.
- **First-login onboarding.** A signed-in user with no family memberships yet is taken
  straight to People & Family Management with the "Create a new family" popup open,
  welcoming them and prompting them to create one. They're made its admin automatically,
  then it's auto-approved or pending per the site's approval setting — same as creating
  a family any other way.

## 1.0.0-beta — Multi-Family

This is the big one: the app now supports multiple independent **Families**, each owning
its own trips, travelers, and roles, with opt-in sharing between them.

### Added
- **Families.** A family owns its trips and travelers. Anyone signed in can create their
  own family (Settings → Families); new families need site-admin approval before use,
  unless the site admin has turned on auto-approve.
- **Per-family roles.** Admin / editor / reader is now scoped per family — the same
  person can be an admin of their own family and just a reader in one that invited them.
  A separate **site admin** role sits above all families (create/approve/delete any
  family, assign anyone to any family+role, view every family's data).
- **Cross-family sharing.** A family admin can invite a whole other family to see their
  trips, at reader / editor / "admin (no delete)". Shared-with families show up as an
  option in the left-panel family switcher.
- **Family switcher** in the destinations panel (only appears once you belong to or can
  view more than one family) — jump between "my active family", "all my families", or
  (site admin) any family in the system or all of them at once. Metrics respect the same
  scope.
- **One-time migration.** Site admins get a "Migrate legacy data → default family" button
  that folds all pre-multi-family trips, travelers, and the old flat access list into a
  single default family ("The Remsiks"), so nothing is lost on upgrade.

### Changed
- App renamed **Trip Tracker → Multi Family Trip Tracker**.
- `/api/roles` and `/api/trips` now resolve access through family memberships and shares
  instead of one global access list (the old list still works as a fallback until you
  migrate).

## 0.9.21-beta

### Changed
- **Default traveler seed is now just you.** The built-in sample traveler list (used to seed a brand-new install) no longer ships with placeholder family names — new installs start with a single default traveler, and the demo trip / random-data generators no longer reference the old names either.

## 0.9.20-beta

### Added
- **Debug JSON for settings and all-trips data, not just a single trip.** In System → Data & Storage, a new **Debug** section (admin only) has bug-icon buttons for **App settings JSON** and **All trips data JSON** — same view / edit / diff-confirm / version-history flow as a trip's debug JSON, just scoped to your whole config or your whole dataset instead of one trip.
- **Diff-only history preview.** Each entry in a debug JSON's version history now has a **Preview diff** toggle that shows what changed against the current JSON inline, without needing to start a revert first.

## 0.9.19-beta

### Added
- **Revert to a previous JSON version.** The trip JSON panel now has a **History** button that lists every version you've confirmed for that trip (newest first, up to 10), each timestamped. Reverting shows the usual line-by-line diff against the trip's current data before you confirm — a revert is just another reviewable edit, so it can itself be undone later.

## 0.9.18-beta

### Added
- **Edit the debug JSON panel, safely.** The trip JSON panel's **Edit** button now opens a real editor with line numbers. Saving is a two-step confirmation: **Review changes** validates the JSON (a malformed edit shows the parse error inline and won't proceed), then shows a **line-by-line diff** — removed lines in red, added lines in green — before you hit **Confirm & save**. A **Copy** button copies the current JSON to your clipboard.

### Changed
- The JSON panel no longer resizes between view and edit modes — it's a fixed height now.

## 0.9.17-beta

### Added
- **Debug mode** (Preferences tab → Form & cards) — when on, every trip card gets a small bug‑icon button, matching the styling and tint of the card's other icon buttons, that opens a read‑only panel with that trip's raw JSON (including its `id`) — handy for troubleshooting.

### Changed
- **Trip ids are now GUIDs** instead of a plain timestamp number, so two people adding a trip in the same millisecond — or merging backups — can no longer collide. Old‑style numeric ids (and any trip missing an id) are migrated to a GUID automatically, once, the next time the app loads.

### Fixed
- The System‑Backup card's nested **"↳ Include photos"** toggle (under Data) never rendered — the template referenced a value that wasn't wired up. It's back and working.

## 0.9.16-beta

### Added
- **Trip card photo layout** preference (Preferences → Form & cards, shown once thumbnails are on): choose **Banner** (full-bleed photo, current default), **Compact** (small square thumbnail beside the title), or **Framed** (header on top, photo inset below) for the trip detail card.

### Fixed
- README's example export JSON was missing `photo` on the location and `showThumbs` / `cardLayout` / `autoClaim` / `updateFreqMin` / `theme` / `accessEmail` on settings — schema doc now matches the real shape.
- Settings pushed to the cloud (any Preferences toggle, not just card layout) used a fixed 1.5s debounce before syncing — reloading right after a change could catch the sync mid-flight and revert to the previous cloud value. Discrete changes (toggles, segmented pickers) now push after 150ms; only in-progress text edits (list labels/colors) keep the longer debounce.

## 0.9.15-beta

### Changed
- **Top bar** — Metrics and Help icons moved up next to the Profile/Settings icons.
- **Trip detail card** — when a trip has a photo, the card now shows it as a full-bleed banner behind the header instead of a small square thumbnail; trips without a photo keep the original layout unchanged. The card's photo-delete control was removed (still available from the edit form).
- **Delete trip** — moved from the detail card into the edit form's footer (Delete · Cancel · Save), using the same confirmation dialog.

---

## 0.9.14-beta

### Added
- **Export images** — the Storage & backup card gets an **Images** switch (alongside Data/Settings) that exports trip photos as a `.zip`. Choose **My photos** (flat zip of just your trips) or **Everyone** (Cloud mode) — which nests one `.zip` per person inside the outer zip, grouped by owner.

### Fixed
- **README audit** — reconciled the app guide against every changelog entry; added missing sections for trip photos, mobile display, update-check frequency, quick duplicate, today-preselected dates, sign-in toasts, and the last-admin guard.

---

## 0.9.13-beta

### Added
- **Export metrics as CSV, JSON, or PDF** — the Export button in the Trip Metrics dialog now opens a small menu with all three formats. PDF opens a printable report in a new tab (use the browser's Save-as-PDF).
- Per-person stats (Users tab edit view) now also show countries visited and a trips-by-year breakdown.
- **Countries · by traveler** leaderboard added to the Trip Metrics dashboard (and included in PDF/JSON exports).
- **Export login stats (CSV)** — admin-only button on the Users tab exports every person's logins, last login, and trips-logged count.
- **Trip stats button** on the trip detail card (📊, next to lock/×) — hover to see a per-traveler stat summary for that trip, without adding a permanent badge to the card face.
- **Hover tooltip on traveler chips** in the trip detail card's TRAVELERS row — shows that person's trips owned, countries visited, and trips they're tagged in elsewhere.

---

## 0.9.12-beta

### Changed
- **Trip delete confirmation** now reads "This removes the trip, its marker from the globe and the associated thumbnail" and "You're about to delete this trip to [Place] ([dates]) from your trips" — and shows the trip's thumbnail (if it has one) right in the dialog.

### Added
- **Per-person stats in Users tab.** Editing a person (cloud mode) now shows trips owned, thumbnail count, and how many other trips they're tagged in — broken down by whose trip. The admin hover tooltip on the access list shows the same breakdown.
- **Metrics: TRAVELERS · BY TRIPS.** A new leaderboard showing trip counts per person, alongside the existing by-days leaderboard.

---

## 0.9.11-beta

### Added
- **Today pre-selected on new trips.** Opening "Add" now defaults the date to today's day in the calendar (duplicated trips still open with a blank date).
- **Quick duplicate.** A duplicate button (⧉) next to the × in the edit-trip form instantly opens a new, unsaved trip pre-filled with everything from the one you're editing except the date — the original is untouched.

### Changed
- **Detail card action buttons** (🔒 who-can-see, × close) are now stacked vertically instead of side-by-side, balancing the layout now that a photo thumbnail sits in that corner.

---

## 0.9.10-beta

### Added
- **Update check frequency.** Settings → System → Updates now lets you pick how often the app polls for a newer version: 3, 5, or 10 minutes.

---

## 0.9.9-beta

### Added
- **Delete your own photos.** A small × now sits on the corner of the trip-card thumbnail to remove that trip's photo (owner only). Your profile bubble also shows how many of your trips have a photo, with a "Remove all" bulk action (with confirm).
- **Reuse a photo across trips.** Typing a city/country that matches another trip you own with a photo now offers "Reuse your photo from X?" instead of requiring a fresh upload — accept or dismiss, never auto-applied.

### Fixed
- **Detail card layout.** The trip photo now sits to the right of the title/city text (left of the lock icon), instead of shifting the whole card's content over.

---

## 0.9.8-beta

### Fixed
- **Stale login stats on hover.** The Users tab hover bubble (online dot, login count, last login) only ever loaded once, when you opened the tab — it never showed someone logging in/out until you refreshed the page. It now refreshes automatically every 30s and on hover.

---

## 0.9.7-beta

### Added
- **Trip photo thumbnail.** Add/Edit location now has an optional Photo field — pick an image and it's automatically center-cropped and downscaled client-side to a small square (well under 32KB) before it's ever stored, so a 20MB phone photo never bloats your data. Shows on the selected-trip card to the left of the "who can see this" lock.
- **Preference: "Show photo thumbnail on card"** (Preferences tab, on by default) — turn off if you'd rather skip rendering thumbnails.

---

## 0.9.6-beta

### Fixed
- **Auto-locate geocoding could pin the wrong country.** When a region name (e.g. a French region) wasn't found as a matching city in the given country, the lookup fell back to an unmatched candidate — sometimes an unrelated place with the same name in another country. It now only accepts a result that actually matches the entered country/state, and fails with a clear message instead of guessing wrong.
- **Editing a location didn't preview on the globe until saved.** The pulsing "live preview" dot (which narrows from country → state → city as you type, and jumps to it once auto-locate resolves) only appeared while adding a new location. It now also shows while editing, updating instantly as you type or auto-locate — the saved dot is held back until you save.

---

## 0.9.5-beta

### Added
- **Mobile display refinement** — a responsive layout for screens ≤ 720px. The floating desktop panels reflow into phone‑friendly sheets: the destinations list becomes a full‑width sheet below the header, the selected‑trip card a bottom sheet, the metrics dashboard and configuration modal near‑full‑width scrollable sheets, and the Add/Edit form goes full‑screen. The globe re‑centers behind everything; the desktop layout is unchanged above 720px.

### Changed
- **App‑guide version badge** now tracks the live app version automatically (no more manual edits to the README badge).

---

## 0.9.4-beta

### Added
- **Metrics filter pane** — the metrics dashboard now has its own **Filters** button opening a filter panel (Year, Status, Visit type, Trip type, Traveler) that recomputes every stat over the chosen set. Defaults to **all trips in the system**; an active‑filter count shows on the button. (Replaces the earlier All/Filtered scope toggle.)

### Changed
- **User editing** — the person editor now has **Save** + **Cancel** side by side (Cancel reverts your edits) with **Deactivate/Activate** on the same row; the delete actions sit below. Adding a new person shows **Add** + **Cancel** instead.
- **Consolidated access management** — the standalone *Access list* block was removed from the System tab; email, role and active‑state are all managed per‑person in the **Users** tab (single source of truth).

---

## 0.9.3-beta

### Added
- **Metrics scope toggle** — the metrics pane header now has an **All trips / Filtered** segmented control; "Filtered" recomputes every stat over the left‑panel filter set, with the subtitle noting how many filters are active.
- **Sign‑in notifications** — when another user signs in, online users get a quiet toast ("*X just signed in*"). Cloud‑only; you're never toasted for yourself or for the people already online when you arrive.

### Changed
- **User editing** — the person editor now has **Save** + **Cancel** side by side (Cancel reverts your edits) with **Deactivate/Activate** on the same row; the delete actions sit below.

### Fixed
- **Last‑admin guard** — the only remaining active admin can no longer be deactivated or deleted (buttons hidden, with a notice).
- **Stuck hover bubble** — the Users‑tab login‑stats tooltip no longer lingers over the edit fields when you click Edit.

---

## 0.9.2-beta

### Added
- **Metrics dashboard** — a bar‑graph icon (left of the **?** in the Configuration header) opens an all‑time stats pane: headline tiles (trips, days away, countries, cities, average & longest trip, busiest year, years active, upcoming, dream‑list), highlight cards (most‑visited country/city, top traveler by days), distribution bar charts (status, trip type, visit type, travelers‑by‑days, top countries, top cities) and a trips‑by‑year column chart.
- **Bulk edit** — a new section atop the **Trips** tab. The target set is chosen by the **filters on the left** (no duplicate filter UI); a live count shows how many of *your* trips match. Tick only the fields to change — Who‑can‑see, Visit type, Travelers, Trip type, Notes, and (admin) Owner — then confirm. Every editor can bulk‑edit their own trips; admins, all.
- **Active / Inactive users** — admins can mark a user Inactive (record + role kept, access revoked until reactivated), shown as a coloured badge, with an All / Active / Inactive filter in the Users tab.
- **Delete user** — admins can remove a user; a confirmation first warns how many trips they **own** (deletable, or kept and unassigned) and how many they're **tagged on** (disassociated).
- **Save toasts** — a small, auto‑dismissing pill confirms add / edit / delete, bulk updates, claims, assignments, sharing, role and active‑state changes across the app.

### Changed
- **Email‑based ownership** — a trip is "yours" if its `ownerEmail` matches your sign‑in email (or you created it). This makes assigning a trip to another user work even before that user's first sign‑in.
- The Trips tab is now visible to any **editor** (and in Local mode), not just admins.
- Replaced the auto‑claim toggle with the per‑trip / claim‑all flow in the Trips tab.

### Fixed
- **Update notice** — the version check now accepts a version suffix (e.g. `‑beta`); previously the suffix made the check silently fail.
- **Live refresh** — saves now update the in‑memory view immediately, so the globe, list and profile bubble reflect changes without a page reload.
- **Edit button** — opening the edit pane no longer mis‑fires after the live edit‑pane‑switch change.
- **Users tab** — the login‑stats hover bubble no longer sticks over the edit fields when you click Edit.
- Clicking another trip while the edit pane is open now switches the pane to that trip.

---

## 0.9.1-beta

### Fixed
- Restored the **update‑available** notification (version‑string format had broken the check).

---

## 0.9.0-beta

### Added
- **Themes** — 10 named looks (Aurora, Cobalt, Violet, Orchid, Magenta, Crimson, Ember, Amber, Emerald, Mono); picking one retints the whole app and is saved with your settings.
- **Per‑user data & sharing (Cloud mode)** — per‑trip visibility (Only me / All users / Specific people), owner & visibility badges, an Owner filter, and a profile bubble with your trip stats.
- **App‑managed access** — Microsoft / Google / Yahoo sign‑in with an admin‑managed email→role allowlist (Reader / Editor / Admin), so access is granted from inside the app rather than the Azure portal.
- **Presence & login analytics** — a "who's online" bar, per‑traveler presence dots, and an admin hover bubble with login counts and last‑login.
- **Configuration data editor** — Travelers, trip/visit types and statuses became fully editable (rename, recolour, add, remove), carried in settings export/import.
- **State / province borders** toggle, **spin‑globe** toggle, **default‑filter** preferences, and an in‑app **Help** viewer (App guide + Deploy guide) rendered from the Markdown docs.

> Versions before 0.9.0‑beta predate this changelog.
