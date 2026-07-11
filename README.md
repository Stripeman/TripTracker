# Multi Family Trip Tracker

A dark, futuristic travel tracker built around a geographically accurate, rotating 3D globe. Plot every destination you've **visited**, have **planned**, or are still **dreaming** about — each pinned to the globe with colour‑coded markers, rich trip details, and flexible filtering. In Cloud mode, trips belong to a **Family** — your own household, extended family, or friend group — and families can invite one another to share their trips.

![Version](https://img.shields.io/badge/version-1.9.1--beta-38bdf8) ![Status](https://img.shields.io/badge/status-active-34d399)

---

## Families (multi-tenant model)

In Cloud mode, every trip and traveler belongs to a **Family**, not to an individual:

- **Anyone signed in can create a family** — a "Create a new family" button on the
  People & Family Management → Families detail panel opens a small popup. New families
  need site-admin approval before their trips become usable, unless the site admin has
  turned on auto-approve.
- **First-login onboarding** — a brand-new user with no family yet is taken straight to
  People & Family Management and prompted to create one; if a site admin instead
  approved their access request without picking an existing family, a solo family is
  auto-created for them (they're its admin) and they're walked straight to **renaming**
  it (family name is otherwise read-only, with a **Rename** button) and adding the rest
  of their family.
- **Roles are scoped per family** — admin / editor / reader. The same person can be
  admin of their own family and just a reader in a family that invited them in.
  A separate **site admin** role sits above every family: create/approve/delete
  families, assign anyone to any family at any role, and view all data.
- **Family Management** — a dedicated top-level view (icon in the header, next to
  Metrics/Help/Profile/⚙) with a **sidebar of your families** and a detail panel for
  whichever one is selected: members and roles, invites, branding, sharing, and a
  guarded delete. Site admins get an additional "Site administration" sidebar entry
  covering every family, approvals, and the site-admin roster.
- **Ownership & transfer** — a family's detail panel shows its **Owner**. The current
  owner (or a site admin) can **transfer ownership** to any other active member, who's
  promoted to admin automatically if they weren't already.
- **Inviting people** — a family admin can add someone **by email** (grants access the
  moment they next sign in — no email is actually sent by default) or generate a
  **shareable invite link** (7-day expiry, single use, role baked in) that anyone can
  open to join at that role. Clicking **"Customize & send an actual email…"** opens an
  editable **subject + message** (prefilled with a sensible default) and sends a real
  email via Resend when configured — access is granted either way, even if email
  delivery isn't set up. **Non-account members** — a name with no email (a kid, a pet,
  whoever) can be added too; they show up as a family member and can be tagged on
  trips, but can never sign in.
- **Family branding** — each family gets an auto-assigned **accent color** (10-color
  palette; a family admin can change it via swatches) and an optional **logo/photo**
  upload (cropped to a square thumbnail client-side before upload). The color/logo show
  in the family switcher, the Family Management sidebar, and the left panel's
  per-family group headers; on the globe, markers get a thin **family-color ring**
  whenever more than one family's trips are visible at once (single-family views are
  unaffected).
- **Cross-family sharing** — a family admin can invite a whole other family to view
  (or edit) their trips at reader / editor / "admin (no delete)", from Family Management.
  "Admin (no delete)" can edit but can never delete another family's trips — only that
  family's own admin (or site admin) can delete its data.
- **Guarded family delete** — deleting a family opens a confirmation with **live counts**
  (trip photos, trips, non-account members, user accounts) and independent checkboxes
  for each category. Checking "Trips" requires "Images" to be checked first (since
  deleting a trip deletes its photo too). "Delete checked items" removes only what's
  ticked; "Delete family" only lights up once all four are checked, and only then does
  the family record itself get removed.
- **Site admin roster** — the `SITE_ADMIN_EMAIL` env var is now just the **primary**
  admin (a bootstrap failsafe, not editable in-app). A primary admin can add or remove
  additional site admins from Family Management → Site administration; everyone else
  sees the list read-only.
- **Families backup (JSON)** — a site admin can **export** every family, membership,
  share, invite link, and additional site admin as one JSON file (Family Management →
  Site administration), and **import** one back — importing *replaces* all of it, with
  a confirmation showing exactly how many families/memberships will change.
- **Family switcher** — the destinations panel gets a small switcher (only shown once
  you can see more than one family) to jump between your active family, all families
  you belong to, or — for site admins — any single family or every family at once.
  Options are tinted with each family's color. The **destinations list groups trips by
  family** into collapsible sections (your active family expanded by default) whenever
  more than one family is in view; with a single family it stays a flat list.
