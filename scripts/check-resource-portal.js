const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const appCore = fs.readFileSync("app-core.js", "utf8");
const backend = fs.readFileSync("backend/main.js", "utf8");
const deckNavigation = fs.readFileSync("deck-nav-core.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const releaseMetadata = JSON.parse(fs.readFileSync("version.json", "utf8"));
const appVersion = releaseMetadata.buildVersion;
const resourceStyles = fs.readFileSync("styles.css", "utf8");

assert.match(
  releaseMetadata.version,
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "version.json must define the editable semantic app version",
);
assert.match(
  appVersion,
  /^mrh-[A-Za-z0-9._-]+$/,
  "version.json must define a valid generated release build identifier",
);
assert.match(
  resourceStyles,
  /\.resource-portal-shell\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*visible;/,
  "the dashboard box should expand with its content instead of clipping it",
);
assert.doesNotMatch(
  resourceStyles.match(/\.resource-portal-shell\s*\{([^}]+)\}/)?.[1] || "",
  /\b(?:height|min-height|max-height)\s*:/,
  "the dashboard box must not have a fixed or bounded height",
);
assert.match(
  resourceStyles,
  /\.resource-portal-sidebar\s*\{[\s\S]*?flex-wrap:\s*nowrap;[\s\S]*?overflow-x:\s*auto;/,
  "dashboard navigation should stay on one line and scroll horizontally if needed",
);
assert.match(
  resourceStyles,
  /\.resource-portal-browser\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*auto;/,
  "the dashboard content area should expand naturally with dynamically added content",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*visible;/,
  "wide tables may scroll horizontally without a vertical height limit",
);

assert.match(
  index,
  /id="resource-dashboard-syllabus-nav"[\s\S]*?Syllabus[\s\S]*?id="resource-dashboard-modules-nav"[\s\S]*?Modules[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?Reviewers/,
  "the dashboard should show Syllabus before Modules and Reviewers",
);
assert.match(
  index,
  /id="resource-dashboard-reviewers-nav"[^>]*onclick="openResourceDashboardTab\('REVIEWERS'\)"[^>]*aria-label="Reviewers"[\s\S]*?Reviewers\s*<\/button>[\s\S]*?id="resource-reviewers-locked-panel"[\s\S]*?This section is locked[\s\S]*?Sign in or create an account/,
  "the Reviewers tab should show an in-place locked message with a sign-in and account-creation action",
);
assert.doesNotMatch(
  index,
  /resource-dashboard-reviewers-lock|fa-lock resource-dashboard-lock-icon/,
  "the Reviewers tab should not display a lock icon",
);
assert.match(
  index,
  /id="resource-dashboard-reviewers-nav"[\s\S]*?<i class="fa-solid fa-clipboard-list" aria-hidden="true"><\/i>/,
  "the Reviewers tab should use a lined-note icon",
);
assert.doesNotMatch(
  index.match(/id="resource-dashboard-reviewers-nav"[^>]*>/)?.[0] || "",
  /\baria-disabled\b|\bdisabled\b/,
  "the Reviewers tab must not be semantically or natively disabled while signed out",
);
assert.match(
  index,
  /resource-reviewer-auth-status[\s\S]*?resource-reviewer-signin-button[\s\S]*?resource-reviewer-signout/,
  "the resource dashboard should include account sign-in and sign-out controls",
);
assert.match(
  index,
  /class="resource-dashboard-topbar"[\s\S]*?resource-dashboard-title" aria-label="Student Portal"[\s\S]*?fa-house[\s\S]*?<span>Student Portal<\/span>[\s\S]*?id="resource-dashboard-profile-nav"[^>]*onclick="openResourceDashboardTab\('PROFILE'\)"[^>]*aria-label="Profile"[\s\S]*?<\/button>\s*<\/div>\s*<div class="resource-portal-shell">/,
  "the Profile button should sit to the right of the Student Portal title, outside the resource tabs",
);
assert.match(
  index,
  /<aside class="resource-portal-sidebar"[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?<\/aside>/,
  "the resource tabs should remain grouped in their own navigation row",
);
assert.doesNotMatch(
  index.slice(
    index.indexOf('<aside class="resource-portal-sidebar"'),
    index.indexOf("</aside>", index.indexOf('<aside class="resource-portal-sidebar"')),
  ),
  /resource-reviewer-signin-button|resource-reviewer-enrollment-form|resource-reviewer-signout/,
  "profile sign-in and settings controls should live in the Profile screen, not the tab header",
);
assert.match(
  index,
  /id="resource-dashboard-content" hidden[\s\S]*?id="resource-dashboard-profile"[^>]*class="resource-profile-screen"[^>]*aria-label="Profile settings"(?![^>]*hidden)[\s\S]*?resource-reviewer-auth-status[\s\S]*?resource-reviewer-signin-button[\s\S]*?resource-reviewer-enrollment-form[\s\S]*?resource-profile-account-details[\s\S]*?resource-profile-name[\s\S]*?resource-profile-email[\s\S]*?resource-reviewer-signout/,
  "Profile should be the initial dashboard view and show login/enrollment or account controls",
);
assert.match(
  index,
  /resource-reviewer-enrollment-form[\s\S]*?name="lastName"[\s\S]*?name="firstName"[\s\S]*?name="middleInitial"/,
  "the sign-in panel should collect the names needed for new account enrollment",
);
assert.match(
  index,
  /Middle Initial \(optional\)/,
  "profile should make the middle initial optional",
);
assert.doesNotMatch(
  index.match(/id="resource-reviewer-middle-initial"[\s\S]*?\/>/)?.[0] || "",
  /\brequired\b/,
  "the middle initial input must not be required",
);
assert.doesNotMatch(
  index,
  /Reviewer access requires administrator approval/,
  "the Profile screen should not display the reviewer access approval notice",
);
assert.match(
  index,
  /resource-profile-form-note[\s\S]*?correct capitalization[\s\S]*?Maria[\s\S]*?Dela Cruz/,
  "profile should explain correct capitalization with a concise example",
);
assert.match(
  index,
  /id="resource-reviewer-edit-profile"[\s\S]*?Edit name/,
  "approved and pending users should have a name-edit control",
);
assert.match(
  index,
  /id="resource-reviewer-cancel-edit"[\s\S]*?Cancel/,
  "the profile editor should allow users to cancel unsaved changes",
);
assert.match(
  index,
  /id="resource-dashboard-profile-picture"[^>]*hidden/,
  "the header Profile button should have a hidden image that can show the signed-in account photo",
);
assert.match(
  resourceStyles,
  /\.resource-profile-toggle > img\s*\{\s*width:\s*2\.25rem;\s*height:\s*2\.25rem;\s*\}[\s\S]*?\.resource-profile-toggle > i\s*\{\s*width:\s*2\.25rem;\s*height:\s*2\.25rem;/,
  "the header profile photo and fallback icon should share the larger size",
);
assert.doesNotMatch(
  index,
  /resource-reviewer-device-id|resource-reviewer-copy-device-id/,
  "the sign-in panel must not display or offer to copy the device identity",
);
assert.match(
  index,
  /resource-dashboard-topbar[\s\S]*?id="resource-dashboard-return"[\s\S]*?aria-label="Return to main menu"[\s\S]*?<span>Return<\/span>[\s\S]*?resource-dashboard-title" aria-label="Student Portal"[\s\S]*?fa-house[\s\S]*?<span>Student Portal<\/span>[\s\S]*?resource-portal-shell/,
  "the dashboard should place a Return button and Student Portal label above and outside its card",
);
assert.match(
  index,
  /resource-dashboard-table-scroll[\s\S]*?class="resource-dashboard-update-note">\s*File updates may take up to 3 minutes\.\s*<\/p>/,
  "the dashboard should show a concise note about file update delays",
);
assert.match(
  index,
  /resource-dashboard-table-head[\s\S]*?resource-dashboard-table-body/,
  "the resource view should render the dashboard spreadsheet as a table",
);
assert.doesNotMatch(
  index,
  /resource-portal-browser-header/,
  "the resource dashboard should not show a title bar",
);
assert.match(
  index,
  /<span class="resource-dashboard-title" aria-label="Student Portal">[\s\S]*?<span>Student Portal<\/span>\s*<\/span>/,
  "the dashboard title should retain its accessible text and a home icon",
);
assert.doesNotMatch(
  index,
  /My Files|resource-portal-preview|resource-portal-items|resource-portal-access-screen|resource-dashboard-search|Open spreadsheet|docs\.google\.com\/spreadsheets/,
  "the dashboard should not expose Drive controls, search, or a link back to its source",
);
assert.match(
  index,
  /<span>Year<\/span>[\s\S]*?resource-dashboard-filter-year[\s\S]*?<span>Semester<\/span>[\s\S]*?resource-dashboard-filter-semester[\s\S]*?<span>Category<\/span>[\s\S]*?resource-dashboard-filter-category/,
  "the dashboard should expose year, semester, and resource-category filters",
);
assert.match(
  index,
  /resource-dashboard-filter-semester[\s\S]*?resource-dashboard-category-filter/,
  "the filter controls should render without a manual refresh button",
);
assert.doesNotMatch(
  index,
  /resource-dashboard-refresh/,
  "the dashboard should not show a manual refresh button",
);
assert.match(
  index,
  /id="resource-dashboard-filter-year"[^>]*role="group"[\s\S]*?id="resource-dashboard-filter-semester"[^>]*role="group"[\s\S]*?id="resource-dashboard-category-filter"/,
  "Year and Semester should use segmented button groups",
);
assert.match(
  appCore,
  /initializeResourceDashboardAutoRefresh\(\)[\s\S]*?setInterval\([\s\S]*?RESOURCE_DASHBOARD_AUTO_REFRESH_INTERVAL_MS[\s\S]*?visibilitychange[\s\S]*?pageshow/,
  "the dashboard should periodically revalidate its backend version and refresh on tab return",
);
assert.match(
  index,
  /id="resource-dashboard-filter-category"[^>]*role="group"[\s\S]*?data-category="all"[\s\S]*?data-category="PRELIMS"[\s\S]*?data-category="MIDTERMS"[\s\S]*?data-category="FINALS"/,
  "the category segmented control should provide All, PRELIMS, MIDTERMS, and FINALS",
);
assert.match(
  appCore,
  /resourceDashboardSelectedCategory = "all"/,
  "the category filter should default to All",
);
assert.match(
  appCore,
  /const showCategoryFilter =\s*hasCategoryFilter \|\| resourceDashboardActiveTab === "SYLLABUS"[\s\S]*?button\.disabled = !hasCategoryFilter \|\| !categoryAvailable/,
  "unavailable category choices should remain visible and disabled",
);
assert.match(
  appCore,
  /const selectedPhaseColumnIndex =[\s\S]*?phaseColumnIndexes\[resourceDashboardSelectedCategory\]/,
  "a selected phase should restrict visible columns and rows to resources in that category",
);
assert.match(
  appCore,
  /if \(selectedPhaseColumnIndex === undefined\) return false;[\s\S]*?if \(!phaseValue && !isResourceDashboardLink\(phaseLink\)\) return false/,
  "a selected phase should show only its column and rows containing that phase resource",
);
assert.match(
  appCore,
  /visibleColumnIndices =\s*hasCategoryFilter && resourceDashboardSelectedCategory !== "all"[\s\S]*?columnIndex === selectedPhaseColumnIndex/,
  "a selected phase should hide the other phase columns",
);
assert.doesNotMatch(
  index,
  /resource-dashboard-filter-column|resource-dashboard-filter-value|Filter column|Filter value/,
  "the dashboard should not expose generic column or text filters",
);
assert.match(
  index,
  /min-height: 64px/,
  "the website header should have increased height",
);
assert.match(
  appCore,
  /async function loadResourceDashboard\(\{ silent = false \} = \{\}\)[\s\S]*?type: "get_resource_dashboard"/,
  "the dashboard should load its sheet data from the backend",
);
assert.match(
  appCore,
  /function isResourceDashboardLink\(value\)[\s\S]*?drive\.google\.com", "docs\.google\.com"/,
  "dashboard resource links should be limited to supported Google resource URLs",
);
assert.doesNotMatch(
  appCore,
  /link\.target\s*=\s*"_blank"/,
  "dashboard resource links must open in the current tab",
);
assert.match(
  appCore,
  /link\.href = linkUrl/,
  "spreadsheet resource values should render as working links",
);
assert.match(
  appCore,
  /titleInParentheses\s*\?\s*titleInParentheses\[1\]\s*:\s*fileTitle/,
  "resource link buttons should keep only the filename in parentheses",
);
assert.match(
  appCore,
  /resourceTitle\.replace\(\/\\\.pdf\$\/i,\s*""\)/,
  "PDF buttons should omit the extension from their visible title",
);
assert.match(
  appCore,
  /isPdfResource =[\s\S]*?isPdfResource \? "fa-file-pdf" : "fa-folder"/,
  "resource links should show PDF icons for syllabuses and PDF filenames",
);
assert.match(
  appCore,
  /if \(!status \|\| !tableHead \|\| !tableBody\) return false;[\s\S]*?if \(!tab\) return false;/,
  "dashboard rendering should not require a visible title bar",
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-dashboard-table-frame\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*overflow:\s*clip;[\s\S]*?\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*margin-inline:\s*auto;[\s\S]*?\.resource-dashboard-table thead tr::before,\s*\.resource-dashboard-table tbody tr::before\s*\{[^}]*inset:\s*0 -100vw;[^}]*border-bottom:\s*1px solid/,
  "decorative row overflow should be clipped separately without stretching table columns",
);
assert.match(
  appCore,
  /const hasCellValue = \(values, rowIndex, columnIndex\) =>[\s\S]*?displayValue !== "" \|\| isResourceDashboardLink\(linkUrl\)[\s\S]*?const nonEmptyRows = tab\.rows[\s\S]*?resourceColumnIndices\.some\(\(columnIndex\) =>\s*hasCellValue\(values, rowIndex, columnIndex\)[\s\S]*?const populatedColumnIndices = tab\.columns[\s\S]*?visibleRows\.some\(\(\{ values, rowIndex \}\) =>\s*hasCellValue\(values, rowIndex, columnIndex\)/,
  "dashboard rendering should omit rows and columns with no displayed values or resource links",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-topbar\s*\{[^}]*justify-content:\s*flex-start;/,
  "the Return button and Dashboard title should align to the dashboard's left",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-return span\s*\{\s*display:\s*none;/,
  "small screens should show the return arrow without its text label",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*min\(100%,\s*40rem\);[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;[^}]*margin-inline:\s*auto;/,
  "the dashboard layout should use a compact stable maximum width and remain responsive",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item\.is-active\s*\{[^}]*background:\s*transparent;/,
  "active dashboard tabs should not have a filled blue background",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-segmented-control\s*\{[^}]*overflow:\s*hidden;[\s\S]*?\.resource-dashboard-segmented-control button\s*\{[^}]*overflow-x:\s*auto;[^}]*white-space:\s*nowrap;/,
  "filter options should use matching segmented controls without spilling long labels",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*visible;/,
  "the dashboard table should grow with its rows and remain horizontally scrollable",
);
assert.doesNotMatch(
  resourceStyles.match(/\.resource-dashboard-table-scroll\s*\{([^}]+)\}/)?.[1] || "",
  /\b(?:height|min-height|max-height)\s*:/,
  "the dashboard table must not impose a fixed or bounded height",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*min\(100%,\s*40rem\);[^}]*max-width:\s*100%;[^}]*margin-inline:\s*auto;/,
  "the dashboard toolbar and card should maintain a compact consistent width within the available page width",
);
assert.match(
  resourceStyles,
  /\.resource-portal-shell\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;/,
  "the dashboard box should fill the stable-width layout without exceeding its parent",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*width:\s*100%;[^}]*max-width:\s*100%;[^}]*box-sizing:\s*border-box;[\s\S]*?\.resource-dashboard-table-frame\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;[^}]*overflow:\s*clip;[\s\S]*?\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*margin-inline:\s*auto;[\s\S]*?\.resource-dashboard-table thead tr::before,\s*\.resource-dashboard-table tbody tr::before\s*\{[^}]*inset:\s*0 -100vw;[^}]*border-bottom:\s*1px solid/,
  "the table frame should clip decorative overflow while actual columns control scrolling",
);
assert.match(
  appCore,
  /function getResourceDashboardColumnHeading\(column\)[\s\S]*?return String\(column\)\.trim\(\)\.toLowerCase\(\) === "course syllabus"\s*\?\s*"SYLLABUS"/,
  "the dashboard should display the syllabus link column as SYLLABUS",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*gap:\s*var\(--resource-dashboard-space\);[\s\S]*?\.resource-dashboard-control\s*\{[^}]*gap:\s*var\(--resource-dashboard-space-tight\);/,
  "filter spacing should use consistent dashboard spacing tokens",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table td\s*\{[^}]*text-align:\s*center;/,
  "dashboard table contents should remain centered",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table thead tr::after\s*\{[^}]*z-index:\s*2;[^}]*right:\s*-100vw;[^}]*bottom:\s*0;[^}]*left:\s*-100vw;[^}]*border-bottom:\s*1px solid/,
  "the table header divider should retain its full-frame decoration",
);
assert.doesNotMatch(
  resourceStyles,
  /\.resource-dashboard-table\s*\{[^}]*min-width:\s*38rem/,
  "the dashboard should not force fixed-width columns on mobile",
);
const dashboardHandler =
  backend.match(
    /function handleGetResourceDashboardRequest\(cachedVersion(?:,\s*accessData)?\)\s*\{[\s\S]*?\n\}/,
  )?.[0] || "";
