# TripTracker OpenWiki Instructions

## Purpose

Document the TripTracker application so that maintainers and coding agents can
understand its architecture, data flow, authentication, deployment model, and
operational constraints without having to rediscover the entire repository.

The source code and current configuration are authoritative. Clearly identify
documentation, scripts, or comments that describe older behavior.

## Project Context

TripTracker is an Azure Static Web Apps application used to manage and display
trip-related information.

Known operational context includes:

- Azure Static Web Apps hosts the frontend and managed API.
- API functionality lives under `/api`.
- Persistent trip data must be stored through the API and the configured Azure
  storage service rather than by modifying deployed static JSON files.
- Authentication and role restrictions are controlled through the Static Web
  Apps authentication configuration.
- The public custom domain is `https://www.triptracking.org`.
- The `main` branch is the production branch unless the current deployment
  configuration demonstrates otherwise.
- GitHub Actions is used for repeatable Azure deployment where configured.

Verify every statement against the current repository before incorporating it
into generated documentation.

## Documentation Priorities

Document the following areas:

1. Application entry points and frontend navigation.
2. Trip creation, editing, viewing, and deletion workflows.
3. User authentication, invitations, and role authorization.
4. Azure Static Web Apps routing and configuration.
5. Frontend-to-API communication.
6. Trip data structures and storage locations.
7. Azure Functions or managed API handlers.
8. Local development, testing, and build commands.
9. GitHub Actions and Azure deployment behavior.
10. Custom-domain considerations for `www.triptracking.org`.
11. Required environment variables and application settings without exposing
    their secret values.
12. Error handling, recovery procedures, and known limitations.

## Security and Privacy

- Never place tokens, passwords, client secrets, connection strings, storage
  keys, invitation links, or personal trip data in the wiki.
- Document configuration variable names, but not their secret values.
- Treat traveler details, itinerary information, and private travel records as
  sensitive.
- Distinguish authorization enforced by the API from visibility enforced only
  by the user interface.
- Identify any route that relies only on client-side protection.

## Documentation Quality

- Describe current behavior, not intended behavior, unless clearly labeled.
- Link related concepts using relative Markdown links.
- Identify the source files supporting important statements.
- Clearly mark legacy, unused, experimental, or deployment-only files.
- Do not describe generated output or temporary deployment directories as
  authoritative source.
- Record meaningful testing gaps and deployment risks.