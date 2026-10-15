const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const appCore = fs.readFileSync("app-core.js", "utf8");
const backend = fs.readFileSync("backend/main.js", "utf8");
const deckNavigation = fs.readFileSync("deck-nav-core.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

assert.match(
  index,
  /id="resource-dashboard-syllabus-nav"[\s\S]*?Syllabus[\s\S]*?id="resource-dashboard-modules-nav"[\s\S]*?Modules[\s\S]*?id="resource-dashboard-reviewers-nav"[\s\S]*?Reviewers/,
  "the dashboard should show Syllabus before Modules and Reviewers",
);
assert.match(
  index,
  /id="resource-dashboard-reviewers-nav"[^>]*aria-label="Reviewers — sign in with an approved Google account"[^>]*title="Sign in with an approved Google account"[^>]*disabled[^>]*aria-disabled="true"[\s\S]*?fa-lock/,
  "the Reviewers tab should remain locked until an approved account signs in",
);
assert.match(
  index,
  /resource-reviewer-auth-status[\s\S]*?resource-reviewer-signin-button[\s\S]*?resource-reviewer-signout/,
  "the resource dashboard should include account sign-in and sign-out controls",
);
assert.match(
  index,
  /resource-reviewer-enrollment-form[\s\S]*?name="lastName"[\s\S]*?name="firstName"[\s\S]*?name="middleInitial"/,
  "the sign-in panel should collect the names needed for new account enrollment",
);
assert.doesNotMatch(
  index,
  /resource-reviewer-device-id|resource-reviewer-copy-device-id/,
  "the sign-in panel must not display or offer to copy the device identity",
);
assert.match(
  index,
  /resource-dashboard-topbar[\s\S]*?id="resource-dashboard-return"[\s\S]*?aria-label="Return to main menu"[\s\S]*?<span>Return<\/span>[\s\S]*?resource-dashboard-title">Resource Dashboard[\s\S]*?resource-portal-shell/,
  "the dashboard should place a Return button and Resource Dashboard label above and outside its card",
);
assert.match(
  index,
  /resource-dashboard-table-scroll[\s\S]*?class="resource-dashboard-update-note">[\s\S]*?File updates may be delayed by up to 3 minutes/,
  "the dashboard should show a centered bottom note inside the card explaining file update delays",
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
  /<span class="resource-dashboard-title">Resource Dashboard<\/span>/,
  "the dashboard label should sit to the right of the Return button",
);
assert.doesNotMatch(
  index,
  /My Files|Reviewer access|resource-portal-preview|resource-portal-items|resource-portal-access-screen|resource-dashboard-search|Open spreadsheet|docs\.google\.com\/spreadsheets/,
  "the dashboard should not expose Drive controls, search, or a link back to its source",
);
assert.match(
  index,
  /<span>Year<\/span>[\s\S]*?resource-dashboard-filter-year[\s\S]*?<span>Semester<\/span>[\s\S]*?resource-dashboard-filter-semester/,
  "the dashboard should expose only year and semester filters",
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
  /async function loadResourceDashboard\(\)[\s\S]*?type: "get_resource_dashboard"/,
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
  /isPdfResource = isSyllabus \|\| \/\\\.pdf\\b\/i\.test\(fileTitle\)[\s\S]*?isPdfResource \? "fa-file-pdf" : "fa-folder"/,
  "resource links should show PDF icons for syllabuses and PDF filenames",
);
assert.match(
  appCore,
  /if \(!tab \|\| !status \|\| !tableHead \|\| !tableBody\) return false;/,
  "dashboard rendering should not require a visible title bar",
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*\}/,
  "dashboard table columns should size to their contents without stretching",
);
const resourceStyles = fs.readFileSync("styles.css", "utf8");
assert.match(
  appCore,
  /const nonEmptyRows = tab\.rows[\s\S]*?tab\.columns\.some\(\(_, columnIndex\) => \{[\s\S]*?displayValue !== "" \|\| isResourceDashboardLink\(linkUrl\)[\s\S]*?const populatedColumnIndices = tab\.columns[\s\S]*?nonEmptyRows\.some\(/,
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
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*fit-content;[^}]*margin-inline:\s*auto;/,
  "the top controls and dashboard card should share a centered layout",
);
assert.match(
  resourceStyles,
  /\.resource-portal-nav-item\.is-active\s*\{[^}]*background:\s*transparent;/,
  "active dashboard tabs should not have a filled blue background",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-control:first-child select\s*\{[^}]*width:\s*3\.5rem;/,
  "the year filter dropdown should have a compact width",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-control:nth-child\(2\) select\s*\{[^}]*width:\s*3\.5rem;/,
  "the semester filter dropdown should have a compact width",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*max-height:\s*min\(68vh,\s*48rem\);/,
  "the dashboard table should scroll within the available viewport",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-layout\s*\{[^}]*width:\s*fit-content;[^}]*margin-inline:\s*auto;/,
  "the dashboard toolbar and card should fit their contents and center on the page",
);
assert.match(
  resourceStyles,
  /\.resource-dashboard-table-scroll\s*\{[^}]*width:\s*fit-content;[^}]*margin-inline:\s*auto;/,
  "the dashboard table wrapper should fit and center around its contents",
);
assert.doesNotMatch(
  resourceStyles.match(/\.resource-dashboard-table\s*\{[^}]*\}/)?.[0] || "",
  /min-width:\s*100%/,
  "the dashboard table should not stretch to fill the available width",
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
  /DriveApp\.getFolderById\(RESOURCE_DASHBOARD_INDEX_FOLDER_ID\)[\s\S]*?getFilesByName\(fileName\)/,
  "the backend should read dashboard indexes from their Drive export folder",
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
  /resourceDashboardSelectedYear = "3"[\s\S]*?resourceDashboardSelectedSemester = "1"/,
  "dashboard filters should default to year 3, semester 1",
);
assert.match(
  appCore,
  /if \(resourceDashboardSelectedYear === "all"\) return true;[\s\S]*?year === resourceDashboardSelectedYear &&\s*\(resourceDashboardSelectedSemester === "all" \|\|\s*semester === resourceDashboardSelectedSemester\)/,
  "All Year Levels should show every row; specific years should filter by semester",
);
assert.match(
  appCore,
  /\.filter\(\s*\(term\) => term\.split\("\."\)\[0\] === resourceDashboardSelectedYear/,
  "semester options should reflect the selected year",
);
assert.match(
  appCore,
  /control\.id === "resource-dashboard-filter-year"\s*\?\s*"All Year Levels"\s*:\s*"All"[\s\S]*?allOption\.value = "all"/,
  "the year and semester filters should label their All options correctly",
);
assert.match(
  appCore,
  /if \(!hasTermFilter\) return true;/,
  "tabs without year data should remain visible without term filtering",
);
assert.match(
  deckNavigation,
  /if \(viewId === "resources"\) \{\s*Promise\.resolve\(globalScope\.loadResourceDashboard\?\.\(\)\)\.catch/,
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
      get: (key) => dashboardCacheValues.get(key) || null,
      put: (key, value) => dashboardCacheValues.set(key, value),
      remove: (key) => dashboardCacheValues.delete(key),
    }),
  },
  DriveApp: {
    getFolderById(id) {
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

const routedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          appVersion: "mrh-release-26.10.15-15",
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
  "a shared server cache should avoid rereading unchanged dashboard index contents",
);

const unchangedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          version: routedDashboard.version,
          appVersion: "mrh-release-26.10.15-15",
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

dashboardIndexModifiedTimes["reviewers_combined.json"] += 1;
const updatedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          version: routedDashboard.version,
          appVersion: "mrh-release-26.10.15-15",
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

const disabledListing = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "list_public_resources",
          appVersion: "mrh-release-26.10.15-15",
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
          appVersion: "mrh-release-26.10.15-15",
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