assert.match(
  backend,
  /RESOURCE_DASHBOARD_INDEX_FILES\s*=\s*\{\s*MODULES:\s*"modules_combined\.json",\s*REVIEWERS:\s*"reviewers_combined\.json",\s*SYLLABUS:\s*"reviewers_combined\.json"/,
  "the backend should use the pasted Drive indexer's combined JSON exports",
);
assert.match(
  backend,
  /MRH_RESOURCE_DASHBOARD_VERSION_CACHE_TTL_SECONDS\s*=\s*CACHE_TTL_SECONDS[\s\S]*?MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS\s*=\s*CACHE_TTL_SECONDS/,
  "version-keyed dashboard payloads should remain cached for six hours",
);
assert.match(
  backend,
  /DriveApp\.getFolderById\(RESOURCE_DASHBOARD_INDEX_FOLDER_ID\)[\s\S]*?getFilesByName\(fileName\)/,
  "the backend should read dashboard indexes from their Drive export folder",
);
assert.match(
  dashboardHandler,
  /mrh_resource_dashboard_latest_v1[\s\S]*?return jsonResponse\(parsedLatestDashboard\)/,
  "the backend should serve a fresh dashboard snapshot without Drive metadata lookups",
);
assert.match(
  backend,
  /function handleGetReviewerDashboardRequest\(data\)[\s\S]*?mrh_reviewer_dashboard_latest_v1[\s\S]*?return jsonResponse\(\{[\s\S]*?tab: parsedLatestReviewerTab/,
  "the reviewer endpoint should authorize each request before serving a cached payload",
);
assert.match(
  dashboardHandler,
  /dashboardCache\.put\(\s*dashboardCacheKey,\s*dashboardJson,\s*MRH_RESOURCE_DASHBOARD_VERSION_CACHE_TTL_SECONDS,\s*\)[\s\S]*?dashboardCache\.put\(\s*"mrh_resource_dashboard_latest_v1",\s*dashboardJson,\s*MRH_RESOURCE_DASHBOARD_CACHE_TTL_SECONDS,/,
  "resource payload retention should not extend the short freshness window for the latest snapshot",
);
assert.match(
  backend,
  /reviewerCache\.put\(\s*reviewerCacheKey,\s*reviewerJson,\s*MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS,\s*\)[\s\S]*?reviewerCache\.put\(\s*"mrh_reviewer_dashboard_latest_v1",\s*reviewerJson,\s*MRH_REVIEWER_DASHBOARD_CACHE_TTL_SECONDS,/,
  "reviewer payload retention should not extend the short freshness window for the latest snapshot",
);
assert.match(
  backend,
  /links\.push\(rowLinks\)[\s\S]*?linkTitles\.push\(rowTitles\)/,
  "the dashboard adapter should preserve indexed resource links and filenames",
);
assert.match(
  backend,
  /Array\.isArray\(item\)[\s\S]*?item\[1\][\s\S]*?getResourceDashboardExportMimeType/,
  "the dashboard adapter should support legacy tuple exports as well as compact objects",
);
assert.doesNotMatch(
  dashboardHandler,
  /SpreadsheetApp|RESOURCE_DASHBOARD_SPREADSHEET_ID/,
  "the dashboard request must not depend on Google Sheets",
);
assert.match(
  dashboardHandler,
  /versionParts\.push\("reviewers-locked-v1"\)[\s\S]*?\["MODULES", "SYLLABUS"\]\.forEach[\s\S]*?tabs\.REVIEWERS = \{\s*columns: \[\],\s*rows: \[\],/,
  "the public backend should invalidate old caches and return no reviewer content while locked",
);
assert.match(
  appCore,
  /tab\.links\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use the backend-provided hyperlink target",
);
assert.doesNotMatch(
  appCore,
  /sortButton\.addEventListener\("click"[\s\S]*?resourceDashboardSortDirection/,
  "dashboard table headings should not sort their columns",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear = "3"[\s\S]*?resourceDashboardSelectedSemester = "2"/,
  "dashboard filters should default to year 3, semester 2",
);
assert.match(
  appCore,
  /if \(!hasTermFilter \|\| resourceDashboardSelectedYear === "all"\)\s*return true;[\s\S]*?year === resourceDashboardSelectedYear &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "All Year Levels should show every row; specific years should filter by semester",
);
assert.match(
  appCore,
  /\.filter\(\s*\(term\) => term\.split\("\."\)\[0\] === resourceDashboardSelectedYear/,
  "semester options should reflect the selected year",
);
assert.match(
  appCore,
  /options\.unshift\(\{\s*value:\s*"all",\s*label:\s*"All"\s*\}\)[\s\S]*?button\.dataset\.filterValue = value[\s\S]*?control\.replaceChildren\(\.\.\.buttons\)/,
  "year and semester segments should retain All as a selectable option",
);
assert.match(
  index,
  /id="resource-dashboard-filter-year"[^>]*role="group"[\s\S]*?id="resource-dashboard-filter-semester"[^>]*role="group"/,
  "Year and Semester should be segmented controls",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-filters\s*\{[^}]*display:\s*grid;[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/,
  "Year and Semester should sit side by side above a full-width category segmented control",
);
assert.match(
  resourceStyles,
  /#resource-dashboard-category-filter\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*width:\s*100%;/,
  "the category control should span the full filter row",
);
assert.doesNotMatch(
  index,
  /id="resource-dashboard-help"|aria-describedby="resource-dashboard-help"/,
  "the resource tabs should not show the removed explanatory note",
);
assert.match(
  appCore,
  /if \(!hasTermFilter \|\| resourceDashboardSelectedYear === "all"\)\s*return true;/,
  "tabs without year data should remain visible without term filtering",
);
assert.match(
  deckNavigation,
  /if \(viewId === "resources"\) \{[\s\S]*?Promise\.resolve\(globalScope\.loadResourceDashboard\?\.\(\)\)\.catch/,
  "opening Resources should load the dashboard without blocking navigation",
);
assert.doesNotMatch(
  fs
    .readFileSync("app-core.js", "utf8")
    .match(/async function loadResourceDashboard\(\)[\s\S]*?\n  \}\n/)?.[0] || "",
  /list_public_resources|get_resource_preview/,
  "dashboard loading should not call the previous Drive listing or preview APIs",
);

let indexReadCount = 0;
let dashboardDriveLookupCount = 0;
let dashboardCacheClock = 0;
const dashboardIndexModifiedTimes = {
  "modules_combined.json": 1000,
  "reviewers_combined.json": 2000,
};
const dashboardCacheValues = new Map();
const dashboardIndexes = {
  "modules_combined.json": {
    b: "https://drive.google.com/open?id=",
    d: {
      "3.1": {
        PRELIMS: {
          "SHIP'S AUDIT": [
            "01 SHIP'S AUDIT (Prelims module)",
            "modulePrelims_123456",
            123,
          ],
        },
      },
      "4.1": {
        PRELIMS: {
          SAFETY: {
            i: "linkedModule_123456",
            n: "01 SAFETY (Prelims).pdf",
            u: "linkedModule_123456",
            t: 1,
          },
        },
        MIDTERMS: {
          SAFETY: {
            i: "midtermModule_123456",
            n: "02 SAFETY (Exam guide)",
            u: "midtermModule_123456",
            t: 1,
          },
        },
      },
      "4.2": {
        FINALS: {
          "SEARCH AND RESCUE": {
            i: "finalModule_123456",
            n: "03 SEARCH AND RESCUE",
            u: "finalModule_123456",
            t: 1,
          },
        },
      },
    },
  },
  "reviewers_combined.json": {
    b: "https://drive.google.com/open?id=",
    d: {
      "3.1": {
        PRELIMS: {
          NAV6: [
            "01 NAV6 REVIEWER (Reviewer One).pdf",
            "reviewerPdf_123456",
            123,
            4,
          ],
        },
      },
      "4.2": {
        SYLLABUS: {
          "SHIP'S AUDIT": {
            i: "reviewerSyllabus_123456",
            n: "SHIP'S AUDIT COURSE SYLLABUS",
            u: "reviewerSyllabus_123456",
            t: "gdoc",
          },
        },
      },
    },
  },
};
const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: () => "",
      setProperty() {},
    }),
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, value) {
      return Array.from(
        crypto.createHash("sha256").update(String(value), "utf8").digest(),
        (byte) => (byte > 127 ? byte - 256 : byte),
      );
    },
  },
  CacheService: {
    getScriptCache: () => ({
      get(key) {
        const entry = dashboardCacheValues.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= dashboardCacheClock) {
          dashboardCacheValues.delete(key);
          return null;
        }
        return entry.value;
      },
      put(key, value, ttlSeconds) {
        dashboardCacheValues.set(key, {
          value,
          expiresAt: dashboardCacheClock + (ttlSeconds || 60) * 1000,
        });
      },
      remove: (key) => dashboardCacheValues.delete(key),
    }),
  },
  DriveApp: {
    getFolderById(id) {
      dashboardDriveLookupCount += 1;
      assert.equal(id, "1cP2FBOW-Jryu9eknJgDjUZcxx9qwC22Z");
      return {
        getFilesByName(name) {
          const content = dashboardIndexes[name];
          const files = content
            ? [
                {
                  getId: () => `id-${name}`,
                  getLastUpdated: () =>
                    new Date(dashboardIndexModifiedTimes[name]),
                  getBlob: () => {
                    indexReadCount += 1;
                    return {
                      getDataAsString: () => JSON.stringify(content),
                    };
                  },
                },
              ]
            : [];
          let index = 0;
          return {
            hasNext: () => index < files.length,
            next: () => files[index++],
          };
        },
      };
    },
  },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput(text) {
      return {
        text,
        setMimeType() {
          return this;
        },
      };
    },
  },
};
vm.createContext(context);
vm.runInContext(backend, context, { filename: "backend/main.js" });

const dashboard = JSON.parse(
  context
    .handleGetResourceDashboardRequest()
    .text,
);
assert.deepEqual(
  JSON.parse(JSON.stringify(dashboard)),
  {
    status: "success",
    version:
      "modules_combined.json:id-modules_combined.json:1000|reviewers_combined.json:id-reviewers_combined.json:2000|reviewers-locked-v1",
    tabs: {
      MODULES: {
        columns: ["Year", "Course", "PRELIMS", "MIDTERMS", "FINALS"],
        rows: [
          [
            "3.1",
            "SHIP'S AUDIT",
            "01 SHIP'S AUDIT (Prelims module)",
            "",
            "",
          ],
          [
            "4.1",
            "SAFETY",
            "01 SAFETY (Prelims).pdf",
            "02 SAFETY (Exam guide)",
            "",
          ],
          [
            "4.2",
            "SEARCH AND RESCUE",
            "",
            "",
            "03 SEARCH AND RESCUE",
          ],
        ],
        links: [
          ["", "", "https://drive.google.com/open?id=modulePrelims_123456", "", ""],
          ["", "", "https://drive.google.com/open?id=linkedModule_123456", "https://drive.google.com/open?id=midtermModule_123456", ""],
          ["", "", "", "", "https://drive.google.com/open?id=finalModule_123456"],
        ],
        linkTitles: [
          ["", "", "01 SHIP'S AUDIT (Prelims module)", "", ""],
          ["", "", "01 SAFETY (Prelims).pdf", "02 SAFETY (Exam guide)", ""],
          ["", "", "", "", "03 SEARCH AND RESCUE"],
        ],
        linkTypes: [
          [
            "",
            "",
            "application/vnd.google-apps.folder",
            "",
            "",
          ],
          ["", "", "application/vnd.google-apps.folder", "application/vnd.google-apps.folder", ""],
          ["", "", "", "", "application/vnd.google-apps.folder"],
        ],
        truncated: false,
      },
      REVIEWERS: {
        columns: [],
        rows: [],
        links: [],
        linkTitles: [],
        linkTypes: [],
        truncated: false,
      },
      SYLLABUS: {
        columns: ["Year", "Course", "COURSE SYLLABUS"],
        rows: [["4.2", "SHIP'S AUDIT", "SHIP'S AUDIT COURSE SYLLABUS"]],
        links: [
          ["", "", "https://drive.google.com/open?id=reviewerSyllabus_123456"],
        ],
        linkTitles: [
          ["", "", "SHIP'S AUDIT COURSE SYLLABUS"],
        ],
        linkTypes: [
          ["", "", "application/vnd.google-apps.document"],
        ],
        truncated: false,
      },
    },
  },
  "the backend should return Modules and Syllabus while withholding Reviewers dashboard content",
);
assert.equal(indexReadCount, 2);
const dashboardVersionCacheKey = Array.from(dashboardCacheValues.keys()).find(
  (key) => key.startsWith("mrh_resource_dashboard_v1_"),
);
assert.ok(dashboardVersionCacheKey);
assert.equal(
  dashboardCacheValues.get(dashboardVersionCacheKey).expiresAt -
    dashboardCacheClock,
  Number(backend.match(/const CACHE_TTL_SECONDS = (\d+)/)?.[1]) * 1000,
  "the version-keyed public dashboard payload should stay cached for six hours",
);
assert.equal(
  dashboardCacheValues.get("mrh_resource_dashboard_latest_v1").expiresAt -
    dashboardCacheClock,
  context.MRH_RESOURCE_DASHBOARD_CACHE_TTL_SECONDS * 1000,
  "the latest dashboard pointer should keep its short freshness lifetime",
);

const routedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          eventId: "12345678-1234-4123-8123-123456789abc",
          appVersion,
        }),
      },
    })
    .text,
);
assert.equal(
  routedDashboard.status,
  "success",
  "the public backend should expose the Drive-index dashboard action",
);
assert.equal(
  indexReadCount,
  2,
  "the latest dashboard snapshot should avoid rereading index contents",
);
assert.equal(
  dashboardDriveLookupCount,
  1,
  "a cached dashboard snapshot should avoid another Drive metadata lookup",
);

const unchangedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          eventId: "22345678-1234-4123-8123-123456789abc",
          version: routedDashboard.version,
          appVersion,
        }),
      },
    })
    .text,
);
assert.equal(unchangedDashboard.notModified, true);
assert.equal(
  indexReadCount,
  2,
  "unchanged dashboard indexes should not be parsed or returned again",
);
assert.equal(
  dashboardDriveLookupCount,
  1,
  "unchanged dashboard versions should be served without a Drive lookup",
);

dashboardCacheClock += 61000;
const cachedAfterLatestExpiry = JSON.parse(
  context.handleGetResourceDashboardRequest().text,
);
assert.equal(cachedAfterLatestExpiry.version, routedDashboard.version);
assert.equal(
  indexReadCount,
  2,
  "an expired latest pointer should reuse the still-valid versioned payload without rereading Drive indexes",
);
assert.equal(
  dashboardDriveLookupCount,
  2,
  "an expired latest pointer should only require checking Drive metadata for changes",
);

dashboardIndexModifiedTimes["reviewers_combined.json"] += 1;
dashboardCacheClock += 61000;
const updatedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          eventId: "32345678-1234-4123-8123-123456789abc",
          version: routedDashboard.version,
          appVersion,
        }),
      },
    })
    .text,
);
assert.equal(updatedDashboard.status, "success");
assert.ok(updatedDashboard.version !== routedDashboard.version);
assert.equal(
  indexReadCount,
  4,
  "updated dashboard indexes should cause the complete dashboard to refresh",
);
assert.equal(
  dashboardDriveLookupCount,
  3,
  "expired snapshots should recheck Drive metadata for updates",
);

