const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
const appConfig = fs.readFileSync("app-config.js", "utf8");
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
const reviewerLessonTitleHelper = appCore.match(
  /function getReviewerPdfLessonTitle\(fileName, courseName\) \{[\s\S]*?\n  \}/,
);
assert.ok(reviewerLessonTitleHelper, "Reviewer PDF lesson titles should have a shared formatter");
const getReviewerPdfLessonTitle = new Function(
  `${reviewerLessonTitleHelper[0]}; return getReviewerPdfLessonTitle;`,
)();
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      getReviewerPdfLessonTitle(
        "NAV7 Lesson 1-2 - SEAM5 (1914H - 12.10.26).pdf",
        "NAV7",
      ),
    ),
  ),
  {
    lesson: "Lesson 1-2",
    details: "1914H - 12.10.26",
    header: "Lesson 1-2 (1914H - 12.10.26)",
  },
  "Reviewer titles should split lesson and parenthetical details into compact display lines",
);
assert.equal(
  getReviewerPdfLessonTitle("NAV7 00 (1914H - 12.10.26).pdf", ""),
  null,
  "numeric-only titles must not be interpreted as lessons without a matched COURSE value",
);
assert.equal(
  getReviewerPdfLessonTitle("NAV7 00 (1914H - 12.10.26).pdf", "NAV7").lesson,
  "Lesson 00",
  "the lesson label should be inserted before a numeric sequence that follows the matched course",
);
assert.equal(
  getReviewerPdfLessonTitle(
    "NAV7 Lesson 4 (1914H - 12.10.26).pdf",
    "NAV7",
  ).lesson,
  "Lesson 4",
  "a single-number Lesson X title must format instead of leaving the chip blank",
);
assert.equal(
  getReviewerPdfLessonTitle("Lesson 00 (1615H - 12.10.26).pdf", "NAV7").lesson,
  "Lesson 00",
  "a separate COURSE cell and a title beginning with Lesson X must still render the chip",
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      getReviewerPdfLessonTitle(
        "02 LESSON 1-2 - SEAM5 (1914H - 12.10.26).pdf",
        "SEAM5",
      ),
    ),
  ),
  {
    lesson: "Lesson 1-2",
    details: "1914H - 12.10.26",
    header: "Lesson 1-2 (1914H - 12.10.26)",
  },
  "a title with an existing Lesson X before the course should preserve both chip lines",
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(
      getReviewerPdfLessonTitle("Lesson X (1615H - 12.10.26).pdf", ""),
    ),
  ),
  {
    lesson: "Lesson X",
    details: "1615H - 12.10.26",
    header: "Lesson X (1615H - 12.10.26)",
  },
  "an already-labeled Lesson X should preserve its details as the second display line",
);
assert.equal(
  getReviewerPdfLessonTitle(
    "02 1-2 - SEAM5 (1914H - 12.10.26).pdf",
    "NAV7",
  ),
  null,
  "a leading numeric prefix must not be mistaken for the lesson after a different COURSE",
);
assert.ok(
  /\.resource-dashboard-link-label\s*\{[^}]*white-space:\s*normal/.test(
    resourceStyles,
  ) &&
    /\.resource-dashboard-link-label-stacked\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*align-items:\s*center;[^}]*gap:\s*0;[^}]*text-align:\s*center/.test(
      resourceStyles,
    ) &&
    /\.resource-dashboard-link-primary,\s*\.resource-dashboard-link-secondary\s*\{[^}]*display:\s*block;[^}]*line-height:\s*1/.test(
      resourceStyles,
    ),
  "lesson chips should render their lesson and details as tightly stacked lines",
);
assert.match(indexHtml, /id="resource-reviewer-retry-verification"[\s\S]*?>\s*Retry\s*</);
assert.match(
  appCore,
  /if \(reviewerLessonTitle\) \{\s*label\.classList\.add\("resource-dashboard-link-label-stacked"\);\s*label\.append/,
  "recognized Reviewer lessons should use a dedicated two-line chip layout",
);
assert.match(
  appCore,
  /const authConfigRequest = globalScope\.AppNetwork\.callBackend\([\s\S]*?const googleIdentityClientRequest =[\s\S]*?const response = await authConfigRequest/,
  "the Google sign-in client should load while auth configuration is being fetched",
);
assert.match(
  fs.readFileSync("app-core-network.js", "utf8"),
  /priority:\s*options\.priority \?\?[\s\S]*?\["verify_reviewer_access", "restore_reviewer_session"\]\.includes/,
  "sign-in and saved-session requests should bypass queued non-auth backend work",
);
const decodeBase64BytesHelper = appCore.match(
  /function decodeBase64Bytes\(encoded\) \{[\s\S]*?\n  \}/,
);
assert.ok(decodeBase64BytesHelper, "PDF byte decoding should use a shared fast path");
const decodeBase64Bytes = new Function(
  "atob",
  `${decodeBase64BytesHelper[0]}; return decodeBase64Bytes;`,
)((encoded) => Buffer.from(encoded, "base64").toString("binary"));
assert.deepEqual(
  Array.from(decodeBase64Bytes("JVA=")),
  [37, 80],
  "base64 PDF decoding should preserve every byte",
);

assert.doesNotMatch(
  indexHtml,
  /resource-reviewer-device-id|resource-reviewer-copy-device-id/,
  "the reviewer sign-in panel must not expose or offer to copy the device ID",
);
assert.match(
  appCore,
  /function applyReviewerAccountStatus\(\s*response,\s*sessionId,\s*preserveProfileEditor = false,\s*\)[\s\S]*?accountStatus === "TRUE"[\s\S]*?reviewerSessionId = sessionId[\s\S]*?form\.hidden = !\(\s*accountStatus === "NOT_FOUND" \|\| accountStatus === "DENIED"\s*\)[\s\S]*?accountStatus === "NOT_FOUND"\s*\? "Verify"/,
  "only TRUE accounts should receive reviewer access, while denied and new users can submit profile details through Profile",
);
assert.match(
  appCore,
  /const keepProfileEditorOpen =\s*preserveProfileEditor && reviewerProfileEditing;[\s\S]*?if \(keepProfileEditorOpen\) \{[\s\S]*?form\.hidden = false;[\s\S]*?formButton\.textContent = "Save changes for approval";[\s\S]*?\} else \{[\s\S]*?if \(inputs\.lastName\) inputs\.lastName\.value = response\.lastName \|\| "";/,
  "approval polling should keep an open profile editor and its unsubmitted field values intact",
);
assert.match(
  appCore,
  /async function loadReviewerDashboard\(\{ refresh = false \} = \{\}\)[\s\S]*?const silentRefresh = refresh && hasExistingReviewerRows[\s\S]*?if \(!silentRefresh\)\s*showReviewerDashboardLoading\(!hasExistingReviewerRows\)[\s\S]*?backendRequest = globalScope\.AppNetwork\.callBackend\([\s\S]*?await backendRequest/,
  "Reviewer initial loads should show Loading while background refreshes preserve existing rows and status",
);
assert.match(
  appCore,
  /type: "get_reviewer_dashboard"[\s\S]*?timeoutMs: 15000,[\s\S]*?maxRetries: 2,[\s\S]*?baseRetryDelayMs: 300,[\s\S]*?maxRetryDelayMs: 1500/,
  "read-only dashboard requests should retry transient failures with a bounded short backoff",
);
assert.match(
  appConfig,
  /https:\/\/script\.google\.com\/macros\/s\/AKfycbyM7L_Fam7UT8iRrCVy09ktV5VPPJxMLF2in6kwUewUJJ-La-BYd8okAsPVC8Tkcaw\/exec/,
  "frontend configuration should target the verified production Apps Script deployment",
);
assert.match(
  network,
  /redirect:\s*"follow"/,
  "Apps Script POST requests must follow Google ContentService redirects",
);
assert.match(
  network,
  /error\.correlationId\s*=/,
  "backend correlation IDs should be carried on structured errors",
);
assert.doesNotMatch(
  network,
  /Invalid backend JSON response:\s*\$\{preview/,
  "non-JSON backend responses must not leak arbitrary response content in user-facing errors",
);
assert.match(
  appCore,
  /function showReviewerDashboardLoading\(clearRows = false\)[\s\S]*?hasRenderedReviewerTable[\s\S]*?setReviewerDashboardFiltersDisabled\(false\)[\s\S]*?renderResourceDashboardTab\(\)[\s\S]*?return;/,
  "an already-rendered authorized Reviewer table must not retain a loading indicator during refresh",
);
assert.match(
  appCore,
  /function mergeResourceDashboardUpdates\(tabName, previousTab, nextTab\)[\s\S]*?recentlyUpdatedCells[\s\S]*?RESOURCE_DASHBOARD_UPDATED_TTL_MS/,
  "dashboard snapshots should retain and expire cell-level recent-update markers",
);
assert.match(
  appCore,
  /const RESOURCE_DASHBOARD_UPDATED_TTL_MS = 48 \* 60 \* 60 \* 1000/,
  "Reviewer NEW and UPDATED badges should expire after 48 hours",
);
assert.match(
  appCore,
  /const REVIEWER_DASHBOARD_CACHE_MAX_CHARS = 1000000[\s\S]*?function cacheReviewerDashboard\([\s\S]*?value\.length > REVIEWER_DASHBOARD_CACHE_MAX_CHARS/,
  "the current-tab dashboard cache should support snapshots up to one megabyte",
);
assert.match(
  appCore,
  /const reviewerDashboardTab = mergeResourceDashboardUpdates\(\s*"REVIEWERS"[\s\S]*?REVIEWERS: reviewerDashboardTab[\s\S]*?cacheReviewerDashboard\(reviewerAuthorizedEmail, reviewerDashboardTab\)/,
  "authorized resource table changes should be detected and cached for the current account",
);
assert.match(
  appCore,
  /normalizedTabs\.MODULES = mergeResourceDashboardUpdates\(\s*"MODULES"[\s\S]*?normalizedTabs\.SYLLABUS = mergeResourceDashboardUpdates\(\s*"SYLLABUS"/,
  "Modules and Syllabus cell changes should be detected before refreshing their dashboard cache",
);
assert.match(
  appCore,
  /const showResourceChangeBadge =\s*recentlyUpdated &&\s*!hasSeenResourceChangeBadge\([\s\S]*?if \(showResourceChangeBadge\) \{[\s\S]*?resource-dashboard-change-badge/,
  "MODULES, SYLLABUS, and REVIEWERS resources should show a separate change badge once per session",
);
assert.match(
  appCore,
  /function hasSeenResourceChangeBadge\(updateKey, updatedAt, changeType\)[\s\S]*?sessionStorage\.getItem\([\s\S]*?activeEntries\.some\([\s\S]*?sessionStorage\.setItem\(/,
  "resource badge visibility should be remembered once per active browser session",
);
assert.match(
  appCore,
  /const RESOURCE_CHANGE_BADGES_SEEN_KEY =\s*"mrh_reviewer_change_badges_seen_v1"/,
  "resource badge session tracking should preserve its existing session-storage key",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-link-button\s*\{[^}]*background:\s*#eff6ff/ &&
    /\.resource-dashboard-change-badge\.is-new\s*\{[^}]*background:\s*#16a34a/ &&
    /\.resource-dashboard-change-badge\.is-updated\s*\{[^}]*background:\s*#f97316/,
  "NEW and UPDATED badges should be green and orange without recoloring resource links",
);
const rowKeyFunction = appCore.match(
  /function getResourceDashboardRowKeys\(tab, tabName\) \{([\s\S]*?)\n  \}/,
);
const mergeUpdatesFunction = appCore.match(
  /function mergeResourceDashboardUpdates\(tabName, previousTab, nextTab\) \{([\s\S]*?)\n  \}/,
);
const resourceBadgeSeenFunction = appCore.match(
  /function hasSeenResourceChangeBadge\(updateKey, updatedAt, changeType\) \{([\s\S]*?)\n  \}/,
);
assert.ok(rowKeyFunction, "resource dashboard row keys should be testable");
assert.ok(mergeUpdatesFunction, "resource dashboard update comparison should be testable");
assert.ok(resourceBadgeSeenFunction, "resource badge session tracking should be testable");
let updateClock = 100000000;
const getResourceDashboardRowKeys = new Function(
  `return function getResourceDashboardRowKeys(tab, tabName) {${rowKeyFunction[1]}\n}`,
)();
const mergeResourceDashboardUpdates = new Function(
  "getResourceDashboardRowKeys",
  "RESOURCE_DASHBOARD_UPDATED_TTL_MS",
  "Date",
  `return function mergeResourceDashboardUpdates(tabName, previousTab, nextTab) {${mergeUpdatesFunction[1]}\n}`,
)(
  getResourceDashboardRowKeys,
  48 * 60 * 60 * 1000,
  { now: () => updateClock },
);
const dashboardTab = (title, link = "resource-file-id") => ({
  columns: ["Year", "Course", "PRELIMS"],
  rows: [["3.1", "NAV6", title]],
  links: [["", "", link]],
  linkTitles: [["", "", title]],
});
const initialModulesTab = dashboardTab("01 Safety (Prelims).pdf");
const firstSeenModulesTab = mergeResourceDashboardUpdates(
  "MODULES",
  null,
  initialModulesTab,
);
assert.deepEqual(
  firstSeenModulesTab.recentlyUpdatedCells,
  {},
  "the first snapshot should establish a baseline without marking every cell as updated",
);
updateClock += 1000;
const renamedModulesTab = mergeResourceDashboardUpdates(
  "MODULES",
  firstSeenModulesTab,
  dashboardTab("02 Safety (Prelims).pdf"),
);
const changedCellKey = JSON.stringify([
  JSON.stringify(["MODULES", ["3.1", "NAV6"], 0]),
  "prelims",
]);
assert.equal(
  renamedModulesTab.recentlyUpdatedCells[changedCellKey].updatedAt,
  updateClock,
  "renaming a resource should mark only that table cell as recently updated",
);
assert.equal(
  renamedModulesTab.recentlyUpdatedCells[changedCellKey].type,
  "UPDATED",
  "changing an existing resource should receive an UPDATED badge",
);
updateClock += 1000;
const unchangedModulesTab = mergeResourceDashboardUpdates(
  "MODULES",
  renamedModulesTab,
  dashboardTab("02 Safety (Prelims).pdf"),
);
assert.equal(
  unchangedModulesTab.recentlyUpdatedCells[changedCellKey].updatedAt,
  renamedModulesTab.recentlyUpdatedCells[changedCellKey].updatedAt,
  "an unchanged cell should preserve its update indicator timestamp",
);
assert.equal(
  unchangedModulesTab.recentlyUpdatedCells[changedCellKey].type,
  "UPDATED",
  "an unchanged cell should preserve its change label",
);
const emptyResourceTab = dashboardTab("", "");
const addedModuleTab = mergeResourceDashboardUpdates(
  "MODULES",
  emptyResourceTab,
  dashboardTab("01 Newly Added.pdf"),
);
const newModuleKey = JSON.stringify([
  JSON.stringify(["MODULES", ["3.1", "NAV6"], 0]),
  "prelims",
]);
assert.equal(
  addedModuleTab.recentlyUpdatedCells[newModuleKey].type,
  "NEW",
  "a resource added to an empty Modules cell should receive a NEW badge",
);
const addedResourceTab = mergeResourceDashboardUpdates(
  "REVIEWERS",
  emptyResourceTab,
  dashboardTab("01 Newly Added.pdf"),
);
const newResourceKey = JSON.stringify([
  JSON.stringify(["REVIEWERS", ["3.1", "NAV6"], 0]),
  "prelims",
]);
assert.equal(
  addedResourceTab.recentlyUpdatedCells[newResourceKey].type,
  "NEW",
  "a resource added to a previously empty cell should receive a NEW badge",
);
const updatedResourceTab = mergeResourceDashboardUpdates(
  "REVIEWERS",
  addedResourceTab,
  dashboardTab("02 Revised.pdf"),
);
assert.equal(
  updatedResourceTab.recentlyUpdatedCells[newResourceKey].type,
  "UPDATED",
  "replacing an existing resource should receive an UPDATED badge",
);
const initialSyllabusTab = {
  columns: ["Year", "Course", "COURSE SYLLABUS"],
  rows: [["3.1", "NAV6", "Syllabus.pdf"]],
  links: [["", "", "old-syllabus-id"]],
  linkTitles: [["", "", "Syllabus.pdf"]],
};
const firstSyllabusSnapshot = mergeResourceDashboardUpdates(
  "SYLLABUS",
  initialSyllabusTab,
  initialSyllabusTab,
);
const syllabusNewSnapshot = mergeResourceDashboardUpdates(
  "SYLLABUS",
  {
    ...firstSyllabusSnapshot,
    rows: [["3.1", "NAV6", ""]],
    links: [["", "", ""]],
    linkTitles: [["", "", ""]],
  },
  initialSyllabusTab,
);
const syllabusChangeKey = JSON.stringify([
  JSON.stringify(["SYLLABUS", ["3.1", "NAV6"], 0]),
  "course syllabus",
]);
assert.equal(
  syllabusNewSnapshot.recentlyUpdatedCells[syllabusChangeKey].type,
  "NEW",
  "a new Syllabus resource should receive a NEW badge",
);
const syllabusUpdatedSnapshot = mergeResourceDashboardUpdates(
  "SYLLABUS",
  syllabusNewSnapshot,
  {
    ...initialSyllabusTab,
    rows: [["3.1", "NAV6", "Revised syllabus.pdf"]],
    links: [["", "", "revised-syllabus-id"]],
    linkTitles: [["", "", "Revised syllabus.pdf"]],
  },
);
assert.equal(
  syllabusUpdatedSnapshot.recentlyUpdatedCells[syllabusChangeKey].type,
  "UPDATED",
  "a changed Syllabus resource should receive an UPDATED badge",
);
const sameNameDifferentLink = mergeResourceDashboardUpdates(
  "REVIEWERS",
  dashboardTab("Same name.pdf", "old-resource-id"),
  dashboardTab("Same name.pdf", "new-resource-id"),
);
assert.deepEqual(
  sameNameDifferentLink.recentlyUpdatedCells,
  {},
  "changing only a resource link should not show an UPDATED badge when its name is unchanged",
);
const renamedResourceTitle = mergeResourceDashboardUpdates(
  "REVIEWERS",
  dashboardTab("Same name.pdf"),
  {
    ...dashboardTab("Same name.pdf"),
    linkTitles: [["", "", "Renamed resource.pdf"]],
  },
);
assert.equal(
  renamedResourceTitle.recentlyUpdatedCells[newResourceKey].type,
  "UPDATED",
  "changing the displayed resource name should show UPDATED even if its underlying cell value is unchanged",
);
updateClock += 48 * 60 * 60 * 1000 + 1;
assert.deepEqual(
  mergeResourceDashboardUpdates(
    "MODULES",
    unchangedModulesTab,
    dashboardTab("02 Safety (Prelims).pdf"),
  ).recentlyUpdatedCells,
  {},
  "recent-update indicators should expire after 48 hours",
);
const reviewerBadgeSessionStorage = new Map();
const reviewerBadgeStorage = {
  getItem(key) {
    return reviewerBadgeSessionStorage.get(key) || null;
  },
  setItem(key, value) {
    reviewerBadgeSessionStorage.set(key, value);
  },
};
const hasSeenResourceChangeBadge = new Function(
  "reviewerAuthorizedEmail",
  "globalScope",
  "RESOURCE_DASHBOARD_UPDATED_TTL_MS",
  "RESOURCE_CHANGE_BADGES_SEEN_KEY",
  "Date",
  `return function hasSeenResourceChangeBadge(updateKey, updatedAt, changeType) {${resourceBadgeSeenFunction[1]}\n}`,
)(
  "reviewer@example.com",
  { sessionStorage: reviewerBadgeStorage, DebugUtils: { warn() {} } },
  48 * 60 * 60 * 1000,
  "mrh_reviewer_change_badges_seen_v1",
  { now: () => updateClock },
);
assert.equal(
  hasSeenResourceChangeBadge(newResourceKey, updateClock, "NEW"),
  false,
  "a new badge should be allowed on its first render in a session",
);
assert.equal(
  hasSeenResourceChangeBadge(newResourceKey, updateClock, "NEW"),
  true,
  "the same badge should be suppressed on later renders in that session",
);
assert.equal(
  hasSeenResourceChangeBadge(
    JSON.stringify([newResourceKey, "MODULES"]),
    updateClock + 1,
    "NEW",
  ),
  false,
  "a distinct resource-change marker should show once in the same session",
);
const freshReviewerBadgeSessionStorage = new Map();
const hasSeenResourceChangeBadgeInFreshSession = new Function(
  "reviewerAuthorizedEmail",
  "globalScope",
  "RESOURCE_DASHBOARD_UPDATED_TTL_MS",
  "RESOURCE_CHANGE_BADGES_SEEN_KEY",
  "Date",
  `return function hasSeenResourceChangeBadge(updateKey, updatedAt, changeType) {${resourceBadgeSeenFunction[1]}\n}`,
)(
  "reviewer@example.com",
  {
    sessionStorage: {
      getItem(key) {
        return freshReviewerBadgeSessionStorage.get(key) || null;
      },
      setItem(key, value) {
        freshReviewerBadgeSessionStorage.set(key, value);
      },
    },
    DebugUtils: { warn() {} },
  },
  48 * 60 * 60 * 1000,
  "mrh_reviewer_change_badges_seen_v1",
  { now: () => updateClock },
);
assert.equal(
  hasSeenResourceChangeBadgeInFreshSession(
    newResourceKey,
    updateClock,
    "NEW",
  ),
  false,
  "a new browser session should be able to show the badge once again",
);
assert.match(
  appCore,
  /resourceDashboardActiveTab === "REVIEWERS" &&\s*reviewerSessionId &&\s*reviewerDashboardLoadedForEmail\?\.toLowerCase\(\) !==\s*reviewerAuthorizedEmail\.toLowerCase\(\)[\s\S]*?showReviewerDashboardLoading\(true\);\s*return true;/,
  "Reviewer placeholder data should not render as zero rows while the authorized table request is pending",
);
assert.match(
  appCore,
  /if \(\s*resourceDashboardActiveTab === "REVIEWERS" &&\s*!nonEmptyRows\.length\s*\) \{\s*status\.textContent = "No review materials are currently available\."/,
  "Reviewer tables with no resources should show an empty state, while unavailable filters are disabled",
);
assert.doesNotMatch(
  appCore,
  /No review materials match the selected filters/,
  "the dashboard should prevent empty category selections instead of showing a filtered-results message",
);
assert.doesNotMatch(
  appCore.match(/async function loadReviewerDashboard\([\s\S]*?\n  \}/)?.[0] ||
    "",
  /filterContainer\.hidden = true|Refreshing reviewer resources…|Loading reviewer resources…/,
  "Reviewer loading should not hide filters or replace the Showing status during refresh",
);
assert.match(
  appCore,
  /function scheduleReviewerStatusPolling\(\s*sessionId,\s*delay = REVIEWER_STATUS_POLL_INTERVAL_MS,[\s\S]*?normalizedDelay = Math\.max\(0, Number\(delay\) \|\| 0\)[\s\S]*?type: "get_reviewer_account_status", sessionId[\s\S]*?applyReviewerAccountStatus\(response, sessionId, true\)[\s\S]*?\}, pollDelay\)/,
  "the page should poll the server so administrator approval changes take effect while open",
);
assert.match(
  appCore,
  /const REVIEWER_STATUS_POLL_INTERVAL_MS = 1000/,
  "visible account approval changes should be refreshed at a one-second interval",
);
assert.match(
  appCore,
  /const REVIEWER_STATUS_BACKGROUND_POLL_INTERVAL_MS = 30000[\s\S]*?function scheduleReviewerStatusPolling\([\s\S]*?document\.visibilityState === "hidden"[\s\S]*?REVIEWER_STATUS_BACKGROUND_POLL_INTERVAL_MS/,
  "background tabs should reduce approval polling while visible tabs remain responsive",
);
assert.match(
  appCore,
  /function refreshReviewerStatusOnReturn\(\)[\s\S]*?document\.visibilityState === "hidden"[\s\S]*?scheduleReviewerStatusPolling\(reviewerSessionId, 0\)[\s\S]*?restoreReviewerSession\(storedSessionId\)/,
  "returning to an active tab should immediately poll approval or retry restoring the saved session",
);
assert.match(
  appCore,
  /document\.addEventListener\(\s*"visibilitychange",\s*refreshReviewerStatusOnReturn,/,
  "tab visibility events should invoke immediate Reviewer status recovery",
);
assert.match(
  appCore,
  /globalScope\.addEventListener\("focus",\s*\(\) => \{[\s\S]*?refreshReviewerStatusOnReturn\(\)/,
  "window focus should invoke immediate Reviewer status recovery",
);
assert.match(
  appCore,
  /function scheduleReviewerSessionRestoreRetry\(sessionId\)[\s\S]*?REVIEWER_SESSION_RESTORE_RETRY_BASE_MS[\s\S]*?2 \*\* reviewerSessionRestoreRetryAttempt[\s\S]*?REVIEWER_SESSION_RESTORE_RETRY_MAX_MS[\s\S]*?sessionId !== getStoredReviewerSessionId\(\)[\s\S]*?restoreReviewerSession\(sessionId\)[\s\S]*?scheduleReviewerSessionRestoreRetry\(sessionId\)/,
  "temporary session-restore failures should recover automatically using capped backoff without overriding sign-out or a newer session",
);
assert.match(
  appCore,
  /function getStoredReviewerDashboard\(email\)[\s\S]*?sessionStorage\.getItem\(REVIEWER_DASHBOARD_CACHE_KEY\)[\s\S]*?cachedEmail !== String\(email \|\| ""\)\.trim\(\)\.toLowerCase\(\)[\s\S]*?REVIEWER_DASHBOARD_CACHE_MAX_AGE_MS/,
  "instant dashboard rows must come only from a fresh current-tab cache for the same account",
);
assert.match(
  appCore,
  /function restoreStoredReviewerDashboard\(email\)[\s\S]*?getStoredReviewerDashboard\(email\)[\s\S]*?reviewerDashboardLoadedForEmail = reviewerAuthorizedEmail/,
  "cached dashboard rows should be hydrated before session restoration completes",
);
assert.match(
  appCore,
  /async function restoreReviewerSession\([\s\S]*?const cachedProfile = getStoredReviewerProfile\(\);[\s\S]*?cachedProfile\?\.accountStatus === "TRUE"[\s\S]*?restoreStoredReviewerDashboard\(cachedProfile\.email\);[\s\S]*?const hasCachedDashboard/,
  "session restoration should hydrate approved same-account rows before deciding whether to show Loading",
);
const openResourceDashboardTabSource =
  appCore.match(
    /function openResourceDashboardTab\(tabName = "DEFAULT"\) \{[\s\S]*?\n  \}/,
  )?.[0] || "";
const cachedProfileHydrationIndex = openResourceDashboardTabSource.indexOf(
  "restoreStoredReviewerDashboard(cachedProfile.email)",
);
const reviewerRestoreBranchIndex = openResourceDashboardTabSource.indexOf(
  "if (!reviewerSessionId)",
  cachedProfileHydrationIndex,
);
assert.ok(
  cachedProfileHydrationIndex >= 0 &&
    reviewerRestoreBranchIndex > cachedProfileHydrationIndex,
  "direct Reviewer tab entry should hydrate same-session cached rows before showing a loading state",
);
assert.match(
  appCore,
  /hasAuthorizedSessionCache[\s\S]*?reviewerSessionRestorePending && !hasAuthorizedSessionCache[\s\S]*?if \(!hasAuthorizedSessionCache\)/,
  "the approved account's cached table should remain visible while its session is refreshed",
);
assert.match(
  appCore,
  /response\.accountStatus === "TRUE"[\s\S]*?resourceDashboardActiveTab === "REVIEWERS"[\s\S]*?loadReviewerDashboard\(\{ refresh: true \}\)/,
  "restoring a cached Reviewer table should fetch a fresh authorized snapshot without replacing the cached view with Loading",
);
assert.match(
  appCore,
  /if \(hasCachedDashboard\) renderResourceDashboardTab\(\);\s*else showReviewerDashboardLoading\(true\)/,
  "session restoration should not clear a cached table into a loading screen",
);
assert.match(
  appCore,
  /cacheReviewerDashboard\(reviewerAuthorizedEmail, reviewerDashboardTab\)/,
  "fresh dashboard data should refresh the current-tab cache",
);
assert.match(
  appCore,
  /function renderReviewerPdfWatermark\(fullName, email\)[\s\S]*?line\.textContent = text;[\s\S]*?watermark\.hidden = false;/,
  "online PDF preview should show one centered two-line identity watermark",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-watermark\s*\{[^}]*place-items:\s*center/,
  "the online PDF identity watermark should stay centered over the document",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-watermark span\s*\{[^}]*font-size:\s*clamp\(0\.875rem,\s*1\.3vw,\s*1\.15rem\)/,
  "the online PDF watermark should be larger and readable",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-watermark span\s*\{[^}]*color:\s*rgb\(51 65 85 \/ 18%\)/,
  "online preview watermarks should use the reduced 18 percent opacity",
);
assert.match(
  fs.readFileSync("backend/ReviewerPdf.gs", "utf8"),
  /opacity:\s*0\.18/,
  "generated PDF watermarks should use the reduced 18 percent opacity",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-expanded\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*1rem;[\s\S]*?\.resource-portal-preview\.is-expanded \.resource-portal-preview-frame\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%/,
  "expanded PDF preview should fill the viewport with an absolutely sized frame",
);
assert.match(
  appCore,
  /const loadingIcon = document\.createElement\("i"\);[\s\S]*?loadingIcon\.className = "fa-solid fa-spinner fa-spin";[\s\S]*?loadingMessage\.textContent = "Loading online preview…"/,
  "the online preview loading status should show a spinner before its text",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-frame\[hidden\],[\s\S]*?\.resource-portal-preview-status\[hidden\],[\s\S]*?display:\s*none;/,
  "the preview loading status should be hidden again after loading completes",
);
assert.match(
  appCore,
  /frame\.hidden = false;\s*frame\.src =\s*previewMimeType/,
  "the PDF frame should be visible before its source is assigned",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-reviewer-pdf,\s*\.resource-portal-preview\.is-reviewer-pdf \.resource-portal-preview-frame,\s*\.resource-portal-preview\.is-reviewer-pdf \.resource-portal-preview-viewer\s*\{[^}]*user-select:\s*none;/,
  "the Reviewer PDF preview should disable selection in its embedded viewer where supported",
);
assert.match(
  appCore,
  /preview\.addEventListener\(eventName, \(event\) => \{\s*if \(resourcePortalPreviewIsReviewer\) event\.preventDefault\(\)/,
  "Reviewer PDF previews should suppress text selection and copy/context actions",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-link-primary,\s*\.resource-dashboard-link-secondary\s*\{[^}]*display:\s*block;[^}]*line-height:\s*1;/,
  "Reviewer table chips should use two tightly stacked lines with zero vertical gap",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table td\.resource-dashboard-column-course\s*\{[^}]*font-weight:\s*700;/,
  "all text in the COURSE table column should be bold",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-title\s*\{[^}]*white-space:\s*pre-line/,
  "Reviewer preview headers should display course and lesson on separate lines",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-title-details\s*\{\s*display:\s*block;\s*font-weight:\s*400/,
  "the lesson line in Reviewer preview titles should be regular weight",
);
assert.match(
  appCore,
  /const courseLine = document\.createElement\("span"\);[\s\S]*?title\.replaceChildren\(courseLine,\s*lessonLine\)/,
  "Reviewer preview titles should bold only the first, course-name line",
);
assert.match(
  appCore,
  /function clearReviewerResourceRows\(\)[\s\S]*?clearStoredReviewerDashboard\(\)/,
  "approval loss should clear the current-tab reviewer dashboard cache",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true[\s\S]*?clearStoredReviewerDashboard\(\)/,
  "sign-out should remove reviewer data cached in the current tab",
);
assert.match(
  appCore,
  /function signOutReviewer\(explicit = true[\s\S]*?if \(resourceDashboardActiveTab === "REVIEWERS"\)\s*renderResourceDashboardTab\(\)/,
  "signing out while viewing Reviewers should immediately render its locked panel",
);
assert.doesNotMatch(
  appCore.match(/function signOutReviewer\(explicit = true[\s\S]*?\n  async function loadReviewerDashboard/)?.[0] || "",
  /resourceDashboardActiveTab = "MODULES"/,
  "sign-out must not unexpectedly switch the active Reviewer section to Modules",
);
assert.doesNotMatch(
  appCore.match(/async function restoreReviewerSession\(requestedSessionId = ""\)[\s\S]*?\n  function setReviewerAccessEnabled/)?.[0] || "",
  /openResourceDashboardTab\("PROFILE"\)/,
  "an expired saved session should keep the Reviewer tab active and show its locked panel",
);
assert.doesNotMatch(
  appCore.match(/async function downloadReviewerPdf\(\)[\s\S]*?\n  function closeReviewerPdfPreview/)?.[0] || "",
  /openResourceDashboardTab\("PROFILE"\)/,
  "an expired session during PDF download or preview should preserve the Reviewers tab and show its locked panel",
);
assert.match(
  appCore,
  /let reviewerAuthGeneration = 0;[\s\S]*?async function completeReviewerSignIn\(idToken\)[\s\S]*?const authGeneration = \+\+reviewerAuthGeneration;[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?reviewerVerificationInFlightToken !== idToken[\s\S]*?const sessionId = String\(response\?\.sessionId \|\| ""\)[\s\S]*?saveReviewerSessionId\(sessionId\)[\s\S]*?applyReviewerAccountStatus\(response, sessionId\)/,
  "out-of-order sign-in responses must not replace the currently selected Google account",
);
assert.match(
  appCore,
  /function scheduleReviewerStatusPolling\([\s\S]*?const authGeneration = reviewerAuthGeneration;[\s\S]*?authGeneration !== reviewerAuthGeneration[\s\S]*?scheduleReviewerStatusPolling\(sessionId\);[\s\S]*?applyReviewerAccountStatus\(response, sessionId, true\)/,
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
  /if \(approved\) \{[\s\S]*?if \(resourceDashboardActiveTab === "REVIEWERS"\)\s*void loadReviewerDashboard\(\);\s*else void openResourceDashboardTab\("REVIEWERS"\);/,
  "approved sign-in should open Reviewer resources without waiting for the table request",
);
assert.match(
  appCore,
  /type:\s*"log_reviewer_sign_in"[\s\S]*?sessionId,[\s\S]*?eventId:\s*signInEventId[\s\S]*?\.catch\(\(error\) => \{[\s\S]*?Unable to record reviewer sign-in activity/,
  "sign-in audit logging should run outside the blocking authentication request",
);
assert.doesNotMatch(
  appCore,
  /preparingReviewerResources|Checking your profile and administrator approval/,
  "approved sign-in should not show redundant background-check status text",
);
assert.doesNotMatch(
  appCore,
  /google\.accounts\.id\.prompt\(/,
  "the signed-out reviewer view should not open an automatic Google account prompt",
);
assert.doesNotMatch(
  appCore,
  /Reviewer access approved|Preparing your resources/,
  "background reviewer preloading should not display approval or loading copy in Profile",
);
assert.match(
  appCore,
  /function setReviewerNavigationBusy\(\)[\s\S]*?resource-dashboard-reviewers-nav[\s\S]*?removeAttribute\("aria-busy"\)/,
  "the Reviewer navigation should never show an adjacent loading indicator",
);
assert.match(
  appCore,
  /const REVIEWER_PROFILE_CACHE_KEY = "mrh_reviewer_profile_v1";[\s\S]*?function getStoredReviewerProfile\(\)[\s\S]*?getStoredReviewerSessionId\(\)[\s\S]*?function cacheReviewerProfile\(response\)[\s\S]*?email,[\s\S]*?firstName:[\s\S]*?middleInitial:[\s\S]*?lastName:[\s\S]*?picture:[\s\S]*?cachedAt:/,
  "display-only reviewer name, picture, and email should be cached for immediate restoration",
);
assert.match(
  appCore,
  /function openResourceDashboardTab\(tabName = "DEFAULT"\)[\s\S]*?hasReviewerSession =\s*!hasExplicitReviewerSignOut\(\) &&\s*Boolean\(reviewerSessionId \|\| getStoredReviewerSessionId\(\)\)[\s\S]*?tabName = hasReviewerSession \? "REVIEWERS" : "PROFILE"[\s\S]*?getStoredReviewerProfile\(\)[\s\S]*?populateReviewerProfile\(cachedProfile\)/,
  "a saved reviewer session should show cached profile data and open Reviewers by default",
);
assert.match(
  appCore,
  /function showReviewerDashboardLoading\(clearRows = false\)[\s\S]*?filters\.hidden = false[\s\S]*?categoryFilter\.hidden = false[\s\S]*?setResourceDashboardStatus\("Loading", true, true\)/,
  "the Reviewer loading state should retain all filters and display a stacked generic label",
);
assert.match(
  appCore,
  /resourceDashboardActiveTab === "REVIEWERS" &&\s*reviewerSessionId &&\s*reviewerDashboardLoadedForEmail\?\.toLowerCase\(\) !==\s*reviewerAuthorizedEmail\.toLowerCase\(\)[\s\S]*?showReviewerDashboardLoading\(true\);\s*return true;/,
  "an authorized Reviewer tab must stay on Loading and clear placeholder rows until the reviewer table response is loaded",
);
assert.match(
  appCore,
  /if \(\s*resourceDashboardActiveTab === "REVIEWERS" &&\s*!nonEmptyRows\.length\s*\) \{\s*status\.textContent = "No review materials are currently available\."/,
  "a successfully loaded empty Reviewer table should show an explicit empty state instead of a zero-row count",
);
assert.match(
  indexHtml,
  /student-portal-deck-description[\s\S]*?Syllabus, Modules, and Reviewers/,
  "the Student Portal entry should name the Reviewers section",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-reviewers-nav"[\s\S]*?aria-label="Reviewers"[\s\S]*?title="Reviewers"[\s\S]*?disabled[\s\S]*?aria-disabled="true"[\s\S]*?Reviewers/,
  "the portal navigation label should be dimmed and disabled until approval",
);
assert.match(
  appCore,
  /function setReviewerDashboardFiltersDisabled\(disabled\)[\s\S]*?button\.disabled = true[\s\S]*?button\.setAttribute\("aria-disabled", String\(button\.disabled\)\)/,
  "all Year, Semester, and Category choices should disable during Reviewer loading",
);
assert.match(
  appCore,
  /reviewerSessionRestorePending && !hasAuthorizedSessionCache\) \{\s*if \(lockedPanel\) lockedPanel\.hidden = true;[\s\S]*?showReviewerDashboardLoading\(true\);\s*return true;/,
  "a saved session without a valid cached dashboard should show Loading and never the Locked panel",
);
assert.match(
  appCore,
  /if \(!idToken\) \{\s*setReviewerNavigationBusy\(false\);[\s\S]*?setReviewerAuthStatus\("Use Google to sign in and request access\."\)/,
  "a credential-less Google callback should clear Reviewer loading states and retain only the approved prompt",
);
assert.match(
  appCore,
  /function setReviewerAuthStatus\(message, busy = false\)[\s\S]*?status\.textContent = message;[\s\S]*?if \(busy\) status\.setAttribute\("aria-busy", "true"\)/,
  "Reviewer auth status should expose the existing accessible loading indicator when busy",
);
assert.match(
  appCore,
  /reviewerVerificationInFlightToken = idToken;\s*setReviewerNavigationBusy\(true\);\s*setReviewerAuthStatus\("Signing in\.\.\.", true\)/,
  "Google credential verification should immediately display Signing in with a loading state",
);
assert.match(
  appCore,
  /function signOutReviewer\([\s\S]*?setReviewerAuthStatus\("Use Google to sign in and request access\."\)/,
  "sign-out should return to the standard Google sign-in prompt",
);
assert.doesNotMatch(
  appCore,
  /Signed out\. Reviewer data|Signed out here, but|Signed out in another tab\./,
  "signed-out states should not display redundant signed-out messages",
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
  /const termFilteredRows = nonEmptyRows\.filter\(\(\{ values \}\) =>\s*matchesSelectedTerm\(values\),?\s*\)[\s\S]*?const availableCategories = new Set\([\s\S]*?termFilteredRows\.some\([\s\S]*?button\.disabled = !hasCategoryFilter \|\| !categoryAvailable[\s\S]*?button\.setAttribute\("aria-pressed", String\(selected\)\)/,
  "category choices without resources for the selected year and semester should remain visible and disabled",
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
  /categoryFilterControl[\s\S]*?querySelectorAll\("\[data-category\]"\)[\s\S]*?button\.addEventListener\("click"[\s\S]*?resourceDashboardSelectedCategories\[resourceDashboardActiveTab\]\s*=\s*button\.dataset\.category[\s\S]*?renderResourceDashboardTab\(\)/,
  "selecting a category segment should immediately rerender the dashboard",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-filter-category"[^>]*role="group"[\s\S]*?data-category="PRELIMS"[\s\S]*?data-category="MIDTERMS"[\s\S]*?data-category="FINALS"[\s\S]*?data-category="all"/,
  "the category segmented control should offer PRELIMS, MIDTERMS, FINALS, then All",
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
assert.match(
  appCore,
  /function refreshResourceDashboardIfNeeded\(\)[\s\S]*?resourceDashboardActiveTab === "REVIEWERS"[\s\S]*?reviewerAccountStatus === "TRUE"[\s\S]*?loadReviewerDashboard\(\{ refresh: true \}\)/,
  "the visible reviewer table should refresh in the background without blocking cached rendering",
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
  /const options = sortedValues\.map\(\(value\) => \(\{\s*value,\s*label:\s*value,\s*\}\)\)[\s\S]*?options\.push\(\{\s*value:\s*"all",\s*label:\s*"All"\s*\}\)[\s\S]*?button\.dataset\.filterValue = value[\s\S]*?button\.disabled =\s*disabled \|\| \(value !== "all" && !values\.has\(value\)\)[\s\S]*?control\.replaceChildren\(\.\.\.buttons\)/,
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
  /const selectedYearName = \{\s*1: "First",\s*2: "Second",\s*3: "Third",\s*\}\[resourceDashboardSelectedYear\][\s\S]*?\?\s*`\$\{selectedYearName\} Year`/,
  "all-semester status should use First, Second, or Third Year labels",
);
assert.match(
  appCore,
  /const summary = createResourceDashboardElement\(\s*"strong",\s*"",\s*selectedTerm,\s*\);\s*status\.replaceChildren\(\s*document\.createTextNode\(\s*`Showing \$\{visibleRows\.length\} of \$\{nonEmptyRows\.length\} rows for `,\s*\),\s*summary/,
  "the dashboard row count should bold only the selected-term label",
);
assert.match(
  appCore,
  /function setReviewerEnrollmentStatus\(message, busy = false\)[\s\S]*?resource-reviewer-enrollment-status[\s\S]*?status\.hidden = !message/,
  "reviewer submission feedback should target its dedicated status below the enrollment controls",
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
  /const preferredTerm = "3\.2"[\s\S]*?availablePreviousTerms = orderedTerms\.filter[\s\S]*?year < preferredYear \|\|\s*\(year === preferredYear && semester <= preferredSemester\)[\s\S]*?const nextAvailableTerm = orderedTerms\.find[\s\S]*?semester > preferredSemester[\s\S]*?const defaultTerm =[\s\S]*?termValues\.has\(preferredTerm\) \? preferredTerm : ""[\s\S]*?nextAvailableTerm[\s\S]*?availablePreviousTerms\[availablePreviousTerms\.length - 1\][\s\S]*?resourceDashboardSelectedYear = defaultYear;[\s\S]*?resourceDashboardSelectedSemester = defaultTerm\.split\("\."\)\[1\]/,
  "default filters should prefer 3.2, then the next available term, then the nearest earlier term",
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
  /\.resource-dashboard-topbar \.resource-profile-toggle\s*\{\s*margin-left:\s*auto;[\s\S]*?\.resource-profile-toggle\s*\{[^}]*display:\s*inline-grid;[^}]*justify-items:\s*center;[\s\S]*?\.resource-profile-toggle > img\s*\{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;[\s\S]*?\.resource-profile-toggle > i\s*\{[^}]*width:\s*2\.75rem;[^}]*height:\s*2\.75rem;[^}]*font-size:\s*2rem;[^}]*line-height:\s*2\.75rem;[\s\S]*?\.resource-profile-toggle:hover,\s*\.resource-profile-toggle\.is-active\s*\{[^}]*border-color:\s*transparent;[^}]*color:\s*inherit;[^}]*background:\s*transparent;/,
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
  /\.resource-profile-signout-button\s*\{[^}]*border:\s*0;[^}]*color:\s*#dc2626;[^}]*background:\s*transparent;/,
  "the Profile sign-out control should be centered red text without a background",
);
assert.match(
  resourceStyles,
  /\.resource-reviewers-locked-panel\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;/,
  "the locked prompt background should fill the dashboard width",
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
  /new globalScope\.ResizeObserver\(\s*renderResponsiveSignInButton,\s*\)/,
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
  /auto_select:\s*false[\s\S]*?button_auto_select:\s*false[\s\S]*?use_fedcm_for_prompt:\s*false[\s\S]*?use_fedcm_for_button:\s*false/,
  "the app should not auto-select or pre-prompt a Google account before the user clicks sign-in",
);
assert.match(
  appCore,
  /itp_support:\s*true[\s\S]*?renderResponsiveSignInButton/,
  "manual Google sign-in should remain available without an automatic account prompt",
);
assert.doesNotMatch(
  appCore,
  /google\.accounts\.id\.prompt\(/,
  "reviewer sign-in should not display the One Tap account suggestion",
);
assert.match(
  appCore,
  /link\.draggable = false;[\s\S]*?\["copy", "contextmenu", "dragstart"\][\s\S]*?link\.dataset\.logCourse = rowValue\("course"\);[\s\S]*?link\.dataset\.logCategory = resourceCategory/,
  "resource clicks should resist casual link copying and log their course/year/semester/category context",
);
assert.match(
  appCore,
  /logResourceDashboardAction\(tabName, "TAB_OPEN"\)[\s\S]*?logResourceDashboardAction\([\s\S]*?"FILTER_YEAR"[\s\S]*?logResourceDashboardAction\([\s\S]*?"FILTER_SEMESTER"[\s\S]*?logResourceDashboardAction\([\s\S]*?"FILTER_CATEGORY"/,
  "tab opens and dashboard filter changes should be recorded",
);
assert.match(
  indexHtml,
  /<span>Student Portal<\/span>/,
  "the Student Portal title should retain its text at narrow widths",
);
assert.match(
  resourceStyles,
  /@media \(max-width: 520px\)[\s\S]*?\.resource-dashboard-title > span\s*\{\s*display:\s*inline;/,
  "narrow layouts should retain the Student Portal title instead of replacing it with the home icon",
);
assert.match(
  resourceStyles,
  /@media \(max-width: 520px\)[\s\S]*?\.resource-dashboard-title\s*\{\s*gap:\s*0\.5rem;\s*\}/,
  "the Student Portal home icon should have extra separation from the title on small screens",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-title > i\s*\{\s*display:\s*inline-block;/,
  "the Student Portal home icon should remain visible on large screens too",
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
  /catch \(error\) \{[\s\S]*?if \(isDefinitivelyInvalidReviewerCredential\(error\)\)[\s\S]*?\(globalScope\.DebugUtils \|\| console\)\.error\(\s*"Unable to refresh reviewer account approval status\."/,
  "temporary approval-check failures should retain the session and only log in the background",
);
assert.doesNotMatch(
  appCore,
  /Unable to refresh administrator approval right now|Unable to refresh reviewer approval right now/,
  "background approval polling should not replace Profile or Reviewer status text",
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
  /const keepReviewerStatus = resourceDashboardActiveTab === "REVIEWERS"[\s\S]*?if \(!silent && !keepReviewerStatus\)[\s\S]*?if \(!cachedDashboard && !silent && !keepReviewerStatus\)/,
  "public dashboard refreshes should not clear Reviewer rows or status",
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
assert.equal(
  indexHtml.includes('id="resource-reviewer-verify-account"'),
  false,
  "Profile settings should not show a separate Verify account button",
);
assert.match(
  appCore,
  /form\.hidden = !\(\s*accountStatus === "NOT_FOUND" \|\| accountStatus === "DENIED"\s*\)/,
  "unverified profiles should see the enrollment form",
);
assert.match(
  appCore,
  /formButton\.textContent =[\s\S]*?accountStatus === "NOT_FOUND"\s*\? "Verify"/,
  "unverified accounts should see the enrollment form with Verify as its submit action",
);
assert.match(
  appCore,
  /function renderReviewerProfileAccessStatus\(accountStatus\)[\s\S]*?TRUE:\s*\{\s*label:\s*"ACCESS GRANTED"[\s\S]*?FALSE:\s*\{\s*label:\s*"ACCESS PENDING"[\s\S]*?DENIED:\s*\{\s*label:\s*"ACCESS DENIED"/,
  "the profile should show explicit Granted, Pending, and Denied access states",
);
assert.match(
  indexHtml,
  /id="resource-profile-avatar-fallback"[\s\S]*?id="resource-profile-picture"[^>]*alt="Profile picture"[\s\S]*?id="resource-profile-name"[\s\S]*?id="resource-profile-email"/,
  "the Profile screen should render its avatar, name, and email in order",
);
assert.match(
  appCore,
  /function setReviewerAccessEnabled\(enabled\)[\s\S]*?reviewersNav\.disabled = !enabled[\s\S]*?reviewersNav\.title = enabled[\s\S]*?setReviewerAccessEnabled\(accountStatus === "TRUE"\)[\s\S]*?function signOutReviewer[\s\S]*?reviewersNav\.disabled = false[\s\S]*?reviewersNav\.title = "Reviewers"/,
  "approved status should unlock Reviewer navigation and sign-out should restore the signed-out navigation state",
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
assert.notEqual(
  normalizerStart,
  -1,
  "the dashboard tab normalizer should exist",
);
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
assert.notEqual(
  functionEnd,
  -1,
  "the dashboard tab normalizer should be complete",
);
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
  "reviewerSessionRestorePending",
  "reviewerAccountStatus",
  "getStoredReviewerSessionId",
  "hasExplicitReviewerSignOut",
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
  false,
  "TRUE",
  () => "",
  () => false,
  "Reviewer@Example.com",
  "reviewer@example.com",
);
assert.equal(
  retainReviewerRows(emptyPublicReviewerTab).REVIEWERS,
  populatedReviewerTab,
  "refreshing public dashboard data should not replace the signed-in user's reviewer rows with the intentionally empty public placeholder",
);
const retainReviewerRowsDuringRestore = createReviewerTabRetention(
  { REVIEWERS: populatedReviewerTab },
  "",
  true,
  "TRUE",
  () => "saved-session",
  () => false,
  "Reviewer@Example.com",
  "reviewer@example.com",
);
assert.equal(
  retainReviewerRowsDuringRestore(emptyPublicReviewerTab).REVIEWERS,
  populatedReviewerTab,
  "same-account authorized rows should survive public dashboard refresh while the saved session is being revalidated",
);
const discardReviewerRowsAfterSignout = createReviewerTabRetention(
  { REVIEWERS: populatedReviewerTab },
  "",
  true,
  "TRUE",
  () => "saved-session",
  () => true,
  "Reviewer@Example.com",
  "reviewer@example.com",
);
assert.equal(
  discardReviewerRowsAfterSignout(emptyPublicReviewerTab).REVIEWERS.rows.length,
  0,
  "explicit sign-out must prevent cached Reviewer rows from being retained during restoration",
);
const doNotRetainReviewerRows = createReviewerTabRetention(
  { REVIEWERS: populatedReviewerTab },
  "",
  false,
  "TRUE",
  () => "",
  () => false,
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
  /const hasExistingReviewerRows =[\s\S]*?const silentRefresh = refresh && hasExistingReviewerRows[\s\S]*?if \(!silentRefresh\)\s*showReviewerDashboardLoading\(!hasExistingReviewerRows\)/,
  "reviewer refreshes should keep existing rows and status while loading only on first fetch",
);
assert.match(
  appCore,
  /const alreadyLoading =\s*status\?\.getAttribute\("aria-busy"\) === "true" &&\s*status\.textContent\.trim\(\) === "Loading"[\s\S]*?if \(!alreadyLoading\) setResourceDashboardStatus\("Loading", true, true\)/,
  "session restore and the following authorized fetch should reuse one loading state",
);
assert.match(
  appCore,
  /if \(tabName !== "REVIEWERS"\) \{\s*const status = document\.getElementById\("resource-portal-status"\);[\s\S]*?status\.textContent\.trim\(\) === "Loading"[\s\S]*?setResourceDashboardStatus\(""\)/,
  "switching away from a loading Reviewer tab should clear its loading box immediately",
);
assert.match(
  appCore,
  /status\.textContent = `\$\{nonEmptyRows\.length\}[\s\S]*?status\.hidden = false;\s*status\.removeAttribute\("aria-busy"\)/,
  "rendering the Syllabus or Modules summary should show the status after Reviewer loading hid it",
);
assert.match(
  appCore,
  /const rawYear = rowValue\("year"\) \|\| resourceDashboardSelectedYear;[\s\S]*?const combinedYear = \/\^\(\\d\+\)\\s\*\[\.\/-\]\\s\*\(\\d\+\)\$\//,
  "resource-click logging should split combined year and semester values before sending them",
);
assert.match(
  appCore,
  /function reconcileResourceDashboardTable\([\s\S]*?currentCell\?\.isEqualNode\(nextCell\)[\s\S]*?currentCell\.replaceWith\(nextCell\)[\s\S]*?currentRows\.get\(rowKey\)/,
  "silent table refreshes should preserve unchanged cells and update only changed cells in stable rows",
);
const reconcileTableFunction = appCore.match(
  /function reconcileResourceDashboardTable\([\s\S]*?\n  \}/,
);
assert.ok(reconcileTableFunction, "the dashboard table reconciler should exist");
const reconcileResourceDashboardTable = new Function(
  `${reconcileTableFunction[0]}; return reconcileResourceDashboardTable;`,
)();
class TestDashboardNode {
  constructor(rowKey = "", columnKey = "", content = "") {
    this.dataset = {
      dashboardRowKey: rowKey,
      dashboardColumnKey: columnKey,
    };
    this.content = content;
    this.children = [];
    this.parent = null;
    this.replaceChildrenCalls = 0;
  }

  get firstElementChild() {
    return this.children[0] || null;
  }

  isEqualNode(other) {
    return (
      this.content === other.content &&
      this.dataset.dashboardColumnKey === other.dataset.dashboardColumnKey
    );
  }

  replaceWith(node) {
    const index = this.parent.children.indexOf(this);
    this.parent.children[index] = node;
    node.parent = this.parent;
    this.parent = null;
  }

  remove() {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  replaceChildren(...children) {
    this.replaceChildrenCalls += 1;
    this.children.forEach((child) => {
      child.parent = null;
    });
    this.children = children;
    this.children.forEach((child) => {
      child.parent = this;
    });
  }
}
const currentHeader = new TestDashboardNode();
const currentHeaderCell = new TestDashboardNode("", "0", "Course");
currentHeader.replaceChildren(currentHeaderCell);
const testHead = new TestDashboardNode();
testHead.replaceChildren(currentHeader);
const currentFirstRow = new TestDashboardNode("modules:1");
const unchangedCourseCell = new TestDashboardNode("", "0", "NAV6");
const changedResourceCell = new TestDashboardNode("", "1", "Old.pdf");
currentFirstRow.replaceChildren(unchangedCourseCell, changedResourceCell);
const unchangedSecondRow = new TestDashboardNode("modules:2");
unchangedSecondRow.replaceChildren(
  new TestDashboardNode("", "0", "SHIP'S AUDIT"),
);
const testBody = new TestDashboardNode();
testBody.replaceChildren(currentFirstRow, unchangedSecondRow);
const nextHeader = new TestDashboardNode();
nextHeader.replaceChildren(new TestDashboardNode("", "0", "Course"));
const nextFirstRow = new TestDashboardNode("modules:1");
nextFirstRow.replaceChildren(
  new TestDashboardNode("", "0", "NAV6"),
  new TestDashboardNode("", "1", "Updated.pdf"),
);
const nextSecondRow = new TestDashboardNode("modules:2");
nextSecondRow.replaceChildren(
  new TestDashboardNode("", "0", "SHIP'S AUDIT"),
);
const initialBodyReplaceChildrenCalls = testBody.replaceChildrenCalls;
reconcileResourceDashboardTable(testHead, testBody, nextHeader, [
  nextFirstRow,
  nextSecondRow,
]);
assert.equal(testBody.children[0], currentFirstRow);
assert.equal(testBody.children[1], unchangedSecondRow);
assert.equal(currentFirstRow.children[0], unchangedCourseCell);
assert.notEqual(currentFirstRow.children[1], changedResourceCell);
assert.equal(currentFirstRow.children[1].content, "Updated.pdf");
assert.equal(
  testBody.replaceChildrenCalls,
  initialBodyReplaceChildrenCalls,
  "an in-place cell update should not replace the table body",
);
const reviewerDashboardLoader = appCore.match(
  /async function loadReviewerDashboard\(\{ refresh = false \} = \{\}\)[\s\S]*?\n  \}/,
);
assert.ok(
  reviewerDashboardLoader,
  "the reviewer dashboard loader should exist",
);
assert.doesNotMatch(
  reviewerDashboardLoader[0],
  /Unable to refresh reviewer resources/,
  "background refresh failures should preserve the visible Showing status",
);
assert.match(
  appCore,
  /function clearReviewerResourceRows\(\)[\s\S]*?reviewerDashboardLoadedForEmail = ""[\s\S]*?function populateReviewerProfile/,
  "reviewer data should be cleared on account-state changes without forcing a tab redirect",
);
assert.doesNotMatch(
  appCore,
  /google\.accounts\.id\.prompt\(/,
  "the reviewer tab should not depend on an automatic account prompt",
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
  /options\.push\(\{\s*value:\s*"all",\s*label:\s*"All"\s*\}\)[\s\S]*?button\.dataset\.filterValue = value[\s\S]*?control\.replaceChildren\(\.\.\.buttons\)/,
  "year and semester segments should put All after the ordered options",
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
  "non-reviewer resource buttons should retain the parenthesized filename convention",
);
assert.match(
  appCore,
  /reviewerPdfMatch\s*\?\s*getReviewerPdfDisplayName\(fileTitle \|\| value\)/,
  "Reviewer PDF table chips should format lesson details from the full resource title",
);
assert.match(
  appCore,
  /const courseName =[\s\S]*?String\(values\[courseColumnIndex\] \|\| ""\)\.trim\(\)[\s\S]*?previewResourceFile\(fileId, fileName, \{\s*reviewer: true,\s*course: courseName/,
  "Reviewer PDF preview headers should include the course from their table row",
);
assert.match(
  appCore,
  /isModuleFolderFallback\s*=\s*resourceDashboardActiveTab === "MODULES" &&\s*\(!titleInParentheses \|\| !resourceTitle\)[\s\S]*?isPdfResource\s*=\s*Boolean\(reviewerPdfMatch\)\s*\|\|\s*\(!isModuleFolderFallback[\s\S]*?isModuleFolderFallback\s*\?\s*"Folder"/,
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
  /const visibleRows = nonEmptyRows[\s\S]*?const populatedColumnIndices = tab\.columns[\s\S]*?visibleRows\.some\([\s\S]*?const visibleColumnIndices =[\s\S]*?visibleColumnIndices\.forEach\(\(columnIndex\) => \{[\s\S]*?const renderedRows = visibleRows\.map\(\(\{ values, rowIndex \}\) => \{\s*const row = document\.createElement\("tr"\);[\s\S]*?visibleColumnIndices\.forEach\(\(index\) => \{[\s\S]*?reconcileResourceDashboardTable\(/,
  "dashboard headers and cells should use filtered rows and reconcile updates in place",
);
assert.match(
  appCore,
  /const resourceColumnIndices =[\s\S]*?const nonEmptyRows = tab\.rows[\s\S]*?resourceColumnIndices\.some\(\(columnIndex\) =>\s*hasCellValue\(values, rowIndex, columnIndex\)/,
  "dashboard rows and term options should include only rows with resources",
);
assert.match(
  appCore,
  /resourceDashboardSelectedCategories = \{\s*MODULES: "all",\s*REVIEWERS: "all",\s*\}[\s\S]*?resourceDashboardCategorySelectionMade = \{\s*MODULES: false,\s*REVIEWERS: false,\s*\}[\s\S]*?!resourceDashboardCategorySelectionMade\[resourceDashboardActiveTab\][\s\S]*?hasCategoryFilter[\s\S]*?availableCategories\.size > 0[\s\S]*?selectedCategory =\s*\["FINALS", "MIDTERMS", "PRELIMS"\]\.find/,
  "Modules and Reviewers should independently default to Finals and fall back through Midterms and Prelims",
);
assert.match(
  appCore,
  /else if \(\s*selectedCategory !== "all" &&\s*!availableCategories\.has\(selectedCategory\)\s*\)\s*\{\s*selectedCategory =\s*\["FINALS", "MIDTERMS", "PRELIMS"\]\.find[\s\S]*?resourceDashboardSelectedCategories\[resourceDashboardActiveTab\]\s*=\s*selectedCategory/,
  "an unavailable selected category should fall back to the highest-priority available category",
);
assert.match(
  appCore,
  /const visibleColumnIndices = categoryColumnIndices\.filter\(\s*\(columnIndex\) => columnIndex !== yearColumnIndex,\s*\);[\s\S]*?visibleColumnIndices\.forEach\(\(columnIndex\) => \{\s*const column = tab\.columns\[columnIndex\]/,
  "dashboard tables should hide the redundant Year column while preserving its filter data",
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
  /link\.dataset\.logResourceArea = resourceArea;[\s\S]*?link\.dataset\.logCourse = rowValue\("course"\);[\s\S]*?link\.dataset\.logCategory = resourceCategory;[\s\S]*?logResourceFileClick\(\s*clickedLink\.dataset\.logResourceArea,[\s\S]*?course:\s*clickedLink\.dataset\.logCourse[\s\S]*?category:\s*clickedLink\.dataset\.logCategory/,
  "resource click handlers should log current row context even when table cells are reconciled in place",
);
assert.match(
  appCore,
  /if \(reviewerSessionId\)\s*payload\.sessionId = reviewerSessionId;/,
  "file click logs should include the verified application session when the user is signed in",
);
assert.match(
  network,
  /log_resource_file_click:\s*\{\s*required:\s*\["eventId",\s*"resourceArea",\s*"fileName",\s*"fileId"\][\s\S]*?"course"[\s\S]*?"year"[\s\S]*?"semester"[\s\S]*?"category"/,
  "file click logging should validate resource identity and its course/year/semester/category context",
);
assert.match(
  network,
  /log_resource_dashboard_action:\s*\{\s*required:\s*\["eventId",\s*"resourceArea",\s*"action"\][\s\S]*?"year"[\s\S]*?"semester"[\s\S]*?"category"/,
  "dashboard activity requests should validate filter and tab actions with structured context",
);
assert.match(
  network,
  /log_reviewer_sign_in:\s*\{\s*required:\s*\["sessionId",\s*"eventId"\]/,
  "reviewer sign-in audit records should use the verified application session",
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
assert.doesNotMatch(
  resourceStyles,
  /\.resource-dashboard-column-year/,
  "dashboard styles should not retain a presentation rule for the removed Year column",
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
  /\.resource-dashboard-browser \.resource-portal-status\[aria-busy="true"\]\s*\{[^}]*box-sizing:\s*border-box;[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/,
  "dashboard loading status boxes should stay constrained to the active dashboard width",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*visible;/,
  "the dashboard table should expand with its rows and allow horizontal scrolling",
);
assert.doesNotMatch(
  resourceStyles.match(
    /\.resource-dashboard-table-scroll\s*\{([^}]+)\}/,
  )?.[1] || "",
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
  /async function restoreReviewerSession\([\s\S]*?type: "restore_reviewer_session", sessionId[\s\S]*?applyReviewerAccountStatus\(response, sessionId\)[\s\S]*?if \(isDefinitivelyInvalidReviewerCredential\(error\)\) \{\s*signOutReviewer\(false\);[\s\S]*?Your saved access session expired or was revoked[\s\S]*?Unable to verify your saved access session right now\. It has been kept/,
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
  const reviewerDashboardHandler = backend.match(
    /function handleGetReviewerDashboardRequest\(data\) \{[\s\S]*?\n\}\n\nfunction protectReviewerDashboardTab_/,
  )?.[0];
  assert.ok(
    reviewerDashboardHandler,
    "the authorized Reviewer dashboard handler should be present",
  );
  assert.ok(
    reviewerDashboardHandler.indexOf("file.getLastUpdated().getTime()") <
      reviewerDashboardHandler.indexOf(
        "reviewerCache.get(reviewerCacheKey)",
      ),
    "the Reviewer dashboard cache lookup must be keyed by the current Drive index timestamp",
  );
  assert.doesNotMatch(
    reviewerDashboardHandler,
    /mrh_reviewer_dashboard_latest_v2/,
    "the Reviewer dashboard must not serve an unversioned latest cache entry",
  );
  assert.match(
    reviewerDashboardHandler,
    /reviewerCacheKey[\s\S]*?MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS/,
    "the current index version should continue using the bounded dashboard cache",
  );
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
  /const requestId = createRequestId\(\);\s*const versionedPayload = \{ \.\.\.payload, appVersion, requestId \};\s*validateBackendPayload\(versionedPayload\)/,
  "the allowlisted dashboard request should pass the common payload validator",
);

console.log("Resource dashboard request contract check passed.");
