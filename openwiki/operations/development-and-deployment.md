---
type: Operations Guide
title: Development and deployment
description: Local development, Azure Static Web Apps deployment, safe configuration names, custom-domain and OAuth considerations, recovery practices, and known operational documentation drift.
resource: /.github/workflows/azure-static-web-apps-delightful-dune-0b6ba6d0f.yml
tags: [operations, deployment, azure, github-actions]
---

# Development and deployment

## Local development

The frontend is static, but the repository now provides Node-based API test, validation, and composite build commands:

- From the repository root, run `npm test` to delegate to the API test suite, or `npm run build` to run that suite followed by API validation.
- From `api/`, run `npm test` for the serial Node test suite, `npm run validate` for structural checks, or `npm run build` for both in sequence. The scripts are defined in [`package.json`](../../package.json) and [`api/package.json`](../../api/package.json).
- The tests use in-memory Blob mocks and cover trip visibility/mutation permissions, family response and mutation authorization, role resolution, legacy storage compatibility, and frontend request contracts. They do not validate a browser session, Static Web Apps authentication, or a live Azure storage account.
- `api/scripts/validate.js` checks JavaScript syntax and JSON, expected Azure Functions HTTP bindings, protected Static Web Apps route coverage for selected endpoints, frontend references to API endpoints, and the configured `/api/roles` source. It is a consistency check, not a replacement for authorization or deployment testing.
- Use an HTTP static server for frontend-only work. The README recommends Live Server because the app fetches assets and API resources; `file://` is not a supported validation path.
- For local managed API/auth emulation, the existing deployment guide suggests installing the Static Web Apps CLI, installing dependencies in `api/`, then running `swa start . --api-location api`. This is useful guidance but requires local Azure settings and is not a substitute for deployed identity-provider validation.
- The API dependency manifest is [`api/package.json`](../../api/package.json); it currently lists `@azure/storage-blob`.
- Run `git diff --check` and `git status --short` after documentation or code work. For behavior changes, manually test both local and authenticated cloud paths plus denied API responses.

The browser entry flow and API calls are documented in [Application and API architecture](../architecture/application-and-api.md). Do not validate security only with a local static-server session; server-side rules are covered in [Authentication and authorization](../security/authentication-and-authorization.md).

## GitHub Actions deployment model

[`.github/workflows/azure-static-web-apps-delightful-dune-0b6ba6d0f.yml`](../../.github/workflows/azure-static-web-apps-delightful-dune-0b6ba6d0f.yml) deploys the repository through `Azure/static-web-apps-deploy@v1`:

- A push to `main` triggers upload. This supports, but cannot independently prove, the brief's production-branch assumption.
- Pull requests targeting `main` trigger preview deployment; closing the PR sends the action that closes its environment.
- The workflow deploys from `/`, uses `api` as the API location, has an empty output location, and sets `skip_app_build: true`. The static HTML is deployed as-is.

Never put the deployment token name or any secret value in generated docs, logs, issues, or commits. Production and preview environments may have different Azure app settings, storage, domains, and OAuth redirect registrations; do not assume parity.

A separate `openwiki-update.yml` workflow runs scheduled/manual documentation refreshes and creates a documentation pull request. It is not part of application runtime or Azure deployment behavior.

## Azure configuration names

Only configure sensitive values through trusted Azure environment settings. The code recognizes these names; values are intentionally omitted:

| Group | Names |
| --- | --- |
| Storage required/placement | `AZURE_STORAGE_CONNECTION_STRING`, `TRIPS_CONTAINER`, `TRIPS_BLOB`, `FAMILIES_BLOB`, `MEMBERSHIPS_BLOB`, `FAMILY_SHARES_BLOB`, `TRAVELERS_BLOB`, `ACTIVITY_BLOB`, `PRESENCE_BLOB`, `ACCESS_BLOB`, `ACCESS_REQUESTS_BLOB` |
| Identity | `AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YAHOO_CLIENT_ID`, `YAHOO_CLIENT_SECRET` |
| Admin/site | `SITE_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_EMAIL`, `SITE_URL` |
| Email | `RESEND_API_KEY`, `RESEND_FROM`, `ACCESS_REQUEST_TO` |

The logical Blob layout, its destructive operations, and its authorization implications are explained in [Families and trip workflows](../domain/families-and-trip-workflows.md).

## Domain and OAuth considerations

The repository brief identifies `https://www.triptracking.org` as the public custom domain. The checked-in deployment guide says provider callbacks should use the `www` host, such as `/.auth/login/aad/callback`, `/.auth/login/google/callback`, and `/.auth/login/yahoo/callback`, and warns that every preview host or added custom host needs a matching provider registration.

This repository cannot verify live DNS, domain ownership, Static Web Apps custom-domain binding, provider registrations, or the current Azure SKU. Treat the checked-in domain instructions as operational guidance requiring confirmation in the relevant provider/Azure consoles. Do not change DNS, redirect URIs, app registrations, or production settings without explicit authorization.

## Recovery and operational risks

- Enable Blob versioning and soft-delete before depending on recovery. Existing deployment documentation gives portal and CLI examples, but confirm policy in the deployed storage account.
- The client downloads/export flows can provide user backups; family backup import replaces key tenancy structures. Obtain a verified export before destructive maintenance.
- Most cloud blobs use uncoordinated read-modify-write operations. Concurrent edits can overwrite one another; presence is the exception with conditional ETag retries.
- Attachments live separately from trip metadata; family deletion may not clean raw attachment blobs. Plan cleanup and retention explicitly.
- API rate limits are in-memory per process and do not provide global abuse protection when scaled out.
- Several handlers return raw storage/provider error messages in 500 responses. Avoid relying on this for diagnostics and prefer a sanitized error-handling improvement.

## Documentation drift to avoid

`DEPLOY-azure.md` remains valuable for basic portal setup and static/SWA CLI layout, but it conflicts with the current implementation in important places:

- It describes presence as Table Storage and `PRESENCE_TABLE`; code uses Blob Storage `presence.json` and optional `PRESENCE_BLOB`.
- It describes a global `access-list.json` UI as the active authorization model. `api/roles` now uses family memberships first and only falls back to that legacy blob if memberships do not exist.
- It documents only some API route protection and contains internally conflicting plan guidance around custom roles. The current [`staticwebapp.config.json`](../../staticwebapp.config.json) and handlers are authoritative.

When changing deployment or access docs, correct rather than copy these stale statements. Use [Authentication and authorization](../security/authentication-and-authorization.md) for the current enforcement model.
