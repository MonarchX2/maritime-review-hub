const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
const backend = fs.readFileSync("backend/main.js", "utf8");
const appConfig = fs.readFileSync("app-config.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const indexHtml = fs.readFileSync("index.html", "utf8");
const resourceStyles = fs.readFileSync("styles.css", "utf8");
assert.match(
  appCore,
  /const RESOURCE_DASHBOARD_FILTERS_KEY =\s*"mrh_resource_dashboard_filters_v1";[\s\S]*?function loadResourceDashboardFilters\(\)[\s\S]*?localStorage\.getItem\(RESOURCE_DASHBOARD_FILTERS_KEY\)[\s\S]*?saved\.sections\?\.\[tabName\][\s\S]*?function saveResourceDashboardFilters\(\)[\s\S]*?localStorage\.setItem\(\s*RESOURCE_DASHBOARD_FILTERS_KEY,[\s\S]*?sections:\s*Object\.fromEntries/,
  "each Student Portal section's filters should be independently restored and persisted",
);
assert.match(
  appCore,
  /const resourceDashboardSelectedYears = \{\s*MODULES: "3",\s*REVIEWERS: "3",\s*SYLLABUS: "3"/,
  "each Student Portal section should have a separate saved year selection",
);
assert.match(
  appCore,
  /const resourceDashboardSelectedSemesters = \{\s*MODULES: "2",\s*REVIEWERS: "2",\s*SYLLABUS: "2"/,
  "each Student Portal section should have a separate saved semester selection",
);
assert.match(
  appCore,
  /resourceDashboardSelectedCategories = \{\s*MODULES: "PRELIMS",\s*REVIEWERS: "all",\s*SYLLABUS: "all"/,
  "Modules should default to PRELIMS while other sections default to All",
);
assert.match(
  appCore,
  /if \(accountStatus === "TRUE"\) \{\s*void loadReviewerDashboard\(\);\s*if \(!resourceDashboardData\) void loadResourceDashboard\(\{ silent: true \}\);/,
  "approved access should start preloading Reviewer data alongside public dashboard data",
);
assert.match(
  appCore,
  /function activateResourceDashboardFilters\(tabName\)[\s\S]*?resourceDashboardSelectedYears\[tabName\][\s\S]*?resourceDashboardSelectedSemesters\[tabName\]/,
  "switching sections should restore that section's own Year and Semester filters",
);
assert.match(
  appCore,
  /saveResourceDashboardFilters\(\);\s*saveResourceDashboardSection\(tabName\);\s*if \(tabName !== "REVIEWERS"\) closeReviewerPdfPreview\(\);\s*resourceDashboardActiveTab = tabName;\s*activateResourceDashboardFilters\(tabName\);/,
  "section switches should save the previous filters before activating the destination section's values",
);
const dashboardFilterStateStart = appCore.indexOf(
  '  let resourceDashboardSelectedYear = "3";',
);
const dashboardFilterStateEnd = appCore.indexOf(
  "\n  function isDefinitivelyInvalidReviewerCredential",
  dashboardFilterStateStart,
);
assert.ok(
  dashboardFilterStateStart >= 0 &&
    dashboardFilterStateEnd > dashboardFilterStateStart,
  "the per-section filter persistence implementation should be extractable",
);
const dashboardFilterStateSource = appCore.slice(
  dashboardFilterStateStart,
  dashboardFilterStateEnd,
);
const createDashboardFilterState = new Function(
  "globalScope",
  "RESOURCE_DASHBOARD_FILTERS_KEY",
  `
    let resourceDashboardActiveTab = "PROFILE";
    ${dashboardFilterStateSource}
    return {
      activate(tabName) {
        saveResourceDashboardFilters();
        resourceDashboardActiveTab = tabName;
        activateResourceDashboardFilters(tabName);
      },
      set(year, semester, category) {
        resourceDashboardSelectedYear = year;
        resourceDashboardSelectedSemester = semester;
        resourceDashboardSelectedCategories[resourceDashboardActiveTab] = category;
        resourceDashboardCategorySelectionMade[resourceDashboardActiveTab] = true;
        saveResourceDashboardFilters();
      },
      get() {
        return {
          year: resourceDashboardSelectedYear,
          semester: resourceDashboardSelectedSemester,
          category: resourceDashboardSelectedCategories[resourceDashboardActiveTab],
        };
      },
    };
  `,
);
const dashboardFilterStorage = new Map();
const dashboardFilterStorageApi = {
  getItem(key) {
    return dashboardFilterStorage.get(key) || null;
  },
  setItem(key, value) {
    dashboardFilterStorage.set(key, value);
  },
};
const dashboardFilterState = createDashboardFilterState(
  { localStorage: dashboardFilterStorageApi, DebugUtils: console },
  "student-portal-filter-test",
);
dashboardFilterState.activate("MODULES");
dashboardFilterState.set("1", "1", "PRELIMS");
dashboardFilterState.activate("REVIEWERS");
dashboardFilterState.set("2", "2", "MIDTERMS");
dashboardFilterState.activate("SYLLABUS");
dashboardFilterState.set("3", "1", "FINALS");
dashboardFilterState.activate("MODULES");
assert.deepEqual(dashboardFilterState.get(), {
  year: "1",
  semester: "1",
  category: "PRELIMS",
});
dashboardFilterState.activate("REVIEWERS");
assert.deepEqual(dashboardFilterState.get(), {
  year: "2",
  semester: "2",
  category: "MIDTERMS",
});
dashboardFilterState.activate("SYLLABUS");
assert.deepEqual(dashboardFilterState.get(), {
  year: "3",
  semester: "1",
  category: "FINALS",
});
const restoredDashboardFilterState = createDashboardFilterState(
  { localStorage: dashboardFilterStorageApi, DebugUtils: console },
  "student-portal-filter-test",
);
restoredDashboardFilterState.activate("MODULES");
assert.deepEqual(restoredDashboardFilterState.get(), {
  year: "1",
  semester: "1",
  category: "PRELIMS",
});
restoredDashboardFilterState.activate("REVIEWERS");
assert.deepEqual(restoredDashboardFilterState.get(), {
  year: "2",
  semester: "2",
  category: "MIDTERMS",
});
restoredDashboardFilterState.activate("SYLLABUS");
assert.deepEqual(restoredDashboardFilterState.get(), {
  year: "3",
  semester: "1",
  category: "FINALS",
});
assert.match(
  appCore,
  /resourceDashboardSelectedYear = button\.dataset\.filterValue;[\s\S]*?saveResourceDashboardFilters\(\);[\s\S]*?resourceDashboardSelectedSemester = button\.dataset\.filterValue;[\s\S]*?saveResourceDashboardFilters\(\);[\s\S]*?resourceDashboardSelectedCategories\[resourceDashboardActiveTab\] =\s*button\.dataset\.category;[\s\S]*?saveResourceDashboardFilters\(\)/,
  "year, semester, and category changes should be saved as soon as the user selects them",
);
assert.doesNotMatch(
  `${appCore}\n${indexHtml}\n${resourceStyles}`,
  /dashboard-auto-fit|DASHBOARD_AUTO_FIT_STORAGE_KEY|toggle-dashboard-auto-fit|Fit dashboard to screen/,
  "the dashboard fit-to-screen setting and scaling implementation should be fully removed",
);
assert.match(
  appCore,
  /function updateResourceDashboardFilterIndicators\(\)[\s\S]*?getBoundingClientRect\(\)[\s\S]*?selectedRect\.left - controlRect\.left - control\.clientLeft[\s\S]*?selectedRect\.top - controlRect\.top - control\.clientTop[\s\S]*?"--filter-indicator-height"[\s\S]*?if \(!control\.classList\.contains\("has-filter-indicator"\)\)[\s\S]*?requestAnimationFrame\(revealIndicator\)[\s\S]*?setTimeout\(revealIndicator, 0\)/,
  "the active filter highlight should align to the selected segment inside the bordered control",
);
assert.match(
  appCore,
  /status\.classList\?\.remove\("resource-dashboard-status-stacked"\);\s*updateResourceDashboardFilterIndicators\(\);/,
  "the active filter indicator should recalculate after a section is rendered",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control\s*\{[^}]*gap:\s*0;[^}]*padding:\s*0;/,
  "the active filter highlight should fill its segment without inset gaps",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control::before\s*\{[^}]*transition:\s*none;/,
  "the filter highlight should appear in place without sliding into its selected segment",
);
const folderRenderer =
  appCore.match(
    /function renderResourceDashboardFolderListing\(listing, frame, status\)[\s\S]*?\n  \}/,
  )?.[0] || "";
assert.match(
  folderRenderer,
  /aria-label", "Folder view"[\s\S]*?\["list", "List view"[\s\S]*?\["grid", "Grid view"[\s\S]*?thumbnailLink/,
  "folder previews should provide list/grid controls and use available file thumbnails",
);
assert.doesNotMatch(
  folderRenderer,
  /Up one level/,
  "folder previews should not show a redundant parent navigation button",
);
assert.match(
  backend,
  /thumbnailLink,shortcutDetails[\s\S]*?item\.thumbnailLink = String\(driveItem\.thumbnailLink\)/,
  "the resource listing should provide Drive thumbnails for grid previews",
);
assert.match(
  appCore,
  /if \(\s*columnName === "course" &&\s*yearColumnIndex >= 0\s*\)[\s\S]*?resource-dashboard-course-term[\s\S]*?`BSMT \$\{year\}\.\$\{semester\}`/,
  "course rows should always show their BSMT term as a secondary line",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-course-term\s*\{[^}]*font-weight:\s*400;[^}]*font-style:\s*italic;/,
  "the BSMT subtitle should be italic and non-bold",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-course-label,\s*\.resource-dashboard-course-term\s*\{[^}]*line-height:\s*1\.05;[\s\S]*?\.resource-dashboard-course-term\s*\{[^}]*margin:\s*-0\.1rem 0 0;/,
  "the BSMT subtitle should sit closer to the course name",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-folder-items\.is-grid/,
  "folder grid mode should be styled",
);
["FOLDER_OPEN", "FOLDER_PAGE", "FOLDER_VIEW", "PDF_DOWNLOAD"].forEach(
  (action) => {
    assert.ok(
      appCore.includes(`"${action}"`),
      `Student Portal action ${action} should be logged`,
    );
  },
);
assert.match(
  backend,
  /"FOLDER_OPEN"[\s\S]*?"FOLDER_PAGE"[\s\S]*?"FOLDER_VIEW"[\s\S]*?"PDF_DOWNLOAD"[\s\S]*?resource: cleanText\(data && data\.resource, 200\)/,
  "the backend must accept and persist detailed Student Portal action events",
);
assert.match(
  backend,
  /function handleRevokeReviewerSessionRequest\(data\)[\s\S]*?appendMRHAccessLog_\("REVIEWERS", account, data\.eventId, "SIGN_OUT"\)/,
  "successful reviewer sign-out attempts should be audited in the access logs",
);
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
assert.match(
  appCore,
  /link\.download = activePdf\.downloadFileName/,
  "Reviewer downloads should use the filename returned by the backend without deriving it from local data",
);
assert.match(
  appCore,
  /typeof response\.downloadFileName !== "string"[\s\S]*?The backend did not provide verified account and download metadata/,
  "Reviewer preview should reject responses without authoritative backend download metadata",
);
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
    details: "(1914H - 12.10.26)",
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
  getReviewerPdfLessonTitle("Lesson 00 (1615H - 12.10.26).pdf", "NAV7"),
  null,
  "a Lesson label must not be inferred unless the course column's value also matches the filename",
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
    details: "(1914H - 12.10.26)",
    header: "Lesson 1-2 (1914H - 12.10.26)",
  },
  "an existing Lesson X may be parsed before the filename's matched course",
);
assert.equal(
  getReviewerPdfLessonTitle("Lesson X (1615H - 12.10.26).pdf", ""),
  null,
  "an existing Lesson label without a matched COURSE name must not be inferred",
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
  /function hasSeenResourceChangeBadge\([\s\S]*?markSeen = false[\s\S]*?sessionStorage\.getItem\([\s\S]*?activeEntries\.some\([\s\S]*?if \(markSeen && !alreadySeen\)[\s\S]*?sessionStorage\.setItem\(/,
  "resource badge visibility should persist only after a user opens the marked resource",
);
assert.match(
  appCore,
  /hasSeenResourceChangeBadge\([\s\S]*?updatedAt,[\s\S]*?changeType,[\s\S]*?true,[\s\S]*?badge\.remove\(\)[\s\S]*?link\.removeAttribute\("aria-label"\)[\s\S]*?\{ once: true, capture: true \}/,
  "the first chip click should synchronously consume and remove its NEW or UPDATED badge before opening the resource",
);
assert.match(
  appCore,
  /closeButton\.addEventListener\("click", \(\) => \{\s*closeResourcePreview\(\);[\s\S]*?function closeResourcePreview\(\)[\s\S]*?releaseResourcePortalPreviewObjectUrl\(\)/,
  "the preview should close immediately and retain the PDF blob briefly after a native download action",
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
  /function hasSeenResourceChangeBadge\([\s\S]*?\) \{([\s\S]*?)\n  \}/,
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
  `return function hasSeenResourceChangeBadge(updateKey, updatedAt, changeType, markSeen = false) {${resourceBadgeSeenFunction[1]}\n}`,
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
  reviewerBadgeSessionStorage.size,
  0,
  "rendering a badge should not consume its one-time visibility",
);
assert.equal(
  hasSeenResourceChangeBadge(newResourceKey, updateClock, "NEW"),
  false,
  "the badge should remain visible through later renders until opened",
);
assert.equal(
  hasSeenResourceChangeBadge(newResourceKey, updateClock, "NEW", true),
  false,
  "opening the resource should mark the badge as seen",
);
assert.equal(
  reviewerBadgeSessionStorage.size,
  1,
  "opening the resource should persist the one-time badge state",
);
assert.equal(
  hasSeenResourceChangeBadge(newResourceKey, updateClock, "NEW"),
  true,
  "the badge should remain suppressed after the resource was opened",
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
  `return function hasSeenResourceChangeBadge(updateKey, updatedAt, changeType, markSeen = false) {${resourceBadgeSeenFunction[1]}\n}`,
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
  /const hasNoReviewerMaterials =\s*resourceDashboardActiveTab === "REVIEWERS" && !nonEmptyRows\.length;\s*if \(hasNoReviewerMaterials\) \{\s*status\.textContent = "No review materials are currently available\."/,
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
  fs.readFileSync("reviewer-pdf-worker.js", "utf8"),
  /const email = sanitizeWatermarkText\(identity\?\.email, 254\);[\s\S]*?const drawBlock = \(centerX, centerY, angle, blockFontSize\)[\s\S]*?watermarkTextLines\.push\([\s\S]*?page\.pushOperators\(\.\.\.operators\)/,
  "browser-generated PDFs should batch centered horizontal and rotated marks while preserving email case",
);
const watermarkWorker = fs.readFileSync("reviewer-pdf-worker.js", "utf8");
[
  "[0.17, 0.5, 0.83]",
  "size.height - perimeterMargin",
  "size.width - perimeterMargin",
  "const firstRowY = size.height * 0.12",
  "const lastRowY = size.height * 0.88",
  "Math.floor((lastRowY - firstRowY) / targetRowSpacing) + 1",
  "[0.23, 0.77].forEach((x)",
  "y + rowSpacing / 2",
  "[0.12, 0.88].forEach((x)",
  "drawBlock(size.width * 0.5, y, 0, smallFontSize)",
  "perimeterFontSize * 0.7",
  "PDFLib.setTextMatrix(...matrix)",
  "PDFLib.showText(encodedLines.get(line))",
  "page.pushOperators(...operators)",
  "pdf.setAuthor(fullName)",
  "pdf.setTitle(downloadFileName)",
  "pdf.setSubject(email)",
  "pdf.setKeywords([fullName, email])",
  "interiorFontSize",
].forEach((placement) => {
  assert.ok(
    watermarkWorker.includes(placement),
    `the watermark layout should include ${placement}`,
  );
});
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-fullscreen\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*height:\s*100vh;[^}]*height:\s*100dvh/,
  "the PDF preview should fill the dynamic viewport whenever it is open",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-fullscreen \.resource-portal-preview-viewer\s*\{[^}]*grid-row:\s*3;/,
  "fullscreen PDF preview should reserve the third grid row for the viewer even when status is hidden",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-fullscreen\.is-blob-viewer[\s\S]*?\.resource-portal-preview-header,[\s\S]*?display:\s*none;[\s\S]*?\.resource-portal-preview-viewer\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;[^}]*height:\s*100dvh/,
  "the Blob PDF viewer should fill the mobile viewport and replace the outer preview header",
);
assert.doesNotMatch(
  indexHtml,
  /resource-portal-preview-mobile-open/,
  "mobile devices should automatically open the standalone Blob viewer instead of showing a new-tab control",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-fullscreen \.resource-portal-preview-frame\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*width:\s*100%;[^}]*height:\s*100%/,
  "the fullscreen PDF frame should fill the visible viewer area",
);
assert.match(
  appCore,
  /preview\.classList\.add\("is-fullscreen"\)[\s\S]*?preview\.setAttribute\("aria-modal", "true"\)[\s\S]*?preview\.hidden = false;[\s\S]*?frame\.hidden = false;[\s\S]*?frame\.src = reviewer\s*\? `\$\{resourcePortalPreviewObjectUrl\}#toolbar=0&navpanes=0&scrollbar=0`/,
  "the online preview should open fullscreen and hide the browser PDF toolbar when supported",
);
assert.match(
  appCore,
  /status\.classList\.add\("is-loading"\);[\s\S]*?const loadingIcon = document\.createElement\("i"\);[\s\S]*?loadingIcon\.className = "fa-solid fa-spinner fa-spin";[\s\S]*?loadingMessage\.textContent =[\s\S]*?Loading PDF Preview\.\.\.[\s\S]*?Loading File Preview\.\.\./,
  "the online preview should show a centered spinner with a file-appropriate loading label",
);
assert.doesNotMatch(
  appCore,
  /Applying personalized watermark/,
  "the loading label must remain unchanged while the protected PDF is watermarked",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-status\.is-loading\s*\{[^}]*display:\s*grid;[^}]*justify-items:\s*center;[\s\S]*?\.resource-portal-preview-status\.is-loading \.fa-spinner\s*\{[^}]*font-size:\s*2\.5rem;[\s\S]*?\.resource-portal-preview\.is-fullscreen[\s\S]*?\.resource-portal-preview-status\.is-loading\s*\{[^}]*top:\s*50%;[^}]*left:\s*50%;[^}]*transform:\s*translate\(-50%, -50%\)/,
  "the preview spinner and message should be large and centered over the fullscreen viewer",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview-frame\[hidden\],[\s\S]*?\.resource-portal-preview-status\[hidden\],[\s\S]*?display:\s*none;/,
  "the preview loading status should be hidden again after loading completes",
);
assert.match(
  appCore,
  /frame\.hidden = false;[\s\S]*?requestAnimationFrame\(resolve\)[\s\S]*?frame\.src = reviewer\s*\? `\$\{resourcePortalPreviewObjectUrl\}#toolbar=0&navpanes=0&scrollbar=0`/,
  "the PDF frame should be visible and laid out before assigning its protected blob URL",
);
assert.doesNotMatch(
  appCore + indexHtml,
  /toggleResourceViewer|resource-portal-preview-expand/,
  "the online preview should not expose a fullscreen/windowed toggle",
);
assert.match(
  resourceStyles,
  /@container dashboard-subject-heading \(max-width: 3\.5rem\)\s*\{\s*\.dashboard-subject-label\s*\{\s*display:\s*none;/,
  "the narrow dashboard should hide HOME text without replacing it with an icon",
);
assert.match(
  resourceStyles,
  /\.resource-portal-preview\.is-reviewer-pdf,\s*\.resource-portal-preview\.is-reviewer-pdf \.resource-portal-preview-frame,\s*\.resource-portal-preview\.is-reviewer-pdf \.resource-portal-preview-viewer\s*\{[^}]*user-select:\s*none;/,
  "the Reviewer PDF preview should disable selection in its embedded viewer where supported",
);
assert.doesNotMatch(
  resourceStyles,
  /\.resource-portal-preview\.is-reviewer-pdf \.resource-portal-preview-frame\s*\{[^}]*pointer-events:\s*none/,
  "Reviewer PDF frame should preserve native scrolling and zoom interaction",
);
assert.match(
  appCore,
  /frame\.tabIndex = 0;/,
  "Reviewer PDF frames should remain keyboard-focusable for native viewer controls",
);
assert.match(
  indexHtml,
  /<a\s+id="resource-portal-preview-download"[^>]*aria-label="Download PDF"[^>]*hidden[\s\S]*?id="resource-portal-preview-close"/,
  "the in-site preview should expose a native PDF download action",
);
assert.match(
  appCore,
  /function watchReviewerPdfPreviewRender\([\s\S]*?frame\.addEventListener\("load", onLoad/,
  "the PDF download fallback should appear only after a render error or missing viewer-load event",
);
assert.match(appCore, /frame\.addEventListener\("error", onError/);
assert.match(appCore, /}, 8000\);/);
assert.match(
  appCore,
  /const previewGeneration = resourcePortalPreviewGeneration;[\s\S]*?const statusTimer = globalScope\.setTimeout\(\(\) => \{[\s\S]*?reviewerPdfDownloadStatusTimer === statusTimer[\s\S]*?previewGeneration !== resourcePortalPreviewGeneration/,
  "an older download-status timeout must not affect a newer preview or download",
);
assert.match(
  appCore,
  /function openBlobResourceViewer\([\s\S]*?Return to Website[\s\S]*?<a id="pdf-download"\$\{blobUrl \? ` href="\$\{blobUrl\}" download="\$\{downloadName\}"`[\s\S]*?preview\.classList\.add\("is-blob-viewer"\)[\s\S]*?frame\.src = viewerUrl/,
  "the Blob viewer should use local PDF.js for mobile PDFs and retain return and download actions",
);
assert.match(appCore, /new URL\("pdfjs-5\.4\.394\.min\.mjs", baseUrl\)/);
assert.match(appCore, /new URL\("pdfjs-5\.4\.394\.worker\.min\.mjs", baseUrl\)/);
assert.match(appCore, /pdfjs\.getDocument[\s\S]*?MRH_PDF_VIEWER_READY/);
assert.match(
  appCore,
  /function getDrivePreviewUrl\([\s\S]*?https:\/\/drive\.google\.com\/file\/d\/[\s\S]*?function openDriveResourceViewer/,
  "public PDFs and unsupported Modules files should route to the native Drive preview",
);
assert.match(
  appCore,
  /previewMode:\s*"drive"[\s\S]*?response\.deliveryMode !== "drive"/,
  "native Drive previews should be authorized by the backend",
);
assert.match(
  appCore,
  /MRH_RESOURCE_PREVIEW_WEBSITE_FALLBACK[\s\S]*?forceInSite:\s*true/,
  "PDF previews should retain an explicit in-site fallback when Drive access is unavailable",
);
assert.match(
  appCore,
  /allowWebsiteFallback = true[\s\S]*?websitePreviewAction[\s\S]*?allowWebsiteFallback: !isDrivePreviewOnly/,
  "unsupported Modules files should open externally without an in-site fallback that can trigger a download",
);
assert.match(
  appCore,
  /const fileContent = usePdfJs[\s\S]*?<iframe title="\$\{safeTitle\}" src="\$\{blobUrl\}"><\/iframe>/,
  "non-mobile resource previews should retain the existing native Blob iframe",
);
assert.doesNotMatch(
  appCore,
  /Open File|Open PDF/,
  "Blob viewers must not show a redundant open-file action",
);
assert.match(
  appCore,
  /function openMobileReviewerPdfBlobViewer\([\s\S]*?activePdf\.sessionId !== reviewerSessionId[\s\S]*?mobileOnly:\s*true/,
  "Reviewer PDFs should use the Blob viewer on mobile only after validating the active reviewer session",
);
assert.match(
  appCore,
  /function isMobileReviewerPdfDevice\([\s\S]*?userAgentData\?\.mobile[\s\S]*?Android\|iPhone\|iPod\|iPad\|Mobile\|Windows Phone[\s\S]*?\(pointer: coarse\)/,
  "mobile detection should cover mobile user agents, Client Hints, and coarse-pointer devices",
);
assert.match(
  appCore,
  /const isPdfResource =[\s\S]*?if \(reviewer && isPdfResource && isMobileReviewerPdfDevice\(\)\) \{[\s\S]*?forcePdfJs:\s*true[\s\S]*?const isInlineResourceType[\s\S]*?AppNetwork\.callBackend/,
  "mobile Reviewer PDF.js preview should open before the backend request and watermarking finish",
);
assert.match(
  appCore,
  /function sendReviewerPdfBytesToBlobViewer\([\s\S]*?MRH_PDF_VIEWER_DATA[\s\S]*?downloadUrl:[\s\S]*?function showReviewerPdfBlobViewerError/,
  "the early mobile viewer shell should receive the prepared PDF and download link when ready",
);
assert.match(
  appCore,
  /const isModulesSection =\s*resourceDashboardActiveTab === "MODULES" && !reviewer;[\s\S]*?const isModulesFile = isModulesSection;[\s\S]*?const isSyllabusPdf =\s*resourceDashboardActiveTab === "SYLLABUS" &&\s*responseMimeType === "application\/pdf"[\s\S]*?openBlobResourceViewer\(previewTitle/,
  "all Modules files and Syllabus PDFs should use the native Blob viewer",
);
assert.match(
  appCore,
  /const isNativeMediaType = .+\.test\(responseMimeType\);[\s\S]*?responseMimeType === "application\/json"\s*\?\s*"text\/plain"[\s\S]*?:\s*isSafeInlineType \|\| \(isModulesSection && isNativeMediaType\)\s*\?\s*responseMimeType\s*:\s*"application\/octet-stream"/,
  "Modules audio and video should use native browser playback while other unsupported types remain non-executable downloads",
);
assert.match(
  appCore,
  /event\.source !== frame\.contentWindow[\s\S]*?event\.data\?\.type === "MRH_PDF_VIEWER_READY"[\s\S]*?sendReviewerPdfBytesToBlobViewer\(\)[\s\S]*?event\.data\?\.type !== "MRH_RESOURCE_PREVIEW_RETURN"[\s\S]*?backButton\.click\(\)/,
  "PDF bytes and return actions should only be handled from the active preview frame",
);
assert.match(
  appCore,
  /function releaseResourcePortalPreviewObjectUrl\(\) \{[\s\S]*?if \(blobViewerUrl\) URL\.revokeObjectURL\(blobViewerUrl\);[\s\S]*?if \(resourcePortalPreviewUrlOpened\) \{\s*globalScope\.setTimeout\([\s\S]*?URL\.revokeObjectURL\(objectUrl\)[\s\S]*?5 \* 60 \* 1000[\s\S]*?\} else \{\s*URL\.revokeObjectURL\(objectUrl\)/,
  "the viewer Blob should be revoked on close while retaining a prepared PDF URL briefly after download",
);
function extractAppFunction(name) {
  const start = appCore.indexOf(`  function ${name}(`);
  assert.notEqual(start, -1, `expected app function ${name}`);
  const end = appCore.indexOf("\n  function ", start + 1);
  return appCore.slice(start, end < 0 ? appCore.length : end);
}
function createPreviewUrlReleaser(opened) {
  const timers = [];
  const revoked = [];
  const globalScope = {
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
    },
  };
  const release = new Function(
    "URL",
    "globalScope",
    `
      let resourcePortalPreviewObjectUrl = "blob:preview";
      let resourcePortalPreviewBlobViewerUrl = "";
      let resourcePortalPreviewUrlOpened = ${opened};
      ${extractAppFunction("releaseResourcePortalPreviewObjectUrl")}
      return releaseResourcePortalPreviewObjectUrl;
    `,
  )(
    { revokeObjectURL: (url) => revoked.push(url) },
    globalScope,
  );
  return { release, timers, revoked };
}
const unopenedPreviewUrl = createPreviewUrlReleaser(false);
unopenedPreviewUrl.release();
assert.deepEqual(unopenedPreviewUrl.revoked, ["blob:preview"]);
assert.equal(unopenedPreviewUrl.timers.length, 0);
const openedPreviewUrl = createPreviewUrlReleaser(true);
openedPreviewUrl.release();
assert.deepEqual(openedPreviewUrl.revoked, []);
assert.equal(openedPreviewUrl.timers.length, 1);
assert.equal(openedPreviewUrl.timers[0].delay, 5 * 60 * 1000);
openedPreviewUrl.timers[0].callback();
assert.deepEqual(openedPreviewUrl.revoked, ["blob:preview"]);
function createPdfRenderWatcher() {
  const listeners = new Map();
  const timers = [];
  const fallbacks = [];
  const frame = {
    addEventListener(name, callback) {
      listeners.set(name, callback);
    },
    removeEventListener(name) {
      listeners.delete(name);
    },
    emit(name) {
      listeners.get(name)?.();
    },
  };
  const status = {
    hidden: false,
    replaceChildren() {},
  };
  const watch = new Function(
    "globalScope",
    "resourcePortalPreviewGeneration",
    "reviewerPdfRenderCheckTimer",
    "reviewerPdfRenderCheckCleanup",
    "renderReviewerPdfDownloadFallback",
    `${extractAppFunction("watchReviewerPdfPreviewRender")}; return watchReviewerPdfPreviewRender;`,
  )(
    {
      setTimeout(callback, delay) {
        timers.push({ callback, delay });
        return timers.length;
      },
      clearTimeout() {},
    },
    7,
    0,
    null,
    () => fallbacks.push("shown"),
  );
  watch(frame, status, { downloadFileName: "file.pdf" }, 7);
  return { frame, timers, fallbacks };
}
const successfulPdfRender = createPdfRenderWatcher();
assert.equal(successfulPdfRender.timers[0].delay, 8000);
successfulPdfRender.frame.emit("load");
assert.deepEqual(successfulPdfRender.fallbacks, []);
const failedPdfRender = createPdfRenderWatcher();
failedPdfRender.frame.emit("error");
assert.deepEqual(failedPdfRender.fallbacks, ["shown"]);
const missingPdfRender = createPdfRenderWatcher();
missingPdfRender.timers[0].callback();
assert.deepEqual(missingPdfRender.fallbacks, ["shown"]);
class TestBlob {
  constructor(parts, options) {
    this.content = parts.join("");
    this.type = options.type;
  }
}
function escapeTestHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}
const blobViewerState = {
  created: [],
  revoked: [],
  blobViewerClassAdded: false,
};
class TestURL extends URL {
  static createObjectURL(blob) {
    blobViewerState.created.push(blob);
    return "blob:viewer";
  }

  static revokeObjectURL(url) {
    blobViewerState.revoked.push(url);
  }
}
const blobViewer = new Function(
  "escapeHTML",
  "URL",
  "Blob",
  "globalScope",
  "isMobileReviewerPdfDevice",
  "reviewerSessionId",
  "resourcePortalPreviewObjectUrl",
  "resourcePortalPreviewUrlOpened",
  "resourcePortalPreviewBlobViewerUrl",
  "resourcePortalPreviewPdfBytes",
  "resourcePortalPreviewBlobViewerReady",
  "resourcePortalPreviewBlobViewerError",
  `${extractAppFunction("openBlobResourceViewer")}; ${extractAppFunction("openMobileReviewerPdfBlobViewer")}; return openMobileReviewerPdfBlobViewer;`,
)(
  escapeTestHtml,
  TestURL,
  TestBlob,
  {
    matchMedia: (query) => ({
      matches: query === "(pointer: coarse)",
    }),
    location: {
      href: 'https://example.test/mrh/?return=<safe&x="y"',
      origin: "https://example.test",
    },
    __MRH_APP_BASE_PATH: "/mrh/",
  },
  () => true,
  "active-session",
  "blob:prepared-pdf",
  false,
  "",
  null,
  false,
  "",
);
const blobViewerPreview = {
  classList: {
    add(className) {
      blobViewerState.blobViewerClassAdded = className === "is-blob-viewer";
    },
  },
};
const blobViewerFrame = {
  hidden: true,
  src: "",
};
const blobViewerStatus = {
  hidden: false,
  classList: { remove() {} },
};
assert.equal(
  blobViewer(
    {
      sessionId: "active-session",
      downloadFileName: "course.pdf",
      bytes: new Uint8Array([37, 80, 68, 70]),
    },
    "NAV6 - <Unsafe> Course",
    blobViewerPreview,
    blobViewerFrame,
    blobViewerStatus,
  ),
  true,
);
assert.equal(blobViewerFrame.src, "blob:viewer");
assert.equal(blobViewerFrame.hidden, false);
assert.equal(blobViewerStatus.hidden, true);
assert.equal(blobViewerState.blobViewerClassAdded, true);
assert.equal(blobViewerState.created.length, 1);
assert.equal(
  blobViewerState.created[0].type,
  "text/html;charset=utf-8",
);
assert.match(
  blobViewerState.created[0].content,
  /href="https:\/\/example\.test\/mrh\/\?return=&lt;safe&amp;x=&quot;y&quot;" target="_top">Return to Website/,
);
assert.match(
  blobViewerState.created[0].content,
  /grid-template-rows: auto minmax\(0, 1fr\);[\s\S]*?#pdf-status \{ position: fixed;/,
  "the PDF status overlay must not create an implicit grid row that pushes the PDF offscreen",
);
assert.match(
  blobViewerState.created[0].content,
  /@media \(max-width: 640px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]*?white-space: normal/,
  "mobile viewer title and actions must wrap and fit within the viewport",
);
assert.match(
  blobViewerState.created[0].content,
  /<h1>NAV6 - &lt;Unsafe&gt; Course<\/h1>/,
);
assert.match(
  blobViewerState.created[0].content,
  /<a id="pdf-download" href="blob:prepared-pdf" download="course\.pdf">Download<\/a>/,
);
assert.match(
  blobViewerState.created[0].content,
  /<a id="return-to-site" href="https:\/\/example\.test\/mrh\/\?return=&lt;safe&amp;x=&quot;y&quot;" target="_top">Return to Website<\/a>/,
);
assert.match(
  blobViewerState.created[0].content,
  /<main id="pdf-pages" aria-label="PDF pages"><\/main>[\s\S]*?pdfjs\.getDocument/,
);
const openImmediateBlobViewer = new Function(
  "escapeHTML",
  "URL",
  "Blob",
  "globalScope",
  "isMobileReviewerPdfDevice",
  "resourcePortalPreviewObjectUrl",
  "resourcePortalPreviewUrlOpened",
  "resourcePortalPreviewBlobViewerUrl",
  "resourcePortalPreviewPdfBytes",
  "resourcePortalPreviewBlobViewerReady",
  "resourcePortalPreviewBlobViewerError",
  `${extractAppFunction("openBlobResourceViewer")}; return openBlobResourceViewer;`,
)(
  escapeTestHtml,
  TestURL,
  TestBlob,
  {
    matchMedia: () => ({ matches: true }),
    location: {
      href: "https://example.test/mrh/",
      origin: "https://example.test",
    },
    __MRH_APP_BASE_PATH: "/mrh/",
  },
  () => true,
  "",
  false,
  "",
  null,
  false,
  "",
);
const earlyViewerFrame = { hidden: true, src: "" };
assert.equal(
  openImmediateBlobViewer("NAV6 - Full Course Name", {
    preview: blobViewerPreview,
    frame: earlyViewerFrame,
    status: blobViewerStatus,
    mobileOnly: true,
    forcePdfJs: true,
  }),
  true,
  "the mobile PDF.js shell should open before source bytes or a Blob URL are available",
);
assert.equal(earlyViewerFrame.src, "blob:viewer");
assert.match(
  blobViewerState.created[1].content,
  /<main id="pdf-pages" aria-label="PDF pages"><\/main>[\s\S]*?Loading PDF Preview[\s\S]*?import\("https:\/\/example\.test\/mrh\/pdfjs-5\.4\.394\.min\.mjs"\)/,
  "the immediate mobile viewer should start loading PDF.js while authorization and watermarking run",
);
assert.match(
  blobViewerState.created[1].content,
  /<a id="pdf-download" aria-disabled="true" tabindex="-1">Download<\/a>/,
  "download must remain unavailable until the authorized, watermarked PDF is ready",
);
assert.ok(
  blobViewerState.created[1].content.indexOf(
    'window.addEventListener("message", (event) => {',
  ) <
    blobViewerState.created[1].content.indexOf("const observer ="),
  "the early PDF preparation error listener must be registered before page rendering starts",
);
assert.doesNotMatch(
  blobViewerState.created[0].content,
  /<iframe title="NAV6 - &lt;Unsafe&gt; Course" src="blob:prepared-pdf"><\/iframe>/,
  "mobile PDFs should use PDF.js rather than an embedded native PDF viewer",
);
assert.doesNotMatch(
  blobViewerState.created[0].content,
  /Open File|Open PDF/,
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
  /\.resource-dashboard-link-button\s*\{[^}]*width:\s*100%;[^}]*height:\s*2\.75rem;/,
  "resource chips should share a consistent fixed height and fill their table column",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-change-link-wrap\s*\{[^}]*display:\s*flex;[^}]*width:\s*100%;[\s\S]*?\.resource-dashboard-change-link-wrap \.resource-dashboard-link-button\s*\{[^}]*max-width:\s*none;/,
  "badged chips should keep the same column width as unbadged chips",
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
  /const reviewerCourseHeading = reviewer\s*\?\s*getReviewerPdfCourseHeading\(course\)\s*:\s*"";[\s\S]*?const courseLine = document\.createElement\("span"\);[\s\S]*?document\.createTextNode\(reviewerCourseHeading\)[\s\S]*?title\.replaceChildren\(courseLine,\s*lessonLine\)/,
  "Reviewer preview titles should show the course code and full course name on the bold first line",
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
  appCore.match(/function downloadReviewerPdf\(event\)[\s\S]*?\n  function getResourceDashboardFolderPanel/)?.[0] || "",
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
  /if \(approved\) \{[\s\S]*?if \(resourceDashboardActiveTab === "REVIEWERS"\)\s*void loadReviewerDashboard\(\);\s*else void openResourceDashboardTab\(getLastResourceDashboardSection\(\)\);/,
  "approved sign-in should restore the saved portal section without waiting for its data request",
);
assert.match(
  appCore,
  /const response = await globalScope\.AppNetwork\.callBackend\([\s\S]*?type:\s*"verify_reviewer_access"[\s\S]*?eventId:\s*signInEventId[\s\S]*?if \(response\?\.auditLogged === false\)[\s\S]*?setReviewerAuthStatus\([\s\S]*?couldn't record the sign-in activity[\s\S]*?Unable to record reviewer sign-in activity/,
  "sign-in audit logging should share the authentication request without hiding audit failures",
);
assert.doesNotMatch(
  appCore.match(/async function completeReviewerSignIn\(idToken\) \{([\s\S]*?)\n  \}\n\n  async function requestReviewerEnrollment/)?.[1] || "",
  /type:\s*"log_reviewer_sign_in"/,
  "the sign-in flow should not issue a second audit request",
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
  /function openResourceDashboardTab\(tabName = "DEFAULT"\)[\s\S]*?hasReviewerSession =\s*!hasExplicitReviewerSignOut\(\) &&\s*Boolean\(reviewerSessionId \|\| getStoredReviewerSessionId\(\)\)[\s\S]*?tabName = hasReviewerSession\s*\?\s*getLastResourceDashboardSection\(\)\s*:\s*"PROFILE"[\s\S]*?getStoredReviewerProfile\(\)[\s\S]*?populateReviewerProfile\(cachedProfile\)/,
  "a saved reviewer session should show cached profile data and restore its last portal section",
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
  /const hasNoReviewerMaterials =\s*resourceDashboardActiveTab === "REVIEWERS" && !nonEmptyRows\.length;\s*if \(hasNoReviewerMaterials\) \{\s*status\.textContent = "No review materials are currently available\."/,
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
  /id="resource-dashboard-subjects-nav"[\s\S]*?Subjects[\s\S]*?id="resource-dashboard-syllabus-nav"[\s\S]*?Syllabus[\s\S]*?id="resource-dashboard-modules-nav"[\s\S]*?Modules[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?fa-clipboard-list/,
  "the portal should show Subjects left of Syllabus alongside Modules and Reviewers",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-return"[^>]*aria-label="Home"[\s\S]*?fa-house/,
  "the return control should be a home icon instead of an arrow and text label",
);
assert.match(
  indexHtml,
  /id="resource-dashboard-course-names-toggle"[\s\S]*?id="resource-dashboard-profile-nav"/,
  "the universal course display toggle should be immediately left of the profile control",
);
assert.match(
  appCore,
  /RESOURCE_DASHBOARD_COURSE_NAMES_KEY[\s\S]*?courseNamesToggle\.addEventListener\("click"[\s\S]*?renderResourceDashboardTab\(\)/,
  "the course display preference should persist and rerender Student Portal resource sections",
);
assert.match(
  appCore,
  /courseNamesToggle\.textContent = selected \? "SUBJECTS" : "COURSE"/,
  "the display toggle should use COURSE and SUBJECTS labels",
);
assert.match(
  appCore,
  /let resourceDashboardCourseNamesEnabled = false;[\s\S]*?localStorage\.getItem\(\s*RESOURCE_DASHBOARD_COURSE_NAMES_KEY/,
  "the toggle should default to COURSE and restore the user's saved choice",
);
const subjectsPanel =
  indexHtml.match(
    /<section\s+id="resource-dashboard-subjects-content"[\s\S]*?<\/section>/,
  )?.[0] || "";
assert.ok(
  [  "Subjects course catalogue", "resource-dashboard-subjects-filter-year",
  "resource-dashboard-subjects-filter-semester",
  "resource-dashboard-subjects-status",
  "resource-dashboard-subjects-search",
  "resource-dashboard-subjects-body"].every((marker) =>
    subjectsPanel.includes(marker),
  ),
  "Subjects should be a separate populated tab with working filters, search, status, and the dashboard table format",
);
assert.doesNotMatch(
  subjectsPanel,
  /resource-dashboard-subjects-title|fa-book-open/,
  "the Subjects section should not repeat a SUBJECTS title inside its panel",
);
assert.equal(
  (subjectsPanel.match(/<th scope="col"/g) || []).length,
  2,
  "the Subjects catalogue should have exactly two columns",
);
assert.match(
  subjectsPanel,
  /class="resource-dashboard-column-course">Course<\/th>[\s\S]*?>Subjects<\/th>/,
  "the Subjects catalogue should use Course and Subjects headers",
);
assert.match(
  subjectsPanel,
  /class="resource-portal-search resource-dashboard-subjects-search-row"[\s\S]*?id="resource-dashboard-subjects-search"[\s\S]*?autocapitalize="characters"[\s\S]*?id="resource-dashboard-subjects-search-clear"/,
  "the Subjects search should occupy the full-width row below the term filters",
);
assert.doesNotMatch(
  subjectsPanel,
  /resource-dashboard-subjects-filter-category|resource-dashboard-subjects-search-toggle|resource-dashboard-subjects-search-popover/,
  "the Subjects panel should no longer include a Category filter or floating search popover",
);
const subjectsRenderer =
  appCore.match(
    /function renderResourceDashboardSubjects\(\)[\s\S]*?(?=\n  async function loadResourceDashboard)/,
  )?.[0] || "";
assert.ok(
  [
    "resourceDashboardData?.MODULES",
    "resource-dashboard-subjects-filter-year",
    "resource-dashboard-subjects-filter-semester",
    "resource-dashboard-subjects-body",
    "Boolean(query) ||",
    "search.value.toLocaleUpperCase()",
    "search.setSelectionRange(start, end)",
    "const searchActive = Boolean(query)",
    "searchActive || (value !== \"all\" && !values.has(value))",
    "resource-dashboard-subjects-search-clear",
    "const uniqueEntries = buildCourseCatalogEntries(visibleEntries)",
    "subjectsTable?.classList.toggle(\"is-search-active\", searchActive)",
    "yearCell.textContent = entry.year",
    "subjectsCell.textContent = entry.subject",
    "courseCell.classList.add(\"resource-dashboard-column-course\")",
    "row.append(yearCell, courseCell, subjectsCell)",
  ].every((marker) => subjectsRenderer.includes(marker)),
  "the Subjects tab should render unique course catalogue records with course codes and mapped names",
);
assert.match(
  subjectsRenderer,
  /resourceDashboardSelectedSemesters\.SUBJECTS === "all" \|\|\s*semesters\.has\(resourceDashboardSelectedSemesters\.SUBJECTS\)\s*\?\s*resourceDashboardSelectedSemesters\.SUBJECTS\s*:\s*"all"/,
  "the Subjects renderer should retain a semester only when it is available for the selected year",
);
assert.match(
  subjectsRenderer,
  /"year",\s*\(value\) => \{\s*resourceDashboardSelectedYears\.SUBJECTS = value;\s*\},/,
  "changing the Subjects year should not reset the semester selection",
);
assert.doesNotMatch(
  subjectsRenderer,
  /previewResourceFile\(|entry\.title/,
  "the Subjects catalogue should not render or open resource entries",
);
assert.match(
  appCore,
  /leftTerm\.year - rightTerm\.year \|\|\s*leftTerm\.semester - rightTerm\.semester \|\|[\s\S]*?getRowOrderName\(left\)/,
  "dashboard entries should sort by year and semester before filename sequence numbers",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-listing[\s\S]*?\.resource-dashboard-table\s*td\.resource-dashboard-column-subjects\s*\{[^}]*text-align:\s*left/,
  "the Subjects column should be left aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-listing \.resource-dashboard-table th\s*\{[^}]*text-align:\s*left/,
  "both headers in the Subjects table should be left aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-listing[\s\S]*?\.resource-dashboard-table-scroll\s*\{\s*display:\s*block;/,
  "the Subjects table should use the shared horizontally scrollable table container",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-listing[\s\S]*?th\.resource-dashboard-column-year,[\s\S]*?td\.resource-dashboard-column-year\s*\{\s*text-align:\s*center/,
  "the always-visible Year column should be centered",
);
assert.match(
  appCore,
  /\.\.\.\["Year", "Course", "Subjects"\]\.map\([\s\S]*?row\.append\(yearCell, courseCell, subjectsCell\)/,
  "the SUBJECTS table should always show the centered Year column to the left of Course",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-search-row\s*\{(?=[^}]*grid-column:\s*1\s*\/\s*-1;)(?=[^}]*align-items:\s*flex-end;)(?=[^}]*min-height:\s*3\.5rem;)(?=[^}]*width:\s*100%;)[^}]*\}/,
  "the Subjects search row should retain the full-width Category filter slot height above the table",
);
assert.match(
  appCore,
  /status\.replaceChildren\(\);\s*status\.hidden = true;/,
  "the Subjects section should hide the entry-count status after rendering",
);
assert.match(
  appCore,
  /button\.disabled =\s*searchActive \|\| \(value !== "all" && !values\.has\(value\)\);\s*button\.setAttribute\("aria-disabled", String\(button\.disabled\)\)/,
  "Subjects unavailable filter options should be disabled accessibly",
);
assert.match(
  appCore,
  /function renderResourceDashboardSubjects\(\)[\s\S]*?updateResourceDashboardFilterIndicators\(\)/,
  "the Subjects filters should update the shared active indicator",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table th\.resource-dashboard-column-course\s*\{[^}]*text-align:\s*right;/,
  "all COURSE headers should be right aligned",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-listing \.resource-dashboard-table th\s*\{[^}]*text-align:\s*left/,
  "the Subjects table should override the global COURSE header alignment",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-subjects-listing \.resource-dashboard-table-frame\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*margin-inline:\s*0;[^}]*overflow:\s*clip;[\s\S]*?\.resource-dashboard-subjects-listing \.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*margin-inline:\s*auto;/,
  "the SUBJECTS table should center when it fits, scroll only its content width when wider, and clip row pseudo-background overflow",
);
assert.match(
  indexHtml,
  /id="resource-portal-preview-back"[^>]*aria-label="Back to folder"[\s\S]*?id="resource-portal-preview-close"[^>]*aria-label="Close preview"/,
  "the preview should provide a return control distinct from closing the preview",
);
assert.match(
  appCore,
  /if \(!listing\) \{[\s\S]*?resourceDashboardActiveTab === "MODULES"[\s\S]*?closeResourcePreview\(\)[\s\S]*?const panel = getResourceDashboardFolderPanel\(frame\)[\s\S]*?renderResourceDashboardFolderListing\(listing, frame, status\)[\s\S]*?const returningToModules =[\s\S]*?resourceDashboardActiveTab === "MODULES"[\s\S]*?backButton\.hidden = !returningToFolder && !returningToModules/,
  "the return control should restore the parent folder when applicable and otherwise return from any Modules preview to its listing",
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
  /const allYearLevelsSelected = resourceDashboardSelectedYear === "all"[\s\S]*?allYearLevelsSelected \|\|\s*term\.split\("\."\)\[0\] === resourceDashboardSelectedYear[\s\S]*?resourceDashboardSelectedSemester = populateTermOptions\([\s\S]*?true,\s*false,\s*\["1",\s*"2"\]/,
  "All Year Levels should keep semester segments enabled and populate them from all available years",
);
assert.match(
  appCore,
  /if \(!hasTermFilter\) return true;[\s\S]*?\(resourceDashboardSelectedYear === "all" \|\|\s*year === resourceDashboardSelectedYear\) &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "All Year Levels should still allow filtering rows by selected semester",
);
assert.match(
  appCore,
  /`Showing \$\{visibleRows\.length\} entries for `/,
  "the dashboard status should show the visible entry count and selected term",
);
assert.match(
  appCore,
  /const summary = createResourceDashboardElement\([\s\S]*?selectedTerm/,
  "the dashboard status should include the selected year/semester label",
);
assert.match(
  appCore,
  /function setReviewerEnrollmentStatus\(message, busy = false\)[\s\S]*?resource-reviewer-enrollment-status[\s\S]*?status\.hidden = !message/,
  "reviewer submission feedback should target its dedicated status below the enrollment controls",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?\.resource-dashboard-term-control\s*\{[^}]*width:\s*100%;[\s\S]*?\.resource-dashboard-semester-segments\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[\s\S]*?\.resource-dashboard-segmented-control button\s*\{[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/,
  "Year and Semester filters should share the first row",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);[\s\S]*?#resource-dashboard-category-filter\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;[\s\S]*?\.resource-dashboard-category-segments\s*\{[^}]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/,
  "the Category filter should span the second row beneath Year and Semester",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control::before\s*\{[^}]*background:\s*#2563eb;[^}]*transition:\s*none;[\s\S]*?\.resource-dashboard-segmented-control button\.is-active\s*\{[^}]*color:\s*#fff;[^}]*background:\s*transparent;[\s\S]*?\.dark \.resource-dashboard-segmented-control\s*\{[^}]*background:\s*#334155;[\s\S]*?\.dark \.resource-dashboard-segmented-control button\.is-active\s*\{[^}]*background:\s*transparent;/,
  "the selected filter segment should use an immediate blue indicator in both themes",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control button:disabled\s*\{[^}]*cursor:\s*not-allowed;[^}]*opacity:\s*0\.5;/,
  "the disabled Syllabus category segments should look inactive",
);
assert.match(
  resourceStyles,
  /#resource-reviewers-locked-panel:not\(\[hidden\]\)\s*~\s*\.resource-dashboard-listing\s*\{\s*display:\s*none;/,
  "the dashboard listing should be hidden while the Reviewers section is locked",
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
  /\.resource-reviewer-enrollment \+ \.resource-profile-signout-button\s*\{\s*margin-top:\s*-1rem;/,
  "the Sign Out button should sit directly below the Verify form when it is visible",
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
  /resourceDashboardActiveTab = tabName;[\s\S]*?dashboardContent\.hidden =\s*tabName === "PROFILE" \|\| tabName === "SUBJECTS"[\s\S]*?subjectsContent\.hidden = tabName !== "SUBJECTS"[\s\S]*?profileScreen\.hidden = tabName !== "PROFILE"[\s\S]*?lockedPanel\.hidden = tabName !== "REVIEWERS"[\s\S]*?if \(tabName === "PROFILE"\) \{\s*void logResourceDashboardAction\("PROFILE", "TAB_OPEN"\);\s*void initializeReviewerAuth\(\)[\s\S]*?if \(tabName === "REVIEWERS"\) \{\s*if \(!reviewerSessionId\) \{[\s\S]*?lockedPanel\.hidden = false[\s\S]*?setResourceDashboardStatus\(""\)/,
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
  /link\.draggable = false;[\s\S]*?\["auxclick", "copy", "contextmenu", "dragstart"\][\s\S]*?link\.dataset\.logCourse = rowValue\("course"\);[\s\S]*?link\.dataset\.logCategory = resourceCategory/,
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
  "narrow layouts should retain the Student Portal title text",
);
assert.match(
  resourceStyles,
  /@media \(max-width: 520px\)[\s\S]*?\.resource-dashboard-title\s*\{\s*gap:\s*0\.5rem;\s*\}/,
  "the Student Portal home icon should have extra separation from the title on small screens",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-title > i\s*\{\s*display:\s*none;/,
  "the redundant Student Portal home icon should not render beside its title",
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
  /const keepReviewerStatus = resourceDashboardActiveTab === "REVIEWERS"[\s\S]*?if \(!silent && !keepReviewerStatus && !cachedDashboard\)[\s\S]*?if \(!cachedDashboard && !silent && !keepReviewerStatus\)/,
  "cached public dashboard refreshes should not replace the visible status with a checking notification",
);
assert.doesNotMatch(
  appCore,
  /Checking for dashboard updates/,
  "dashboard update checks should remain silent while cached content is visible",
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
  `${appCore.slice(
    appCore.indexOf("  function normalizeResourceDashboardIndex("),
    normalizerStart,
  )}${appCore.slice(normalizerStart, functionEnd)}; return normalizeResourceDashboardTabs;`,
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
  /const hasNoReviewerMaterials =[\s\S]*?status\.textContent = "No review materials are currently available\.";\s*status\.hidden = false;\s*\} else if \(\s*\["SYLLABUS", "MODULES", "REVIEWERS"\]\.includes\([\s\S]*?status\.replaceChildren\(\);\s*status\.hidden = true/,
  "successful Syllabus, Modules, and Reviewer renders should hide the entry-count status while retaining the empty-reviewer notice",
);
assert.match(
  appCore,
  /resourceDashboardSelectedSemester === "all"[\s\S]*?resource-dashboard-course-term[\s\S]*?`BSMT \$\{year\}\.\$\{semester\}`/,
  "the per-course BSMT term second line should remain available when Semester is All",
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
  /if \(!hasTermFilter\) return true;[\s\S]*?\(resourceDashboardSelectedYear === "all" \|\|\s*year === resourceDashboardSelectedYear\) &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "All Year Levels should bypass only year filtering and continue applying semester filtering",
);
assert.match(
  appCore,
  /\.filter\(\s*\(term\) =>\s*allYearLevelsSelected \|\|\s*term\.split\("\."\)\[0\] === resourceDashboardSelectedYear/,
  "semester options should reflect the selected year, or all available years when Year is All",
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
  /reviewerPdfMatch\s*\?\s*cleanResourceDisplayName\(\s*getReviewerPdfDisplayName\(fileTitle \|\| value\)/,
  "Reviewer PDF table chips should format lesson details from the full resource title",
);
assert.match(
  appCore,
  /const courseName =[\s\S]*?String\(values\[courseColumnIndex\] \|\| ""\)\.trim\(\)[\s\S]*?previewResourceFile\(fileId, fileName, \{\s*reviewer: true,\s*course: courseName/,
  "Reviewer PDF preview headers should include the course from their table row",
);
assert.match(
  appCore,
  /isModuleFolderFallback\s*=\s*resourceDashboardActiveTab === "MODULES" &&\s*\(mimeType === "application\/vnd\.google-apps\.folder" \|\|\s*\(!mimeType && !hasFilenameExtension && !titleInParentheses\)\)[\s\S]*?isFolderResource\s*=\s*isModuleFolderFallback/,
  "folder resources should use the Folder label without misclassifying named files when t is omitted",
);
assert.match(
  appCore,
  /header\.textContent = getResourceDashboardColumnHeading\(column\)[\s\S]*?const isSyllabus = columnName\.includes\("syllabus"\)[\s\S]*?const linkLabel = isSyllabus\s*\?\s*"PDF"/,
  "syllabus links should always show a PDF icon and the PDF label",
);
assert.match(
  appCore,
  /const useLegacyInSiteDashboardPreview = false;[\s\S]*?link\.href =\s*reviewerPdfMatch \|\|\s*\(isInSiteDashboardResource && useLegacyInSiteDashboardPreview\)\s*\?\s*"#resource-portal-preview"[\s\S]*?if \(\s*isInSiteDashboardResource &&\s*useLegacyInSiteDashboardPreview\s*\)\s*\{\s*link\.addEventListener\("click", \(event\) => \{\s*event\.preventDefault\(\);/,
  "Modules and Syllabus chips should follow their direct links while retaining the disabled in-site preview code",
);
assert.match(
  appCore,
  /link\.href =[\s\S]*?: linkUrl;[\s\S]*?\["auxclick", "copy", "contextmenu", "dragstart"\]/,
  "direct resource chips should retain their validated Drive hyperlink",
);
assert.match(
  appCore,
  /if \(isInSiteDashboardResource && !useLegacyInSiteDashboardPreview\) \{\s*link\.target = "_blank";\s*link\.rel = "noopener noreferrer";/,
  "Modules and Syllabus direct links should open in a new tab securely",
);
assert.match(
  indexHtml,
  /frame-src blob: https:\/\/accounts\.google\.com/,
  "the preview frame policy must not allow Google Drive pages to escape the site",
);
assert.match(
  appCore,
  /async function loadResourceDashboardFolderPreview\([\s\S]*?type: "list_public_resources"[\s\S]*?pageToken[\s\S]*?nextPageToken[\s\S]*?renderResourceDashboardFolderListing/,
  "nested folders must be browsable in-site with pagination for every folder item",
);
assert.match(
  appCore,
  /item\.type === "folder"[\s\S]*?loadResourceDashboardFolderPreview\(item\.id, frame, status\)[\s\S]*?previewResourceFile\(item\.id, item\.name, \{\s*dashboardFolderFile: true/,
  "folder descendants and their files must remain inside the Student Portal preview",
);
assert.match(
  appCore,
  /function renderResourceDashboardFolderListing\([\s\S]*?resource-dashboard-folder-view-toggle[\s\S]*?resource-dashboard-folder-load-more/,
  "the in-site folder viewer should provide view controls and support pagination without an Up button",
);
assert.match(
  backend,
  /function handleListPublicResourcesRequest\(data\)[\s\S]*?getResourceFolderBreadcrumbs\(folder\)[\s\S]*?Drive\.Files\.list[\s\S]*?nextPageToken/,
  "folder listings must validate resource-root ancestry and support pagination",
);
assert.match(
  backend,
  /function handleGetResourcePreviewRequest\(data\)[\s\S]*?getResourceFileBreadcrumbs\(file\)[\s\S]*?RESOURCE_PORTAL_MAX_PREVIEW_BYTES/,
  "file previews must enforce resource-root ancestry and size limits",
);
assert.match(
  backend,
  /if \(requestType === "list_public_resources"\)\s*return handleListPublicResourcesRequest\(data\)[\s\S]*?if \(requestType === "get_resource_preview"\)\s*return handleGetResourcePreviewRequest\(data\)/,
  "the portal must route folder and file preview requests through the protected backend handlers",
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
  /resourceDashboardSelectedCategories = \{\s*MODULES: "PRELIMS",\s*REVIEWERS: "all",\s*SYLLABUS: "all",\s*SUBJECTS: "all",\s*\}[\s\S]*?resourceDashboardCategorySelectionMade = \{\s*MODULES: false,\s*REVIEWERS: false,\s*SYLLABUS: false,\s*SUBJECTS: false,\s*\}[\s\S]*?!resourceDashboardCategorySelectionMade\[resourceDashboardActiveTab\][\s\S]*?hasCategoryFilter[\s\S]*?availableCategories\.size > 0[\s\S]*?selectedCategory =\s*\["PRELIMS", "MIDTERMS", "FINALS"\]\.find/,
  "each section should independently retain its category selection and Modules should prefer PRELIMS by default",
);
assert.match(
  appCore,
  /else if \(\s*selectedCategory !== "all" &&\s*!availableCategories\.has\(selectedCategory\)\s*\)\s*\{\s*selectedCategory =\s*\["PRELIMS", "MIDTERMS", "FINALS"\]\.find[\s\S]*?resourceDashboardSelectedCategories\[resourceDashboardActiveTab\]\s*=\s*selectedCategory/,
  "an unavailable selected category should fall back to PRELIMS before other available categories",
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
  /^\.resource-dashboard-table\s+(?:th|td)\.resource-dashboard-column-year/m,
  "the conditional SUBJECTS Year column should not add a global Year-column style",
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
assert.match(
  resourceStyles,
  /\.resource-dashboard-link-button\s*\{[^}]*justify-content:\s*center;[\s\S]*?text-align:\s*center;/,
  "text and icons inside dashboard table chips should be centered together",
);
assert.match(
  resourceStyles,
  /@media \(max-width:\s*520px\)\s*\{\s*\.resource-dashboard-filters\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  "Year and Semester filters should stay on one row on small screens when space allows",
);
assert.match(
  resourceStyles,
  /@media \(max-width:\s*359px\)\s*\{\s*\.resource-dashboard-filters\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
  "Year and Semester filters should stack only on exceptionally narrow screens",
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
  /\.resource-dashboard-table th\s*\{[^}]*font-size:\s*1rem;[\s\S]*?padding-block:\s*0\.875rem;/,
  "table headings in every dashboard section should use larger text and fill their cell space",
);
assert.match(
  appCore,
  /isPdfResource =[\s\S]*?isPdfResource \? "fa-file-pdf" : "fa-folder"/,
  "resource links should show PDF icons for syllabuses and PDF filenames",
);
assert.match(
  appCore,
  /cleanResourceDisplayName\(resourceTitle\)\.replace\(\/\\\.pdf\$\/i,\s*""\)/,
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
  /restore_reviewer_session:[\s\S]*?required: \["sessionId"\][\s\S]*?sign_out_reviewer:[\s\S]*?required: \["sessionId", "eventId"\]/,
  "the backend client contract should expose validated session restore and auditable revocation",
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
  /const requestId = createRequestId\(\);\s*const requestStartedAt = Date\.now\(\);\s*const versionedPayload = \{ \.\.\.payload, appVersion, requestId \};\s*validateBackendPayload\(versionedPayload\)/,
  "the allowlisted dashboard request should pass the common payload validator",
);

console.log("Resource dashboard request contract check passed.");
