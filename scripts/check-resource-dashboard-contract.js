const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");
const resourceStyles = fs.readFileSync("styles.css", "utf8");
const fileIdHelper = appCore.match(
  /function getResourceDashboardFileId\(value\) \{[\s\S]*?\n  \}/,
);
assert.ok(fileIdHelper, "the dashboard should resolve file IDs for click logs");
const getResourceDashboardFileId = new Function(
  "URL",
  `${fileIdHelper[0]}; return getResourceDashboardFileId;`,
)(URL);
assert.equal(
  getResourceDashboardFileId(
    "https://drive.google.com/file/d/012345678901234567890/view",
  ),
  "012345678901234567890",
);
assert.equal(
  getResourceDashboardFileId(
    "https://docs.google.com/spreadsheets/d/112345678901234567890/edit",
  ),
  "112345678901234567890",
);
assert.equal(
  getResourceDashboardFileId(
    "https://drive.google.com/drive/folders/212345678901234567890",
  ),
  "212345678901234567890",
);
assert.equal(
  getResourceDashboardFileId(
    "https://drive.google.com/open?id=312345678901234567890",
  ),
  "312345678901234567890",
);
assert.equal(
  getResourceDashboardFileId(
    "https://example.com/file/d/012345678901234567890/view",
  ),
  "",
  "click log identity parsing must only accept Google resource URLs",
);

