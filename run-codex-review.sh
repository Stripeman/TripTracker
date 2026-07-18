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
  echo "Do not run this write-enabled review directly on '$CURRENT_BRANCH'."
  echo "Switch to a dedicated working branch first."
  exit 1
fi

TIMESTAMP="$(date +"%Y%m%d-%H%M%S")"
LOG_DIR="$PROJECT_ROOT/logs/codex-runs/$TIMESTAMP"
RESULT_FILE="$LOG_DIR/codex-review-results-$TIMESTAMP.md"
RUN_LOG="$LOG_DIR/codex-review-run-$TIMESTAMP.log"
PROMPT_FILE="$LOG_DIR/codex-review-prompt-$TIMESTAMP.md"
STATUS_BEFORE="$LOG_DIR/git-status-before.txt"
STATUS_AFTER="$LOG_DIR/git-status-after.txt"
DIFF_BEFORE="$LOG_DIR/git-diff-before.patch"
DIFF_AFTER="$LOG_DIR/git-diff-after.patch"
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
git diff --binary > "$DIFF_BEFORE"

cat > "$PROMPT_FILE" <<'PROMPT'
Validate and improve the current TripTracker repository changes.

This repository directory may still be named VacationTracker, but the product
name is TripTracker. Do not rename the repository directory merely because the
folder name differs from the product name.

This is a focused validation and defect-correction task, not a general cleanup,
redesign, or style refactor.

Before editing:
1. Read AGENTS.md in full.
2. Read CLAUDE.md in full.
3. Read openwiki/quickstart.md.
4. Read the OpenWiki pages relevant to architecture, workflows, authentication,
   authorization, Blob Storage, testing, deployment, and operations.
5. Inspect every existing package.json and package-lock.json.
6. Inspect the frontend, api directory, Azure Functions function.json files,
   shared API libraries, staticwebapp.config.json, and deployment configuration.
7. Inspect the current Git history, working-tree changes, and most recent commit.
8. State exactly which instruction and documentation files were read.
9. If rg/ripgrep is unavailable or fails to launch, use find, grep, PowerShell,
   or Node-based searching instead. A missing rg command is not a blocker.

Project areas to validate where they exist:
- Trip creation, retrieval, editing, and deletion.
- Required-field, date-range, and duration validation.
- Trip normalization and persisted document shape.
- Missing, malformed, empty, and legacy Blob Storage documents.
- Authentication-principal parsing.
- Administrator, normal-user, roles, and access-list behavior.
- User or traveler data isolation.
- Presence and login analytics.
- Frontend-to-API request contracts.
- Azure Functions route names and HTTP methods.
- Static Web Apps routing, authentication, and navigation fallback.
- Error handling that does not disclose secrets or sensitive trip information.
- Build, test, local-start, and deployment preflight behavior.

Review and correction requirements:
- Run the existing tests and build/validation commands first.
- Fix only clear, evidence-backed defects.
- Add or improve tests when needed to reproduce and verify a definite defect.
- Minimal production-code refactoring is allowed only when required to fix a
  demonstrated defect or make existing behavior testable.
- Preserve runtime behavior, API contracts, stored-data compatibility,
  authorization boundaries, and deployment behavior unless a test proves the
  current behavior is wrong.
- Do not make speculative improvements, unrelated formatting changes, or broad
  renames.
- Do not create placeholder tests or scripts that merely print success.

Npm and build requirements:
- The repository is known to have api/package.json.
- A root package.json may or may not exist; inspect the repository.
- If a root package.json exists, preserve its real build workflow.
- If root npm helpers are absent and genuinely required, create only a minimal
  root package.json that delegates to the API package.
- Running npm test from the repository root should execute all tests.
- Running npm run build from the repository root should run tests and meaningful
  build or deterministic structural validation.
- Prefer Node's built-in test runner when practical.
- Avoid unnecessary dependencies and update lockfiles when needed.

Local validation requirements:
- Run npm test and npm run build when available.
- Run API-specific test and build commands when available.
- Run applicable syntax checks and JSON validation.
- Run git diff --check and git status --short.
- Review the complete resulting diff.
- Start the Azure Static Web Apps emulator and perform local smoke tests when
  practical.
- Do not connect to live Azure services or write to live Blob Storage.
- If emulator, authentication, or browser testing is blocked, report the exact
  blocker and provide a precise manual test procedure.

Change restrictions:
- Do not modify, replace, reformat, stage, delete, or rename .gitignore.
- Suggest useful .gitignore additions in the final report only.
- Do not deploy, commit, or push.
- Do not modify Azure resources, DNS, custom domains, app registrations,
  environment variables, or secrets.
- Do not delete persisted trip data or discard existing user work.
- Do not expose credentials, tokens, connection strings, private traveler
  information, or secret values.
- Do not modify logs/codex-runs except for files created by this run.

At completion, provide:
1. Every file changed, added, deleted, or renamed.
2. The exact reason for each change.
3. Every defect found and the evidence supporting it.
4. Every test added or changed and the behavior it verifies.
5. Every command executed.
6. Results of npm test and npm run build.
7. Local emulator and smoke-test results.
8. Anything that could not be tested.
9. Remaining risks and recommended manual tests.
10. Exact suggested .gitignore additions without applying them.
11. A keep, revise, or revert recommendation for each production-code change.
PROMPT

echo
echo "Starting focused TripTracker Codex review..."
echo "Branch:       $CURRENT_BRANCH"
echo "Final report: $RESULT_FILE"
echo "Complete log: $RUN_LOG"
echo

set +e
codex exec   --sandbox workspace-write   --output-last-message "$RESULT_FILE"   "$(cat "$PROMPT_FILE")"   2>&1 | tee "$RUN_LOG"
CODEX_EXIT_CODE=${PIPESTATUS[0]}
set -e

git status --short > "$STATUS_AFTER"
git diff --binary > "$DIFF_AFTER"
git diff --stat > "$DIFF_STAT"

echo
echo "Codex review completed with exit code: $CODEX_EXIT_CODE"
echo "Final report:  $RESULT_FILE"
echo "Complete log:  $RUN_LOG"
echo "Resulting diff: $DIFF_AFTER"
echo "Diff summary:   $DIFF_STAT"

exit "$CODEX_EXIT_CODE"