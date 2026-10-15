# Changelog

## 26.10.16-7 - 2026-10-16

### Changed
- Label dashboard row counts with the selected “Year Level X.Y” term.

## 26.10.16-6 - 2026-10-16

### Changed
- Label the all-years dropdown option “All” and align reviewer sign-in/profile controls to the far right of the dashboard toolbar.

## 26.10.16-5 - 2026-10-16

### Changed
- Label the year-wide dashboard filter “All Year Levels”, include every semester, and disable the semester selector while it is active.

## 26.10.16-4 - 2026-10-16

### Fixed
- Avoid generating a device ID during public dashboard loads or before a returning Google account has had a chance to recover its registered identity.

## 26.10.16-3 - 2026-10-16

### Changed
- Hide device IDs from the reviewer interface and recover the account's existing ID automatically after browser storage is cleared.

## 26.10.16-2 - 2026-10-16

### Added
- Let verified Google users submit pending reviewer-account requests with their name and device identity; an administrator must activate each account.

### Security
- Preserve device identity in redundant browser storage, refuse silent replacement when saved copies are damaged or disagree, and restore an existing account identity after browser storage loss.

## 26.10.16-1 - 2026-10-16

### Added
- Add Google account and registered-device authorization using an administrator-managed `MRH_Accounts` spreadsheet, with separate `MODULE` and `REVIEWERS` access logs.

### Changed
- Match review question-range typography to the page indicator and prompt before exiting Review Mode from the last page.
- Cache backend dashboard and verified-account data to reduce repeated Drive, Sheets, and Google token-verification work.

## 26.10.15-29 - 2026-10-15

### Changed
- Use `/dashboard` as the Resource Dashboard route while preserving `/resources` links, add an All-years filter, improve loading visibility, and standardize dashboard typography and spacing.
- Refresh dashboard navigation labels and icons, and hide empty rows and columns.

### Security
- Lock Reviewers pending account setup, omit reviewer data from the public dashboard response, and remove reviewer data from previously cached dashboard indexes.

## 26.10.15-28 - 2026-10-15

### Fixed
- Keep the legacy sync fallback cache-version-aware, avoid nested connection-pool waits, and preserve cold-start handling.
- Restore the dashboard row count after an unchanged cached-dashboard check.

## 26.10.15-27 - 2026-10-15

### Changed
- Reduce the Resource Dashboard tab bar height and standardize dashboard typography.

## 26.10.15-26 - 2026-10-15

### Performance
- Fetch changed sync metadata and the deck summary in one backend request, with a single-request unchanged check.

## 26.10.15-25 - 2026-10-15

### Changed
- Hide empty Resource Dashboard rows and align the Return control and Dashboard title to the left.

## 26.10.15-24 - 2026-10-15

### Changed
- Place the centered file-update delay note at the bottom inside the dashboard card.

## 26.10.15-23 - 2026-10-15

### Changed
- Move the Return control outside the dashboard card, place the Dashboard label beside it, and use an icon-only Return control on small screens.

## 26.10.15-22 - 2026-10-15

### Changed
- Note that Resource Dashboard updates may take up to three minutes to appear.

## 26.10.15-21 - 2026-10-15

### Changed
- Rename the dashboard tab to Syllabus, move it before Modules, normalize dashboard spacing, and add a return-to-menu button.

### Fixed
- Keep dashboard data loading from blocking navigation back to the main menu.

## 26.10.15-20 - 2026-10-15

### Fixed
- Keep the Resource Dashboard compatible with older backend responses that include syllabus data in the Reviewers tab.

## 26.10.15-19 - 2026-10-15

### Changed
- Separate Course Syllabus resources into their own Resource Dashboard tab.
- Support compact Drive-ID and legacy tuple index exports.

## 26.10.15-18 - 2026-10-15

### Changed
- Show syllabus resources as PDF buttons with PDF icons in the Resource Dashboard.

## 26.10.15-17 - 2026-10-15

### Changed
- Cache Resource Dashboard data in browser storage and refresh it only when the website release or a Drive JSON index changes.

## 26.10.15-16 - 2026-10-15

### Changed
- Refresh the Resource Dashboard layout, remove filled active-tab backgrounds, and compact the term filters.

## 26.10.15-15 - 2026-10-15

### Changed
- Limit Resource Dashboard filtering to Year and Semester, defaulting to 3.1.

## 26.10.15-14 - 2026-10-15

### Changed
- Show parenthesized resource filenames in dashboard buttons, with PDF icons for Reviewers and folder icons for Modules.

## 26.10.15-13 - 2026-10-15

### Fixed
- Resolve Drive file titles for dashboard resource links with a DriveApp fallback and avoid exposing unresolved raw URLs.

## 26.10.15-12 - 2026-10-15

### Changed
- Label dashboard resource buttons with the linked Drive file title instead of the raw URL.

## 26.10.15-11 - 2026-10-15

### Changed
- Size dashboard columns to their content and display spreadsheet resource links as labeled buttons.

## 26.10.15-10 - 2026-10-15

### Changed
- Add column-based filtering and sortable headers to the resource dashboard.
- Preserve spreadsheet links and render Google Drive and Docs resources as same-tab links.

## 26.10.15-9 - 2026-10-15

### Fixed
- Allow the Resource Dashboard request through frontend backend-payload validation.

## 26.10.15-8 - 2026-10-15

### Changed
- Increase the website header height and simplify the resource dashboard title.
- Remove dashboard search and external spreadsheet/document links so dashboard data stays in the website.

## 26.10.15-7 - 2026-10-15

### Changed
- Replace the Resources Drive browser with Modules and Reviewers dashboards backed by the shared spreadsheet.
- Disable the Resource Portal Drive listing and preview endpoints.

## 26.10.15-6 - 2026-10-15

### Changed
- Remove explanatory and access-disclosure copy from the Resources portal while retaining functional status messages.
- Adopt `YY.MM.DD-sequence` release numbering and advance the sequence for subsequent code releases on the same date.

## 10.16.5 - 2026-10-15

### Fixed
- Use a field-limited Drive API listing for Resources instead of per-item DriveApp metadata reads.
- Speed up repeat browsing with a bounded 30-second server-side metadata cache while checking folder ancestry on every request.

## 10.16.4 - 2026-10-15

### Changed
- Add a dedicated reviewer-access screen that clearly keeps sign-in disabled until verified identity and folder grants are configured.
- Allow supported resource previews to expand into a focused online viewer.

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

## 10.15.26-9 - 2026-10-15

### Added
- Publish the public Drive resource browser with folder listing integrated into the Resources view.

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