const disabledListing = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "list_public_resources",
          appVersion,
        }),
      },
    })
    .text,
);
assert.equal(
  disabledListing.code,
  "FEATURE_DISABLED",
  "the former Drive listing API should be explicitly disabled",
);
const disabledPreview = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_preview",
          appVersion,
        }),
      },
    })
    .text,
);
assert.equal(
  disabledPreview.code,
  "FEATURE_DISABLED",
  "the former Drive preview API should be explicitly disabled",
);
assert.equal(
  indexReadCount,
  4,
  "disabled Drive requests should not read dashboard index files",
);

const snapshotProperties = {
  MRH_SUBJECT_SCHEMA_VERSION: "10",
  LAST_CACHE_BUILD_SUCCESS: "2026-10-15T00:00:00.000Z",
  BUILD_STATUS: "IDLE",
  MRH_CACHE_VERSION_TIMESTAMP: "2026-10-15T00:00:00.000Z",
};
context.getScriptProps = () => ({
  getProperty: (key) => snapshotProperties[key] || null,
  setProperty(key, value) {
    snapshotProperties[key] = value;
  },
});
context.getCacheInvalidationVersion = () => "cache-v1";
context.generateCacheKey = (key) => key;
context.cacheGetChunked = () => JSON.stringify([{ Subject: "COLREGS" }]);
context.filterSummaryDataByAccess = (summary) => summary;
const unchangedSync = JSON.parse(
  context
    .handleDeckSyncSnapshot_("2026-10-15T00:00:00.000Z")
    .text,
);
assert.equal(unchangedSync.notModified, true);

const changedSync = JSON.parse(context.handleDeckSyncSnapshot_("").text);
assert.deepEqual(
  JSON.parse(JSON.stringify(changedSync.summary)),
  [{ Subject: "COLREGS" }],
);
assert.equal(changedSync.payloadSchemaVersion, 2);

let cacheVersionReads = 0;
context.getCacheInvalidationVersion = () =>
  cacheVersionReads++ === 0 ? "cache-v1" : "cache-v2";
const racedSync = JSON.parse(context.handleDeckSyncSnapshot_("").text);
assert.equal(racedSync.code, "SYNC_RACE");

snapshotProperties.LAST_CACHE_BUILD_SUCCESS = "";
let rebuildTriggerCount = 0;
context.ensureResumeBuildTrigger = () => {
  rebuildTriggerCount += 1;
};
const coldStartSync = JSON.parse(
  context.handleDeckSyncSnapshot_("2026-10-15T00:00:00.000Z").text,
);
assert.equal(coldStartSync.isColdStart, true);
assert.equal(rebuildTriggerCount, 1);

console.log("Resource dashboard and disabled Drive portal checks passed.");
