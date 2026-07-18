---
type: Domain Workflow Guide
title: Families and trip workflows
description: Describes family-scoped tenancy, trip lifecycle, storage blobs, sharing and permission rules, attachments, notifications, and recovery constraints in TripTracker.
resource: /api/trips/index.js
tags: [domain, trips, families, storage, authorization]
---

# Families and trip workflows

## Tenancy model

Cloud data is organized around families rather than a single global trip list. A trip normally carries `familyId`, creator ownership (`owner` and/or `ownerEmail`), visibility/sharing fields, and content such as dates, place, travelers, itinerary, comments, and attachment metadata. Family membership roles (`reader`, `editor`, `admin`) are scoped to a family; a person can hold different roles in different families. Cross-family shares are directional and grant `reader`, `editor`, or `admin-no-delete` access to another family's trips.

This model is maintained by [`api/families/index.js`](../../api/families/index.js) and consumed by [`api/trips/index.js`](../../api/trips/index.js). It depends on the identity and coarse SWA role layer described in [Authentication and authorization](../security/authentication-and-authorization.md), but those global roles do not replace the family/trip checks.

## Trip lifecycle

### Create and edit

The main form contains Details, Notes & photos, Itinerary, and Permissions tabs. In Cloud mode it sends the current dataset to `POST /api/trips`; the server reconciles submitted records against persisted records rather than accepting arbitrary edits. New trips receive caller ownership, and a trip without an explicit family is associated with the caller's first editable family when possible.

The server normalizes sharing fields and preserves existing trips when the caller lacks edit/delete rights. It permits narrowly scoped changes such as comments or itinerary updates only when family policy allows them. `POST /api/trips?mode=replace`, `?mode=assign`, and `?mode=deleteUser` are elevated operations; do not expose or change them without reviewing their role checks.

### View, edit, delete, and share

The API evaluates access in this order of importance:

- Site admins bypass normal checks.
- A trip owner and explicitly named `sharedWith` email recipients have direct access.
- `soloPrivate` / “Only me” trips remain limited to the owner, explicit recipients, site admins, and the **owner of the trip's family**. Ordinary family admins do not pierce that boundary.
- Otherwise, direct family roles and incoming cross-family shares determine viewing and editing; family trip-permission floors can require editor or admin level for edit, attachment, comments, and delete variants.
- Legacy trips without a `familyId` retain separate compatibility behavior.

The family-owner exception is intentional current behavior. Recent Git history corrected a server/client mismatch where a family owner with a weaker membership row could not edit; regression tests should include owner, normal family admin, editor, reader, cross-family recipient, explicit recipient, and site admin. UI controls are helpful affordances only—the server is decisive.

## Persistent cloud state

The Azure Blob container defaults to `data` and can be configured through environment-variable names documented in [Development and deployment](../operations/development-and-deployment.md). Important logical blobs include:

| Logical blob | Purpose |
| --- | --- |
| `trip-tracker.json` | Main `{ app, version, locations, settings? }` dataset; legacy forms are still accepted. |
| `families.json` | Families, approval/branding/configuration fields. |
| `memberships.json` | Family-specific people, roles, active state, defaults. |
| `family-shares.json` | Directional family-to-family permission grants. |
| `travelers.json` | Family-scoped traveler reference rows keyed by the identifiers used in trip traveler arrays. |
| `activity.json` | Bounded activity/audit entries, currently limited to about 300 records. |
| `family-settings.json` | Site-wide/family defaults such as approval, landing and notification controls. |
| `access-requests.json`, `invite-links.json`, `site-admins.json` | Access requests, redeemable links, and additional site-admin data. |
| `attachments/<tripId>/...` | Raw file data; trip records retain metadata. |
| `presence.json` | Online/presence and login records. |

The main dataset's `settings.travelers` is a legacy compatibility area: current family APIs use `travelers.json` once migrated, but generic settings serialization may still carry the older field. Preserve migration and dual-read behavior when changing traveler data.

## Families API responsibilities

`GET /api/families` returns the caller's scoped families, memberships, shares, travelers, activity, settings, and an ETag. Site admins receive extra administrative/pending views. `POST /api/families` is an action-command API covering family lifecycle, membership and invitation management, family-to-family sharing, travelers, notification/category/trip-policy configuration, backup/import, and site-admin controls.

Because the action API has a broad surface, any new action must establish the target family's existence and check the appropriate family admin, owner, site admin, or primary-site-admin rule. Current code has several mutation paths that authorize by supplied membership but do not consistently prove that a supplied target family exists; treat orphan records as a known integrity risk.

## Attachments, activity, and notifications

`/api/attachments` stores allowed uploads under a trip-specific Blob path and writes metadata into the trip dataset. Reads require trip visibility plus the family's shared-attachment policy. Uploads require trip attachment edit rights and an approved family. Deletion retains a special uploader-by-email allowance. The handler accepts a claimed MIME type and base64 input; it has a 25 MiB approximate/post-decode cap but no content-signature or malware validation.

Family, trip, attachment, presence, and notification actions can write activity entries. Notification/audit writes are intentionally best effort and may be lost; they are not a compliance-grade audit system. Email dispatch uses configured Resend settings when enabled and is also best effort.

## Recovery and change constraints

- Never “fix” cloud data by editing deployed `demo-data.json` or `trip-tracker.json`; use the API, explicit import/backup flows, or an approved maintenance procedure.
- Configure Blob versioning and soft delete in Azure before relying on recovery. Existing deployment guidance describes this operationally.
- The general family backup/import replaces family, membership, share, and site-admin structures; treat it as destructive and verify a current export first.
- Most blob read-modify-write paths lack ETag/lease protection, so concurrent writers can lose updates. Presence is a notable exception that uses conditional ETag writes.
- Family delete paths may leave related records or raw attachment blobs behind; assess cleanup and retention before implementing destructive operations.

For frontend request flow and browser data modes, see [Application and API architecture](../architecture/application-and-api.md). For route and permission enforcement, see [Authentication and authorization](../security/authentication-and-authorization.md).
