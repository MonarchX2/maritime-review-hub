# Changelog

## 26.10.22 - 2026-10-17

### Fixed

- Allow PDF downloads enough time for the backend to recover and rerun a stale
  processing job before the browser reports a timeout.

## 26.10.21 - 2026-10-17

### Fixed

- Replace overdue Reviewer PDF worker triggers when queued downloads are still
  pending, instead of leaving the preparation job stuck indefinitely.

## 26.10.20 - 2026-10-17

### Fixed

- Keep the reviewer resource table visible while refreshing already-rendered
  data, and make the expanded PDF viewer fill its viewport.

### Improved

- Reduce protected PDF preview work by checking the source version with a
  metadata lookup and avoiding a duplicate synchronous access-log write.
- Increase online preview watermarks to a compact 4-by-5 grid and downloaded
  PDF watermarks to a compact 2-by-5 grid.

## 26.10.19 - 2026-10-17

### Fixed

- Keep deck sync snapshots consistent when the backend cache changes without a
  newer timestamp, and immediately retry with both the applied timestamp and
  cache version.
- Refresh account approval every two seconds and recheck immediately when the
  Student Portal tab becomes active.

### Improved

- Render cached reviewer resources immediately and refresh the visible table
  without blocking navigation.
- Preview protected PDFs without generating a server-side copy; overlay the
  verified full name and email in the viewer and generate watermarked PDFs only
  after an explicit download.
- Permanently remove private download derivatives after delivery or session
  cleanup, and reduce PDF output size with object streams.

## 26.10.17 - 2026-10-17

### Improved

- Add protected, in-site Reviewer PDF viewing with server-side authorization,
  permanent per-page watermarks, and fail-closed delivery.
- Clear Reviewer PDF previews when reviewer authorization changes and validate
  PDF responses before rendering.

### Maintenance

- Deploy the Reviewer PDF backend and update all website version markers.

## 26.10.16-51 - 2026-10-16

### Improved

- Add a responsive Student Portal welcome banner with profile details, adjustable
  visibility, and a saved show/hide preference.
- Center the banner when it stacks above the portal card, shorten long names
  when stacked, enlarge its side-by-side profile picture, tighten the greeting
  and email spacing, show the visibility toggle only when stacked, and refine
  dashboard spacing. Restore the cached profile immediately on page refresh.

## 26.10.16-50 - 2026-10-16

### Improved

- Add an account-aware welcome panel beside the Student Portal entry on the
  dashboard, center it whenever it stacks above the portal entry, allow its
  visibility choice to persist, show full names when they fit and last names
  when space is short, and clarify its Syllabus, Modules, and Reviewers subtitle.
- Shorten the reviewer enrollment action to `Submit`.
- Add Date and Time account-creation columns to `ACCOUNTS`, populate the first
  available blank account row, and preserve creation times when profiles change.

## 26.10.16-49 - 2026-10-16

### Fixed

- Keep the Syllabus and Modules row summary visible when switching away from
  a loading Reviewer table.
- Store combined year/semester resource context in the matching Year and
  Semester log columns, including when migrating existing log rows.

## 26.10.16-48 - 2026-10-16

### Fixed

- Keep the Student Portal title visible on small screens instead of replacing
  it with a home icon.
- Automatically request the current website release when the backend rejects
  an outdated client, while preserving local study data.
- Keep the Google sign-in button manual by disabling the automatic account
  prompt and account selection.

### Improved

- Default Modules and Reviewers to Finals, then Midterms and Prelims when a
  preferred category is unavailable.
- Split access-log dates and times into separate columns, rename the
  `MODULE` log worksheet to `MODULES`, and migrate older log rows safely.
- Record tab visits, filter changes, and resource clicks in Syllabus, Modules,
  and Reviewers with separate Event, Course, Year, Semester, Category, and
  Resource fields; Drive file IDs are not written to the logs.
- Reduce casual copying of resource links and show `Submit` for denied-profile
  corrections.
- Synchronize the About MRH release history from this changelog and update
  Reviewer table content incrementally.

## 26.10.16-47 - 2026-10-16

### Improved

- Show a consistent Google sign-in prompt when signed out and a visible
  "Signing in..." state while verifying a sign-in.
- Simplify reviewer profile enrollment by removing the redundant Edit button,
  uppercasing names as they are typed, and confirming name accuracy before
  submission.
- Remove the redundant Year column from Syllabus, Modules, and Reviewer tables
  while retaining year and semester filtering.

## 26.10.16-46 - 2026-10-16

### Improved

- Send formal reviewer status emails with Maritime Review Hub as the displayed
  sender name.
- Keep the Reviewer dashboard on Loading until its authorized table response
  arrives, and show a clear empty state when the loaded data has no resources.
