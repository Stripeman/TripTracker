# Changelog

All notable changes to **Trip Tracker** are recorded here. The newest release is at the top.

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
