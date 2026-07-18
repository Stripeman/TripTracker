---
type: Architecture Guide
title: Application and API architecture
description: Explains TripTracker's browser entry flow, overlay-based frontend, Local and Cloud data paths, Azure Functions API calls, and periodic refresh behavior.
resource: /Trip Tracker.dc.html
tags: [architecture, frontend, api, data-flow]
---

# Application and API architecture

## Entry and frontend composition

[`index.html`](../../index.html) is the deployed entry point. It makes an unauthenticated `GET /api/site-settings` call and redirects to `Trip Tracker.dc.html` when the returned `landingVariant` is `signin` (or on an error); otherwise it redirects to `Landing.dc.html`. The active marketing page sends its calls to action back to the main application. `Landing Page.dc.html` has placeholder links and should be treated as a design artifact, not the active landing flow.

[`Trip Tracker.dc.html`](../../Trip%20Tracker.dc.html) is the primary application. It is a large, self-contained browser SPA with a canvas globe and conditional overlays rather than frontend URL routes. Header controls and overlays expose destination selection, add/edit forms, family management, settings, metrics/heat map, calendar, activity, profile, help, attachment, itinerary, comment, and permission flows. This frontend dispatches persistence and access-sensitive actions to the managed API documented in [Families and trip workflows](../domain/families-and-trip-workflows.md).

`support.js` is loaded beside the main HTML. The user-facing README says these files must remain colocated; test the deployed/static layout if changing filenames or entry references.

## Data modes and boot sequence

The frontend defaults a fresh configuration to `cloud` mode, retaining that choice in `localStorage` under `vacation-location:config`.

| Mode | Read path | Write path | Important boundary |
| --- | --- | --- | --- |
| Cloud | `GET /api/trips` | `POST /api/trips` (or `?mode=replace`) | Server filters the dataset and enforces permissions. Successful cloud reads are copied to local browser storage as a cache. |
| Local | existing browser trips, then `trip-tracker.json`, then `demo-data.json` | browser storage or explicit file/export flows | Static JSON only seeds/imports local data; it is not a cloud persistence store. |

If Cloud mode cannot connect, the app falls back to local loading. An empty cloud dataset plus existing browser data prompts the user rather than silently uploading local trips. Switching Cloud to Local requires confirmation because the browser dataset is distinct.

The relevant browser keys are `vacation-location:locations:v4`, `vacation-location:config`, and the per-browser visual preference key `vacation-location:local-theme`. Do not put sensitive cloud data into documentation or tests that inspect these values.

## Frontend-to-API contract map

| Endpoint | Client use | Server concept |
| --- | --- | --- |
| `/api/site-settings` | Entry-page landing decision | Public, sanitized landing fields. |
| `/api/trips` | Cloud dataset read; normal save; privileged `assign`, `deleteUser`, and `replace` modes | Cloud trip state and per-trip access rules. |
| `/api/families` | Family/membership/share/activity state, action commands, ETag refresh | Multi-family tenancy, invitations, site/family configuration. |
| `/api/attachments` | File upload and deletion; attachment retrieval | Blob-backed trip attachments with trip-level authorization. |
| `/api/presence` | Heartbeat, online roster, admin stats | Blob-backed presence and login activity. |
| `/api/request-access` | Signed-out access request and onboarding fallback | Anonymous, rate-limited request intake. |
| `/api/access` | Legacy administrative access-list UI path | Legacy-role migration fallback; not the primary family membership model. |
| `/.auth/me` and `/.auth/login/*` | Reads SWA principal and begins Google/AAD/Yahoo login | Static Web Apps identity layer. |

The frontend calls `GET /api/families` with `If-None-Match`; the server can return `304` so the 30-second family/activity poll does not force a re-render. This optimization was introduced in recent Git history; preserve it when changing the response shape.

## Polling and external dependencies

In authenticated Cloud mode, the frontend refreshes family state/activity and presence roughly every 30 seconds; it also refreshes after returning to a visible browser tab. Update checking has a configurable interval (3, 5, or 10 minutes; default 10). Client logic persists activity IDs it has already toasted and ignores entries older than 15 minutes to avoid duplicate update notifications.

The globe and location experience also depend on external map/geocoding resources (world atlas/Natural Earth sources and Open-Meteo geocoding). Serve over HTTP during local work; the existing README explicitly warns that `file://` blocks needed fetch behavior.

## API runtime

The `api/` directory is Azure Functions v2 host configuration with Node dependencies limited to `@azure/storage-blob`. Function bindings are deliberately `anonymous`; [Static Web Apps configuration and handler checks](../security/authentication-and-authorization.md) provide the actual protection model. `api/host.json` selects the Functions extension bundle.

### Safe change sequence

1. Locate the UI event and request in `Trip Tracker.dc.html`.
2. Trace the matching handler and its stored fields.
3. Update both the client behavior and server authorization/validation where necessary.
4. Test the successful action and 401/403/error path. A hidden button or client computed property is never sufficient authorization.
5. Exercise Local mode separately if the change affects initialization, export/import, or browser persistence.

See [Development and deployment](../operations/development-and-deployment.md) for available local-run options and deployment behavior.
