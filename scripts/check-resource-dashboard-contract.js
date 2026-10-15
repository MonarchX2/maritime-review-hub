const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");
const resourceStyles = fs.readFileSync("styles.css", "utf8");

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
  /resourceDashboardSelectedYear = populateTermOptions\([\s\S]*?"3",\s*true,\s*\)/,
  "the year filter should include an All option",
);
assert.match(
  appCore,
  /resourceDashboardSelectedYear === "all" \|\|\s*year === resourceDashboardSelectedYear/,
  "selecting All years should show rows across every year",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-control:first-child select\s*\{\s*width:\s*3\.5rem;\s*\}[\s\S]*?\.resource-dashboard-control:nth-child\(2\) select\s*\{\s*width:\s*3\.5rem;/,
  "year and semester dropdowns should use compact widths",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-control input,\s*\.resource-dashboard-control select\s*\{[^}]*min-height:\s*2rem;[^}]*padding:\s*var\(--resource-dashboard-space-tight\) var\(--resource-dashboard-space\);/,
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
assert.doesNotMatch(
  appCore,
  /if \(!\["MODULES", "REVIEWERS", "SYLLABUS"\]\.includes\(tabName\)\)/,
  "the dashboard tab handler should reject selecting the locked Reviewers tab",
);
assert.match(
  appCore,
  /if \(!\["MODULES", "SYLLABUS"\]\.includes\(tabName\)\) return false;/,
  "the dashboard tab handler should only allow unlocked tabs",
);
assert.match(
  appCore,
  /\(resourceDashboardSelectedYear === "all" \|\|\s*year === resourceDashboardSelectedYear\) &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "the dashboard should filter by year and optionally by semester, including All years",
);
assert.match(
  appCore,
  /\.filter\([\s\S]*?resourceDashboardSelectedYear === "all" \|\|\s*term\.split\("\."\)\[0\] === resourceDashboardSelectedYear/,
  "semester options should reflect the selected year or all years",
);
assert.match(
  appCore,
  /createResourceDashboardElement\("option", "", "All"\)[\s\S]*?allOption\.value = "all"/,
  "the semester filter should include an All option",
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
  /const isSyllabus = \["syllabus", "course syllabus"\]\.includes\([\s\S]*?isPdfResource = isSyllabus \|\|[\s\S]*?const linkLabel = isSyllabus\s*\?\s*"PDF"/,
  "syllabus links should always show a PDF icon and the PDF label",
);
assert.match(
  appCore,
  /tab\.linkTitles\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use backend-resolved Drive titles",
);
assert.match(
  appCore,
  /const populatedColumnIndices = tab\.columns[\s\S]*?nonEmptyRows\.some\([\s\S]*?populatedColumnIndices\.forEach\(\(columnIndex\) => \{[\s\S]*?tableHead\.appendChild\(headerRow\)/,
  "dashboard headers should omit columns that are empty across the dataset",
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
  /\.resource-portal-sidebar\s*\{[^}]*gap:\s*var\(--resource-dashboard-space\);[^}]*padding:\s*0 var\(--resource-dashboard-space-wide\);/,
  "dashboard tabs should use the shared spacing scale",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table th,\s*\.resource-dashboard-table td\s*\{[^}]*padding:\s*var\(--resource-dashboard-space\);/,
  "dashboard table cells should have equal, consistent spacing",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{\s*--resource-dashboard-font-title:\s*1\.125rem;\s*--resource-dashboard-font:\s*0\.875rem;\s*--resource-dashboard-font-small:\s*0\.75rem;/,
  "Resource Dashboard typography should match the main dashboard title, body, and small-text scale",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item\s*\{[^}]*min-height:\s*2\.2rem;[^}]*font-size:\s*var\(--resource-dashboard-font\)/,
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
  /isPdfResource = isSyllabus \|\| \/\\\.pdf\\b\/i\.test\(fileTitle\)[\s\S]*?isPdfResource \? "fa-file-pdf" : "fa-folder"/,
  "resource links should show PDF icons for syllabuses and PDF filenames",
);
assert.match(
  appCore,
  /resourceTitle\.replace\(\/\\\.pdf\$\/i,\s*""\)/,
  "button labels should omit the PDF extension",
);
assert.match(
  network,
  /get_resource_dashboard:\s*\{\s*required:\s*\[\],\s*allowed:\s*\["type",\s*"version",\s*"appVersion"\]/,
  "the backend request validator should allow a cached dashboard version",
);
assert.match(
  network,
  /const versionedPayload = \{ \.\.\.payload, appVersion \};\s*validateBackendPayload\(versionedPayload\)/,
  "the allowlisted dashboard request should pass the common payload validator",
);

console.log("Resource dashboard request contract check passed.");
