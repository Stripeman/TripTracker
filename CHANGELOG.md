# Changelog

All notable changes to **Multi Family Trip Tracker** are recorded here. The newest release is at the top.

---

## 1.29.7-beta — Fixed: switching Metrics family scope left stale filters behind (showed 0 trips)

### Fixed
- **Switching Metrics' family scope didn't reset the dimension filters (travelers/visit/trip/status/year)** — if you had a traveler chip toggled on while viewing one family (e.g. hers), then switched scope to a different family (e.g. "My family"), that leftover traveler filter stayed active. Since your own trips don't have her family's traveler tagged, every one of your trips got filtered out — showing "no trips" despite having 55. Switching scope now clears all Metrics filters, exactly like the existing "Clear filters" button does.
- **1.29.6 accidentally dropped the "My family" option for site admins** when adding the every-family list — site admins now get "My family" (their own, by name) back at the top, ahead of "Every family" and the individual per-family list.

### Tested
- 8‑scenario check confirming: site admins have "My family" back, the individual/bundle options are unaffected, and — reproducing the exact reported sequence — a leftover traveler filter from a different family now gets cleared on scope switch instead of silently zeroing out an otherwise-correct 55-trip result.
- Deep re-audit of every permission gate after this whole session's changes: 22 trip-level scenarios (view/edit/delete across soloPrivate, family roles, shares, floors, hiddenFromShares), 9 family-scoped bulk-edit scenarios (including multi-family admins switching between families they administer), and 8 family/traveler-visibility + notification-routing scenarios (accessible-family sets, site-admin bypass, kill-switch gates) — all 39 passing, no regressions found from the family-visibility and Metrics fixes earlier in this release.

---

## 1.29.6-beta — Fixed: Metrics scope for site admins didn't list every family individually

### Fixed
- **Site admins only saw "My family" and "Every family (site admin)" in the Metrics scope picker** — no way to isolate metrics to one specific other family, even though a site admin can see all of them. The picker used `baseFamilyScopeOptions()`, which only lists families reachable through actual membership or a family-to-family share — a family visible to a site admin purely by virtue of being a site admin (no share relationship at all) was never listed. Metrics now mirrors the People/Users tab's existing site-admin behavior: every family in the system appears individually, plus the "Every family" bundle.

### Tested
- 6‑scenario matrix: site admin sees the bundle option, their own family, a family actually shared with them, and (the reported bug) a family with no share relationship at all — all listed individually with correct names; non‑admin behavior confirmed unchanged.

---

## 1.29.5-beta — Fixed: shared family's own record was invisible too (deeper follow-up)

### Fixed
- **A deeper instance of the 1.29.4 bug**: even after travelers became visible for shared families, the family *record itself* (`GET /api/families` → `families[]`) still only included families you're a direct member of — a family that only shares trips with you never sent its own name/color/etc. to the client at all. Every UI that looks up a family by id (the Metrics scope picker from 1.29.4, family-name labels on shared trips, and more) silently couldn't resolve it even with the travelers fix in place. Now `families[]` uses the same accessible-family set (your memberships + anyone who shared with you) as travelers and shares already did.

### Tested
- Re-verified the full scenario matrix against the corrected logic: non-admins see their own family plus any that shared with them (and nothing unrelated), site admins still see everything.
- Reviewed api/trips/index.js's own family-access checks (`me.sharesIn`, `me.familyRoles`) — confirmed they were already correct and unaffected; this bug was isolated to the families-listing endpoint.

---

## 1.29.4-beta — Fixed: shared-family data invisible to Metrics (travelers, family scope)

