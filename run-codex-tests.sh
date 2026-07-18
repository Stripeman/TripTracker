#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Allow Git commands launched by Codex and its PowerShell subprocesses to
# inspect this repository without permanently changing additional Git settings.
PROJECT_ROOT_WINDOWS="$(pwd -W | sed 's#\\#/#g')"

export GIT_CONFIG_COUNT=1
export GIT_CONFIG_KEY_0="safe.directory"
export GIT_CONFIG_VALUE_0="$PROJECT_ROOT_WINDOWS"

CURRENT_BRANCH="$(git branch --show-current)"

if [[ -z "$CURRENT_BRANCH" ]]; then
  echo "Unable to determine the current Git branch."
  exit 1
fi

if [[ "$CURRENT_BRANCH" == "main" || "$CURRENT_BRANCH" == "master" ]]; then
  echo "Do not run this write-enabled test task directly on '$CURRENT_BRANCH'."
  echo "Switch to a dedicated testing branch first."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The repository has uncommitted changes."
  echo "Commit or stash them before running this focused Codex task."
  exit 1
fi

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
LOG_DIR="$PROJECT_ROOT/logs/codex-runs/$TIMESTAMP"
RESULT_FILE="$LOG_DIR/codex-test-results-$TIMESTAMP.md"
RUN_LOG="$LOG_DIR/codex-test-run-$TIMESTAMP.log"
PROMPT_FILE="$LOG_DIR/codex-test-prompt-$TIMESTAMP.md"
STATUS_BEFORE="$LOG_DIR/git-status-before.txt"
STATUS_AFTER="$LOG_DIR/git-status-after.txt"
PATCH_FILE="$LOG_DIR/codex-test-changes.patch"
DIFF_STAT="$LOG_DIR/git-diff-stat-after.txt"
GITIGNORE_BACKUP="$LOG_DIR/gitignore-before.txt"

mkdir -p "$LOG_DIR"

GITIGNORE_EXISTED=0
if [[ -f .gitignore ]]; then
  GITIGNORE_EXISTED=1
  cp .gitignore "$GITIGNORE_BACKUP"
fi

restore_gitignore() {
  if [[ "$GITIGNORE_EXISTED" == "1" ]]; then
    if ! cmp -s .gitignore "$GITIGNORE_BACKUP"; then
      echo
      echo "WARNING: Codex modified .gitignore."
      echo "Restoring the pre-run version."
      cp "$GITIGNORE_BACKUP" .gitignore
    fi
  elif [[ -e .gitignore ]]; then
    echo
    echo "WARNING: Codex created .gitignore."
    echo "Removing it because this task may only suggest ignore entries."
    rm -f .gitignore
  fi
}
trap restore_gitignore EXIT

git status --short > "$STATUS_BEFORE"

cat > "$PROMPT_FILE" <<'PROMPT'
Create or improve meaningful automated tests and build validation for the
current TripTracker repository.

This repository directory may still be named VacationTracker, but the product
name is TripTracker. Do not rename the repository directory merely because the
folder name differs from the product name.

This is a focused testing task. Do not perform a general cleanup, redesign,
route migration, deployment change, or styling refactor.

Before editing:
1. Read AGENTS.md in full.
2. Read CLAUDE.md in full.
3. Read openwiki/quickstart.md.
4. Read the OpenWiki pages relevant to architecture, workflows, authentication,
   authorization, Blob Storage, testing, deployment, and operations.
5. Inspect every existing package.json and package-lock.json.
6. Inspect api/package.json, api/package-lock.json when present, all API
   handlers, function.json files, shared libraries, frontend API callers,
   staticwebapp.config.json, and deployment configuration.
7. Inspect any existing tests before creating new ones.
8. Inspect the most recent Git commit and current implementation.
9. Report exactly which instruction and documentation files were read.
10. If rg/ripgrep is unavailable or fails to launch, use find, grep,
    PowerShell, or Node-based searching instead. A missing rg command is not a
    blocker.

Known npm structure:
- The repository has api/package.json.
- The API package is named trip-tracker-api.
- A root package.json may or may not exist; inspect the repository.
- Do not assume AzureCosting's structure, handlers, routes, or tests apply here.

Required outcome:
- Running npm test from the repository root must execute all automated tests.
- Running npm run build from the repository root must run tests and meaningful
  build or deterministic structural validation.