- Place profile enrollment and correction forms below the profile details.

## 26.10.16-45 - 2026-10-16

### Maintenance

- Synchronize deck-navigation formatting and update its multiline regression
  check to match the current helper signature.
- Redeploy the validated Reviewer backend with the current website release.

## 26.10.16-44 - 2026-10-16

### Improved

- Clarify that a middle initial may be any single letter followed by a period,
  not one specific initial.

## 26.10.16-43 - 2026-10-16

### Fixed

- Validate reviewer names and the one-letter-plus-period middle initial in the
  browser before sending an enrollment request, and keep profile drafts intact
  during status refreshes.
- Show only the Reviewer loading state while a saved session is being restored.

### Improved

- Clarify reviewer profile warnings and email/name matching, and send pending,
  access-granted, and access-denied status emails.
- Refine profile status and sign-out presentation, and disable Reviewer filters
  while dashboard data is loading.

## 26.10.16-42 - 2026-10-16

### Changed

- Bump the website release version.

## 26.10.16-41 - 2026-10-16

### Improved

- Simplify the locked Reviewer prompt with a red lock icon and concise sign-in action.
- Cache reviewer display details for instant Profile and header rendering while validating sessions and refreshing resources silently in the background.
- Open Reviewer resources by default for signed-in users and refine Profile actions.

## 26.10.16-40 - 2026-10-16

### Improved

- Show Popular badges on General Knowledge, BSMT Competencies, and Review Notes for Deck Officers decks.
- Keep unavailable Student Portal filter choices visible but disabled, and omit empty table columns.
- Show horizontal table scrolling only when populated columns exceed the dashboard width while preserving full-width row and header decorations.
- Enlarge the Profile avatar and remove redundant approval and sign-in loading status indicators.

## 26.10.16-39 - 2026-10-16

### Fixed

- Keep authorized Reviewer resources visible when public dashboard refreshes return the intentionally empty protected-tab placeholder.
- Preserve the last loaded Reviewer rows during temporary refresh failures and refresh them when returning to the Reviewer tab.
- Match reviewer account email addresses without case sensitivity when retaining loaded Reviewer data.

## 26.10.16-38 - 2026-10-16

- Persist reviewer sign-in across browser restarts with server-validated application sessions and cross-tab sign-out synchronization.
- Move Student Portal to the top of Home and refine dashboard and breadcrumb spacing.
- Auto-size the Resource Dashboard box around its content and wrap dashboard navigation instead of clipping it.
- Centralize the semantic release baseline in `package.json` and regenerate app, worker, manifest, and runtime release metadata during deployment.
- Preserve reviewer authentication state after temporary verification failures and offer a retry.

## 26.10.16-37 - 2026-10-16

### Improved

- Center resource tables and show the syllabus link column as SYLLABUS.
- Keep reviewer navigation in place while sign-in is being verified and reuse authorized reviewer data during the session.
- Show progress indicators during dashboard data loads and reviewer sign-in checks.

## 26.10.16-36 - 2026-10-16

### Improved

- Center dashboard navigation links when they fit and keep them scrollable on narrow screens.
- Tighten the Category dropdown and retain versioned dashboard payloads longer to avoid repeated index rebuilds.

## 26.10.16-35 - 2026-10-16

### Changed

- Place the Profile settings button at the right side of the Resource Dashboard title bar.

## 26.10.16-34 - 2026-10-16

### Changed

- Add contextual usage notes and filter explanations throughout the Resource Dashboard.
- Make the Category filter more compact and hide phase columns that are not selected.
- Reduce horizontal spacing between resource table columns.
- Keep Resource Dashboard tabs on one row on small screens, with horizontal scrolling when needed.
- Use a clipboard-check icon for the Reviewers tab.
- Ignore stale Google sign-in, approval-poll, and profile-submission responses after account state changes.
- Return a clear provider-unavailable response when Google returns malformed token data.

## 26.10.16-33 - 2026-10-16

### Fixed

- Keep the profile name editor open and preserve unsaved changes while reviewer approval status refreshes.

## 26.10.16-32 - 2026-10-16

### Changed

- Improve Google sign-in restoration after refresh with FedCM automatic selection for both the returning-user prompt and sign-in button, without persisting credentials.

## 26.10.16-31 - 2026-10-16

### Fixed

- Recheck account rows before profile submissions so stale cached rows cannot create duplicates or overwrite a different account.
- Include the verified account in module and syllabus file-click logs when a user is signed in.

## 26.10.16-30 - 2026-10-16

### Added

- Add a PRELIMS, MIDTERMS, FINALS, or All category filter to the Modules and Reviewers dashboards, defaulting to All.

