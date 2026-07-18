# TripTracker Repository Agent Instructions

## Read Before Making Changes

Before modifying this repository:

1. Read `openwiki/quickstart.md`.
2. Read the OpenWiki pages relevant to the requested task.
3. Inspect the current source files and configuration involved.
4. Inspect `package.json` and use the scripts actually defined there.
5. Treat current source and configuration as authoritative when documentation
   differs from implementation.

Do not infer behavior solely from filenames, comments, screenshots, or legacy
deployment documentation.

## Project Guardrails

TripTracker is an Azure Static Web Apps application.

Preserve the following unless the user explicitly requests a change:

- Frontend and managed API compatibility.
- Existing API route contracts.
- Authentication and authorization behavior.
- Trip-data formats and storage compatibility.
- Separation between deployed static content and persisted trip data.
- Custom-domain compatibility with `www.triptracking.org`.
- Existing responsive behavior and supported browsers.
- Current production and preview-environment separation.

Persistent application data must be written through the application API and its
configured storage service. Do not implement a feature by modifying a JSON file
inside the deployed website.

## Change Guidelines

- Make focused changes limited to the requested task.
- Codex execution logs are stored under `logs/codex-runs/`.
- Run write-enabled Codex tasks only from a dedicated working branch.
- Use `./run-codex-tests.sh` to create or improve automated tests and build
  validation.
- Use `./run-codex-review.sh` to validate current changes and correct only
  evidence-backed defects.
- Inspect existing implementations before replacing them.
- Avoid unrelated refactoring or formatting.
- Preserve public routes, configuration names, and stored-data formats unless
  all consumers and migration requirements are identified.
- Handle missing, malformed, empty, and legacy data safely.
- Do not add dependencies unless they are needed and justified.
- Do not replace working code merely because another design is preferred.
- Do not create placeholder implementations or tests that always pass.

## Security and Privacy

- Never commit credentials, deployment tokens, API keys, client secrets,
  connection strings, storage keys, or private invitation URLs.
- Never print secrets in logs or final reports.
- Treat traveler identities, itinerary details, and private trip data as
  sensitive.
- Validate user-controlled values before using them in storage paths, URLs,
  queries, or API requests.
- Do not weaken authentication or authorization to work around an error.
- Verify authorization in API handlers rather than relying solely on frontend
  visibility.

## Azure and Deployment Safety

Do not perform any of the following unless explicitly requested:

- Deploy to Azure.
- Push or commit changes.
- Modify DNS or the `triptracking.org` custom domain.
- Change authentication providers or app registrations.
- Delete Azure resources or persisted trip data.
- Modify production application settings.
- Invoke production maintenance or data-reset operations.

Do not assume that an Azure Static Web Apps preview environment shares the same
settings or data as production.

## Testing and Validation

Use the repository's defined scripts.

Run the applicable commands after changes, such as:

```bash
npm test
npm run build
git diff --check
git status --short

<!-- OPENWIKI:START -->

## OpenWiki

This repository uses OpenWiki for recurring code documentation. Start with `openwiki/quickstart.md`, then follow its links to architecture, workflows, domain concepts, operations, integrations, testing guidance, and source maps.

The scheduled OpenWiki GitHub Actions workflow refreshes the repository wiki. Do not hand-edit generated OpenWiki pages unless explicitly asked; prefer updating source code/docs and letting OpenWiki regenerate.

<!-- OPENWIKI:END -->
