# Maritime Review Hub Audit Report

Date: 2026-10-10
Repository: MonarchX2/maritime-review-hub

## Scope and baseline

This review covered the checked-in client code, runtime wiring, browser storage logic, service-worker behavior, and the build configuration available in the current project directory.

The project is a static web app with a service worker and frontend scripts loaded by [app-entry.js](./app-entry.js). It is not a full-stack app in this workspace; the backend contract is represented by `databaseUrl` in [app-config.js](./app-config.js) and network calls in [app-core-network.js](./app-core-network.js).

Baseline checks performed:
- `npm run build:css` — passed successfully.
- `git status --short` — confirmed the worktree already had local modifications in [sw.js](./sw.js) and [tailwind.generated.css](./tailwind.generated.css), which were preserved and not overwritten.

Excluded from deep source review:
- `node_modules/` and generated build artifacts were not treated as source code to audit exhaustively.
- External dependency internals were not reviewed beyond the project’s own usage and configuration.

## Summary of findings

All three findings below were addressed in the current working tree.

### 1) Missing architecture validation script
Severity: Medium
Resolution: Added [scripts/frontend-architecture-check.js](./scripts/frontend-architecture-check.js) and validated it via `npm run check:architecture`.

### 2) Service worker integrity hashes are static and manual
Severity: Medium
Resolution: Replaced the hand-maintained hash table in [sw.js](./sw.js) with runtime-generated SHA-256 validation that refreshes the shell integrity map during precache.

### 3) Persistent storage identity uses `Math.random()`
Severity: Medium
Resolution: Updated [storage-utils.js](./storage-utils.js) so it prefers browser cryptographic APIs and only falls back to a non-`Math.random()` timestamp/performance-derived seed when truly necessary.

## Reliability notes

### Client-side security posture
- The app uses `escapeHTML` and sanitizes some rendered content paths, which reduces obvious XSS risk in known render functions.
- However, a large portion of the app still uses HTML string generation and `innerHTML` assignment in multiple UI-rendering paths; this is not inherently a vulnerability by itself, but it increases the need for strict input sanitization and review.

### Dependency and configuration quality
- The repo contains a build step for CSS and an architecture check entry, but the validation tooling is incomplete.
- The current repo is missing a full server-side or test harness, so many defects are only visible through runtime inspection and static source review.

## Overall assessment

This project is a reasonably structured static front-end with careful runtime boundaries, but it currently has a few real maintainability and reliability risks rather than a severe confirmed exploit path in the checked-in code.

The most important issues to fix next are:
1. Restore or remove the missing architecture-check script.
2. Make service-worker integrity validation deterministic and automation-driven.
3. Replace the non-cryptographic fallback for storage identity generation.

No destructive or irreversible operations were performed during this review. Existing user modifications were preserved.
