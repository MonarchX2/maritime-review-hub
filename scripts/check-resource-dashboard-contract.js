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
  /getStoredJSON\(\s*RESOURCE_DASHBOARD_CACHE_KEY[\s\S]*?stored\?\.appVersion === appVersion[\s\S]*?stored\.tabs/,
  "the dashboard should restore valid data cached for the current website version",
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
  "the dashboard should provide year and semester filters only",
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
assert.deepEqual(legacyTabs.REVIEWERS.columns, ["Year", "Course", "PRELIMS"]);
assert.match(
  appCore,
  /\["MODULES", "REVIEWERS", "SYLLABUS"\]\.every/,
  "the dashboard cache should include all three normalized tabs",
);
assert.match(
  appCore,
  /resource-dashboard-syllabus-nav/,
  "the dashboard should expose a separate syllabus navigation tab",
);
assert.match(
  appCore,
  /year === resourceDashboardSelectedYear &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "the dashboard should filter by year and optionally by semester",
);
assert.match(
  appCore,
  /\.filter\(\(term\) => term\.split\("\."\)\[0\] === resourceDashboardSelectedYear\)/,
  "semester options should be limited to the selected year",
);
assert.match(
  appCore,
  /createResourceDashboardElement\("option", "", "All"\)[\s\S]*?allOption\.value = "all"/,
  "the semester filter should include an All option",
);
assert.match(
  appCore,
  /sortButton\.addEventListener\("click"/,
  "the dashboard should provide sortable column headings",
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
assert.match(
  resourceStyles,
  /\.resource-dashboard-sort\s*\{[^}]*justify-content:\s*center;[^}]*text-align:\s*center;/,
  "dashboard header buttons should be center-aligned",
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
  /\.resource-portal-sidebar\s*\{[^}]*padding:\s*0 clamp\(/,
  "the dashboard tab bar should not have excess vertical padding",
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
  "dashboard column headings should use the shared smaller dashboard font",
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