## 26.10.16-29 - 2026-10-16

### Added

- Let signed-in users edit their profile name; any actual change returns Reviewer access to pending administrator approval.

### Fixed

- Hide the Google sign-in control after authentication and keep approval status visible without duplicate Profile copy.

### Changed

- Simplify Profile guidance and use Google FedCM/automatic account selection after refresh without storing ID tokens.
- Serve Modules, Syllabus, and Reviewer snapshots from short-lived backend caches, and avoid opening the account spreadsheet for sign-in configuration.
- Keep file-click logs while removing redundant dashboard-load log writes and disabling per-request Apps Script tracing by default.

## 26.10.16-28 - 2026-10-16

### Fixed

- Keep the Reviewer name-entry form and its First Name field within the Profile dialog on narrow screens.

## 26.10.16-27 - 2026-10-16

### Fixed

- Keep the Modules and Syllabus table frame sized to its content while aligning it with the dashboard filters.

## 26.10.16-26 - 2026-10-16

### Fixed

- Expand the Resource Dashboard to the available page width and add consistent spacing across profile, navigation, filters, and resource tables.

## 26.10.16-25 - 2026-10-16

### Fixed

- Keep cached deck access enabled when the backend confirms the cached summary is already current.

## 26.10.16-24 - 2026-10-16

### Added

- Require administrator approval before reviewer resources are available; pending users stay locked, and denied users can correct their name and resubmit.
- Refresh account approval while users are signed in so spreadsheet changes take effect without a page reload.

### Changed

- Remove device identity from account matching, access-log columns, and frontend requests; migrate and deduplicate legacy account/log rows during spreadsheet setup.
- Format new access-log timestamps in Philippine local time and use targeted account lookups for status checks.
- Open the Resource Dashboard on Profile and confirm before exiting it.

## 26.10.16-23 - 2026-10-16

### Fixed

- Preserve reviewer sign-out state across refreshes without storing Google ID tokens, and always clear the in-memory session even if browser storage is unavailable.

### Changed

- Register one `ACCOUNTS` row per verified email and browser-device UUID, allowing an existing account to sign in on additional browsers without re-entering profile details.
- Document that clearing browser storage creates a new device UUID rather than recovering a physical-device identifier.

## 26.10.16-22 - 2026-10-16

### Changed

- Record individual syllabus, module, and reviewer resource clicks with the resource name and Drive ID in their respective log tabs.
- Create the `SYLLABUS` access-log tab during account spreadsheet setup.

## 26.10.16-21 - 2026-10-16

### Fixed

- Clear the previous resource tab's table and filters while Reviewer resources are loading.

## 26.10.16-20 - 2026-10-16

### Fixed

- Keep the signed-out Reviewers tab accessible and clickable by removing disabled ARIA semantics.

## 26.10.16-19 - 2026-10-16

### Fixed

- Apply safe frontend updates while the Resource Dashboard is open, while preserving unfinished Profile enrollment details.

## 26.10.16-18 - 2026-10-16

### Fixed

- Keep the Reviewers tab clickable while signed out and route users to Profile for Google sign-in.
- Make the Reviewers tab clickable after sign-in and show the signed-in profile picture in the header Profile button.

### Changed

- Initialize Google automatic re-authentication on dashboard load without storing ID tokens in browser storage.
- Improve Profile form spacing, mark Middle Initial optional, and show a name-capitalization example.

## 26.10.16-16 - 2026-10-16

### Changed

- Center Google sign-in and show the signed-in profile picture above the account name and email.

## 26.10.16-15 - 2026-10-16

### Changed

- Allow every verified Google account to access reviewer resources after profile enrollment, and log each sign-in and reviewer access.
- Record required Apps Script OAuth scopes in the `SCOPES` worksheet and style the Google sign-in button to match the dashboard.

## 26.10.16-12 - 2026-10-16

### Changed

- Add a dedicated Profile section for Google sign-in, new-account enrollment, and signed-in account details/sign-out.

## 26.10.16-11 - 2026-10-16

### Changed

- Place sign-in and profile controls at the right side of the dashboard tab header and default Google sign-in UI to English.
- Allow the Google Identity Services stylesheet through the site Content Security Policy.

## 26.10.16-10 - 2026-10-16

### Changed

- Move Google sign-in and the signed-in profile control to the right side of the Syllabus/Modules/Reviewers header, and request English for Google sign-in.

## 26.10.16-9 - 2026-10-16

### Fixed

- Treat empty Module title parentheses as a missing title and preserve safe dashboard cache data when sanitizing legacy reviewer rows.

## 26.10.16-8 - 2026-10-16

### Changed

- Show a folder icon and “Folder” for Module resources without a parenthesized title.

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
