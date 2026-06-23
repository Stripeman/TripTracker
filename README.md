# Trip Tracker

A dark, futuristic travel tracker built around a geographically accurate, rotating 3D globe. Plot every destination you've **visited**, have **planned**, or are still **dreaming** about — each pinned to the globe with colour‑coded markers, rich trip details, and flexible filtering.

![Version](https://img.shields.io/badge/version-v1.5-38bdf8) ![Status](https://img.shields.io/badge/status-active-34d399)

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
- **Travelers**: Terry · Karen · Nikki · Amanda — multi‑select, each colour‑coded; shown on the detail card.
- The destinations list shows each trip's **date range** on the same line as the country.
- Click any saved location (on the globe or in the list) to view its detail card, then **Edit** or **Delete** it.
- **Required fields:** every destination needs a **city**, a **date**, and a **status** (State is also required for U.S. cities). The `·required` hint clears automatically once a field has a value.
- **Duplicate guard:** if a trip with the same place and the same date already exists, a *“This trip already exists — add anyway?”* notice appears next to the Dates field. It's informational — you can still add it.
- **Audit stamps:** the Edit form shows a read-only **Added** timestamp (set when the destination is first created) and a **Last modified** timestamp (updated each time you save changes).
- **Add another after saving:** a sticky toggle in the form — when on, saving keeps the form open with the same details but the **date cleared**, so you can quickly log repeat visits to the same place. Stays on until you turn it off.

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
- **Role-aware UI:** in Cloud mode the **Add / Edit / Delete** controls are hidden unless your account has the `editor` role, and **Import / Clear data** require the `admin` role (read-only `reader` accounts see the data but no editing actions). Local mode always allows editing.
- **Export / Import** with independent **Data** and **Settings** switches: back up or restore destinations, display settings, or both. Import only applies what you've switched on *and* what the file contains.
- **Clear data** always downloads a dated backup first.

### ⚙ Settings — three tabs
The ⚙ panel has a left‑hand tab rail; **Filters is selected by default**:

**Filters tab** — sets what the filters open to on each visit, via colour‑coded segmented toggles that match the filter colours:
- **Sort destinations** — Descending (newest first) / Ascending (oldest first)
- **Year** — All years / Current year
- **Trip type** — All / *(your trip types)*
- **Visit type** — All / *(your visit types)*
- **Status** — All / Visited
- **Traveler** — All / *(your travelers)*
- Ships defaulting to **Descending + Current year + Personal + Visited**; changing a default applies immediately and is carried in settings export/import.

**System tab** — display + storage:
- Toggle whether the **Trip details** section is open by default on the form.
- Toggle whether **trip details** and the **status** appear on the detail card.
- **Spin the globe** — turn the idle auto‑rotation on or off (you can always drag to spin manually).
- **Data source**, linked file / browser storage, and **Export / Import** (see Storage & backup).

**Data tab** — editable reference data (see below).

### 🧩 Configuration data (editable lists)
The **Settings** tab turns what used to be fixed lists into editable data. For each category you can **rename**, **recolour** (colour swatch), **add**, and **remove** items; changes flow live into the Add/Edit form, the filters, the detail card, and the globe colours:
- **Travelers** (e.g. Terry · Karen · Nikki · Amanda)
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

This very document is the app's help screen. The **?** button (top of the ⚙ settings panel, left of ⓘ) opens a guide rendered live from `README.md` — so there's only ever one file to maintain. Keep `README.md` next to the app and serve over http for it to load.

---

## Data format

On a **fresh visit** (when the browser has no saved data yet), the app fetches **`demo-data.json`** from its own folder and loads it as the starting dataset — handy for demos and for shipping a curated set to whoever opens the app. Once data exists in the browser, that local copy is used and the file is no longer read (so a viewer's edits stick). Replace `demo-data.json` to change the demo set.

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
    "spin": true,
    "defaultYear": "current",
    "defaultTrip": "vacation",
    "defaultStatus": "visited",
    "defaultTraveler": "all",
    "sortDir": "desc",
    "dataSource": "cloud",
    "travelers": [{ "key": "terry", "label": "Terry", "color": "#fb7185" }],
    "tripTypes": [{ "key": "vacation", "label": "Personal", "color": "#2dd4bf" }],
    "visitTypes": [{ "key": "city", "label": "City", "color": "#38bdf8" }],
    "statuses": [{ "key": "visited", "label": "Visited", "short": "Visited", "color": "#34d399" }]
  },
  "locations": [
    {
      "id": 1,
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
- `travelers` (any number): keys from your editable **Travelers** list (defaults: `terry` · `karen` · `nikki` · `amanda`)
- `lat` / `lon` are optional strings — leave blank to geocode from city/state/country on save.
- `dateEnd` is optional (single‑day trips omit it). `createdAt` / `modifiedAt` are set automatically.
- `settings`: `version` is a number that auto‑increments on every settings change; `defaultYear` is `current` or `all`; `defaultTrip` is `all` or any trip‑type key; `defaultStatus` is `all` / `visited`; `defaultTraveler` is `all` or any traveler key; `defaultVisit` is `all` or any visit‑type key; `sortDir` is `desc` (newest first) / `asc` (oldest first); `dataSource` is `local` or `cloud`.
- `settings.travelers` / `tripTypes` / `visitTypes` / `statuses` are the **editable reference lists** — each item is `{ key, label, color }` (statuses also carry a `short` label). Omit them to fall back to the built‑in defaults.

Data‑only and settings‑only exports contain just the `locations` or `settings` key respectively. Imports accept any of these shapes (a bare array of locations is also supported for backward compatibility).

---

## Tech

- **D3** orthographic projection + **TopoJSON** world atlas for the globe (rendered to `<canvas>`).
- **Open‑Meteo** geocoding API for automatic coordinate lookup.
- Browser **localStorage** + optional **File System Access API** for persistence.
- Fonts: Orbitron, Space Grotesk, IBM Plex Mono.

---

## Author

**Terry Remsik** — Terry.Remsik@gmail.com