- **Metrics scope** — the Trip Metrics header gets a scope dropdown (My family / All
  families I have access to / Every family for site admins) that drives the dashboard
  and every export format (CSV/JSON/PDF). "All families I have access to" includes
  families shared with you, not just direct memberships. The default is a stable "home
  family", independent of whichever family is selected in the left panel.
- **Transfer family ownership** — from a family's detail panel, the current owner (or a
  site admin) can hand ownership to another active member of that family.
- **Upgrading existing data** — a site admin runs "Migrate legacy data → default
  family" once (Family Management → Site administration); it folds any pre-existing
  trips/travelers/access-list entries into a single family so nothing is lost.

---

## Features

### 🌍 Interactive globe
- Geographically accurate orthographic globe (D3 + world‑atlas TopoJSON) with land, country borders, graticule, and an atmospheric glow.
- Auto‑rotates when idle; **drag to spin** in any direction.
- Markers are colour‑coded by status. The selected location gets an **amber pulsing dot**, a label, and the globe flies to centre it.
- **Live preview dot while adding** — as you fill in the form, a cyan **crosshair dot** appears and narrows: Country → centre of the country, + State → the state, + City → the city, and exact lat/lon pins it precisely. The globe flies to follow it; if a city name matches several places, all of them pulse.
- **Clustering** — destinations that share a location collapse into a single dot with a count badge. Click it to **fan the entries out** on connector lines and pick a specific trip.

### 📍 Destinations
- Add a destination with (in order): **country**, optional **state**, **city**, optional **latitude/longitude**, **date(s)**, **status**, **visit type(s)**, **trip type(s)**, **traveler(s)**, and free‑form **notes**.
- **Status**: Planned (blue) · Visited (green) · Dream destination (purple).
- **Trip type**: Personal · Work.
- **Travelers**: Terry · [others] — multi‑select, each colour‑coded; shown on the detail card.
- The destinations list shows each trip's **date range** on the same line as the country.
- Click any saved location (on the globe or in the list) to view its detail card, then **Edit** or **Delete** it.
- **Required fields:** every destination needs a **city**, a **date**, and a **status** (State is also required for U.S. cities). The `·required` hint clears automatically once a field has a value.
- **Duplicate guard:** if a trip with the same place and the same date already exists, a *“This trip already exists — add anyway?”* notice appears next to the Dates field. It's informational — you can still add it.
- **Audit stamps:** the Edit form shows a read-only **Added** timestamp (set when the destination is first created) and a **Last modified** timestamp (updated each time you save changes).
- **Duplicate this Trip:** a sticky toggle in the form (labelled *“Duplicate this Trip · clears date”*) — when on, saving keeps the form open with the same details but the **date cleared**, so you can quickly log repeat visits to the same place. Stays on until you turn it off. A **quick duplicate button (⧉)** on the edit form does the same instantly from an existing trip — opens a new, unsaved trip pre-filled with everything except the date, leaving the original untouched.
- Opening **Add** pre-selects **today** in the calendar (duplicated trips still open with a blank date, so you can pick the right day).

### 🖼 Trip photos
- Add a **photo thumbnail** to any trip from the Add/Edit form — it shows on the trip's detail card (toggle this off in **Preferences** if you'd rather keep cards text‑only). Pick the card's **photo layout** in Preferences: **Banner** (full-bleed), **Compact** (small thumbnail beside the title), or **Framed** (inset photo below the header).
- **Smart reuse suggestion:** typing a city/country that matches a trip of yours which already has a photo offers *“Reuse your photo from [place]”* — accept or dismiss it; it's never applied automatically.
- Remove a single trip's photo from the form or right off the detail card, or use **Remove all my photos** in the profile bubble to strip photos from every trip you own in one step (with a confirmation first).