assert.doesNotMatch(
  indexHtml,
  /resource-reviewer-device-id|resource-reviewer-copy-device-id/,
  "the reviewer sign-in panel must not expose or offer to copy the device ID",
);
assert.match(
  appCore,
  /function applyReviewerAccountStatus\(\s*response,\s*sessionId,\s*preserveProfileEditor = false,\s*\)[\s\S]*?accountStatus === "TRUE"[\s\S]*?reviewerSessionId = sessionId[\s\S]*?accountStatus === "NOT_FOUND" \|\| accountStatus === "DENIED"/,
  "only TRUE accounts should receive reviewer access, while denied and new users can submit profile details",
);
assert.match(
  appCore,
  /const keepProfileEditorOpen =\s*preserveProfileEditor && reviewerProfileEditing;[\s\S]*?if \(keepProfileEditorOpen\) \{[\s\S]*?form\.hidden = false;[\s\S]*?formButton\.textContent = "Save changes for approval";[\s\S]*?\} else \{[\s\S]*?if \(inputs\.lastName\) inputs\.lastName\.value = response\.lastName \|\| "";/,
  "approval polling should keep an open profile editor and its unsubmitted field values intact",
);
assert.match(
  appCore,
  /async function loadReviewerDashboard\(\{ refresh = false \} = \{\}\)[\s\S]*?if \(!status \|\| !tableHead \|\| !tableBody\) \{[\s\S]*?if \(!hasExistingReviewerRows\) \{[\s\S]*?tableHead\.replaceChildren\(\);[\s\S]*?filterContainer\.hidden = true;[\s\S]*?Loading reviewer resources…[\s\S]*?backendRequest = globalScope\.AppNetwork\.callBackend\([\s\S]*?await backendRequest/,
  "loading Reviewer resources should retain valid visible rows while refreshing and show a loading state on first load",
);
assert.match(
  appCore,
  /function scheduleReviewerStatusPolling\(sessionId\)[\s\S]*?type: "get_reviewer_account_status", sessionId[\s\S]*?applyReviewerAccountStatus\(response, sessionId, true\)[\s\S]*?REVIEWER_STATUS_POLL_INTERVAL_MS/,
  "the page should poll the server so administrator approval changes take effect while open",
);
assert.match(
  appCore,
  /let reviewerAuthGeneration = 0;[\s\S]*?async function completeReviewerSignIn\(idToken\)[\s\S]*?const authGeneration = \+\+reviewerAuthGeneration;[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?reviewerVerificationInFlightToken !== idToken[\s\S]*?const sessionId = String\(response\?\.sessionId \|\| ""\)[\s\S]*?saveReviewerSessionId\(sessionId\)[\s\S]*?applyReviewerAccountStatus\(response, sessionId\)/,
  "out-of-order sign-in responses must not replace the currently selected Google account",
);
assert.match(
  appCore,
  /function scheduleReviewerStatusPolling\(sessionId\)[\s\S]*?const authGeneration = reviewerAuthGeneration;[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?scheduleReviewerStatusPolling\(sessionId\);[\s\S]*?applyReviewerAccountStatus\(response, sessionId, true\)/,
  "approval polling should ignore stale auth responses and reschedule if another check is in flight",
);
assert.match(
  appCore,
  /async function requestReviewerEnrollment\(event\)[\s\S]*?const authGeneration = \+\+reviewerAuthGeneration;\s*stopReviewerStatusPolling\(\)[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?applyReviewerAccountStatus\([\s\S]*?finally \{[\s\S]*?scheduleReviewerStatusPolling\(enrollmentSessionId\)/,
  "profile submission should invalidate stale approval polls and resume polling after completion",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true(?:, preserveStoredSession = false)?\) \{[\s\S]*?reviewerAuthGeneration \+= 1;/,
  "sign-out should invalidate outstanding sign-in and profile requests",
);
assert.match(
  appCore,
  /const sessionId = String\(response\?\.sessionId \|\| ""\);[\s\S]*?saveReviewerSessionId\(sessionId\);[\s\S]*?if \(reviewerVerificationRetryToken === idToken\)\s*reviewerVerificationRetryToken = ""/,
  "successful verification should persist only the opaque application session and clear its transient Google credential",
);
assert.match(
  appCore,
  /callback: \(credentialResponse\) => \{\s*const credential =[\s\S]*?reviewerAuthCheckPending = false[\s\S]*?if \(!credential\) \{[\s\S]*?void completeReviewerSignIn\(""\);[\s\S]*?setExplicitReviewerSignOut\(false\)[\s\S]*?completeReviewerSignIn\(credential\)/,
  "the Google callback should only clear saved sign-out state after receiving a credential",
);
assert.match(
  appCore,
  /if \(approved\) \{[\s\S]*?Preparing your resources…[\s\S]*?void loadReviewerDashboard\(\)\.then\(\(loaded\) => \{[\s\S]*?authStatus\.textContent = loaded\s*\? ""\s*:\s*"Resources could not be preloaded/,
  "approved reviewer data should preload without a persistent approval message",
);
assert.match(
  appCore,
  /if \(reviewerAuthCheckPending\) \{\s*authStatus\?\.removeAttribute\("aria-busy"\);\s*setReviewerNavigationBusy\(true\);[\s\S]*?globalScope\.google\.accounts\.id\.prompt/,
  "the Google sign-in instruction should not show a loading spinner while the navigation remains busy",
);
assert.doesNotMatch(
  appCore,
  /Reviewer access approved/,
  "the Profile view should not show an approval status message",
);
assert.match(
  appCore,
  /function setReviewerNavigationBusy\(\)[\s\S]*?resource-dashboard-reviewers-nav[\s\S]*?removeAttribute\("aria-busy"\)/,
  "the Reviewer navigation should never show an adjacent loading indicator",
);
assert.match(
  appCore,
  /if \(!idToken\) \{\s*setReviewerNavigationBusy\(false\);[\s\S]*?Google sign-in did not return a credential\. Open Profile to sign in again\./,
  "a credential-less Google callback should clear Reviewer loading states",
);
const reviewerPromptCallback = appCore.match(
  /globalScope\.google\.accounts\.id\.prompt\(\(notification\) => \{[\s\S]*?\n          \}\);/,
);
assert.ok(reviewerPromptCallback, "the returning-user prompt callback should exist");
assert.match(
  reviewerPromptCallback[0],
  /reviewerAuthCheckPending = false;\s*setReviewerNavigationBusy\(\s*Boolean\(\s*reviewerPendingEnrollmentSessionId \|\|\s*reviewerSessionId \|\|\s*reviewerSessionRestorePending,\s*\),\s*\)/,
  "a prompt completion notification should preserve the busy state when credential verification is already underway",
);
assert.doesNotMatch(
  reviewerPromptCallback[0],
  /openResourceDashboardTab\("PROFILE"\)/,
  "a prompt completion notification must not redirect away from Reviewers before a credential callback settles",
);
assert.match(
  appCore,
  /if \(reviewerDashboardRequestPromise\) return true;[\s\S]*?reviewerDashboardRequestPromise = backendRequest/,
  "reviewer data prefetch and tab clicks should share a single in-flight backend request",
);
assert.match(
  appCore,
  /async function requestReviewerEnrollment\(event\)[\s\S]*?type: "request_reviewer_enrollment"[\s\S]*?!\["FALSE", "TRUE"\]\.includes\(response\.accountStatus\)/,
  "new and corrected profiles should be submitted pending administrator review",
);
assert.doesNotMatch(
  appCore,
  /deviceIdentity|getResourceDeviceIdentity/,
  "frontend requests and state should no longer use device identity",
);
assert.match(
  appCore,
  /AppNetwork\.callBackend\(\s*\{\s*type:\s*"get_resource_dashboard"/,
  "the dashboard should send its request through the shared backend client",
);
assert.match(
  appCore,
  /getStoredJSON\(\s*RESOURCE_DASHBOARD_CACHE_KEY[\s\S]*?normalizeResourceDashboardTabs\(stored\.tabs\)[\s\S]*?stored\.appVersion === appVersion[\s\S]*?resourceDashboardData =\s*retainAuthorizedReviewerDashboardTab\(sanitizedTabs\)/,
  "the dashboard should sanitize browser-cached rows while restoring valid reviewer data from the current authorized session",
);
assert.match(
  appCore,
  /JSON\.stringify\(stored\.tabs\) !== JSON\.stringify\(sanitizedTabs\)[\s\S]*?setStoredJSON\(RESOURCE_DASHBOARD_CACHE_KEY,\s*\{\s*\.\.\.stored,\s*tabs:\s*sanitizedTabs/,
  "sanitized dashboard tabs should replace the cached legacy data without discarding safe cache metadata",
);
assert.match(
  appCore,
  /cachedDashboard \? \{ version: cachedDashboard\.version \} : \{\}/,
  "the dashboard should ask the backend to validate its cached index version",
);
assert.match(
  appCore,
  /response\?\.notModified === true && cachedDashboard/,
  "unchanged dashboard indexes should reuse the cached dashboard",
);
assert.match(
  appCore,
  /if \(response\?\.notModified === true && cachedDashboard\) \{[\s\S]*?renderResourceDashboardTab\(\);[\s\S]*?return true;/,
  "unchanged cached dashboards should restore their normal row-count status",
);
assert.match(
  appCore,
  /setStoredJSON\(RESOURCE_DASHBOARD_CACHE_KEY/,
  "fresh dashboard data should be persisted for later visits",
);
assert.match(
  appCore,
  /resource-dashboard-filter-year[\s\S]*?resource-dashboard-filter-semester/,
  "the dashboard should provide year and semester filters",
);
assert.match(
  appCore,
  /availableCategories = new Set\([\s\S]*?showCategoryFilter =\s*hasCategoryFilter \|\| resourceDashboardActiveTab === "SYLLABUS"[\s\S]*?button\.disabled = !hasCategoryFilter \|\| !categoryAvailable[\s\S]*?button\.setAttribute\("aria-pressed", String\(selected\)\)/,
  "unavailable category choices should remain visible and disabled",
);
assert.match(
  appCore,
  /yearFilterContainer\.hidden = !hasTermFilter && !showCategoryFilter[\s\S]*?semesterFilterContainer\.hidden = !hasTermFilter && !showCategoryFilter[\s\S]*?filterContainer\.hidden =\s*!showCategoryFilter && !hasTermFilter/,
  "term filter controls should remain available and disable missing values",
);
assert.match(
  appCore,
  /const phaseColumnIndexes = tab\.columns\.reduce[\s\S]*?\["PRELIMS", "MIDTERMS", "FINALS"\]\.includes\(phase\)[\s\S]*?selectedPhaseColumnIndex[\s\S]*?phaseValue[\s\S]*?isResourceDashboardLink\(phaseLink\)/,
  "the selected phase should retain only its column and rows with a resource for that phase",
);
assert.match(
  appCore,
  /categoryFilterControl[\s\S]*?querySelectorAll\("\[data-category\]"\)[\s\S]*?button\.addEventListener\("click"[\s\S]*?resourceDashboardSelectedCategory = button\.dataset\.category[\s\S]*?renderResourceDashboardTab\(\)/,
  "selecting a category segment should immediately rerender the dashboard",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-filter-category"[^>]*role="group"[\s\S]*?data-category="all"[\s\S]*?data-category="PRELIMS"[\s\S]*?data-category="MIDTERMS"[\s\S]*?data-category="FINALS"/,
  "the category segmented control should offer All, PRELIMS, MIDTERMS, and FINALS",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-filter-year"[^>]*role="group"[\s\S]*?id="resource-dashboard-filter-semester"[^>]*role="group"/,
  "year and semester filters should use segmented button groups",
);
assert.doesNotMatch(
  indexHtml,
  /resource-dashboard-refresh/,
  "the dashboard should not show a manual refresh button",
);
assert.match(
  indexHtml,
  /class="resource-dashboard-title" aria-label="Student Portal"[\s\S]*?fa-house[\s\S]*?id="resource-dashboard-syllabus-nav"[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?fa-clipboard-list/,
  "the portal title should retain a home icon and the tabs a lined-note Reviewer icon",
);
assert.match(
  appCore,
  /function initializeResourceDashboardAutoRefresh\(\)[\s\S]*?setInterval\([\s\S]*?RESOURCE_DASHBOARD_AUTO_REFRESH_INTERVAL_MS[\s\S]*?visibilitychange[\s\S]*?pageshow[\s\S]*?function initializeResourceDashboardControls\(\)/,
  "auto-refresh should be initialized once and revalidate the dashboard when a page returns",
);
assert.doesNotMatch(
  indexHtml,
  /resource-dashboard-help|aria-describedby="resource-dashboard-help"/,
  "the unnecessary white help note should be removed from the resource tabs",
);
assert.doesNotMatch(
  appCore,
  /resourceDashboardHelp|updateResourceDashboardHelp/,
  "the removed tab explanations should not be recreated by dashboard code",
);
assert.doesNotMatch(
  indexHtml,
  /Reviewer access requires administrator approval/,
  "the Profile screen should not show the removed reviewer access notice",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear = populateTermOptions\([\s\S]*?defaultYear,\s*true,\s*false,\s*\["1",\s*"2",\s*"3"\],\s*\)/,
  "the year filter should support an all-levels selection",
);
assert.match(
  appCore,
  /const options = sortedValues\.map\(\(value\) => \(\{\s*value,\s*label:\s*value,\s*\}\)\)[\s\S]*?options\.unshift\(\{\s*value:\s*"all",\s*label:\s*"All"\s*\}\)[\s\S]*?button\.dataset\.filterValue = value[\s\S]*?button\.disabled =\s*disabled \|\| \(value !== "all" && !values\.has\(value\)\)[\s\S]*?control\.replaceChildren\(\.\.\.buttons\)/,
  "the year and semester segmented controls should keep unavailable values disabled alongside All",
);
assert.match(
  appCore,
  /yearFilterControl\.addEventListener\("click"[\s\S]*?resourceDashboardSelectedYear = button\.dataset\.filterValue[\s\S]*?renderResourceDashboardTab\(\)/,
  "changing the year segmented control should immediately rerender results",
);
assert.match(
  appCore,
  /semesterFilterControl\.addEventListener\("click"[\s\S]*?resourceDashboardSelectedSemester = button\.dataset\.filterValue[\s\S]*?renderResourceDashboardTab\(\)/,
  "changing the semester segmented control should immediately rerender results",
);
assert.match(
  appCore,
  /const allYearLevelsSelected = resourceDashboardSelectedYear === "all"[\s\S]*?if \(allYearLevelsSelected\)[\s\S]*?resourceDashboardSelectedSemester = "all"[\s\S]*?true,\s*true,\s*\["1",\s*"2"\],\s*\)/,
  "All Year Levels should disable the semester segments and select all semesters",
);
assert.match(
  appCore,
  /if \(!hasTermFilter \|\| resourceDashboardSelectedYear === "all"\)\s*return true;[\s\S]*?year === resourceDashboardSelectedYear/,
  "All Year Levels should include every row regardless of semester",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear === "all"\s*\?\s*"All Year Levels"/,
  "the dashboard status should say All Year Levels instead of all.1",
);
assert.match(
  appCore,
  /const selectedYearName = \{\s*"1": "First",\s*"2": "Second",\s*"3": "Third",\s*\}\[resourceDashboardSelectedYear\][\s\S]*?\?\s*`\$\{selectedYearName\} Year`/,
  "all-semester status should use First, Second, or Third Year labels",
);
assert.match(
  appCore,
  /`Year Level \$\{resourceDashboardSelectedYear\}\.\$\{resourceDashboardSelectedSemester\}`[\s\S]*?`Showing \$\{visibleRows\.length\} of \$\{nonEmptyRows\.length\} rows for \$\{selectedTerm\}\./,
  "the dashboard row count should identify the selected term as Year Level X.Y and end with a period",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.resource-dashboard-term-control\s*\{[^}]*width:\s*100%;[\s\S]*?\.resource-dashboard-semester-segments\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[\s\S]*?\.resource-dashboard-segmented-control button\s*\{[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/,
  "Year and Semester should fit side by side without filter labels spilling",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?#resource-dashboard-category-filter\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;[\s\S]*?\.resource-dashboard-category-segments\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  "the category segments should span the filter row beneath consistently sized controls",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control button\.is-active\s*\{[^}]*color:\s*#fff;[^}]*background:\s*#2563eb;[\s\S]*?\.dark \.resource-dashboard-segmented-control\s*\{[^}]*background:\s*#334155;/,
  "the segmented category selection should use the website's blue accent in both themes",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.5;/,
  "the disabled Syllabus category segments should look inactive",
);
assert.match(
  resourceStyles,
  /#resource-reviewers-locked-panel:not\(\[hidden\]\)\s*~\s*\.resource-portal-toolbar\s*\{\s*display:\s*none;/,
  "the empty dashboard toolbar spacing should be removed while the Reviewers section is locked",
);
assert.match(
  resourceStyles,
  /#resource-reviewers-locked-panel:not\(\[hidden\]\)\s*~\s*#resource-portal-status\s*~\s*\.resource-dashboard-table-scroll\s*\{\s*display:\s*none;/,
  "the empty table frame should be hidden while the Reviewers section is locked",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control button\s*\{[^}]*text-transform:\s*uppercase;/,
  "year, semester, and category labels should be capitalized consistently",
);
assert.match(
  appCore,
  /const preferredTerm = "3\.2"[\s\S]*?availablePreviousTerms = orderedTerms\.filter[\s\S]*?year < preferredYear \|\|\s*\(year === preferredYear && semester <= preferredSemester\)[\s\S]*?const defaultTerm =\s*availablePreviousTerms\[availablePreviousTerms\.length - 1\][\s\S]*?!termValues\.has\(preferredTerm\)[\s\S]*?resourceDashboardSelectedYear = defaultYear;[\s\S]*?resourceDashboardSelectedSemester = defaultTerm\.split\("\."\)\[1\]/,
  "default filters should prefer year 3 semester 2 and fall back to the nearest earlier available term",
);
assert.match(
  appCore,
  /const previousSemesters = orderedSemesters\.filter\([\s\S]*?Number\(semester\) <= preferredSemester[\s\S]*?const fallbackSemester =\s*previousSemesters\[previousSemesters\.length - 1\]/,
  "missing semester 2 should fall back to the nearest earlier available semester",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[^}]*justify-content:\s*center;[\s\S]*?\.resource-portal-nav-item:first-child\s*\{\s*margin-left:\s*0;\s*\}[\s\S]*?\.resource-portal-nav-item:last-child\s*\{\s*margin-right:\s*0;\s*\}/,
  "Syllabus, Modules, and Reviewers should be centered together in the navigation row",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-topbar \.resource-profile-toggle\s*\{\s*margin-left:\s*auto;[\s\S]*?\.resource-profile-toggle\s*\{[^}]*display:\s*inline-grid;[^}]*justify-items:\s*center;[\s\S]*?\.resource-profile-toggle > img\s*\{[^}]*width:\s*2\.25rem;[^}]*height:\s*2\.25rem;[\s\S]*?\.resource-profile-toggle > i\s*\{[^}]*width:\s*2\.25rem;[^}]*height:\s*2\.25rem;[^}]*font-size:\s*1\.75rem;[^}]*line-height:\s*2\.25rem;[\s\S]*?\.resource-profile-toggle:hover,\s*\.resource-profile-toggle\.is-active\s*\{[^}]*border-color:\s*transparent;[^}]*color:\s*inherit;[^}]*background:\s*transparent;/,
  "the Profile control should be right aligned and both profile images should use the enlarged size",
);
assert.match(
  resourceStyles,
  /#resource-reviewer-signin-button\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;[^}]*justify-content:\s*center;[^}]*overflow:\s*hidden;[\s\S]*?#resource-reviewer-signin-button iframe\s*\{[^}]*max-width:\s*100%;/,
  "Google sign-in should fit its container without overflowing",
);
assert.match(
  resourceStyles,
  /#resource-reviewer-signin-button\[hidden\],\s*\.resource-reviewer-signout\[hidden\],\s*\.resource-reviewer-retry\[hidden\]\s*\{\s*display:\s*none;/,
  "the sign-in and account action controls should respect their hidden state",
);
assert.match(
  resourceStyles,
  /\.resource-profile-screen\s*\{[^}]*margin:\s*0 auto;[\s\S]*?\.resource-profile-card\s*\{[^}]*display:\s*grid;[^}]*gap:\s*1rem;[^}]*padding:\s*clamp\(1rem,\s*3vw,\s*1\.5rem\);[\s\S]*?\.resource-reviewer-enrollment\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*gap:\s*1rem;[\s\S]*?\.resource-reviewer-enrollment input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
  "Profile settings should avoid excess outer and inner spacing while reviewer fields stay overflow-safe",
);
assert.match(
  resourceStyles,
  /\.resource-reviewer-enrollment button\s*\{[^}]*max-width:\s*100%;[\s\S]*?white-space:\s*normal;/,
  "the enrollment submit button should wrap instead of overflowing narrow dialogs",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*min\(100%,\s*40rem\);[^}]*max-width:\s*100%;[\s\S]*?\.resource-portal-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[\s\S]*?\.resource-dashboard-table-scroll\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[\s\S]*?\.resource-dashboard-table-frame\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*overflow:\s*clip;[\s\S]*?\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*margin-inline:\s*auto;[\s\S]*?\.resource-dashboard-table thead tr::before,\s*\.resource-dashboard-table tbody tr::before\s*\{[^}]*inset:\s*0 -100vw;/,
  "Resource Dashboard should keep a compact stable maximum width while remaining responsive",
);
assert.match(
  resourceStyles,
  /\.resource-profile-status\[aria-busy="true"\]::before\s*\{[^}]*animation:\s*resource-dashboard-status-spin/,
  "Google sign-in and profile submission should show an activity spinner",
);
assert.match(
  resourceStyles,
  /\.resource-profile-account-details\s*\{[^}]*justify-items:\s*center;[\s\S]*?\.resource-profile-avatar\s*\{[^}]*border-radius:\s*50%;/,
  "Profile should center the sign-in control and show a circular account avatar",
);
assert.match(
  resourceStyles,
  /\.resource-profile-heading\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*center;[\s\S]*?\.resource-reviewers-locked-panel\s*\{[^}]*width:\s*fit-content;[^}]*max-width:\s*min\(100%,\s*38rem\);[^}]*margin-inline:\s*auto;/,
  "the Profile heading should stack and center its icon and label, and the locked message should use a centered content-fit width",
);
assert.match(
  appCore,
  /const renderResponsiveSignInButton = \(\) => \{[\s\S]*?Math\.min\(280, Math\.floor\(signInButton\.clientWidth \|\| 280\)\)[\s\S]*?width < 187 \? "signin" : "signin_with"[\s\S]*?renderButton\(signInButton,\s*\{[\s\S]*?theme:\s*"filled_blue"[\s\S]*?text:\s*buttonText[\s\S]*?shape:\s*"rectangular"[\s\S]*?width,[\s\S]*?locale:\s*"en"/,
  "the Google sign-in button should use the site's blue theme, fit its container, and use English",
);
assert.match(
  appCore,
  /reviewerSignInButtonResizeHandler = renderResponsiveSignInButton;[\s\S]*?globalScope\.addEventListener\([\s\S]*?"resize"[\s\S]*?reviewerSignInButtonResizeHandler/,
  "the Google sign-in button should be resized when its container changes",
);
assert.match(
  appCore,
  /new globalScope\.ResizeObserver\(renderResponsiveSignInButton\)/,
  "Google sign-in width changes should also be tracked when the container resizes without a window event",
);
assert.match(
  appCore,
  /resourceDashboardActiveTab = tabName;[\s\S]*?dashboardContent\.hidden = tabName === "PROFILE"[\s\S]*?profileScreen\.hidden = tabName !== "PROFILE"[\s\S]*?lockedPanel\.hidden = tabName !== "REVIEWERS"[\s\S]*?if \(tabName === "PROFILE"\) \{\s*void initializeReviewerAuth\(\)[\s\S]*?if \(tabName === "REVIEWERS"\) \{\s*if \(!reviewerSessionId\) \{[\s\S]*?lockedPanel\.hidden = false[\s\S]*?setResourceDashboardStatus\(""\)/,
  "signed-out users should see the locked Reviewer message in place without being redirected or shown a busy icon",
);
assert.match(
  appCore,
  /function renderResourceDashboardTab\(\)[\s\S]*?if \(\s*resourceDashboardActiveTab === "REVIEWERS" &&\s*!reviewerSessionId\s*\) \{[\s\S]*?lockedPanel\.hidden = false[\s\S]*?updateNote\.hidden = true[\s\S]*?filters\.hidden = true[\s\S]*?tableHead\.replaceChildren\(\)[\s\S]*?tableBody\.replaceChildren\(\)[\s\S]*?return true;\s*\}\s*if \(!tab\) return false;/,
  "late dashboard renders should not hide the locked Reviewer panel or expose its empty filters when signed out",
);
assert.match(
  appCore,
  /updateNote\.hidden = tabName === "REVIEWERS" && !reviewerSessionId;[\s\S]*?if \(tabName === "REVIEWERS"\) \{[\s\S]*?if \(!reviewerSessionId\) \{[\s\S]*?setResourceDashboardStatus\(""\)/,
  "the file update note should be hidden while Reviewer resources are locked",
);
assert.match(
  appCore,
  /if \(updateNote\)\s*updateNote\.hidden =\s*resourceDashboardActiveTab === "REVIEWERS" && !reviewerSessionId;/,
  "the file update note should become visible when a signed-in Reviewer tab is rendered",
);
assert.match(
  appCore,
  /auto_select:\s*!hasExplicitReviewerSignOut\(\)[\s\S]*?button_auto_select:\s*!hasExplicitReviewerSignOut\(\)[\s\S]*?use_fedcm_for_prompt:\s*true[\s\S]*?use_fedcm_for_button:\s*true[\s\S]*?globalScope\.google\.accounts\.id\.prompt\(\(notification\) =>/,
  "returning users should be automatically reauthenticated through Google prompt and button flows unless they explicitly signed out",
);
assert.match(
  appCore,
  /use_fedcm_for_prompt:\s*true[\s\S]*?itp_support:\s*true/,
  "Google should reauthenticate returning users through FedCM where available",
);
assert.match(
  appCore,
  /function setExplicitReviewerSignOut\(signedOut\)[\s\S]*?localStorage\.setItem\(\s*REVIEWER_EXPLICIT_SIGNOUT_KEY,\s*"true",?\s*\)[\s\S]*?localStorage\.removeItem\(REVIEWER_EXPLICIT_SIGNOUT_KEY\)/,
  "explicit sign-out preference should persist across reloads and clear on a subsequent sign-in",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true[\s\S]*?setExplicitReviewerSignOut\(true\)[\s\S]*?catch \(error\) \{[\s\S]*?reviewerSessionId = ""[\s\S]*?reviewerAuthorizedEmail = ""[\s\S]*?reviewerDashboardRequestGeneration \+= 1/,
  "explicit sign-out should suppress automatic sign-in and clear in-memory credentials even if saving the preference fails",
);
assert.doesNotMatch(
  appCore,
  /localStorage\.setItem\([^,]*(?:token|credential)|sessionStorage\.setItem\([^,]*(?:token|credential)/i,
  "Google credentials must not be persisted in browser storage",
);
const invalidCredentialHelper = appCore.match(
  /function isDefinitivelyInvalidReviewerCredential\(error\) \{[\s\S]*?\n  \}/,
);
assert.ok(
  invalidCredentialHelper,
  "reviewer verification errors should be classified conservatively",
);
const isDefinitivelyInvalidReviewerCredential = new Function(
  `${invalidCredentialHelper[0]}; return isDefinitivelyInvalidReviewerCredential;`,
)();
assert.equal(
  isDefinitivelyInvalidReviewerCredential({ code: "UNAUTHORIZED" }),
  true,
  "a backend-confirmed invalid credential should trigger reauthentication",
);
assert.equal(
  isDefinitivelyInvalidReviewerCredential({ code: "SESSION_EXPIRED" }),
  true,
  "an expired application session should be invalidated",
);
assert.equal(
  isDefinitivelyInvalidReviewerCredential({ code: "SESSION_INVALID" }),
  true,
  "a revoked application session should be invalidated",
);
for (const error of [
  { code: "AUTH_PROVIDER_UNAVAILABLE" },
  { code: "SERVER_ERROR" },
  { code: "HTTP_ERROR", status: 429 },
  new TypeError("Network request failed"),
  { name: "TimeoutError" },
]) {
  assert.equal(
    isDefinitivelyInvalidReviewerCredential(error),
    false,
    "a temporary or ambiguous verification failure must retain the credential",
  );
}
assert.match(
  appCore,
  /async function completeReviewerSignIn\(idToken\)[\s\S]*?const previousSessionId =\s*reviewerSessionId \|\| reviewerPendingEnrollmentSessionId;[\s\S]*?reviewerVerificationInFlightToken = idToken;[\s\S]*?authGeneration !== reviewerAuthGeneration \|\|\s*reviewerVerificationInFlightToken !== idToken[\s\S]*?saveReviewerSessionId\(sessionId\)[\s\S]*?if \(isDefinitivelyInvalidReviewerCredential\(error\)\) \{[\s\S]*?previousSessionId[\s\S]*?reviewerVerificationRetryToken = idToken;[\s\S]*?retryButton\.hidden = false/,
  "candidate verification should preserve the current application session on temporary failures and ignore stale results",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true[\s\S]*?reviewerVerificationRetryToken = "";[\s\S]*?reviewerSessionId = ""/,
  "explicit sign-out should clear both the active session and any retry credential",
);
assert.match(
  appCore,
  /catch \(error\) \{[\s\S]*?Unable to refresh administrator approval right now[\s\S]*?Your current sign-in is retained[\s\S]*?\(globalScope\.DebugUtils \|\| console\)\.error\(\s*"Unable to refresh reviewer account approval status\."/,
  "temporary approval-check failures should not discard a valid in-memory credential",
);
assert.match(
  appCore,
  /const retryCredential =\s*reviewerVerificationRetryToken[\s\S]*?signOutReviewer\(false\);[\s\S]*?reviewerVerificationRetryToken = retryCredential;[\s\S]*?reviewerVerificationRetryAvailable = true/,
  "expiry of the prior session should not discard a distinct candidate credential awaiting retry",
);
assert.match(
  appCore,
  /function handleReviewerSignOutStorageChange\(event\)[\s\S]*?event\?\.key === REVIEWER_SESSION_STORAGE_KEY[\s\S]*?signOutReviewer\(false\)/,
  "session changes and explicit sign-out in another tab should clear or restore this tab's reviewer session",
);
assert.match(
  appCore,
  /if \(!reviewerVerificationRetryToken\)\s*reviewerVerificationRetryAvailable = false;[\s\S]*?if \(retryButton && !reviewerVerificationRetryToken\)\s*retryButton\.hidden = true/,
  "approval polling for the active account should preserve retry state for a different transient Google credential",
);
assert.match(
  appCore,
  /function promptReviewerReauthentication\(\)[\s\S]*?reviewerReauthenticationPromptAttempted[\s\S]*?hasExplicitReviewerSignOut\(\)[\s\S]*?identityApi\.prompt\(\(notification\) => \{[\s\S]*?authGeneration !== reviewerAuthGeneration/,
  "confirmed invalid credentials should trigger at most one guarded Google reauthentication prompt",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true[\s\S]*?if \(explicit\) globalScope\.google\?\.accounts\?\.id\?\.disableAutoSelect\?\.\(\);/,
  "only explicit sign-out should disable Google's automatic account selection",
);
assert.match(
  indexHtml,
  /id="resource-reviewer-retry-verification"[^>]*class="resource-reviewer-signout resource-reviewer-retry"[^>]*hidden/,
  "temporary verification failures should have an accessible retry control",
);
assert.match(
  appCore,
  /async function loadResourceDashboard\(\{ silent = false \} = \{\}\)[\s\S]*?initializeResourceDashboardControls\(\);\s*void initializeReviewerAuth\(\);/,
  "Google re-authentication should initialize when the dashboard loads after refresh",
);
assert.match(
  appCore,
  /function populateReviewerProfile\(response\)[\s\S]*?profileName\.textContent = displayName \|\| email[\s\S]*?profileEmail\.textContent = email[\s\S]*?image\.src = pictureUrl/,
  "successful sign-in should populate the profile picture, name, and email",
);
assert.match(
  appCore,
  /function openReviewerProfileEditor\(\)[\s\S]*?function closeReviewerProfileEditor\(\)[\s\S]*?dataset\.savedValue[\s\S]*?response\.profileUpdated/,
  "users should be able to edit and cancel profile-name changes",
);
assert.match(
  appCore,
  /profileUpdated && authStatus[\s\S]*?Name updated\. Reviewer access is locked until approval\./,
  "a saved name edit should clearly indicate that Reviewer access needs approval again",
);
assert.match(
  appCore,
  /DENIED:\s*"Invalid credentials\. Correct your name, then resubmit\."/,
  "denied users should see the requested invalid-credentials message",
);
assert.match(
  indexHtml,
  /id="resource-profile-avatar-fallback"[\s\S]*?id="resource-profile-picture"[^>]*alt="Profile picture"[\s\S]*?id="resource-profile-name"[\s\S]*?id="resource-profile-email"/,
  "the Profile screen should render its avatar, name, and email in order",
);
assert.match(
  appCore,
  /function setReviewerAccessEnabled\(enabled\)[\s\S]*?reviewersNav\.title = enabled[\s\S]*?setReviewerAccessEnabled\(accountStatus === "TRUE"\)[\s\S]*?function signOutReviewer[\s\S]*?reviewersNav\.title = "Reviewer resources"/,
  "verified approval should update the Reviewer navigation label and sign-out should reset it without an icon",
);
assert.match(
  appCore,
  /function populateReviewerProfile\(response\)[\s\S]*?headerProfilePicture[\s\S]*?image\.src = pictureUrl[\s\S]*?headerProfileIcon\.hidden = Boolean\(pictureUrl\)[\s\S]*?function signOutReviewer[\s\S]*?headerProfilePicture\.removeAttribute\("src"\)/,
  "the header Profile icon should show the signed-in user's picture and clear it on sign-out",
);
assert.match(
  indexHtml,
  /http-equiv="Content-Security-Policy"[\s\S]*?style-src[^"]*https:\/\/accounts\.google\.com/,
  "the Content Security Policy should allow the Google sign-in stylesheet",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-control\s*\{[^}]*font-size:\s*0\.9rem;[\s\S]*?\.resource-dashboard-segmented-control button\s*\{[^}]*min-height:\s*1\.75rem;[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/,
  "dashboard filter labels should be larger while controls stay compact and clip/scroll long labels",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear = "3"[\s\S]*?resourceDashboardSelectedSemester = "2"/,
  "the dashboard should default to year 3, semester 2",
);
assert.match(
  appCore,
  /function normalizeResourceDashboardTabs\(tabs\)[\s\S]*?normalized\.SYLLABUS = \{[\s\S]*?normalized\.REVIEWERS = \{/,
  "the dashboard should support older backend responses by splitting syllabus data out of Reviewers",
);
assert.match(
  appCore,
  /const normalizedTabs = normalizeResourceDashboardTabs\(response\.tabs\)[\s\S]*?resourceDashboardData =\s*retainAuthorizedReviewerDashboardTab\(normalizedTabs\)[\s\S]*?tabs:\s*normalizedTabs/,
  "public dashboard refreshes should retain authorized reviewer rows in memory while caching only sanitized tabs",
);
const normalizerStart = appCore.indexOf(
  "  function normalizeResourceDashboardTabs(tabs) {",
);
assert.notEqual(normalizerStart, -1, "the dashboard tab normalizer should exist");
const functionStart = appCore.indexOf("{", normalizerStart);
let functionDepth = 0;
let functionEnd = -1;
for (let index = functionStart; index < appCore.length; index += 1) {
  if (appCore[index] === "{") functionDepth += 1;
  if (appCore[index] === "}") functionDepth -= 1;
  if (functionDepth === 0) {
    functionEnd = index + 1;
    break;
  }
}
assert.notEqual(functionEnd, -1, "the dashboard tab normalizer should be complete");
const normalizeDashboardTabs = new Function(
  `${appCore.slice(normalizerStart, functionEnd)}; return normalizeResourceDashboardTabs;`,
)();
const legacyTabs = normalizeDashboardTabs({
  MODULES: { columns: ["Year", "Course"], rows: [["3.1", "NAV6"]] },
  REVIEWERS: {
    columns: ["Year", "Course", "PRELIMS", "SYLLABUS"],
    rows: [
      ["3.1", "NAV6", "Reviewer.pdf", ""],
      ["4.2", "SHIP'S AUDIT", "", "Syllabus.pdf"],
    ],
    links: [
      ["", "", "https://drive.google.com/open?id=reviewerId", ""],
      ["", "", "", "https://drive.google.com/open?id=syllabusId"],
    ],
    linkTitles: [
      ["", "", "Reviewer.pdf", ""],
      ["", "", "", "Syllabus.pdf"],
    ],
  },
});
assert.deepEqual(legacyTabs.SYLLABUS.rows, [
  ["4.2", "SHIP'S AUDIT", "Syllabus.pdf"],
]);
assert.deepEqual(legacyTabs.SYLLABUS.links, [
  ["", "", "https://drive.google.com/open?id=syllabusId"],
]);
assert.deepEqual(legacyTabs.REVIEWERS, {
  columns: [],
  rows: [],
  links: [],
  linkTitles: [],
  linkTypes: [],
  truncated: false,
});
const lockedTabs = normalizeDashboardTabs({
  MODULES: { columns: ["Year", "Course"], rows: [["3.1", "NAV6"]] },
  SYLLABUS: { columns: ["Year", "Course", "SYLLABUS"], rows: [] },
});
assert.deepEqual(lockedTabs.REVIEWERS.rows, []);
const reviewerTabRetentionFunction = appCore.match(
  /function retainAuthorizedReviewerDashboardTab\(tabs\) \{[\s\S]*?\n  \}/,
);
assert.ok(
  reviewerTabRetentionFunction,
  "the dashboard should preserve its authorized reviewer tab across public refreshes",
);
const createReviewerTabRetention = new Function(
  "resourceDashboardData",
  "reviewerSessionId",
  "reviewerDashboardLoadedForEmail",
  "reviewerAuthorizedEmail",
  `${reviewerTabRetentionFunction[0]}; return retainAuthorizedReviewerDashboardTab;`,
);
const populatedReviewerTab = {
  columns: ["Course", "PRELIMS"],
  rows: [["SHIP'S AUDIT", "Review.pdf"]],
  links: [],
  linkTitles: [],
  linkTypes: [],
  truncated: false,
};
const emptyPublicReviewerTab = {
  ...lockedTabs,
  REVIEWERS: {
    columns: [],
    rows: [],
    links: [],
    linkTitles: [],
    linkTypes: [],
    truncated: false,
  },
};
const retainReviewerRows = createReviewerTabRetention(
  { REVIEWERS: populatedReviewerTab },
  "valid-session",
  "Reviewer@Example.com",
  "reviewer@example.com",
);
assert.equal(
  retainReviewerRows(emptyPublicReviewerTab).REVIEWERS,
  populatedReviewerTab,
  "refreshing public dashboard data should not replace the signed-in user's reviewer rows with the intentionally empty public placeholder",
);
const doNotRetainReviewerRows = createReviewerTabRetention(
  { REVIEWERS: populatedReviewerTab },
  "",
  "reviewer@example.com",
  "reviewer@example.com",
);
assert.deepEqual(
  doNotRetainReviewerRows(emptyPublicReviewerTab).REVIEWERS,
  emptyPublicReviewerTab.REVIEWERS,
  "reviewer rows must not be retained without a currently authorized session",
);
assert.match(
  appCore,
  /normalized\.REVIEWERS = \{\s*columns: \[\],\s*rows: \[\],\s*links: \[\],/,
  "the dashboard normalizer should remove reviewer data before rendering or caching",
);
assert.match(
  appCore,
  /hasValidCachedTab\(stored\?\.tabs\?\.MODULES\)[\s\S]*?normalizeResourceDashboardTabs\(stored\.tabs\)[\s\S]*?JSON\.stringify\(stored\.tabs\) !== JSON\.stringify\(sanitizedTabs\)[\s\S]*?setStoredJSON\(RESOURCE_DASHBOARD_CACHE_KEY/,
  "old and current cached reviewer data should be replaced with a sanitized dashboard cache",
);
assert.match(
  appCore,
  /if \(!saved\) \{[\s\S]*?removeStoredItem\(RESOURCE_DASHBOARD_CACHE_KEY\)[\s\S]*?Unable to remove reviewer data from the cached dashboard/,
  "stale reviewer cache data should be removed if sanitization cannot be persisted",
);
assert.match(
  appCore,
  /resource-dashboard-syllabus-nav/,
  "the dashboard should expose a separate syllabus navigation tab",
);
assert.match(
  appCore,
  /if \(tabName === "REVIEWERS"\) \{\s*if \(!reviewerSessionId\) \{[\s\S]*?lockedPanel\.hidden = false[\s\S]*?filters\.hidden = true[\s\S]*?setResourceDashboardStatus\(""\)/,
  "the Reviewers tab should stay open and display the locked-panel sign-in prompt for unauthenticated users",
);
assert.match(
  appCore,
  /reviewerDashboardLoadedForEmail\?\.toLowerCase\(\) ===\s*reviewerAuthorizedEmail\.toLowerCase\(\)[\s\S]*?renderResourceDashboardTab\(\)[\s\S]*?loadReviewerDashboard\(\{ refresh: true \}\)[\s\S]*?async function loadReviewerDashboard\(\{ refresh = false \} = \{\}\)[\s\S]*?reviewerDashboardLoadedForEmail\?\.toLowerCase\(\) ===\s*reviewerAuthorizedEmail\.toLowerCase\(\)[\s\S]*?reviewerDashboardLoadedForEmail = reviewerAuthorizedEmail/,
  "an already authorized reviewer tab should remain visible and refresh from the backend on entry",
);
assert.match(
  appCore,
  /const hasExistingReviewerRows =[\s\S]*?if \(resourceDashboardActiveTab === "REVIEWERS"\) \{\s*if \(!hasExistingReviewerRows\) \{[\s\S]*?tableHead\.replaceChildren\(\)[\s\S]*?Refreshing reviewer resources…[\s\S]*?Previously loaded data is still shown/,
  "reviewer refreshes and temporary network failures should preserve already-loaded rows",
);
assert.match(
  appCore,
  /function clearReviewerResourceRows\(\)[\s\S]*?reviewerDashboardLoadedForEmail = ""[\s\S]*?function populateReviewerProfile/,
  "reviewer data should be cleared on account-state changes without forcing a tab redirect",
);
assert.match(
  appCore,
  /globalScope\.google\.accounts\.id\.prompt\(\(notification\) => \{[\s\S]*?isNotDisplayed\?\.\(\)[\s\S]*?isSkippedMoment\?\.\(\)[\s\S]*?reviewerAuthCheckPending = false/,
  "the pending reviewer tab should resolve to Profile only after Google confirms no sign-in is available",
);
assert.match(
  appCore,
  /if \(!hasTermFilter \|\| resourceDashboardSelectedYear === "all"\)\s*return true;[\s\S]*?year === resourceDashboardSelectedYear &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "All Year Levels should bypass year and semester filtering",
);
assert.match(
  appCore,
  /\.filter\(\s*\(term\) => term\.split\("\."\)\[0\] === resourceDashboardSelectedYear/,
  "semester options should reflect the selected year",
);
assert.match(
  appCore,
  /options\.unshift\(\{\s*value:\s*"all",\s*label:\s*"All"\s*\}\)[\s\S]*?button\.dataset\.filterValue = value[\s\S]*?control\.replaceChildren\(\.\.\.buttons\)/,
  "year and semester segments should expose an All option",
);
assert.match(
  appCore,
  /\[\.\.\.new Set\(\[\.\.\.fixedValues,\s*\.\.\.values\]\)\][\s\S]*?button\.disabled =\s*disabled \|\| \(value !== "all" && !values\.has\(value\)\)[\s\S]*?\["1", "2", "3"\][\s\S]*?\["1", "2"\]/,
  "Year and Semester should keep unavailable choices visible but disabled",
);
assert.doesNotMatch(
  appCore,
  /sortButton\.addEventListener\("click"/,
  "the dashboard should not sort rows when column headings are clicked",
);
assert.match(
  appCore,
  /titleInParentheses\s*\?\s*titleInParentheses\[1\]\s*:\s*fileTitle/,
  "resource buttons should use only the parenthesized filename",
);
assert.match(
  appCore,
  /isModuleFolderFallback\s*=\s*resourceDashboardActiveTab === "MODULES" &&\s*\(!titleInParentheses \|\| !resourceTitle\)[\s\S]*?isPdfResource\s*=\s*!isModuleFolderFallback[\s\S]*?isModuleFolderFallback\s*\?\s*"Folder"/,
  "Module resources without a parenthesized title should use the Folder label and folder icon",
);
assert.match(
  appCore,
  /header\.textContent = getResourceDashboardColumnHeading\(column\)[\s\S]*?const isSyllabus = columnName\.includes\("syllabus"\)[\s\S]*?const linkLabel = isSyllabus\s*\?\s*"PDF"/,
  "syllabus links should always show a PDF icon and the PDF label",
);
const headingFunction = appCore.match(
  /function getResourceDashboardColumnHeading\(column\) \{[\s\S]*?\n  \}/,
);
assert.ok(headingFunction, "the dashboard heading formatter should exist");
const formatDashboardHeading = new Function(
  `${headingFunction[0]}; return getResourceDashboardColumnHeading;`,
)();
assert.equal(formatDashboardHeading("COURSE SYLLABUS"), "SYLLABUS");
assert.equal(formatDashboardHeading("Course"), "Course");
assert.match(
  appCore,
  /tab\.linkTitles\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use backend-resolved Drive titles",
);
assert.match(
  appCore,
  /const visibleRows = nonEmptyRows[\s\S]*?const populatedColumnIndices = tab\.columns[\s\S]*?visibleRows\.some\([\s\S]*?const visibleColumnIndices =[\s\S]*?visibleColumnIndices\.forEach\(\(columnIndex\) => \{[\s\S]*?tableHead\.appendChild\(headerRow\)[\s\S]*?visibleRows\.forEach\(\(\{ values, rowIndex \}\) => \{\s*const row = document\.createElement\("tr"\);\s*visibleColumnIndices\.forEach\(\(index\) => \{/,
  "dashboard headers and cells should use columns populated after the active filters",
);
assert.match(
  appCore,
  /const resourceColumnIndices =[\s\S]*?const nonEmptyRows = tab\.rows[\s\S]*?resourceColumnIndices\.some\(\(columnIndex\) =>\s*hasCellValue\(values, rowIndex, columnIndex\)/,
  "dashboard rows and term options should include only rows with resources",
);
assert.match(
  appCore,
  /resourceDashboardSelectedCategory !== "all" &&\s*!availableCategories\.has\(resourceDashboardSelectedCategory\)[\s\S]*?resourceDashboardSelectedCategory = "all"/,
  "an unavailable phase should not remain selected after its resources disappear",
);
assert.match(
  appCore,
  /columnName === "course" \|\| columnName === "year"[\s\S]*?resource-dashboard-column-\$\{columnName\}/,
  "dashboard cells and headers should identify the Course and Year columns",
);
assert.match(
  appCore,
  /"GENERAL KNOWLEDGE",\s*"BSMT COMPETENCIES",\s*"REVIEW NOTES FOR DECK OFFICERS \(BOOK\)"[\s\S]*?fa-fire resource-dashboard-popular-icon/,
  "the three popular Student Portal resources should show a fire icon",
);
assert.match(
  appCore,
  /resource-dashboard-link-cell/,
  "dashboard resource buttons should be identifiable for cell alignment",
);
assert.match(
  appCore,
  /function getResourceDashboardFileId\(value\)[\s\S]*?url\.searchParams\.get\("id"\)[\s\S]*?return \/\^\[A-Za-z0-9_-\]\{10,200\}\$\/\.test\(fileId\)/,
  "file click logs should use validated Drive IDs from resource links",
);
assert.match(
  appCore,
  /link\.addEventListener\("click",\s*\(\) => \{\s*void logResourceFileClick\(resourceArea,\s*fileName,\s*fileId\);/,
  "clicking a syllabus, module, or reviewer resource should log that specific resource",
);
assert.match(
  appCore,
  /if \(reviewerSessionId\)\s*payload\.sessionId = reviewerSessionId;/,
  "file click logs should include the verified application session when the user is signed in",
);
assert.match(
  network,
  /log_resource_file_click:\s*\{\s*required:\s*\["eventId",\s*"resourceArea",\s*"fileName",\s*"fileId"\]/,
  "file click logging requests should validate the category, resource name, and Drive ID",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table th\s*\{[^}]*text-align:\s*center;/,
  "the dashboard header row should be center-aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table thead tr::after\s*\{[^}]*z-index:\s*2;[^}]*right:\s*-100vw;[^}]*bottom:\s*0;[^}]*left:\s*-100vw;[^}]*border-bottom:\s*1px solid/,
  "the full-width header divider should render above the header cells",
);
assert.doesNotMatch(
  appCore,
  /resource-dashboard-sort|resourceDashboardSortColumn|resourceDashboardSortDirection|"A-Z"|"Z-A"/,
  "dashboard headers should not provide alphabetical sorting controls",
);
assert.doesNotMatch(
  resourceStyles,
  /resource-dashboard-sort/,
  "dashboard styles should not include alphabetical sorting controls",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table td\s*\{[^}]*text-align:\s*center;/,
  "dashboard table cell contents, including Course values, should remain centered",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table \.resource-dashboard-column-year\s*\{[^}]*text-align:\s*center;/,
  "the dashboard Year column should be center-aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table td\.resource-dashboard-column-course\s*\{[^}]*text-align:\s*right;/,
  "the dashboard Course names should be right-aligned without shifting the column heading",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table \.resource-dashboard-link-cell\s*\{[^}]*text-align:\s*center;/,
  "dashboard resource buttons should be center-aligned",
);
assert.doesNotMatch(
  resourceStyles,
  /\.resource-dashboard-help\s*\{/,
  "the unnecessary resource-tab explanation box styles should be removed",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[\s\S]*?--resource-dashboard-space-tight:\s*0\.25rem;[\s\S]*?--resource-dashboard-space:\s*0\.5rem;[\s\S]*?--resource-dashboard-space-wide:\s*0\.75rem;/,
  "the Resource Dashboard should define a consistent spacing scale",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-browser \.resource-portal-status\[aria-busy="true"\]\s*\{[^}]*border:\s*1px solid #bfdbfe;[^}]*color:\s*#1e40af;[^}]*background:\s*#eff6ff;[^}]*font-weight:\s*600;/,
  "dashboard loading and update checks should have a visible but restrained status treatment",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-browser \.resource-portal-status\[aria-busy="true"\]::before\s*\{[^}]*animation:\s*resource-dashboard-status-spin/,
  "dashboard loading and update checks should show a subtle progress indicator",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*visible;/,
  "the dashboard table should expand with its rows and allow horizontal scrolling",
);
assert.doesNotMatch(
  resourceStyles.match(/\.resource-dashboard-table-scroll\s*\{([^}]+)\}/)?.[1] || "",
  /\b(?:height|min-height|max-height)\s*:/,
  "the dashboard table should not have a fixed or bounded height",
);
assert.doesNotMatch(
  resourceStyles,
  /\.resource-portal-nav-item\[aria-busy="true"\]::after\s*\{[^}]*animation:\s*resource-dashboard-status-spin/,
  "the Reviewer tab should not show an adjacent loading icon",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[^}]*gap:\s*var\(--resource-dashboard-space-wide\);[^}]*padding:\s*var\(--resource-dashboard-space\) 1rem;/,
  "dashboard tabs should use the shared spacing scale",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/,
  "dashboard tabs should stay in one row and scroll horizontally if needed",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/,
  "dashboard tab labels should not shrink or wrap on small screens",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table th,\s*\.resource-dashboard-table td\s*\{[^}]*padding:\s*0\.75rem 0\.5rem;/,
  "dashboard table cells should keep comfortable row spacing with compact column spacing",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{\s*--resource-dashboard-font-title:\s*1\.125rem;\s*--resource-dashboard-font:\s*0\.875rem;\s*--resource-dashboard-font-small:\s*0\.75rem;/,
  "Resource Dashboard typography should match the main dashboard title, body, and small-text scale",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item\s*\{[^}]*min-height:\s*2\.5rem;[^}]*font-size:\s*var\(--resource-dashboard-font\)/,
  "dashboard tabs should use a compact height and the shared dashboard body font",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table\s*\{[^}]*font-size:\s*var\(--resource-dashboard-font\)/,
  "dashboard table text should use the shared dashboard body font",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table th\s*\{[^}]*font-size:\s*var\(--resource-dashboard-font-small\)/,
  "dashboard column headings should use the shared small-text dashboard font",
);
assert.match(
  appCore,
  /isPdfResource =[\s\S]*?isPdfResource \? "fa-file-pdf" : "fa-folder"/,
  "resource links should show PDF icons for syllabuses and PDF filenames",
);
assert.match(
  appCore,
  /resourceTitle\.replace\(\/\\\.pdf\$\/i,\s*""\)/,
  "button labels should omit the PDF extension",
);
assert.match(
  network,
  /get_resource_dashboard:\s*\{\s*required:\s*\["eventId"\],\s*allowed:\s*\[[\s\S]*?"sessionId"[\s\S]*?"eventId"[\s\S]*?\]/,
  "dashboard requests should support cached versions and event-level logging",
);
assert.match(
  network,
  /log_module_access:\s*\{\s*required:\s*\["eventId"\],\s*allowed:\s*\["type",\s*"idToken",\s*"sessionId",\s*"eventId",\s*"appVersion"\]/,
  "module access logging should require an application session and unique event ID",
);
assert.match(
  network,
  /get_reviewer_account_status:\s*\{\s*required:\s*\[\],\s*allowed:\s*\["type",\s*"idToken",\s*"sessionId",\s*"appVersion"\]/,
  "account-status polling should support securely validated application sessions",
);
assert.match(
  appCore,
  /renderSkeleton\(\);\s*installReviewerSignOutStorageListener\(\);\s*void restoreReviewerSession\(\);/,
  "saved reviewer sessions and tab synchronization should initialize during app startup",
);
assert.match(
  appCore,
  /async function restoreReviewerSession\([\s\S]*?type: "restore_reviewer_session", sessionId[\s\S]*?applyReviewerAccountStatus\(response, sessionId\)[\s\S]*?clearStoredReviewerSession\(\)[\s\S]*?Unable to verify your saved reviewer session right now\. It has been kept/,
  "startup should restore sessions from the backend and retain them after temporary failures",
);
assert.match(
  appCore,
  /REVIEWER_SESSION_STORAGE_KEY = "mrh_reviewer_session_v1"[\s\S]*?function saveReviewerSessionId\(sessionId\)[\s\S]*?localStorage\.setItem\(\s*REVIEWER_SESSION_STORAGE_KEY,\s*sessionId/,
  "only the opaque application session ID should persist in browser storage",
);
assert.match(
  network,
  /restore_reviewer_session:[\s\S]*?required: \["sessionId"\][\s\S]*?sign_out_reviewer:[\s\S]*?required: \["sessionId"\]/,
  "the backend client contract should expose validated session restore and revocation",
);
const backendPath = require("node:path").join(
  __dirname,
  "..",
  "backend",
  "main.js",
);
if (fs.existsSync(backendPath)) {
  const backend = fs.readFileSync(backendPath, "utf8");
  assert.match(
    backend,
    /REVIEWER_SESSION_TTL_MS = 30 \* 24 \* 60 \* 60 \* 1000[\s\S]*?function createReviewerSession_\([\s\S]*?Utilities\.getUuid\(\)[\s\S]*?function verifyReviewerSession_\([\s\S]*?session\.expiresAt[\s\S]*?Date\.now\(\)/,
    "the backend should create random sessions and validate their server-side expiry",
  );
  assert.match(
    backend,
    /function getReviewerSessionPropertyKey_\(sessionId\)[\s\S]*?REVIEWER_SESSION_PROPERTY_PREFIX \+ sha256Hex\(sessionId\)[\s\S]*?function revokeReviewerSession_\(/,
    "the backend should persist sessions by a hashed ID and support server-side revocation",
  );
} else {
  console.log(
    "Backend-only assertions skipped because Apps Script source is deployed separately.",
  );
}
assert.match(
  network,
  /const versionedPayload = \{ \.\.\.payload, appVersion \};\s*validateBackendPayload\(versionedPayload\)/,
  "the allowlisted dashboard request should pass the common payload validator",
);

console.log("Resource dashboard request contract check passed.");
