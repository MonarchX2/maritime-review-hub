# Changelog

## 10.16.3 - 2026-10-15

### Changed
- Apply the exact `REVIEWERS vXX.XX.XX` folder rule and deny public access to matching folders and descendants until recipient authorization is configured.
- Remove stale listing caches, direct Google Drive links, and download controls; route supported previews through the portal without caching document bytes.
- Disclose that browser-based copying or capture cannot be prevented.

## 10.16.2 - 2026-10-15

### Fixed
- Cache small private-file previews so repeat opens avoid exporting Google Workspace documents again.
- Allow the first private Google Workspace preview more time to finish exporting.

## 10.16.1 - 2026-10-15

### Changed
- Restyle Resources as a responsive Drive file browser with current-folder search, file types, and modified dates.
- Allow the website to browse and preview files under the private Drive root without changing Drive sharing; reviewer-named folders remain excluded.
- Cache recent folder listings so previously visited resources appear immediately while refreshing.

## 10.15.26-10 - 2026-10-15

### Fixed
- Allow the Resources portal's public Drive listing request through frontend backend-payload validation.
- Preview public Drive files inside the Resources page.

## 10.15.26-8 - 2026-10-15

### Added
- Browse publicly shared Drive folders and files in the Resources portal while excluding private reviewer folders.
- Open publicly shared files using their Google Drive links.
- Use `/resources` and the shorter “Resources” page title.

## 10.15.26-7 - 2026-10-15

### Added
- Add a Resource Portal frontend view with a dedicated navigation route and setup empty state.

## 10.15.26-6 - 2026-10-15

### Changed
- When the backend retires an app version, clear all Maritime Review Hub browser namespaces, its local database, offline caches, and app service workers before showing an update-required page.
- Keep unrelated origin storage, caches, and service workers untouched.

## 10.15.26-5 - 2026-10-15

### Changed
- Require the current app version on every backend API request and reject clients older than 10.15.26-5.

## 10.15.26-4 - 2026-10-15

### Added
- Restore quiz-only progress bars and question/card counts, showing deck progress bars only on decks with saved quiz progress.
- Add a per-deck Show Answers setting to Review mode.
- Remove Reset buttons from Review-mode deck cards.

### Fixed
- Fix a deck-card rendering error that could prevent users from opening decks.
- Retire cached service workers and assets from the old Pages path when the new site is opened, without redirecting old links.

## 10.15.26-3 - 2026-10-15

### Added
- Keep Quiz and Study preferences, including navigation position, scoped to the active deck.

### Changed
- Remove progress bars and completed/total counters from deck cards and sessions while retaining the Study question range below pagination.
- Scramble protected deck and folder names before blurring them, and remove redundant lock icons beside those names.
- Keep sort and filter menus within small viewports.
- Restore the previous question type when its confirmation is canceled.

## 10.15.26-2 - 2026-10-15

### Changed
- Increase spacing above the dashboard navigation bar and below the session progress area.
- Adjust review title and action spacing for small and large screens.
- Shorten the deck source filter to “All” and capitalize the dashboard heading as “SUBJECTS”.

## 10.16.0 - 2026-10-15

### Added
- Keep study and quiz sessions addressable in the URL and offer to restore saved progress after a page refresh.
- Add navigation and practice/review regression coverage for session routing and dashboard updates.

### Fixed
- Correct JavaScript syntax in dashboard navigation so the root-level syntax check passes.
- Keep session navigation URLs and dashboard progress displays consistent when moving between views.