### 🗓 Dates
- Pick a **single day**, **drag across the calendar**, or **click a start day then an end day** to select a date range.
- **Type a date directly** — the calendar popover has editable **Start** and **End** fields (`YYYY-MM-DD`, also accepts `MM/DD/YYYY`). This is the way to enter dates far in the past or future; typing a start date re-centres the calendar on that month. Input is strictly validated — only a complete, real calendar date is accepted (e.g. `2001-02-30` is rejected), so partial/garbage text never sets a date.
- The calendar is a **continuously scrolling list of months** (one year back to two years forward), so a nearby range that spans month boundaries is just a scroll — no paging. It opens scrolled to the current month (or to the start date you've typed).
- Choosing a date auto‑sets the status: a future date → **Planned**, today or past → **Visited** (you can still override).

### 📌 Smart location resolution
- Leave the coordinates blank and they're **fetched automatically** on save (geocoding), or use the **Auto‑locate** button in the form.
- If no coordinates are entered, the dot is placed from the **city → state → country**, in that order.
- **Changing the city, state, or country clears any existing coordinates**, so the dot always reflects the current place (and re‑geocodes on save).
- **State is required** for U.S. cities.
- Adding a destination that matches an existing city **pre‑fills** its location info (everything except the dates).

### 🔎 Filtering
- **Free‑text search** — start typing to match destinations by **city, state, country, or notes**; results update live and respect every other active filter.
- Filter the destinations list by **year**, **status**, **visit type**, **trip type**, and **traveler** — all colour‑coded to match the globe.
- Per‑filter totals show the number of **trips** and **days**.
- The year list only contains years that actually have destinations. Defaults to the **current year**.
- Filters also **hide/show markers on the globe**.

### 🔥 Heat map
- The grid‑icon button beside the search box opens a right‑side **Travel Heat Map** panel; toggle it to hide the panel and see the globe, and again to bring it back.
- Ranks places by travel intensity (trips and days) over the currently filtered set, coloured from **cool (fewer)** to **hot (more)**, with a legend.
- **By country / By city** switch — view the heat ranking either way.
- **Tap a tile to filter** the globe and list to that place (multi‑select supported). Selected tiles get an amber outline; the rest **dim** so your picks stand out, and a *Filtering: …* banner with **Clear** appears.
- **The two modes cross‑filter:** selecting countries narrows the *By city* list to cities within those countries, and selecting cities narrows the *By country* list to the countries that contain them. The globe shows the precise intersection of all active filters.

### 💾 Storage & backup
- **Data source switch** (⚙ → Settings → Data & Storage): choose **Local** or **Cloud**.
  - **Local** — data stays in this browser. On first run with no saved data it loads `trip-tracker.json`, and if that's empty it falls back to `demo-data.json`.
  - **Cloud** — syncs to the Azure API; reads need the **`reader`** (or `editor`) role, saves need **`editor`**. Cloud data is private to authorized users.
- **Reload from cloud** (⚙ → System, Cloud mode) re-fetches the cloud dataset and tells you **how many records it fetched**, then asks what to do: **Merge** (keep both sets — cloud wins on duplicate ids, and any local‑only trips are pushed back to the cloud), **Overwrite** (replace your current view with the cloud copy), or **Cancel** (so you can export or review your local data first). Nothing changes until you choose.
- **Role-aware UI:** in Cloud mode the **Add / Edit / Delete** controls are hidden unless your account has the `editor` role, and **Import / Clear data** require the `admin` role (read-only `reader` accounts see neither). The **Users** tab and the data-list editors in **Settings** (trip/visit types, statuses) and the **Access requests** email are **admin-only** in Cloud mode too; non-admins don't see those controls at all. Local mode always allows editing.
- **Sign in or request access:** when an unauthorized visitor opens the site in Cloud mode they get a clean **Sign in required / No access** screen (no data is shown) with two paths — **Sign in** with an authorized account, or **Request access** by entering their email. If the optional Resend email backend is configured (see deploy guide), the request is emailed straight to the owner ("Request sent ✓"); otherwise it falls back to opening the visitor's own mail app. The destination address is set in **⚙ → System → "Access requests go to"** and is shown on the sign-in screen so people can also email it directly.
- **Multi-provider sign-in:** the Sign in screen offers **Microsoft, Google, and Yahoo** — people use whatever account they already have.
- **App-managed access (no Azure invitations):** roles live per-family in **People & Family Management** (each family's admin manages who's in their family, at reader/editor/admin) — site admins can additionally approve pending access requests and families, and assign anyone to any family. assign anyone to any family from **⚙ → Families → Site Admin**. After someone signs in, the server's custom-roles function matches their email (across any provider) against their family memberships and grants a role — so you let people in or out from inside the app, never the Azure portal. A `BOOTSTRAP_ADMIN_EMAIL` / `SITE_ADMIN_EMAIL` env var is the lock-out safety net. **Inactive users:** an admin can mark a user **Inactive** (⚙ → Users) — the record and role are kept but access is revoked until reactivated.
- **Export / Import** with independent **Data** and **Settings** switches: back up or restore destinations, display settings, or both. Import only applies what you've switched on *and* what the file contains.
- **Clear data** always downloads a dated backup first.

### 👤 Per-user data & sharing (Cloud mode)
In Cloud mode every trip belongs to whoever created it — ownership is resolved by **email**, so an admin can hand a trip to any user even before that user's first sign‑in. The server only ever sends each person the trips they're allowed to see — privacy is enforced on the server, not just hidden in the browser.
- **Who's signed in:** **⚙ → System → Cloud sync** shows your account (avatar, email, and your role — `reader` / `editor` / `admin`) with a **Sign out** button.
- **Visibility per trip:** the add/edit form has a **"Who can see this"** picker:
  - **🔒 Only me** — private to you (default).
  - **👥 All users** — any signed-in user can view it.
    - **✉ Specific people** — share **by name**: pick from your **People** chips (Terry, [others], …) instead of typing emails. Each person can hold an optional email in **⚙ → Users**; that's the address access is granted to. People without an email are greyed out with a hint. A **"+ other email"** box covers anyone who isn't in your People list.
- **Your profile:** a **person icon** sits in the top‑right, just left of the ⚙ cog (Cloud mode, when signed in). It opens a themed card showing **who you're signed in as** and your role, your **trip stats** (created by you, private vs. shared, and how many trips you're tagged on as a traveler), and a **Sign out** button.
- **Names, not emails:** because Travelers map names → emails, the owner badge and share picker show **names** (e.g. "Terry"), and when you're signed in with a Traveler's email the app greets you by that name. Sharing still resolves to emails under the hood (that's what sign-in matches on).
- **Traveler presence dot:** in **⚙ → Users**, each person with an email shows a small status dot next to their name — **green** when that person (matched by their email) is currently online, **grey** when offline. Hovering the dot shows a cursor-following tooltip with their **online status and role(s)** (e.g. "Online · editor, reader"). Roles are reported by each browser's presence heartbeat, so a Traveler's role is shown while they're online; offline, the tooltip notes the role appears once they sign in. (This is separate from the always-on "ONLINE" bar at the bottom of the screen.)
- **Settings sync to the cloud:** editing configuration data (Travelers and their **emails**, visit/trip types, statuses, default filters, display options) saves to the cloud automatically a moment after you change it — so the name↔email mapping and your settings persist and are shared with other users, not just stored in your browser. (Requires the `editor`/`admin` role, like any cloud write.)
- **You can only edit your own trips.** Trips shared with you are view-only (the detail card shows an owner badge, a visibility badge, and "Shared with you · view only" instead of Edit/Delete). A normal save never touches anyone else's data.
- **Quick permission editor:** on a trip you own (Cloud mode), the detail card has a **🔒 lock button** next to the close button. It opens a compact "Who can see this" picker — **Private / All users / People** — where People shows each registered Traveler as a **colored first-initial circle** (hover for their full name + email). Changes **save instantly**, and your last choice becomes the **default visibility for the next new trip** you create.
- **Owner filter:** the left filter panel adds an **Owner** row — **Everyone** (all you can see) / **Mine** / **Shared with me** — and the globe follows the filter.
- **Legacy trips** (created before this feature, with no owner) stay visible to everyone; an admin can assign or claim them via the **Trips** tab.
- **Admins** get no special *viewing* power — they see a trip only if its owner shared it, same as anyone. Admin rights apply to **Import**, **Clear data**, assigning/claiming **unclaimed trips**, managing **users** (roles, active/inactive, delete), and bulk **owner** reassignment.
- **Who's online:** a thin bar at the bottom-right shows the names of everyone signed in right now (green dot + name; "you" highlighted). Hover a name to see when they were last active. Each browser quietly polls presence every 30s. When someone new signs in, other online users get a quiet toast (*"[Name] just signed in"*) — never for yourself or people already online when you arrive.uietly sends a heartbeat every ~30s and is shown as online for up to ~90s after — so it reflects "active in the last minute or so," not instant presence. Only signed-in users see it, and it's Cloud-mode only.
- **Login analytics (admin):** in **⚙ → System → Access list**, an admin can **hover any person's row** to see a stat bubble — whether they've actually signed in, their **total login count**, **last login**, and **how many trips they've logged**. The bubble appears to the *bottom-left* of the cursor so it never blocks the email field. Login counts are recorded server-side (one count per page-load); trip totals are read from the dataset, so they're accurate even for trips you can't see.

### ⚙ Configuration — tabs
The ⚙ **Configuration** panel has a tab row across the top — **Settings · Preferences · Trips · System** — with **Settings selected by default**. (**Trips** shows in Cloud mode / for any editor.)

**People & Family Management** — the person‑icon button (top‑right) opens a single pane covering everyone and every family: **My Family Management** (your families — members, roles, invites, branding, sharing, guarded delete), **Site Management** (site admins only — Site User Management + Site Family Management sub-tabs, covering every family), and **Pending Actions** (site admins).emberships, family detail/members/sharing — everyone in Cloud mode), and, for site admins, **Pending Actions** (access requests + family approvals, badge‑counted on the button itself) and **Site Family Mgmt** (auto‑approve, all‑families list, assign a person to a family, migrate legacy data, families backup). If you're not in a family yet, the sidebar tells you so and points you at creating one or asking for an invite.

