# Trip Tracker

A dark, futuristic travel tracker built around a geographically accurate, rotating 3D globe. Plot every destination you've **visited**, have **planned**, or are still **dreaming** about — each pinned to the globe with colour‑coded markers, rich trip details, and flexible filtering.

![Version](https://img.shields.io/badge/version-v1.4-38bdf8) ![Status](https://img.shields.io/badge/status-active-34d399)

---

## Features

### 🌍 Interactive globe
- Geographically accurate orthographic globe (D3 + world‑atlas TopoJSON) with land, country borders, graticule, and an atmospheric glow.
- Auto‑rotates when idle; **drag to spin** in any direction.
- Markers are colour‑coded by status. The selected location gets an **amber pulsing dot**, a label, and the globe flies to centre it.
- **Clustering** — destinations that share a location collapse into a single dot with a count badge. Click it to **fan the entries out** on connector lines and pick a specific trip.

### 📍 Destinations
- Add a destination with: **city**, optional **state**, **country**, **latitude/longitude**, **date(s)**, **status**, **visit type(s)**, **trip type(s)**, and free‑form **notes**.
- **Status**: Planned (blue) · Visited (green) · Dream destination (purple).
- **Trip type**: Personal · Work.
- Click any saved location (on the globe or in the list) to view its detail card, then **Edit** or **Delete** it.
- **Required fields:** every destination needs a **city**, a **date**, and a **status**. State is also required for U.S. cities.
- **Audit stamps:** the Edit form shows a read-only **Added** timestamp (set when the destination is first created) and a **Last modified** timestamp (updated each time you save changes).

### 🗓 Dates
- Pick a **single day** or **drag across the calendar** to select a date range.
- Choosing a date auto‑sets the status: a future date → **Planned**, today or past → **Visited** (you can still override).
- The calendar opens on the current month when adding a new destination.

### 📌 Smart location resolution
- Leave the coordinates blank and they're **fetched automatically** on save (geocoding), or use the **Auto‑locate** button in the form.
- If no coordinates are entered, the dot is placed from the **city → state → country**, in that order.
- **State is required** for U.S. cities.
- Adding a destination that matches an existing city **pre‑fills** its location info (everything except the dates).

### 🔎 Filtering
- **Free‑text search** — start typing to match destinations by **city, state, country, or notes**; results update live and respect every other active filter.
- Filter the destinations list by **year**, **status**, **visit type**, and **trip type** — all colour‑coded to match the globe.
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
- Data is saved in your browser automatically.
- Optionally **link a JSON file** (Chromium browsers) so every change auto‑saves straight to disk — it reconnects to that file on your next visit.
- **Export / Import** with independent **Data** and **Settings** switches: back up or restore destinations, display settings, or both. Import only applies what you've switched on *and* what the file contains.
- **Clear data** always downloads a dated backup first.

### ⚙ Display settings
- Toggle whether the **Trip details** section is open by default on the form.
- Toggle whether **trip details** and the **status** appear on the detail card.
- **Spin the globe** — turn the idle auto‑rotation on or off (you can always drag to spin manually).

### 🎛 Default filters
- A **Default Filters** section sets what the filters open to on each visit, via colour‑coded segmented toggles that match the filter colours:
  - **Year** — All years / Current year
  - **Trip type** — All / Personal / Work
  - **Status** — All / Visited
- Ships defaulting to **Current year + Personal + Visited**; changing a default applies immediately and is carried in settings export/import.

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
  "exportedAt": "2026-06-19T00:00:00.000Z",
  "settings": { "detailsFormDefault": true, "detailsCard": true, "statusCard": true },
  "locations": [
    {
      "id": 1,
      "city": "Paris",
      "state": "",
      "country": "France",
      "lat": "48.8566",
      "lon": "2.3522",
      "date": "2024-06-14",
      "dateEnd": "2024-06-21",
      "status": "visited",
      "notes": "Summer evenings in Le Marais",
      "visitTypes": ["city"],
      "tripTypes": ["vacation"]
    }
  ]
}
```

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
