# TripTracker Claude Code Instructions

Read and follow `AGENTS.md` before inspecting or modifying this repository.

Also read:

- `openwiki/quickstart.md`
- The OpenWiki pages relevant to the requested task
- The actual source and configuration files involved

## Working Method

Before editing:

1. Inspect the current implementation.
2. Identify callers, API routes, configuration values, stored-data fields, and
   tests affected by the change.
3. Confirm whether the requested behavior already exists.
4. Describe a brief plan for changes involving multiple files.

## Editing Rules

- Prefer targeted edits over full-file rewrites.
- Preserve the repository's formatting and naming conventions.
- Do not make unrelated improvements.
- Do not remove fallback, validation, or error-handling logic without a clear
  reason.
- Do not change API contracts or persisted trip-data formats without tracing
  every consumer.
- Do not introduce dependencies when the current stack can reasonably support
  the change.
- Do not replace working code with pseudocode, placeholders, or incomplete
  implementations.
- Do not modify files under `logs/codex-runs/`.

## TripTracker Requirements

Preserve:

- Azure Static Web Apps routing.
- Frontend/API compatibility.
- Authentication and role boundaries.
- Persistent storage through the API.
- Existing trip-data compatibility.
- The production custom domain `www.triptracking.org`.
- Production and preview-environment separation.

Never place credentials, private traveler information, access tokens, storage
keys, or deployment tokens in source, documentation, tests, or logs.

## Command Safety

Do not:

- Deploy or modify Azure resources without explicit approval.
- Change DNS or custom-domain settings.
- Delete persisted trip data.
- Commit or push automatically.
- Force-push.
- Discard uncommitted work.
- Run destructive storage operations.

Explain any destructive local command before executing it.

## Final Response

Report:

- Changes made.
- Files modified.
- Commands and tests executed.
- Results.
- Anything not verified.
- Remaining risks or recommendations.

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->