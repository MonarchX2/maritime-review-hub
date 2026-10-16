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
  /function applyReviewerAccountStatus\(\s*response,\s*idToken,\s*preserveProfileEditor = false,\s*\)[\s\S]*?accountStatus === "TRUE"[\s\S]*?reviewerIdentityToken = idToken[\s\S]*?accountStatus === "NOT_FOUND" \|\| accountStatus === "DENIED"/,
  "only TRUE accounts should receive reviewer access, while denied and new users can submit profile details",
);
assert.match(
  appCore,
  /const keepProfileEditorOpen =\s*preserveProfileEditor && reviewerProfileEditing;[\s\S]*?if \(keepProfileEditorOpen\) \{[\s\S]*?form\.hidden = false;[\s\S]*?formButton\.textContent = "Save changes for approval";[\s\S]*?\} else \{[\s\S]*?if \(inputs\.lastName\) inputs\.lastName\.value = response\.lastName \|\| "";/,
  "approval polling should keep an open profile editor and its unsubmitted field values intact",
);
assert.match(
  appCore,
  /async function loadReviewerDashboard\(\)[\s\S]*?if \(!status \|\| !tableHead \|\| !tableBody\) \{[\s\S]*?tableHead\.replaceChildren\(\);[\s\S]*?filterContainer\.hidden = true;[\s\S]*?setResourceDashboardStatus\("Loading reviewer resources…", true\);[\s\S]*?backendRequest = globalScope\.AppNetwork\.callBackend\([\s\S]*?await backendRequest/,
  "loading Reviewer resources should clear the previous tab's rows and filters first",
);
assert.match(
  appCore,
  /function scheduleReviewerStatusPolling\(idToken\)[\s\S]*?type: "get_reviewer_account_status"[\s\S]*?applyReviewerAccountStatus\(response, idToken, true\)[\s\S]*?REVIEWER_STATUS_POLL_INTERVAL_MS/,
  "the page should poll the server so administrator approval changes take effect while open",
);
assert.match(
  appCore,
  /let reviewerAuthGeneration = 0;[\s\S]*?async function completeReviewerSignIn\(idToken\)[\s\S]*?const authGeneration = \+\+reviewerAuthGeneration;[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?reviewerPendingEnrollmentToken !== idToken[\s\S]*?applyReviewerAccountStatus\(response, idToken\)/,
  "out-of-order sign-in responses must not replace the currently selected Google account",
);
assert.match(
  appCore,
  /function scheduleReviewerStatusPolling\(idToken\)[\s\S]*?const authGeneration = reviewerAuthGeneration;[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?scheduleReviewerStatusPolling\(idToken\);[\s\S]*?applyReviewerAccountStatus\(response, idToken, true\)/,
  "approval polling should ignore stale auth responses and reschedule if another check is in flight",
);
assert.match(
  appCore,
  /async function requestReviewerEnrollment\(event\)[\s\S]*?const authGeneration = \+\+reviewerAuthGeneration;\s*stopReviewerStatusPolling\(\)[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?applyReviewerAccountStatus\([\s\S]*?finally \{[\s\S]*?scheduleReviewerStatusPolling\(enrollmentToken\)/,
  "profile submission should invalidate stale approval polls and resume polling after completion",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true\) \{\s*reviewerAuthGeneration \+= 1;/,
  "sign-out should invalidate outstanding sign-in and profile requests",
);
assert.match(
  appCore,
  /callback: \(credentialResponse\) => \{\s*const credential =[\s\S]*?reviewerAuthCheckPending = false[\s\S]*?if \(!credential\) \{[\s\S]*?void completeReviewerSignIn\(""\);[\s\S]*?setExplicitReviewerSignOut\(false\)[\s\S]*?completeReviewerSignIn\(credential\)/,
  "the Google callback should only clear saved sign-out state after receiving a credential",
);
assert.match(
  appCore,
  /if \(approved\) \{[\s\S]*?Reviewer access approved\. Preparing your resources[\s\S]*?void loadReviewerDashboard\(\)\.then\(\(loaded\) => \{/,
  "approved reviewer data should be prefetched while the profile view is open",
);
assert.match(
  appCore,
  /function setReviewerNavigationBusy\(busy\)[\s\S]*?resource-dashboard-reviewers-nav[\s\S]*?setReviewerNavigationBusy\(true\);[\s\S]*?setReviewerNavigationBusy\(false\)/,
  "reviewer authentication and background resource prefetch should expose a navigation loading state",
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
  /reviewerAuthCheckPending = false;\s*setReviewerNavigationBusy\(\s*Boolean\(reviewerPendingEnrollmentToken \|\| reviewerIdentityToken\),\s*\)/,
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
  /getStoredJSON\(\s*RESOURCE_DASHBOARD_CACHE_KEY[\s\S]*?normalizeResourceDashboardTabs\(stored\.tabs\)[\s\S]*?stored\.appVersion === appVersion[\s\S]*?resourceDashboardData = sanitizedTabs/,
  "the dashboard should sanitize cached reviewer data before restoring data for the current website version",
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
  /resourceDashboardSelectedCategory = "all"[\s\S]*?showCategoryFilter = \["MODULES", "REVIEWERS"\]\.includes\(\s*resourceDashboardActiveTab,\s*\)[\s\S]*?categoryFilterControl\.value = resourceDashboardSelectedCategory/,
  "Modules and Reviewers should share a category filter that defaults to All",
);
assert.match(
  appCore,
  /filterContainer\.hidden = !hasTermFilter && !showCategoryFilter[\s\S]*?yearFilterContainer\.hidden = !hasTermFilter[\s\S]*?semesterFilterContainer\.hidden = !hasTermFilter/,
  "the category filter should remain available on Modules and Reviewers without year metadata",
);
assert.match(
  appCore,
  /const phaseColumnIndexes = tab\.columns\.reduce[\s\S]*?\["PRELIMS", "MIDTERMS", "FINALS"\]\.includes\(phase\)[\s\S]*?selectedPhaseColumnIndex[\s\S]*?phaseValue[\s\S]*?isResourceDashboardLink\(phaseLink\)/,
  "the selected phase should retain only its column and rows with a resource for that phase",
);
assert.match(
  appCore,
  /categoryFilterControl\.addEventListener\("change"[\s\S]*?resourceDashboardSelectedCategory = categoryFilterControl\.value[\s\S]*?renderResourceDashboardTab\(\)/,
  "changing the category should immediately rerender the dashboard",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-filter-category"[\s\S]*?<option value="all">All<\/option>[\s\S]*?<option value="PRELIMS">PRELIMS<\/option>[\s\S]*?<option value="MIDTERMS">MIDTERMS<\/option>[\s\S]*?<option value="FINALS">FINALS<\/option>/,
  "the category dropdown should offer All, PRELIMS, MIDTERMS, and FINALS",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-help"[\s\S]*?class="resource-dashboard-help"[\s\S]*?aria-describedby="resource-dashboard-help"/,
  "dashboard filters should be associated with a visible contextual explanation",
);
assert.match(
  appCore,
  /const resourceDashboardHelp = \{[\s\S]*?SYLLABUS:[\s\S]*?MODULES:[\s\S]*?REVIEWERS:[\s\S]*?function updateResourceDashboardHelp\(tabName\)[\s\S]*?help\.textContent = resourceDashboardHelp\[tabName\] \|\| ""/,
  "each resource tab should display its own short usage explanation",
);
assert.match(
  appCore,
  /resourceDashboardActiveTab = tabName;\s*updateResourceDashboardHelp\(tabName\)/,
  "switching dashboard tabs should immediately update the usage explanation",
);
assert.match(
  indexHtml,
  /Reviewer access requires administrator approval[\s\S]*?change your name, access is paused until the updated details\s*are approved/,
  "the Profile screen should explain reviewer approval and name-edit behavior",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear = populateTermOptions\([\s\S]*?"3",\s*true,\s*\)/,
  "the year filter should support an all-levels selection",
);
assert.match(
  appCore,
  /createResourceDashboardElement\(\s*"option",\s*"",\s*"All",?\s*\)[\s\S]*?allOption\.value = "all"/,
  "the year dropdown should label its all-levels option simply All",
);
assert.match(
  appCore,
  /const allYearLevelsSelected = resourceDashboardSelectedYear === "all"[\s\S]*?semesterFilterControl\.disabled = allYearLevelsSelected[\s\S]*?if \(allYearLevelsSelected\)[\s\S]*?resourceDashboardSelectedSemester = "all"/,
  "All Year Levels should disable the semester filter and select all semesters",
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
  /`Year Level \$\{resourceDashboardSelectedYear\}\.\$\{resourceDashboardSelectedSemester\}`[\s\S]*?`Showing \$\{visibleRows\.length\} of \$\{nonEmptyRows\.length\} rows for \$\{selectedTerm\}\./,
  "the dashboard row count should identify the selected term as Year Level X.Y and end with a period",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-control:first-child select\s*\{\s*width:\s*3\.5rem;\s*\}[\s\S]*?\.resource-dashboard-control:nth-child\(2\) select\s*\{\s*width:\s*3\.5rem;/,
  "year and semester dropdowns should use compact widths",
);
assert.match(
  resourceStyles,
  /#resource-dashboard-filter-category\s*\{\s*width:\s*6\.5rem;\s*padding-right:\s*0\.4rem;\s*padding-left:\s*0\.4rem;/,
  "the category dropdown should fit its phase labels without excess horizontal space",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item:first-child\s*\{\s*margin-left:\s*auto;\s*\}[\s\S]*?\.resource-portal-nav-item:last-child\s*\{\s*margin-right:\s*auto;\s*\}/,
  "dashboard links should center when there is free space and remain reachable when overflowing",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-topbar \.resource-profile-toggle\s*\{\s*margin-left:\s*auto;/,
  "the Profile icon button should align to the far right of the title bar",
);
assert.match(
  resourceStyles,
  /#resource-reviewer-signin-button\s*\{[^}]*justify-content:\s*center;/,
  "Google sign-in should be horizontally centered",
);
assert.match(
  resourceStyles,
  /#resource-reviewer-signin-button\[hidden\],\s*\.resource-reviewer-signout\[hidden\]\s*\{\s*display:\s*none;/,
  "the sign-in and account action controls should respect their hidden state",
);
assert.match(
  resourceStyles,
  /\.resource-profile-card\s*\{[^}]*display:\s*grid;[^}]*gap:\s*1\.25rem;[\s\S]*?\.resource-reviewer-enrollment\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*gap:\s*1rem;[\s\S]*?\.resource-reviewer-enrollment input\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;/,
  "Reviewer name fields should stack in a full-width, overflow-safe grid",
);
assert.match(
  resourceStyles,
  /\.resource-reviewer-enrollment button\s*\{[^}]*max-width:\s*100%;[\s\S]*?white-space:\s*normal;/,
  "the enrollment submit button should wrap instead of overflowing narrow dialogs",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*100%;[\s\S]*?\.resource-portal-shell\s*\{[^}]*width:\s*100%;[\s\S]*?\.resource-dashboard-table-scroll\s*\{[^}]*width:\s*fit-content;[^}]*margin-inline:\s*auto;/,
  "Resource Dashboard containers should fill the page while the table frame fits its content and centers",
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
  appCore,
  /script\.src = "https:\/\/accounts\.google\.com\/gsi\/client\?hl=en"[\s\S]*?renderButton\(signInButton,\s*\{[\s\S]*?theme:\s*"filled_blue"[\s\S]*?shape:\s*"rectangular"[\s\S]*?width:\s*280[\s\S]*?locale:\s*"en"/,
  "the Google sign-in button should use the site's blue theme, compact rectangular shape, and English",
);
assert.match(
  appCore,
  /tabName === "REVIEWERS" &&\s*!reviewerIdentityToken &&\s*!reviewerPendingEnrollmentToken &&\s*!reviewerAuthCheckPending[\s\S]*?openResourceDashboardTab\("PROFILE"\)[\s\S]*?dashboardContent\.hidden = tabName === "PROFILE"[\s\S]*?profileScreen\.hidden = tabName !== "PROFILE"[\s\S]*?if \(tabName === "PROFILE"\) \{\s*void initializeReviewerAuth\(\)/,
  "the Reviewers tab should wait for in-flight sign-in and route confirmed signed-out users to Profile",
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
  /function signOutReviewer\(explicit = true\)[\s\S]*?setExplicitReviewerSignOut\(true\)[\s\S]*?catch \(error\) \{[\s\S]*?reviewerIdentityToken = ""[\s\S]*?reviewerAuthorizedEmail = ""[\s\S]*?reviewerDashboardRequestGeneration \+= 1/,
  "explicit sign-out should suppress automatic sign-in and clear in-memory credentials even if saving the preference fails",
);
assert.doesNotMatch(
  appCore,
  /localStorage\.setItem\([^,]*(?:token|credential)|sessionStorage\.setItem\([^,]*(?:token|credential)/i,
  "Google credentials must not be persisted in browser storage",
);
assert.match(
  appCore,
  /async function loadResourceDashboard\(\)[\s\S]*?initializeResourceDashboardControls\(\);\s*void initializeReviewerAuth\(\);/,
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
  /reviewersNav\.removeAttribute\("aria-disabled"\)[\s\S]*?reviewersLock\.hidden = true[\s\S]*?function signOutReviewer[\s\S]*?reviewersNav\.removeAttribute\("aria-disabled"\)[\s\S]*?reviewersLock\.hidden = false/,
  "sign-in should unlock reviewer resources and sign-out should restore the lock state",
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
  /\.resource-dashboard-control input,\s*\.resource-dashboard-control select\s*\{[^}]*min-height:\s*2\.25rem;[^}]*padding:\s*var\(--resource-dashboard-space\) var\(--resource-dashboard-space-wide\);/,
  "dashboard filter controls should use consistent spacing and align with refresh",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear = "3"[\s\S]*?resourceDashboardSelectedSemester = "1"/,
  "the dashboard should default to year 3, semester 1",
);
assert.match(
  appCore,
  /function normalizeResourceDashboardTabs\(tabs\)[\s\S]*?normalized\.SYLLABUS = \{[\s\S]*?normalized\.REVIEWERS = \{/,
  "the dashboard should support older backend responses by splitting syllabus data out of Reviewers",
);
assert.match(
  appCore,
  /resourceDashboardData = normalizeResourceDashboardTabs\(response\.tabs\)/,
  "the dashboard should normalize backend tabs before rendering or caching them",
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
  /tabName === "REVIEWERS" &&\s*!reviewerIdentityToken &&\s*!reviewerPendingEnrollmentToken &&\s*!reviewerAuthCheckPending[\s\S]*?openResourceDashboardTab\("PROFILE"\)[\s\S]*?Verifying your Google sign-in and reviewer approval/,
  "the Reviewers tab should stay open while Google sign-in is being verified and route signed-out users to Profile",
);
assert.match(
  appCore,
  /reviewerDashboardLoadedForEmail === reviewerAuthorizedEmail[\s\S]*?renderResourceDashboardTab\(\)[\s\S]*?async function loadReviewerDashboard\(\)[\s\S]*?reviewerDashboardLoadedForEmail = reviewerAuthorizedEmail/,
  "an already authorized reviewer tab should reuse in-memory data instead of waiting for another backend fetch",
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
  /createResourceDashboardElement\(\s*"option",\s*"",\s*"All",?\s*\)[\s\S]*?allOption\.value = "all"/,
  "year and semester filters should label their all-values option All",
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
  /const populatedColumnIndices = tab\.columns[\s\S]*?nonEmptyRows\.some\([\s\S]*?const visibleColumnIndices =[\s\S]*?visibleColumnIndices\.forEach\(\(columnIndex\) => \{[\s\S]*?tableHead\.appendChild\(headerRow\)[\s\S]*?visibleRows\.forEach\(\(\{ values, rowIndex \}\) => \{\s*const row = document\.createElement\("tr"\);\s*visibleColumnIndices\.forEach\(\(index\) => \{/,
  "dashboard headers and cells should use the same populated and category-filtered columns",
);
assert.match(
  appCore,
  /const nonEmptyRows = tab\.rows[\s\S]*?tab\.columns\.some\(\(_, columnIndex\) => \{[\s\S]*?isResourceDashboardLink\(linkUrl\)/,
  "dashboard rows containing resource links should not be treated as empty",
);
assert.match(
  appCore,
  /columnName === "course" \|\| columnName === "year"[\s\S]*?resource-dashboard-column-\$\{columnName\}/,
  "dashboard cells and headers should identify the Course and Year columns",
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
  /if \(reviewerIdentityToken\)\s*payload\.idToken = reviewerIdentityToken;/,
  "file click logs should include the verified account when the user is signed in",
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
  /\.resource-dashboard-table \.resource-dashboard-column-course\s*\{[^}]*text-align:\s*right;/,
  "the dashboard Course column should be right-aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table \.resource-dashboard-column-year\s*\{[^}]*text-align:\s*center;/,
  "the dashboard Year column should be center-aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table \.resource-dashboard-link-cell\s*\{[^}]*text-align:\s*center;/,
  "dashboard resource buttons should be center-aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-help\s*\{[^}]*border-left:\s*3px solid #94a3b8;[^}]*font-size:\s*var\(--resource-dashboard-font-small\);[^}]*line-height:\s*1\.5;/,
  "contextual dashboard notes should be readable but visually restrained",
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
  /\.resource-portal-nav-item\[aria-busy="true"\]::after\s*\{[^}]*animation:\s*resource-dashboard-status-spin/,
  "reviewer sign-in and background resource preparation should show progress on the Reviewer tab",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[^}]*gap:\s*var\(--resource-dashboard-space-wide\);[^}]*padding:\s*var\(--resource-dashboard-space\) 1rem;/,
  "dashboard tabs should use the shared spacing scale",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/,
  "dashboard tabs should remain on one horizontally scrollable row",
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
  /get_resource_dashboard:\s*\{\s*required:\s*\["eventId"\],\s*allowed:\s*\["type",\s*"version",\s*"idToken",\s*"eventId",\s*"appVersion"\]/,
  "dashboard requests should support cached versions and event-level logging",
);
assert.match(
  network,
  /log_module_access:\s*\{\s*required:\s*\["idToken",\s*"eventId"\]/,
  "module access logging should require verified identity and a unique event ID",
);
assert.match(
  network,
  /get_reviewer_account_status:\s*\{\s*required:\s*\["idToken"\]/,
  "the client should have an authenticated account-status polling endpoint",
);
assert.match(
  network,
  /const versionedPayload = \{ \.\.\.payload, appVersion \};\s*validateBackendPayload\(versionedPayload\)/,
  "the allowlisted dashboard request should pass the common payload validator",
);

console.log("Resource dashboard request contract check passed.");