**Settings tab** — first, what the filters open to on each visit (colour‑coded segmented toggles that match the filter colours), then the editable reference lists (Trip types, Visit types, Statuses — see *Configuration data* below):
- **Sort destinations** — Descending (newest first) / Ascending (oldest first)
- **Year** — All years / Current year
- **Trip type** — All / *(your trip types)*
- **Visit type** — All / *(your visit types)*
- **Status** — All / Visited
- **Traveler** — **Auto (me)** / All / *(your travelers)*. **Auto (me)** is the default: when you're signed in, the list opens filtered to **your own** trips (matched by your email → Traveler), so each person lands on their own travels first. Set a specific traveler or All to override.
- Ships defaulting to **Descending + Current year + Personal + Visited**; changing a default applies immediately and is carried in settings export/import.
- **Themes** — a grid of **10 looks** (Aurora · Cobalt · Violet · Orchid · Magenta · Crimson · Ember · Amber · Emerald · Mono). Picking one instantly retints the **whole app** — globe, tiles, cards, modals and all — and is saved with your settings. Aurora is the default cyan.

**Site User Management** (People & Family Management → Site Management → Site User Management, site admins only) — the unified **People** list, scoped to your own family: you only see people who share a family with you (or yourself); everyone else is invisible, and only a site admin or an admin of that person's family can edit their role, activate/deactivate, or delete them. Site admins see everyone, **grouped by family** (with a "No family" group for anyone unassigned). Each person always has a **name + colour**; an **email is optional** — give someone an email and they can sign in, at which point a **role** and a **presence dot** appear. People without an email are simply names you can pick. Each row has an **Edit** button (so you can't fat‑finger an email just by clicking a field), and **+ Add person** at the top. In Cloud mode an **admin** sets emails and roles (Reader / Editor / Admin, cumulative) and, for a name‑only person, an **Owned by** parent user; a regular **editor** can add name‑only people under themselves and can delete **only** people they added that aren't tagged on any trip. The Users tab is hidden for read‑only (`reader`) accounts.
- **Active / Inactive** — an admin can mark a user **Inactive** (keeps the record and role but revokes access until reactivated), shown as a coloured badge, and filter the list by **All / Active / Inactive**. The last remaining active admin can't be deactivated or deleted (buttons hidden, with a notice) — there's always at least one admin.nactive**.
- **Delete user…** — an admin can remove a user; a confirmation first warns how many trips they **own** (deletable, or kept and unassigned) and how many they're **tagged on** (disassociated).
- **FAMILY picker** — a family admin (or site admin) can assign/move a person into any family they administer (site admins: any family). New people default to your active family and you as owner. "Owned by" (for name-only people) is scoped to the same family.
- **Rename any user you administer** — family admins for their own families, site admins for anyone; the Edit button itself only shows for people you're allowed to manage. A signed-in account with no traveler record yet (e.g. a brand-new user) gets one created automatically the moment you edit it.
- **Family-scope dropdown** (same pattern as Trip Metrics) — site admins can filter to one specific family or see everyone; other users see their own family plus every family they have access to.
- **"My Families" member list** (Family Management → My Family Management → a family's detail panel) is the same rich per-person card as Site User Management — name, color, email, role, active/inactive, edit, delete — scoped to that one family, instead of a plain email list.

**Trips tab** (editors, Cloud — also Local mode) — **Trip Management**, two sections:
- **Bulk edit** — change many trips at once. The target set is chosen by the **filters on the left** (no duplicate filter UI here); a live count shows how many of *your* trips match. Tick only the fields to change — **Who‑can‑see**, **Visit type**, **Travelers**, **Trip type**, **Notes**, and (admin) **Owner** — then confirm. It only touches trips you own (admins, all).
- **Unclaimed trips** (admin) — new trips are owned by their creator automatically; this lists older trips with **no owner** and lets an admin **assign each to a person**, or **claim them all** at once. Assigning is by email, so the trip becomes that user's the next time they load — no re‑import needed.

**Preferences tab** — display options:
- Toggle whether the **Trip details** section is open by default on the form.
- Toggle whether **trip details** and the **status** appear on the detail card.
- **Spin the globe** — turn the idle auto‑rotation on or off (you can always drag to spin manually).
- **State / province borders** — overlay internal admin‑1 borders on large countries (USA, Canada, Brazil, Australia, China, India, Russia, Indonesia, South Africa). Off by default; the data (~880 KB) is fetched lazily only the first time you enable it, and the lines are drawn only while the globe is still, so spin performance is unaffected. Countries smaller than South Korea are never drawn.
- **Debug info on trip cards** — off by default; when on, every trip card gets a small bug‑icon button (matching the tint of the card's other icon buttons) that opens a panel with that trip's raw JSON (including its `id`). From there you can **copy** the JSON, or **Edit** it in a line‑numbered editor — saving requires reviewing a line‑by‑line diff and confirming; malformed JSON is caught and blocked before you can proceed. A **History** button lists every version you've confirmed for that trip so you can revert to one (also via a reviewable diff, plus a **Preview diff** toggle to see what changed without starting a revert). Meant for troubleshooting, not everyday use.

**System tab** — data, storage & app info:
- **Data source** (Local browser / linked file, or Cloud), **Export / Restore**, and **Clear data** (see Storage & backup).
- **Debug** (admin only) — the same view / edit / diff‑confirm / version‑history flow as a trip's debug JSON, scoped instead to your **whole app settings** or your **entire trips dataset** at once.
- **Access requests and approvals** live in **People & Family Management → Pending Actions** (site admins) — approve into an existing family and role, or leave it on the default **"+ New family for them"** to auto-create a solo family with that person as its admin; either way it emails the person that they're in (when a family was auto-created, the email also points them to renaming it and adding members). Declining just clears the request. A badge on the person‑icon button shows the pending count.
- *(The GitHub repository link now lives in the **help guide**, opened from the **help icon**.)*

### 📊 Trip metrics
A **bar‑graph icon** sits in the header, next to the help icon. It opens a **metrics pane** covering **every trip, all time** (independent of the active filters):
- **Family scope** (Cloud mode) — a dropdown in the pane header: **My family** (default) / **All my families** / **Every family** (site admins only). Drives the whole dashboard and every export.
- **Headline tiles** — total trips, total days away, countries, cities, average trip length, longest trip, busiest year, years active, upcoming trips, and dream‑list count.
- **Highlights** — most‑visited country, most‑visited city, and the top traveler (by days away).
- **Distributions** (mini bar charts) — by status, by trip type, by visit type, travelers by trips, travelers by days, **countries by traveler**, top countries, and top cities.
- **Trips by year** — a small column chart of trips per year.
- **Export** — a button opens **CSV, JSON, or PDF** (PDF opens a printable report in a new tab; save it from the browser's print dialog). Exports respect the metrics pane's own filters.

Each trip's detail card also has a small **stats button** (same bar‑graph icon, next to 🔒/×) — hover it for a per‑traveler summary of that one trip, and hovering a traveler chip in the TRAVELERS row shows that person's trips owned, countries visited, and other trips they're tagged in.

### 🔔 Update notice
The app knows its own build version and quietly checks the server for a newer deployed version (on load, whenever the tab regains focus, and on an interval you control — **⚙ → System → Updates**, 3 / 5 / 10 minutes). When a newer build is live, an **UPDATE AVAILABLE** badge appears to the right of the title and a dismissible amber **notice bar** drops in at the top with a **Reload** button to pick up the new version. Detection is automatic from the version number — nothing to configure beyond the check frequency.

### 📱 Mobile display
On screens ≤ 720px the desktop's floating panels reflow into phone‑friendly sheets: the destinations list becomes a full‑width sheet below the header, the selected‑trip card a bottom sheet, the metrics dashboard and configuration modal near‑full‑width scrollable sheets, and the Add/Edit form goes full‑screen. The globe re‑centers behind everything. The desktop layout is unchanged above 720px.

### 🧩 Configuration data (editable lists)
The **Settings** tab turns what used to be fixed lists into editable data. For each category you can **rename**, **recolour** (colour swatch), **add**, and **remove** items; changes flow live into the Add/Edit form, the filters, the detail card, and the globe colours:
- **Travelers** (e.g. Terry · [others]) — editing a person (Cloud mode) shows their **trips owned, countries visited, trips‑by‑year breakdown**, and how many other trips they're tagged in.
- **Trip types** (e.g. Personal · Work)
- **Visit types** (e.g. National park · City · Family · Beach · Food & wine · Adventure · Road trip · Cultural)
- **Statuses** (defaults: Planned · Visited · Dream) — fully editable: rename, recolour, **add**, and **remove**. The date‑driven auto‑select looks for `planned` / `visited` and simply skips if you've removed them; existing trips keep their stored status even if you delete it from the list.
- A **settings version number** increments on every change and is shown at the bottom of the tab. It travels with settings export/import so you can tell which revision a backup came from.
- All four lists, plus the version, are part of the **settings** payload — exported and imported with the Settings switch.

### 🖱 Globe controls
- **Drag** to rotate, **mouse‑wheel** to zoom from 1× to 6× (drag sensitivity scales with zoom).
- **Hover** any landmass for a faint country label — it's suppressed/relocated so it never covers a placed dot.

---

## Running it

Trip Tracker is a self‑contained design component. Two files must stay **side by side**:

```
Trip Tracker.dc.html   ← the app
support.js             ← the runtime it loads
README.md              ← this guide (also the in-app ? help)
demo-data.json         ← demo data, auto-loaded on a fresh visit (optional)
```

Because the app fetches map data and (optionally) links files, open it over **http**, not `file://`:

1. Open the project folder in your editor (e.g. VS Code).
2. Use a static server — the **Live Server** extension is the easiest: right‑click `Trip Tracker.dc.html` → **Open with Live Server**.

> **Note:** Linking a live JSON file uses the browser's File System Access API, available in Chromium‑based browsers (Chrome, Edge). Elsewhere, use **Export / Import** instead — that works everywhere. File pickers are also blocked inside sandboxed preview panes, so use a real browser tab for file linking.

### In‑app help

This very document is the app's help screen. The **help icon** (top‑right header) opens a guide rendered live from `README.md` — so there's only ever one file to maintain. Its footer has the build version, last‑updated date, author, and a link to the **GitHub repository**. Keep `README.md` next to the app and serve over http for it to load.

A matching **standalone page** lives at **`help.html`** — it renders these same guides (App guide + Deploy guide) with identical styling. Use it to:
- **Share a link** to the guide without opening the app — e.g. `https://your-site/help.html` (or `help.html?doc=deploy` for the deploy guide; the chosen tab is kept in the URL).
- **Save as PDF** — the page has a **Save PDF** button (your browser's print-to-PDF), and the dark theme is preserved in the output. No separate PDF file to maintain — the page *is* the shareable, printable artifact.

Inside the app, the **↗ Open / PDF** link in the Help &amp; Guide header opens this page for whichever guide you're viewing.

---

## Data format

On a **fresh visit** (when the browser has no saved data yet), the app fetches **`demo-data.json`** from its own folder and loads it as the starting dataset — handy for demos and for shipping a curated set to whoever opens the app. Once data exists in the browser, that local copy is used and the file is no longer read (so a viewer's edits stick). Replace `demo-data.json` to change the demo set.

Each trip's **`id`** is a GUID (e.g. `03a315ce-93d4-4020-89e4-38f8d2f1f71f`), assigned the moment it's created. A trip loaded without one — or with an old‑style numeric id from before this app used GUIDs — gets a fresh GUID assigned automatically on load, so ids stay unique across devices, imports, and merges.

Exporting **everything** produces a file named **`trip-tracker.json`** — deliberately different from `demo-data.json` so dropping an export into the app folder never silently overwrites the bundled demo. The file uses the same shape:

```json
{
  "app": "vacation-location",
  "version": 1,
  "exportedAt": "2026-06-20T00:00:00.000Z",
  "settings": {
    "version": 7,
    "detailsFormDefault": true,
    "detailsCard": true,
    "statusCard": true,
    "showThumbs": true,
    "cardLayout": "banner",
    "spin": true,
    "stateBorders": false,
    "autoClaim": false,
    "updateFreqMin": 10,
    "theme": "aurora",
    "defaultYear": "current",
    "defaultTrip": "vacation",
    "defaultStatus": "visited",
    "defaultTraveler": "all",
    "defaultVisit": "all",
    "sortDir": "desc",
    "dataSource": "cloud",
    "accessEmail": "terry.remsik@gmail.com",
    "travelers": [{ "key": "terry", "label": "Terry", "color": "#fb7185", "email": "terry.remsik@gmail.com", "createdBy": "", "familyId": "fam-abc123" }],
    "tripTypes": [{ "key": "vacation", "label": "Personal", "color": "#2dd4bf" }],
    "visitTypes": [{ "key": "city", "label": "City", "color": "#38bdf8" }],
    "statuses": [{ "key": "visited", "label": "Visited", "short": "Visited", "color": "#34d399" }]
  },
  "locations": [
    {
      "id": "03a315ce-93d4-4020-89e4-38f8d2f1f71f",
      "city": "Paris",
      "state": "",
      "country": "France",
      "lat": "48.8566",
      "lon": "2.3522",
      "date": "2026-06-19",
      "dateEnd": "2026-06-28",
      "status": "visited",
      "notes": "Spring on the Canal Saint-Martin",
      "visitTypes": ["city", "family"],
      "tripTypes": ["vacation"],
      "travelers": ["terry"],
      "photo": "data:image/jpeg;base64,…",
      "familyId": "fam-abc123",
      "owner": "usr_9f2a1c",
      "ownerEmail": "terry.remsik@gmail.com",
      "visibility": "private",
      "sharedWith": [],
      "createdAt": "2026-06-19T13:48:07.884Z",
      "modifiedAt": "2026-06-19T13:48:07.884Z"
    }
  ]
}
```

**Field values:**
- `status`: a key from your editable **Statuses** list (defaults: `planned` · `visited` · `dream`)
- `visitTypes` (any number): keys from your editable **Visit types** list (defaults: `natlpark` · `city` · `family` · `beach` · `food` · `adventure` · `roadtrip` · `cultural`)
- `tripTypes` (any number): keys from your editable **Trip types** list (defaults: `vacation` shown as *Personal* · `work`)
- `travelers` (any number): keys from your editable **Travelers** list (defaults: `terry` · *[others]*)
- `lat` / `lon` are optional strings — leave blank to geocode from city/state/country on save.
- `dateEnd` is optional (single‑day trips omit it). `createdAt` / `modifiedAt` are set automatically.
- `photo` is optional — a data‑URL string for the trip's thumbnail (shown per **Preferences → Show photo thumbnail on card**, in the **Banner / Compact / Framed** layout you've picked). Omit it for a text‑only card.
- `familyId` — which family this trip belongs to (Cloud mode). Omitted/blank trips are treated as unassigned/legacy and visible everywhere until claimed or migrated.
- `owner` / `ownerEmail` — the account that owns this trip (Cloud mode); `ownerEmail` drives per‑trip permissions and the family scoping rules described above.
- `visibility` — `private` (only the owner), `all` (everyone with access to the family), or `shared` (only `sharedWith`). Defaults to `private` when omitted.
- `sharedWith` — array of emails, only meaningful when `visibility` is `shared`.
- `settings`: `version` is a number that auto‑increments on every settings change; `showThumbs` toggles trip photos on cards; `cardLayout` is `banner` / `thumbnail` / `framed`; `autoClaim` auto‑assigns unclaimed trips you create; `updateFreqMin` is `3` / `5` / `10`; `theme` is one of the 10 named looks; `accessEmail` is the admin contact shown in the access list; `defaultYear` is `current` or `all`; `defaultTrip` is `all` or any trip‑type key; `defaultStatus` is `all` / `visited`; `defaultTraveler` is `all` or any traveler key; `defaultVisit` is `all` or any visit‑type key; `sortDir` is `desc` (newest first) / `asc` (oldest first); `dataSource` is `local` or `cloud`.
- `settings.travelers` / `tripTypes` / `visitTypes` / `statuses` are the **editable reference lists** — each item is `{ key, label, color }` (statuses also carry a `short` label). A traveler item can also carry `email` (lets them sign in), `createdBy` (who added a name‑only person — governs delete permission), and `familyId` (which family they belong to). Omit the list to fall back to the built‑in defaults.

Data‑only and settings‑only exports contain just the `locations` or `settings` key respectively. Imports accept any of these shapes (a bare array of locations is also supported for backward compatibility).

### Families backup (JSON)

Site Management → Site Family Management → **Families backup** exports/imports a
*separate* file covering the multi‑family system itself (families, memberships, shares,
invite links, additional site admins) — distinct from the trips/settings export above:

```json
{
  "app": "vacation-location-families",
  "version": 1,
  "exportedAt": "2026-07-11T00:00:00.000Z",
  "families": [
    { "id": "fam-abc123", "name": "The Remsiks", "color": "#fb7185", "createdBy": "terry.remsik@gmail.com", "createdAt": "2026-06-01T00:00:00.000Z", "approved": true, "autoApproved": false, "autoNamed": false, "logo": "" }
  ],
  "memberships": [
    { "email": "terry.remsik@gmail.com", "familyId": "fam-abc123", "role": "admin", "active": true, "createdAt": "2026-06-01T00:00:00.000Z" }
  ],
  "shares": [
    { "fromFamilyId": "fam-abc123", "toFamilyId": "fam-xyz789", "role": "reader" }
  ],
  "siteAdmins": ["terry.remsik@gmail.com"]
}
```

- `families[].autoNamed` — true if the family still has the generic name it was auto‑given (e.g. approving an access request without picking a family); cleared the first time it's renamed. Drives the first‑login onboarding nudge.
- `memberships[].role` — `reader` / `editor` / `admin`. `active: false` revokes access without deleting the record.
- `shares[].role` — `reader` / `editor` / `admin-no-delete`; grants `toFamilyId`'s members that level of access to `fromFamilyId`'s trips.
- Importing **replaces** all of `families`/`memberships`/`shares`/`siteAdmins` — the confirmation shows exactly how many of each will change.

---

## Tech

- **D3** orthographic projection + **TopoJSON** world atlas for the globe (rendered to `<canvas>`).
- **Open‑Meteo** geocoding API for automatic coordinate lookup.
- Browser **localStorage** + optional **File System Access API** for persistence.
- Fonts: Orbitron, Space Grotesk, IBM Plex Mono.

---

## Author

**Terry Remsik** — Terry.Remsik@gmail.com