- Preserve any genuine existing frontend or API build process.
- If there is no root package.json, create a minimal one only when needed to
  provide repository-level test and build commands.
- Root scripts may delegate to api/package.json.
- Add meaningful test and build scripts to api/package.json when missing.
- Do not create placeholder scripts that merely print success.
- Prefer Node's built-in test runner unless the code clearly requires another
  framework.
- Avoid unnecessary dependencies and update lockfiles when needed.

Create tests only for behavior that actually exists. Where applicable, test:
- Authentication-principal parsing.
- Administrator and normal-user authorization.
- Roles and access-list behavior.
- Trip creation, retrieval, editing, and deletion.
- Required-field, start-date, end-date, and duration validation.
- Trip normalization and persisted document shape.
- Missing, malformed, empty, and legacy Blob Storage documents.
- User or traveler data isolation.
- Presence and login analytics.
- Frontend-to-API request contracts.
- Azure Functions route names and HTTP methods.
- Static Web Apps route configuration.
- Error responses that do not disclose credentials or sensitive trip data.

Testing restrictions:
- Do not connect to live Azure services.
- Mock Azure Blob Storage, authentication principals, HTTP requests, email,
  maps, and other remote dependencies.
- Do not use real credentials, tokens, connection strings, tenants,
  subscriptions, storage accounts, traveler records, or invitation URLs.
- Minimal production-code refactoring is allowed only when necessary to expose
  testable behavior or inject mocked dependencies.
- Explain every production-code refactoring and preserve runtime behavior.
- Do not introduce broad abstractions solely for testing.
- Do not weaken validation, authorization, or error handling to make tests pass.
- Do not create tests that assert only implementation trivia.

Build validation should inspect, where applicable:
- JavaScript or TypeScript syntax.
- JSON validity.
- Required frontend entry points.
- Required Azure Functions structure.
- Static Web Apps configuration.
- API route consistency.
- Required deployment files.
- Broken local script, stylesheet, image, or page references.
- Test execution and the real production build when one exists.

Run and report all applicable commands, including:
- npm --prefix api test
- npm --prefix api run build
- npm test
- npm run build
- Any existing frontend-specific test or build commands
- JavaScript or TypeScript syntax checks
- JSON validation
- git diff --check
- git status --short
- The complete resulting diff

Restrictions:
- Do not modify, replace, reformat, stage, delete, or rename .gitignore.
- Suggest useful .gitignore additions only in the final report.
- Do not modify deployment workflows unless a path must be corrected solely to
  allow the existing build to run.
- Do not deploy, commit, or push.
- Do not modify Azure resources, DNS, custom domains, app registrations,
  environment settings, or secrets.
- Do not write to live Blob Storage or delete persisted trip data.
- Do not make unrelated application or styling changes.
- Do not discard existing user work.
- Do not modify logs/codex-runs except for files created by this run.

At completion, provide:
1. Every file changed or added.
2. The exact reason for each change.
3. Every test created and the behavior it verifies.
4. Every command executed.
5. Results of npm --prefix api test and npm --prefix api run build.
6. Results of npm test and npm run build.
7. Test coverage and known gaps.
8. Anything that could not be validated.
9. Every production-code refactoring made for testability.
10. Remaining risks and recommended manual tests.
11. Exact suggested .gitignore additions without applying them.
12. A keep, revise, or revert recommendation for every production-code
    refactoring.
PROMPT

echo
echo "Starting focused TripTracker Codex test task..."
echo "Branch:       $CURRENT_BRANCH"
echo "Final report: $RESULT_FILE"
echo "Complete log: $RUN_LOG"
echo

set +e
codex exec   --sandbox workspace-write   --output-last-message "$RESULT_FILE"   "$(cat "$PROMPT_FILE")"   2>&1 | tee "$RUN_LOG"
CODEX_EXIT_CODE=${PIPESTATUS[0]}
set -e

git status --short > "$STATUS_AFTER"
git diff --binary > "$PATCH_FILE"
git diff --stat > "$DIFF_STAT"

echo
echo "Codex test task completed with exit code: $CODEX_EXIT_CODE"
echo "Final report:  $RESULT_FILE"
echo "Complete log:  $RUN_LOG"
echo "Change patch:  $PATCH_FILE"
echo "Diff summary:  $DIFF_STAT"

exit "$CODEX_EXIT_CODE"