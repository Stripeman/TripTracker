---
type: Security Architecture Guide
title: Authentication and authorization
description: Documents Static Web Apps identity configuration, custom role resolution, route gates, server-side family and trip enforcement, and client-side access limitations.
resource: /staticwebapp.config.json
tags: [security, authentication, authorization, azure-static-web-apps]
---

# Authentication and authorization

## Layers of protection

TripTracker uses several layers. They are complementary, not interchangeable:

1. **Static Web Apps identity** supplies a principal through `x-ms-client-principal` and identity-provider callbacks.
2. **Custom role resolution** calls `/api/roles` through `auth.rolesSource` to assign coarse `reader`, `editor`, and `admin` roles.
3. **SWA route rules** deny unauthenticated or insufficiently coarse roles for selected endpoints.
4. **Function handlers** parse the principal and apply detailed per-family, ownership, trip-sharing, and attachment rules.
5. **Frontend UI gates** hide controls and show sign-in/no-access screens, but do not establish security.

The application architecture calls these endpoints from the browser; see [Application and API architecture](../architecture/application-and-api.md). The protected resources and rules they govern are described in [Families and trip workflows](../domain/families-and-trip-workflows.md).

## Identity and role source

[`staticwebapp.config.json`](../../staticwebapp.config.json) configures Microsoft Entra ID, Google, and a Yahoo OpenID Connect provider. It refers only to configured setting names—`AAD_CLIENT_ID`, `AAD_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `YAHOO_CLIENT_ID`, and `YAHOO_CLIENT_SECRET`—and no secret values belong in source or this wiki.

The same configuration sets `auth.rolesSource` to `/api/roles`. [`api/roles/index.js`](../../api/roles/index.js) reads the authenticated email, grants the primary site administrator `admin`, `editor`, and `reader`, and otherwise returns the highest role from active family memberships. If the memberships blob does not exist, it can fall back to the legacy `access-list.json` record. Primary site-admin email configuration comes from `SITE_ADMIN_EMAIL`, with `BOOTSTRAP_ADMIN_EMAIL` as a fallback/bootstrap safety net.

A returned global role is a **route-access ceiling**, not evidence that the user may manipulate every family or trip. For example, an admin role earned through membership still requires handler-level authorization for an unrelated family's data.

## Static route gates

The current SWA configuration protects these paths:

| Route | Gate | Notes |
| --- | --- | --- |
| `/api/access` | `admin` | Legacy access-list management endpoint. |
| `/api/families` | `authenticated` | Handler performs action-specific checks. |
| `/api/trips` GET | `reader` or `editor` | Handler filters returned trips. |
| `/api/trips` POST/PUT | `editor` | Handler still limits the actual changes. |
| `/api/attachments` GET | `reader` or `editor` | Handler checks trip visibility and sharing policy. |
| `/api/attachments` POST | `editor` | Handler checks attachment edit rights. |
| `/api/presence` | `reader` or `editor` | Handler requires a principal; admin stats add another check. |

`/api/roles`, `/api/site-settings`, and `/api/request-access` do not have a matching static route rule. The latter two are intentionally anonymous: site settings returns a limited landing payload, and request-access accepts rate-limited requests. The roles endpoint is needed for role assignment.

All function bindings themselves use `authLevel: "anonymous"`. This makes preserving SWA configuration and handler checks critical: direct or misconfigured deployment paths must not be assumed to receive a binding-level auth barrier.

## Server-side data enforcement

Protected handlers decode the client principal and require it before protected work. Detailed enforcement includes:

- `/api/trips`: ownership, direct email sharing, family role, directional family share, family policy floors, legacy behavior, and family-owner exception for solo-private trips.
- `/api/attachments`: trip visibility plus attachment visibility/edit policy, approved family state, and a limited uploader-delete exception.
- `/api/families`: family/site/primary-admin gates per action, including invites, membership, backups, and settings.
- `/api/access`: requires both route `admin` and a defensive principal-role check.

There are distinct administrative concepts: a primary site admin from environment configuration; additional site admins from `site-admins.json` recognized by the families API; and global SWA `admin` roles. The trips and attachments handlers use a narrower primary-admin concept than the families handler in some paths. Treat this divergence as a high-risk policy boundary and decide explicitly which definition an added feature needs.

## Client-side gates and privacy

The frontend detects `/api/trips` 401/403 responses, clears loaded trip data, and presents sign-in/no-access UI. It hides Add/Edit/Delete and administrative controls based on client-computed role and ownership state. These controls improve usability but are bypassable with direct requests; any matching handler rule must be tested independently.

Presence is a privacy-sensitive exception: the default roster can expose online users' names, emails, and global roles to readers/editors without the family scoping used by trip data. Avoid broadening it accidentally, and assess whether that disclosure matches product expectations.

Trip details, traveler information, itinerary entries, attachments, invite links, and access requests are sensitive. Do not log, copy into test fixtures, or document real values. Use only synthetic data in troubleshooting and verification.

## Security change checklist

1. Identify the route gate in `staticwebapp.config.json` and the function binding/method.
2. Trace principal parsing and every relevant handler authorization branch.
3. Check direct family membership, family ownership, cross-family sharing, `sharedWith`, solo-private behavior, and site-admin handling where applicable.
4. Exercise a denied request, not merely a hidden UI control.
5. Avoid exposing raw upstream/storage errors. Several handlers currently serialize raw error messages in 500 responses; treat that as a remediation area, not a pattern to copy.
6. Keep rate-limit assumptions conservative: the shared limiter is process-local and resets on cold starts or scale-out.

Identity-provider redirect URIs, Azure setting names, and deployment separation are covered in [Development and deployment](../operations/development-and-deployment.md).
