---
type: Project Guide
title: TripTracker quickstart
description: Entry point for maintaining TripTracker, an Azure Static Web Apps trip tracker with a static single-page frontend, Azure Functions API, and family-scoped cloud data.
resource: /README.md
tags: [triptracker, azure-static-web-apps, architecture, operations]
---

# TripTracker

TripTracker is a browser-based travel tracker centered on an interactive globe. Its deployed shape is a static frontend at the repository root plus Azure Functions in [`api/`](../api/); in cloud mode, trips and family state are persisted in Azure Blob Storage rather than in deployed JSON assets. The repository's current `README.md` is the user-facing feature guide and is rendered by the app's help experience, while this wiki is the maintenance map.

## Start here

1. Read [Application and API architecture](architecture/application-and-api.md) to trace the browser entry point, frontend state modes, API calls, and pollers.
2. Read [Families and trip workflows](domain/families-and-trip-workflows.md) before changing trips, travelers, sharing, attachments, or activity.
3. Read [Authentication and authorization](security/authentication-and-authorization.md) before changing identity, roles, routes, or any client-side gate.
4. Read [Development and deployment](operations/development-and-deployment.md) before local runs, Azure settings, GitHub Actions, recovery, or domain/OAuth work.

## Repository shape

| Area | Current source of truth | Why it matters |
| --- | --- | --- |
| Browser entry | [`index.html`](../index.html) | Looks up public landing settings, then redirects to the main application or landing page. |
| Primary frontend | [`Trip Tracker.dc.html`](../Trip%20Tracker.dc.html) | Large self-contained single-page application: globe, forms, navigation, local/cloud persistence, and API client. |
| Managed API | [`api/`](../api/) | Azure Functions handlers own cloud persistence and authorization decisions. |
| SWA config | [`staticwebapp.config.json`](../staticwebapp.config.json) | Configures fallback routing, identity providers, custom role source, and coarse API route gates. |
| Deployment | [Azure workflow](../.github/workflows/azure-static-web-apps-delightful-dune-0b6ba6d0f.yml) | Deploys pushes to `main` and pull-request previews without building the static frontend. |
| User documentation | [`README.md`](../README.md), [`DEPLOY-azure.md`](../DEPLOY-azure.md) | Useful context, but portions of the deployment guide describe superseded storage and access behavior. |

## Operating model

- **Local mode:** browser storage is the normal local source. A first-use fallback can load `trip-tracker.json` or `demo-data.json`; these are bootstrap/import artifacts, not cloud persistence.
- **Cloud mode:** the frontend calls the managed API. The API uses configured Azure Blob Storage and filters data by the signed-in identity, memberships, ownership, trip sharing, and family-sharing rules.
- **Families are the main tenancy boundary:** trips have `familyId`; membership roles are scoped per family; one user can have different roles in different families. The global SWA role is only a coarse ceiling, so the API must retain detailed checks.
- **No URL-routed frontend:** the main application is an overlay-driven SPA. UI visibility is not security enforcement; handlers must be changed with the UI whenever access behavior changes.

## Change guide

| Change | Start with | Verify |
| --- | --- | --- |
| Trip form, globe, filters, metrics, UI state | [Application and API architecture](architecture/application-and-api.md) | Follow all relevant API calls in `Trip Tracker.dc.html`; manually test Local and Cloud behavior. |
| Trip permissions, shares, family role, ownership, traveler | [Families and trip workflows](domain/families-and-trip-workflows.md) | Test API-backed view/edit/delete/attachment behavior for each affected role, not just hidden controls. |
| Sign-in, provider setup, route restrictions, role logic | [Authentication and authorization](security/authentication-and-authorization.md) | Check both `staticwebapp.config.json` and the relevant handler; avoid logging or documenting credentials. |
| Blob schema, import/export, deletion, backups | [Families and trip workflows](domain/families-and-trip-workflows.md) | Preserve legacy input handling; do not modify deployed static JSON as a persistence mechanism. |
| Azure deployment, custom domain, environment settings | [Development and deployment](operations/development-and-deployment.md) | Confirm production vs preview settings and provider redirect URIs; do not deploy or alter DNS without approval. |

## Evidence and documentation status

Recent Git history shows active work on bulk editing, family access, activity polling, and notification deduplication. In particular, the current server implementation grants a family owner elevated access even where that owner's membership row is weaker; this was fixed in the trips and attachments handlers and is a policy-critical regression area.

`DEPLOY-azure.md` is partly historical: it describes presence as Azure Table Storage and an app-managed global access list. Current code uses Blob-backed `presence.json` and prefers family memberships, with `access-list.json` as a fallback for legacy migration. Use the linked operational page and current code/configuration when working on deployment or access.

## Backlog

- **Live Azure resource/SKU and DNS state** — source anchor: `DEPLOY-azure.md`, `staticwebapp.config.json`; not documented as fact because the repository cannot verify provisioned resources or DNS.
- **Automated tests** — source anchor: repository root and `api/package.json`; no test suite or root build scripts were found, so this wiki records manual and static checks rather than inventing coverage.