### Fixed
- **A shared family's travelers were never sent to the client at all** — the server's traveler visibility only checked direct family membership (`myFamilyIds`), not shared access, so a family that shared trips with you never had its people show up anywhere that reads the travelers list (Metrics' traveler filter chips, name lookups, etc.), even though you could see their trips. Now travelers are visible for your own families *and* any family that has shared trips with one of yours — mirrors the client's existing `myAccessibleFamilyIds` logic exactly.
- **Metrics' family-scope picker never listed an individual shared family by name** — only "My family" and an opaque "All families I have access to" bundle, so there was no way to isolate metrics to just one shared family, and the default ("My family") silently excluded shared trips unless you remembered to switch to the bundle option. Now every individually-accessible family (yours, plus any that shared with you) appears as its own selectable option, independent of whatever family is selected in the main trip list.

### Tested
- 8‑scenario matrix: shared-family travelers now visible (previously invisible), unrelated families still correctly excluded, site admin still sees everyone, and Metrics scope now correctly isolates to a specific chosen family in addition to "mine"/"all mine"/"all".

---

## 1.29.3-beta — Site-wide settings now log their own distinct activity; cleaner notification wording

### Fixed
- **Site-wide Site Admin actions (Audit log detail, Per-family category limit, email kill switch, default notification prefs, auto-approve, image uploads, public sharing) never wrote an Activity Log entry at all** — so the global bell showed whatever the last *unrelated* action happened to be, making it look like the wrong thing was logged. Each of these now logs its own specific, correctly-worded entry (e.g. "Disabled email notifications site-wide" vs. the site-wide toggle actually flipped), visible only to site admins (they're not tied to any one family).
- **Notification message wording cleaned up**: trip-level messages (edited/deleted/commented/attachment added-or-removed) no longer embed the actor's raw email inline — that was redundant with the name already shown separately, and looked like "terry@example.com edited a trip." Messages are now specific about *what* changed (e.g. "Edited Étretat, France (Jul 2–5)" instead of just "edited a trip"), and the global bell/View‑all popup now resolve the actor's display name the same way the per-family Audit tab already did, with a ✉ link to their email.

### Tested
- Confirmed all 6 previously-silent site-wide actions now produce distinct, correctly-labeled messages with no raw email embedded.

---

## 1.29.2-beta — Trip-level email notifications now also reach the trip's own owner

### Fixed
- **Email for Trip edits, Trip deletes, Comments, and Attachment uploads only went to that family's admins** — if the trip's actual owner wasn't a family admin (e.g. a regular editor's own trip), they never heard about changes someone else made to it. Now the trip's `ownerEmail` is always included alongside the family admins (deduped, and skipped if the owner is the one who caused the event).
- Audited every notification channel for correct recipient scoping: **bell/activity feed** is filtered server‑side by family membership (`visibleTo`), never client‑side, so it can't leak across families; **ownership transfers** already emailed the incoming owner directly; **new trips / category changes** are family‑wide events where "family admins" is the correct audience (no single trip owner to add).

### Tested
- 5‑scenario matrix: owner editing their own trip (no self-notify), an admin editing someone else's trip (owner notified, actor excluded), a third party acting on a trip (both admin and owner notified), owner-who-is-also-admin (no duplicate email), and legacy trips with no owner (falls back to admins only).

---

## 1.29.1-beta — Family detail tab bar redesigned as icons; new Sharing tab

### Changed
- **Family detail tab bar (My Families → [family]) now uses icons for most tabs** instead of text labels, with a hover tooltip: Permissions (lock), Categories (tag), Trips → renamed **Bulk Edit** (checklist), Notifications (bell), Owner (gear). Overview and Audit stay as text.
- **New "Family Settings & Sharing" tab** (share/network icon): the "Families that can see ours" and "Families we can see" sections moved here out of Permissions, which now covers only the edit/attachment/comment/delete floors.

---

## 1.29.0-beta — Reorganized the ⚙ Configuration panel

### Changed
- **New "Site Admin" tab** in the ⚙ Configuration panel, visible to site admins only. The whole Site Administration section (Audit log detail, Per‑family category limit, Disable all email notifications, Default notifications for new families, Primary/Additional site admins) moved out of the System tab into this dedicated tab.
- **System tab reordered**: Clear data now sits above the backup sections instead of after them, so System Backup (Export/Restore selected) and My Backup (export/restore just your own data) are the last things in the tab, as intended.

---

## 1.28.7-beta — Fixed: kill switch was restoring family email settings instead of leaving them off

### Fixed
- **Turning the kill switch back off was restoring each family's previous Email preference** instead of leaving it off — e.g. a family with Category-changes email ON before the switch flipped on would come back ON automatically once the site admin re-enabled email, exactly the opposite of the intent. Fixed: turning the switch ON now force-writes every family's Email toggle (all 7 event types) to OFF right then (not just a visual lock), and turning it back OFF only removes the lock — it never rewrites anything, so families land back at all-off and must deliberately re-enable Email themselves.

### Tested
- 5-step scenario reproducing the exact reported sequence (family turns a toggle on → site admin disables → re-enables) confirms the toggle now stays off instead of springing back on.

---

## 1.28.6-beta — Kill switch replaces the separate bulk email reset

### Changed
- **Removed the separate "Reset every family's email notifications" ON/OFF buttons** (introduced in 1.28.3-beta) — they overlapped confusingly with the kill switch and didn't lock anything, so a family could immediately undo a site-wide "OFF" reset. The kill switch alone now does what that control was meant to: turning it **OFF** sets every family's Email toggle off *and* locks it (can't be clicked); turning it back **ON** only unlocks the toggles again, without forcing any family's setting back on — each family keeps whatever they last had.

---

## 1.28.5-beta — Real email for Comments/Trip edits/Trip deletes; kill-switch lock on family toggles; activity feed cap; family-scoped bulk editor

### Added
- **Family-scoped Trips tab** (My Families → [family] → Trips, that family's admin or a site admin): the same bulk-edit tool as Settings → Trips tab, but locked to just this one family's own trips — no family picker needed since the scope is implicit, and a family admin can never reach another family's trips through it. Fulfills the follow-up noted in 1.28.4.
- **Email now fires for Comments, Trip edits, and Trip deletes**, matching the other four event types (Category changes, Attachment uploads, Ownership transfers, New trips). All 7 Notifications toggles now do something real — previously these three only had working Toast/Bell, and the Email toggle was a no-op. Like the others, email doesn't require Audit log detail to be "Detailed" — only the Bell (Activity Log) entry does; email fires independent of that setting, subject to the per-family pref and the site-wide kill switch.
- **The site-wide email kill switch now visibly locks every family's Email toggle**: while it's on, every family's Email chip in My Families → Notifications shows off and clicking it explains why instead of toggling. Turning the kill switch back off doesn't change anything underneath — each family's actual stored preference (on or off, whatever it was) reappears exactly as it was, now editable again.
- **Activity bell dropdown capped at 200 rows** (most recent first) with a "View all (N more)" link when the feed is longer, opening a popup that lists every entry grouped into Today / Yesterday / This week / Earlier sections — no cap there.

### Fixed
- **Attachments & Storage showed twice on the Family Management Overview tab** — a leftover duplicate block from an earlier edit. Removed; the People section and everything else in Overview is unaffected.

### Tested
- 9-scenario matrix confirming the new email hookups: fires correctly per pref/kill-switch, independent of Bell's `auditDetailed` requirement, and never fires for legacy/unassigned trips.
- 5-scenario matrix confirming the family-scoped Trips tab: a family admin only ever sees their own family's trips through it (never another family's, even by trying), a site admin can use it for any family, and it's cleanly independent from the system-wide Trips tab's own family filter.

---

## 1.28.4-beta — Trips-tab bulk editor is now site-admin-only, sees every trip

### Fixed
- **Settings → Trips tab bulk editor only ever showed trips matching whatever the left search panel happened to be filtered to**, and was reachable by any user with an "editor" role, not just site admins — so a site admin whose left panel was scoped to their own family saw only their own family's trips in what was meant to be a system-wide tool. The tab (and its bulk-edit target set) is now strictly site-admin-only, pulls from every trip in the system by default, and gets its own independent family filter dropdown ("All families" or a specific one) instead of reusing the main list's filter.

### Noted
- A separate, family-scoped version of this same bulk-edit tool (a family admin bulk-editing just their own family's trips, from within My Families) is a reasonable follow-up — not built yet, flagged for a future pass.

---

## 1.28.3-beta — Bulk reset of every family's email notifications

### Added
- **Reset every family's email notifications** (⚙ → Preferences → Site Administration): "Turn ON for everyone" / "Turn OFF for everyone" rewrites the Email toggle across all 7 event types for every existing family in one shot (confirmation prompt first). Unlike the kill switch, this is a one-time reset, not a standing override — families can still fine-tune their own Email toggles afterward in My Families → Notifications. Toast and Bell are untouched. New `resetAllFamilyEmailPrefs` action, site admin only, logged once to the activity feed.

### Tested
- 9-scenario matrix: auth gate, correct per-family/per-key email rewrite while leaving toast/bell untouched, families with no prior prefs at all get every key set correctly, and toggling back on works for all families.

---

## 1.28.2-beta — Site-wide notification defaults + email kill switch

### Added
- **Default notification prefs for new families** (⚙ → Preferences → Site Administration → "Default notifications for new families"): site admin sets the Toast/Bell/Email defaults applied once, at creation time, to every brand-new family (self-serve, auto-created from an access request, or created via the debug/admin flow). Existing families are never retroactively changed — those stay edited per-family in My Families → Notifications. New action `setDefaultNotifPrefs` (site admin only).
- **Site-wide email kill switch** (⚙ → Preferences → Site Administration → "Disable all email notifications"): one toggle suppresses *every* courtesy email in the app — invites, family shares, category changes, attachment uploads, ownership transfers, new trips — regardless of any family's own notification settings, for abuse/incident response. Toasts and the Activity Log (bell) are unaffected since they don't touch the outside world. New action `setEmailKillSwitch` (site admin only); the explicit "send invite email" action is blocked outright (403) while the switch is on, since that's a directed send rather than a background courtesy notification.

### Tested
- 11-scenario matrix covering both new site-admin actions: auth gates, default-pref application to new-vs-existing families, and the kill switch overriding both per-family and default email preferences — all passing.

---

## 1.28.1-beta — Notifications tab; hover-popover clipping fix

### Added
- **Notifications tab** (per family, admin‑only, in **My Families → [family] → Notifications tab**): independent **Toast** (live in‑app), **Bell** (Activity Log), and **Email** toggles for seven event types — Category list changes, Attachment uploads, Ownership transfers, New trips, Trip edits, Trip deletes, and Comments. Everything defaults to on. New `setFamilyNotifPrefs` action (family admin/owner or site admin only) and a shared `api/_shared/notify.js` helper (`notifPrefOn`, `sendEmail`, `familyAdminEmails`) used across the families/trips/attachments APIs. Courtesy emails go to a family's admins (excluding whoever caused the event); ownership‑transfer emails also go to the new owner. Toast delivery rides the app's existing 30s activity poll — a genuinely new activity item with its toast pref on triggers a live toast for anyone online, skipping the person who caused it.

### Fixed
- **Hover popovers clipped at the bottom of the browser** instead of flipping above the cursor — affected the traveler‑stats popover on a trip card, the online‑presence tip, and the admin login‑stats bubble. All three now flip above the cursor when they'd overflow the viewport.

### Tested
- Full scenario matrix (20 cases) for the new Notifications tab: `setFamilyNotifPrefs` auth gates (non‑admin blocked, admin‑of‑other‑family blocked, family admin/site admin allowed), per‑channel independence (toggling one channel never touches the other two), invalid key/channel rejection, per‑event bell/email gating at each of the four wired call sites, and the client‑side toast diffing (skips already‑seen activity, skips your own actions, respects the per‑family toast pref, ignores unmapped event types) — all passing.
- Re‑verified family‑approval enforcement end‑to‑end after the notification-plumbing changes — no regressions.

---

## 1.28.0-beta — Real family-approval enforcement, category safety checks, permission-gate audit

### Added
- **Family approval is now actually enforced**, not just a cosmetic flag. A family pending approval can no longer create trips, invite/share/promote members, transfer ownership, or upload attachments — site admins still bypass every check. A "Pending approval" banner appears on the Add Location form and the relevant actions when your active family isn't approved yet.
- **Real-time approval status** — the app already polls for family updates every 30s and on tab focus; now the moment a pending family flips to approved, everyone in it gets a toast ("'<Family>' has been approved — you can add trips now") instead of a silent state change.
- **Usage warnings before touching a category in use**: removing a single custom Visit Type / Trip Type / Status item now checks whether any of that family's trips use it — if so, shows the affected trips and a "Reassign to…" picker before deleting. "Revert to site default" has the same check for every custom item at once.

### Fixed
- **Shared-family editors couldn't upload attachments** — the client-side attachment-upload check only recognized your own family's role, not a role granted via family-to-family sharing, so a shared editor saw no upload button even though the server would have allowed it. Now matches server logic exactly.
- **Comment gate let readers post on trips owned by other members of their own family** regardless of that family's comment-permission floor — the client check only looked at "is this trip unassigned or mine," missing the family-membership + floor check entirely. Fixed to mirror the server.
- **Category revert/reassign wasn't scoped to the reverting family** — reassigning a status/type key during a "Revert to site default" could rewrite matching values on *any* family's trips, not just the one being reverted. Now scoped by `familyId`.
- **Category limit of exactly 0 silently fell back to 40** on both client and server (`Number(0) || 40` treats 0 as falsy) instead of clamping to the minimum of 1.
- **Add Location modal rendered broken/unbounded** after the pending-approval banner was added — a stray extra closing `</div>` closed the whole modal wrapper early, so the tabs and form spilled out with no width constraint. Removed the duplicate tag.
- Full permission-gate audit this cycle covered trip view/edit/delete, itinerary edit, attachment upload, comment posting, family delete, category limits/overrides, audit-level control, and trip visibility/sharing tiers — all passing except the four fixes above.

---

## 1.27.0-beta — Per-family Visit Type / Trip Type / Status lists; sharing moved under Permissions

### Added
- **Per-family category overrides**: each family can now run its own Visit Type, Trip Type, and Status lists instead of the site-wide defaults — gated to that family's owner/admin via a new **Categories** tab in My Families. Toggle "Use custom list" to start from a copy of the site default, edit/add/remove items freely, or "Revert to site default" to go back to inheriting. New trips for that family show its effective list; trips already tagged with a family-only type still resolve their label/color correctly everywhere (cards, filters, metrics, CSV export) via a merged lookup.
- **Site admin control over the per-family category limit**: ⚙ → Preferences → Site Administration → "Per-family category limit" (1–200, default 40) caps how many items a family's custom list can hold, enforced server-side.
- **Unclaimed trips (Settings → Trips tab, site admin only) are now clickable** — click a trip's name to select and view it before deciding who to assign it to, instead of just seeing a place/date row.
- Backend: new `setFamilyCategories` and `setFamilyCatLimit` actions (family admin/owner or site admin only, respectively), logged to the family's Audit tab.

### Changed
- **"Families that can see ours" / "Families we can see" moved into the Permissions tab** — previously shown under every tab in My Families, now scoped correctly with the rest of the sharing controls.

---

## 1.26.0-beta — Family detail tabs; audit detail; Trips tab rebuilt

### Added
- **My Families detail panel now has tabs** (visible to family admins): **Overview** (branding, photo uploads, owner, attachments & storage summary, people), **Permissions** (the Trip Permissions block, moved out of Overview), **Audit** (the Activity Log, moved out of Overview), and **Owner** (Transfer Ownership, gated to the family's actual owner — admins who aren't owner don't see it).
- **Activity Log entries now show who did it and what changed**: the actor's display name (falls back to email if they have no traveler profile) with a small ✉ link to email them, plus the trip-permission log message now lists the specific settings that changed (e.g. "who can edit trips → Admin only") instead of a generic "updated trip permissions."
- **Rebuilt the Settings → Trips tab**, which had gone empty (its logic and data existed but no markup rendered it): unclaimed-trips list with per-trip owner assignment plus "claim all as me," and a bulk-edit tool (owner/notes/visit type/trip type/travelers/sharing) scoped to whatever the left-panel filters currently match.

### Changed
- De-duplicated the family-scope option builder used by the Metrics and People family-scope pickers into a single shared helper (`baseFamilyScopeOptions`) — no user-visible change.

### Fixed
- Confirmed the "activeTouches already declared" console error reported earlier was a stale hot-reload artifact from a mid-edit session, not a persisted bug — a fresh page load renders cleanly with no console errors (verified via full code review pass: no duplicate method names, no duplicate API action handlers, all routes correct).

---

## 1.25.1-beta — Code cleanup

### Fixed
- Confirmed the "activeTouches already declared" console error reported earlier was a stale hot-reload artifact from a mid-edit session, not a persisted bug — a fresh page load renders cleanly with no console errors (verified via full code review pass: no duplicate method names, no duplicate API action handlers, all routes correct).

### Changed
- De-duplicated the family-scope option builder used by the Metrics and People family-scope pickers into a single shared helper (`baseFamilyScopeOptions`) — no user-visible change.

---

## 1.25.0-beta — Attachments & storage view; itinerary shared-editing; trip-deletion floors

### Added
- Family admin panel: **Attachments & Storage** section — file count, total size (25MB/file cap noted), and a per-file list (name, trip, size) for that family's trips.
- Family admin panel: **Activity Log** section — chronological log of that family's own admin events (people/roles, ownership transfers, trip-permission changes, sharing), scoped to just this family (separate from the app-wide activity bell). Ownership transfers and trip-permission changes are now recorded to it (previously unlogged).
- **Audit log detail** setting (⚙ → Preferences → Site Administration, site-admin only): Essential (default, unchanged behavior) / Detailed (adds trip create/edit/delete, itinerary edits, comments) / Verbose (adds sign-ins). Applies to the per-family Activity Log across `api/trips`, `api/attachments`, and `api/presence`.
- **Itinerary editing**: family editors (per the edit floor) can now edit itinerary day-by-day directly from the Itinerary modal, with Edit/Save/Cancel. New per-family toggle **"Shared families can edit itinerary"** (off by default) — itinerary always follows the trip's own sharing tier and is never public regardless of this setting; the modal shows a note to that effect for shared viewers.
- Trip Permissions gains two delete-related toggles: **"Any family member can delete this family's trips"** (off by default — normally only admins can delete any trip; editors can only delete trips they created) and **"Shared families can delete this family's trips"** (off by default, never on unless explicitly enabled).

### Fixed / hardened
- The Edit/Attachment/Comment role-floor settings added last release were client-side only — `api/trips` and `api/attachments` now enforce `editFloor`/`attachFloor`/`commentFloor`/`memberDeleteAny`/`sharedCanDelete` server-side too, so the floors are real security boundaries, not just UI hints.
- Comments and itinerary edits from people without full trip-edit rights (e.g. a family's own reader posting a comment, or a shared family editing itinerary once opted in) now persist correctly — previously the server's whole-trip edit gate silently dropped these changes for anyone without edit rights on the trip.
- Attachments hidden from shared families (via "Attachments visible to shared families" = Off) are now also stripped server-side from the trips feed and blocked on direct download — not just hidden in the UI.
- The trip-delete button in the edit form now matches the server's real rule (family admins can delete any trip in their family; editors only their own) instead of a coarser check that could show the button when the save would actually be rejected.

---

## 1.24.1 — Edit/Stats/Debug consolidated into the detail card's action row

### Changed
- Trip detail card: Edit, Traveler Stats, and Debug buttons moved out of the top-right corner (across all header layouts — banner, thumbnail, framed, no-photo) into the single bottom action row, alongside Gallery/Itinerary/Comments/Attachments/Permissions. Edit is the leftmost button in that row. Only the × (close) button remains up top.

---

## 1.24.0 — Trip card action row cleanup; landing page polish

### Changed
- Trip card bottom action row is now a single row of circular icon buttons — Gallery, Itinerary, Comments, Attachments, Permissions — each with a count badge where applicable. Replaces the old "Edit" button, top-right lock icon, and the separate combined "Details" shortcut.
- Itinerary icon now shows a day-count badge, matching Gallery/Comments/Attachments.
- Landing pages: merged "How it works" into the Features section (one nav link, one target) across all three variants; rewrote feature copy to sell concrete benefits instead of generic labels.
- Added a testimonials section (toggle + admin-managed quotes) available across all landing variants.

---

## 1.23.1-beta — Sign-in redirected back to landing page after auth

### Fixed
- After completing sign-in, Google/Microsoft/Yahoo redirected to `/` — which, once a landing-page variant is active, bounces straight back to the landing page instead of into the app. All auth links now redirect to the app itself post-login.

---

## 1.23.0-beta — Mobile responsive pass; fixed landing-page sign-in loop

### Fixed
- **"Sign in" / "Get started" / pricing CTA buttons on the landing page looped back to itself** instead of reaching the app — they linked to `/`, which (once a landing variant is active) redirects back to the landing page. Now they link straight to the app.
- Landing page footer version was a hardcoded string that would drift; it now reads the live `APP_VERSION` straight out of the app file at load, so it can never go stale.

### Changed
- **Responsive pass on the main app** for phones/small tablets: top bar now wraps instead of overflowing (title shrinks, tagline hides), icon buttons resize down at narrower widths, "Add location" collapses to icon-only under 420px, and left panel/detail card/metrics/config panel positions adjust to clear the taller wrapped header. Added safe-area-inset padding for notched phones.

---

## 1.22.0-beta — Merged "How it works" into Features; added testimonials

### Changed
- **Removed the separate "How it works" section** from the landing page — its 3 steps (start your family / log a trip / share it) are now part of the single **Features** section/link, so there's one clear scroll target instead of two thin ones. Applies to all three landing variants.

### Added
- **Customer testimonials section** on the public landing page — off by default. Site admin adds/edits quotes (with name + family, optional) from ⚙ Settings → System → Public Landing Page, and flips it on once there's at least one. Hidden automatically if the list is empty.
- New `/api/site-settings` fields `showTestimonials`/`testimonials`; new `/api/families` actions `setShowTestimonials` / `setTestimonials` (site admin only).

---

## 1.21.0 — Landing page control moved to System settings; fixed broken picker

### Fixed
- The public-landing-page variant picker was silently broken since 1.19.0 (missing wiring — no options ever rendered). Rebuilt it from scratch.

### Changed
- **Moved the landing-page picker out of Site Family Management into ⚙ Settings → System** (site-admin only), grouped with the other global toggles instead of family admin.
- Added a real 4th option, **"Sign-in only"** — the original behavior where unauthenticated visitors go straight to the sign-in prompt with no marketing page. This is now the default (unchanged behavior for existing deployments). The other three are named **Classic Split**, **Centered Globe**, and **Family Showcase** (previously just "A/B/C").
- `index.html` now checks the site setting before redirecting: "Sign-in only" → straight to the app; any other variant → the public landing page.
- Pricing-section toggle only shows once a landing variant (not "Sign-in only") is selected, since it has nothing to attach to otherwise.

---

## 1.20.0 — Comments & attachments moved to modals, multi-file upload

### Changed
- **Comments** and **Attachments** are no longer shown inline on the trip detail card — each now has its own button (with a live count) that opens a modal, matching the existing Gallery/Itinerary pattern. Keeps the card compact for trips with a lot of discussion or files.
- **Attachment upload now accepts multiple files at once** (select or drag several) instead of one at a time; each uploads and reports errors independently, so one oversized or failed file doesn't block the rest.

---

## 1.19.0 — Landing page pricing section

### Added
- **Pricing section on the public landing page** (all three layout variants) — three tiers (Solo Family / Extended Family / Whole Clan). Off by default; a site admin turns it on from Site Family Management → "Pricing section on landing page", same on/off control style as the existing site-wide toggles.
- New `/api/site-settings` field `showPricingSection` (public, read-only) and `/api/families` action `setShowPricingSection` (site admin only) to control it.

---

## 1.18.0 — Attachments, notifications, rate limiting, public pages

### Added
- **Attachments per trip (Cloud mode):** attach real files — PDF, images, Word, Excel — up to 25MB, stored in Blob Storage (metadata only on the trip itself). Shown under the detail card's Comments section, with download and delete (uploader, trip owner, or site admin).
- **In-app activity feed:** a bell icon in the header (badge dot for unseen events) opens a dropdown of recent invites, family shares, and access approvals.
- **Family-share email:** inviting another whole family now emails that family's admins (via Resend, same setup as existing invite emails) in addition to the existing person-invite and access-approval emails.
- **Basic API rate limiting:** per-user limits on `/api/trips`, `/api/attachments`, and per-email limits on `/api/request-access`, to blunt retry storms/scripted abuse. In-memory/per-instance — a first layer, not a hard guarantee at scale.
- **Public-facing pages:** a marketing landing page (two layout options) and a draft Terms of Service page (placeholders for entity name/contact/jurisdiction — needs review before real use).

### Changed
- `DEPLOY-azure.md`: noted that custom domains added via DNS (e.g. a GoDaddy-parked domain) need their own Authorized redirect URI added in each OAuth provider, same as preview slots.

---

## 1.17.0 — Light/Dark mode, globe realism, and modal polish

### Added
- **Appearance: Dark / Light toggle** in Preferences → Settings, independent of the 9 accent themes (and Realistic space) — pick any color theme, then flip Dark/Light on top of it. Replaces the old standalone "Light" theme entry (existing users on Light are migrated automatically).
- Preferences → Globe: **Cloud drift speed** slider (0–3x), shown when Realistic space is active.

### Changed
- **Realistic space** globe: land is now one continuous latitude-banded terrain gradient (ice → forest → desert → tropics, mirrored both hemispheres) instead of per-country flat fills — no more patchwork look at country borders. Added mottled terrain texture and softer terminator shading.
- Clouds rebuilt as stretched, wispy swirl systems for a more realistic satellite-photo feel, denser than before.
- All modal dialogs (Help & guide, permissions, delete confirmations, transfer ownership, cloud access message) are now top-justified like the trip form, so they don't jump vertically when their content changes.
- Light mode's own tone dialed back — less bright/washed out.
- **Theme + Dark/Light are now per-person**, not shared: each browser/person keeps their own choice, stored locally and never synced to the family's cloud config. New installs default to **Realistic space** + Dark.
- **Admins can lock the theme for everyone** — a "Lock for everyone" toggle in Preferences → Appearance (site admins only) freezes the current theme + Dark/Light choice as the enforced look for all users; the picker is disabled (with a 🔒 note) for everyone else until an admin turns it back off.

---

## 1.16.1-beta — Form top-justified

### Changed
- The trip Add/Edit popup is now top-justified (not vertically centered), so switching tabs with different content heights no longer shifts the whole modal up/down.

## 1.16.0-beta — Unsaved-changes warning + trip comments

### Added
- **Unsaved changes warning:** closing the trip popup (× / backdrop / Cancel) with edits pending now confirms before discarding. Same guard on browser tab close/refresh while the form is open and dirty.
- **Comments per trip (Cloud mode):** a Comments section on the detail card — name, timestamp, and text per comment, delete for your own comments (or the trip owner/site admin), and a quick add box. Starts Phase 3 priority #3 (richer trip content).

## 1.15.1-beta — Permissions tab

### Changed
- Renamed the trip form's "Sharing" tab to "Permissions" — same lock-icon permissions modal as the trip card. In Local/Demo mode it now shows an explanatory note instead of appearing empty.

## 1.15.0-beta — Tabs inside the trip form

### Changed
- The trip popup now has 4 tabs — Details, Notes & photos, Itinerary, Sharing — instead of one long scroll. Permissions ("Who can see this") lives on its own Sharing tab, separate from photos.

## 1.14.0-beta — Trip form is now a popup

### Changed
- The Add/Edit trip form was a 388px panel slid in from the right edge of the screen; it's now a centered popup modal (like the Family and Permissions modals), 640px wide with its own backdrop, so the growing set of sections (photo, gallery, itinerary, permissions) has more room to breathe instead of being crammed into a narrow strip.

## 1.13.0-beta — Phase 3: reworked sharing permissions + image-upload controls

### Added
- **Unified Permissions modal**: the lock icon on a trip card (and a new picker button in the trip form's "Who can see this" section) now opens one popup with two tabs — Visibility and Specific people — instead of the old cramped inline row of buttons.
- **Two new visibility tiers**: "Only me" (hidden from literally everyone, including your own family — new, requires nothing else to be shared) and "Only my family" (promoted from the old "keep private from shares" checkbox into a first-class tier). Combined with the existing "All shared families" (now the explicit default) and "Public" (renamed from "All users"), that's the full four-tier model end to end.
- **"Specific people" is explicitly additive** — picking people always layers on top of whichever visibility tier is selected (even "Only me"), and the modal says so.
- **Site-wide + per-family image-upload controls**: a site admin can turn photo/gallery uploads off for the whole app (Settings → Site Family Management); each family's admin can override that default for their own family (People & Family Management → their family panel). The trip form hides the Photo/Gallery sections (with an explanation) when uploads are off for the trip's family, and the server strips any photo/gallery on save if uploads are disabled for that family — enforced both places.

### Changed
- Server-side (`api/trips`): added `soloPrivate` (true = visible to nobody but the owner, overriding even family membership) alongside the existing `hiddenFromShares`; `sharedWith` is now always additive regardless of the base tier, rather than only applying under a "shared" visibility value.

## 1.12.0-beta — Phase 3: richer trip content (item 3.2 — itinerary) + lightbox fixes

### Added
- **Day-by-day itinerary**: an optional "+ Add day-by-day notes" section on the trip form generates one note field per day in the trip's date range (capped at 60 days). Notes are pruned to the current range and saved keyed by date.
- Detail card shows a "View itinerary · N days" button (same collapsed-behind-a-button pattern as the gallery) opening a read-only modal listing each day's notes.

### Fixed
- **Gallery lightbox was non-interactive** — the close button, prev/next arrows, and backdrop-click didn't respond to clicks; they all sat under an app-wide overlay that intentionally sets `pointer-events:none` so clicks reach the 3D globe through the gaps, and the lightbox (and the new itinerary modal) forgot to opt back in with `pointer-events:auto`. Fixed on both.
- Lightbox images were rendering at their native pixel size instead of filling the viewing area (only `max-width`/`max-height` were set, which cap size but don't grow a smaller image to fill it). Now sized to fill 90vw × 78vh with `object-fit:contain`.

## 1.11.1-beta — Phase 3: gallery follow-up fixes

### Fixed
- Multi-select on the gallery file picker wasn't actually enabling (a boolean attribute rendered as a literal empty string) — you could only add one photo at a time. Now picks multiple at once.
- Detail card's gallery could push the card's top off-screen when a trip had many photos (the card grows upward, anchored to its bottom-fixed position, with no scroll). Replaced the inline thumbnail strip with a single "View gallery · N" button that opens the lightbox — card height no longer depends on gallery size.
- Gallery photos were stored at a very small resolution (200px), so the full-screen lightbox view looked blurry/tiny. Bumped to 480px.

## 1.11.0-beta — Phase 3: richer trip content (item 3.1 — photo gallery)

### Added
- Trips can now hold multiple photos: a new **Gallery** section on the trip form under the cover photo, accepting multi-select and adding thumbnails as tiles you can remove individually.
- Trip detail card shows a **Gallery** strip below the notes when a trip has extra photos; clicking one opens a full-screen **lightbox** with prev/next nav and a position counter.
- Photo counts (profile bubble, per-person management view, metrics) and the "remove all my photos" bulk action now include gallery photos alongside the cover photo.
- Photo `.zip` export now includes every gallery image per trip (numbered when a trip has more than one), not just the cover.

## 1.10.1-beta — Phase 3: mobile polish (item 2, partial)

### Fixed
- People & Family Management's sidebar+detail split layout (fixed 230px sidebar) didn't fit small screens at all. On ≤720px it now goes full-screen and stacks vertically — sidebar becomes a scrollable strip capped at 34vh, detail panel takes the rest.
- Audited all other modals (help, calendar, delete confirmations, add-person, new-family) — all already use `min(Npx, vw%)` sizing and were already mobile-safe.

---

## 1.10.0-beta — Phase 3: cross-family sharing UX (item 1)

### Added
- **"Families we can see"** list in My Family Management, alongside the existing "Families that can see ours" — two-sided visibility into cross-family shares instead of a one-way outgoing list. Incoming shares are read-only here (only the granting family can revoke).
- **Per-trip visibility override**: a new "Keep private even from families we've shared with" checkbox on the trip form. Even when your family broadly shares with another family, individual trips can opt out — enforced server-side in both view and edit checks, not just hidden in the UI. Shown as a "🚫 Not shared out" badge on the trip when applicable.

---

## 1.9.17-beta — Delete my own account

### Added
- **"Delete my account…"** in the Profile popup — self-service account deletion with the same confirmation pattern as family/user delete: shows exactly how many families you'd leave, trips you own (+ photos), other trips you're tagged on, and non-account people you've added, before anything happens.
- Blocked (with a clear message) if you're the sole active admin of any family — transfer ownership or promote another admin there first.
- Two modes, like person delete: keep your trips (unassigned) or delete them too. Either way your tag is removed from other people's trips, your membership is removed from every family, and your traveler/person record is deleted. Your sign-in itself is never touched by the app (you're signed out at the end, but the identity provider account is untouched).

---

## 1.9.16-beta — Onboarding now branches on auto-approve

### Changed
- First-login onboarding now branches on the "Auto-approve new families" setting:
  - **ON**: welcomed with "Thanks for registering!" and taken straight to create their own family (unchanged flow, updated copy).
  - **OFF**: no self-serve family creation offered — an access request is auto-filed on their behalf and they see "Thanks for registering! Your request has been submitted and is awaiting site-admin approval," landing in Pending Actions for review.

---

## 1.9.15-beta — Onboarding had no path back into an existing family

### Fixed
- A signed-in user with zero family memberships (e.g. someone just removed from a family) was only ever offered "Create a new family" or "Skip for now" — no way to ask to (re)join an existing family, and no visibility for the site admin either way. The onboarding modal now has a "Request access instead" link that submits a normal pending access request (shows up in Pending Actions), reusing the same persistence as the signed-out request form.

---

## 1.9.14-beta — "Delete family" button was calling an undefined method

### Fixed
- **`confirmFamilyDeleteAll` was never defined** — the "Delete family" button's `onClick` referenced a method that didn't exist in the logic class, so clicking it silently threw and did nothing at all. Added the missing method.
- Removed the native `disabled` attribute from both delete buttons in the confirmation modal (a disabled button also fires nothing on click, with zero feedback) — they now always respond, with a toast explaining what's still needed if the required checkboxes aren't checked.

---

## 1.9.13-beta — Clearer wording on family-delete confirmation

### Changed
- "User accounts tied to this family" checkbox relabeled to "Remove their association with this family," and the explanatory note is now a highlighted warning: removes the association only, does NOT delete the account, sign-in, or other family memberships.

---

## 1.9.12-beta — Delete-family confirmation lists who's affected

### Confirmed safe
- Checked: "User accounts tied to this family" in the delete-family flow only removes that person's **membership row for this family** (`m.familyId !== familyId` scoping) — it never touches their sign-in, their account, or their membership/role in any other family they belong to.

### Added
- The delete-family confirmation now lists the actual non-account member names and user-account emails under each checkbox (up to 6, then "+N more"), instead of just a count — no more guessing who's affected.

---

## 1.9.11-beta — Backup list was missing account-only people

### Fixed
- The backup "include these users" list only read `cfgTravelers`, but the People & Family panel actually shows a merged list — `cfgTravelers` plus a synthesized row for every membership/account that signed in or was approved but was never explicitly added as a "person." Those accounts (and their families) were invisible in the backup list even though they own trips. The backup list now uses the same merged source.

---

## 1.9.10-beta — Code review pass

### Fixed
- `myTravelerKey()` was defined twice in the logic class. The second, weaker definition (no email trim/case-safety) silently overrode the first, more robust one — removed the duplicate.

---

## 1.9.9-beta — Backup checkboxes now family-scoped

### Fixed
- The backup-list checkbox identity was still the bare traveler `key`, so two people in different families sharing the same legacy key toggled the same checkbox and the same trip-inclusion logic — a real gap given this is now a multi-family app. Row identity and trip-tag matching are now scoped by `key + familyId` end-to-end, so families with colliding legacy keys are handled correctly and independently.

---

## 1.9.8-beta — Backup list regression fix

### Fixed
- The 1.9.7 fix deduped backup-list rows by traveler `key` alone. Some legacy people (created before a key-collision fix shipped this session) share the same short key across different families — deduping by key alone silently dropped one of two real people with an email from the list. Now dedupes by key+familyId instead.

---

## 1.9.7-beta — Backup user list now reflects real trip tagging

### Fixed
- **Backup "include these users" list** only showed people with an email set, because it only recognized `ownerEmail`. Trips are actually tagged to people via a `travelers[]` array (which includes name-only people) — the list now has one row per traveler (email or not), keyed by their traveler key.
- **Which trips a checkbox controls** now matches reality: a trip is included if *either* its owner or *any* tagged traveler is checked, not just the owner.

---

## 1.9.6-beta — Migration buttons hide once run

### Changed
- **"Migrate legacy data → default family"** button now hides itself once every trip has a `familyId` (nothing left to migrate).
- **"Backfill travelers → per-family storage"** button now hides once the deployment is fully migrated (badge already showed "LIVE"; the button was redundant past that point).
- Dropped `settings.travelers` entirely — people are now read/written exclusively via per-family `travelers.json`, with no legacy fallback branch. Backup export/import updated to carry people alongside data/settings so this didn't create a gap in backups.

---

## 1.9.5-beta — Unified delete confirmation

### Added
- **Deleting any person now shows a confirmation** with trip impact — trips owned,
  trips tagged, and a **per-family breakdown** of how many trips are affected in each
  family — instead of the old behavior where a name-only person tagged on a trip
  couldn't be deleted at all (hard-blocked) while an account holder got a confirm
  dialog with no family breakdown. Both flows are now the same modal, with button
  wording adapted for whether the person has an account.

### Fixed
- The confirm-then-delete flow could still be rejected server-side because the trip
  data update (disassociating the person) and the traveler-record deletion weren't
  sequenced against the server's own trip-usage guard — the confirmed flow now tells
  the server this is a reviewed, confirmed deletion.

## 1.9.4-beta — Explicit default family + add-person popup

### Added
- **"Set as default family"** — a star button on each row in "My Families" lets you
  explicitly pick which family loads by default at sign-in (only one can be default;
  picking a new one clears the old). The sign-in default now prefers this explicit
  choice over the previous guess-by-ownership/admin-role logic, which could pick the
  wrong family for someone who owns or administers more than one.
- **"+ Add person" is now a popup** (name, color, optional email) instead of an inline
  editable row — clearer, and removes a subtle race in the old inline-add flow.

### Fixed
- **Duplicate "add a person" entry points.** A legacy "Add family member (no email)"
  input existed separately from "+ Add person" and wrote to a different, no-longer-
  displayed backend concept — removed; "+ Add person" already supports no-email
  entries.
- **Adding a person could silently fail to save** if a short auto-generated key (`p`,
  `p1`...) collided with one already in storage from earlier testing — the server now
  resolves the collision instead of rejecting the add.
- **A leftover reference to a renamed variable** (`activeFam` → `activeFamObj`) in the
  family switcher's style crashed `renderVals()` on load in some cases.
- **Transfer-ownership dropdown pre-selected the first member**, so clicking Transfer
  without touching the dropdown could transfer to the wrong person by accident. It now
  requires an explicit choice (blank by default; button disabled until one is picked).

## 1.9.3-beta — "Viewing a family" vs. "your active family" decoupled

### Bug
- **Browsing a family under "My Families" silently changed your active family**,
  which drove the left panel's trip-family filter/dropdown — clicking a family row
  just to look at it would reshuffle what trips you saw. Viewing a family's details in
  People & Family Management is now fully separate from your app-wide active family; a
  small "Use this"/"Active" pill on each row lets you deliberately switch instead.
- **The whole family detail panel (rename, color, logo, members, invites, sharing,
  transfer ownership, delete, "+ Add person", role/active toggles, last-admin checks)
  was silently keyed to your TRUE active family**, not whichever family you were
  actually viewing — so most of it broke or silently no-oped the moment you looked at
  a family other than your own. Every action in that panel now consistently targets
  the family actually on screen.
- **"Create a new family" appeared once per family** in the detail panel (looked like
  it belonged to whichever family you were viewing). Moved to a single "+ New" button
  next to the "MY FAMILIES" header.

## 1.9.2-beta — Staging bugfixes, round 2

### Bug
- **Transfer ownership button did nothing on first click.** The dropdown's displayed
  default (first available person) only lived in the render's fallback logic, not
  actual state — clicking Transfer without first touching the dropdown read an empty
  value and silently no-opped. The handler now mirrors the same default.
- **"My Families" didn't list your own family first.** Now sorted with your home
  family at the top.
- **"+ Add person" in My Family Management could still add to the wrong family.** It
  was reusing Site User Management's logic, which could pick up a stale "specific
  family" selection left over from browsing there. It now always targets the family
  panel you're actually viewing.

## 1.9.1-beta — Staging bugfixes (post phase-2 cutover)

### Bug
- **Adding a person went to the wrong family.** "+ Add person" in Site User
  Management always used the left panel's active family, not whichever family you'd
  browsed to via that screen's own FAMILY dropdown — so a site admin viewing "The
  Smiths" could silently add a new person to their own family instead.
- **No way to add a person from "My Family Management".** That per-family panel had no
  "+ Add person" button at all — it only ever existed on Site User Management, which
  is now gated behind Site Management (site-admin only), leaving regular family admins
  with no way to add anyone. Added an "+ Add person" button directly to the family
  detail panel, scoped to the family being viewed.
- **Can't reassign a person's family from "My Family Management".** The FAMILY (and
  OWNED BY) picker only existed in the Site User Management copy of the person editor
  — the condensed version built for the per-family panel was missing both sections
  entirely. Added them, so family admins can now move/reassign people from their own
  family panel too, not just Site Management.
- **A new name-only person showed no owner.** "OWNED BY" only listed people who
  already had a materialized traveler record, so the person who actually created the
  entry (the current admin) often didn't appear as an option — even though `createdBy`
  was set correctly underneath, it looked unassigned. Owner options are now built from
  real family memberships, so the creator always shows up.

## 1.9.0-beta — Traveler storage, phase 2 (cutover)

### Added
- **Per-family traveler storage is now live** (after running the one-time backfill).
  People are read from and saved to the new server-enforced `travelers.json` instead of
  the old shared `settings.travelers` — every add/edit/delete/move now goes through a
  family-admin-gated API action, closing the gap where a raw API call could set any
  `familyId`. Deleting a traveler is now also blocked server-side if they're still
  tagged on a trip.
- Site Management → Site Family Management shows a **migrated / not migrated** badge
  next to the backfill button.

### Notes
- Fully backward compatible: an unmigrated deployment behaves exactly as before. Once
  a site admin clicks "Backfill travelers → per-family storage", the app switches over
  automatically — no other user-facing change.
- See `TRAVELER-STORAGE-PLAN.md` for the full status, including the couple of
  deliberately-deferred rough edges (stale `settings.travelers` left in place as inert
  dead weight; the raw settings-debug-JSON `travelers` field no longer round-trips
  once migrated).

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
