const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appCore = fs.readFileSync("app-core.js", "utf8");
const backend = fs.readFileSync("backend/main.js", "utf8");
const deckNavigation = fs.readFileSync("deck-nav-core.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");

assert.match(
  index,
  /openResourceDashboardTab\('MODULES'\)[\s\S]*?Modules[\s\S]*?openResourceDashboardTab\('REVIEWERS'\)[\s\S]*?Reviewers/,
  "the dashboard should navigate between the spreadsheet's Modules and Reviewers tabs",
);
assert.match(
  index,
  /resource-dashboard-table-head[\s\S]*?resource-dashboard-table-body/,
  "the resource view should render the dashboard spreadsheet as a table",
);
assert.match(
  index,
  /<span>Dashboard<\/span>/,
  "the dashboard should use the concise Dashboard brand",
);
assert.doesNotMatch(
  index,
  /My Files|Reviewer access|resource-portal-preview|resource-portal-items|resource-portal-access-screen|resource-dashboard-search|Open spreadsheet|docs\.google\.com\/spreadsheets/,
  "the dashboard should not expose Drive controls, search, or a link back to its source",
);
assert.match(
  index,
  /resource-dashboard-filter-column[\s\S]*?resource-dashboard-filter-value/,
  "the dashboard should expose a column filter",
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
  /"resource-dashboard-link-button",\s*value \|\| "Open link"/,
  "resource links should be styled buttons labeled with their spreadsheet text",
);
assert.match(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-dashboard-table\s*\{[^}]*width:\s*max-content;[^}]*min-width:\s*100%;/,
  "dashboard table columns should size to their contents",
);
assert.doesNotMatch(
  fs.readFileSync("styles.css", "utf8"),
  /\.resource-dashboard-table\s*\{[^}]*min-width:\s*38rem/,
  "the dashboard should not force fixed-width columns on mobile",
);
assert.match(
  backend,
  /getRichTextValues\(\)[\s\S]*?getFormulas\(\)[\s\S]*?links:\s*dataRows\.map/,
  "the backend should retain rich-text and formula hyperlink targets",
);
assert.match(
  appCore,
  /tab\.links\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use the backend-provided hyperlink target",
);
assert.match(
  appCore,
  /sortButton\.addEventListener\("click"[\s\S]*?resourceDashboardSortDirection/,
  "dashboard table headings should sort their columns",
);
assert.match(
  appCore,
  /visibleRows = tab\.rows[\s\S]*?filterValues\.some/,
  "dashboard rows should be filterable by selected column",
);
assert.match(
  deckNavigation,
  /if \(viewId === "resources"\) \{\s*await globalScope\.loadResourceDashboard\?\.\(\);/,
  "opening the Resources view should load the dashboard instead of scanning Drive",
);
assert.doesNotMatch(
  fs
    .readFileSync("app-core.js", "utf8")
    .match(/async function loadResourceDashboard\(\)[\s\S]*?\n  \}\n/)?.[0] || "",
  /list_public_resources|get_resource_preview/,
  "dashboard loading should not call the previous Drive listing or preview APIs",
);

let spreadsheetOpenCount = 0;
const spreadsheetTabs = {
  MODULES: [
    ["Year", "Course", "", "PRELIMS", "MIDTERMS", "FINALS"],
    ["3.1", "SHIP'S AUDIT", "", "https://drive.google.com/file/d/module-prelims/view", "", ""],
    ["4.1", "SAFETY", "", "Prelims module", "Exam guide", ""],
    ["", "", "", "", "", ""],
  ],
  REVIEWERS: [
    ["Reviewer", "Course"],
    ["Reviewer One", "NAV6"],
  ],
};
const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
  SpreadsheetApp: {
    openById(id) {
      spreadsheetOpenCount += 1;
      assert.equal(
        id,
        "1TSOO8oD2KLo015eeCf6zb3c7eGFo27uJD5p03L-IVOs",
      );
      return {
        getSheetByName(name) {
          const values = spreadsheetTabs[name];
          if (!values) return null;
          return {
            getLastRow: () => values.length,
            getLastColumn: () => values[0].length,
            getRange(_row, _column, rowCount, columnCount) {
              const richLinks = {
                "2:3": "https://drive.google.com/file/d/linked-module/view",
              };
              const formulas = {
                "2:4": '=HYPERLINK("https://docs.google.com/document/d/exam-guide/edit","Exam guide")',
              };
              return {
                getDisplayValues: () =>
                  values
                    .slice(0, rowCount)
                    .map((row) => row.slice(0, columnCount)),
                getRichTextValues: () =>
                  values.slice(0, rowCount).map((row, rowIndex) =>
                    row.slice(0, columnCount).map((_value, columnIndex) => {
                      const linkUrl = richLinks[`${rowIndex}:${columnIndex}`];
                      return {
                        getLinkUrl: () => linkUrl || "",
                      };
                    }),
                  ),
                getFormulas: () =>
                  values.slice(0, rowCount).map((row, rowIndex) =>
                    row.slice(0, columnCount).map(
                      (_value, columnIndex) =>
                        formulas[`${rowIndex}:${columnIndex}`] || "",
                    ),
                  ),
              };
            },
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
    tabs: {
      MODULES: {
        columns: ["Year", "Course", "PRELIMS", "MIDTERMS", "FINALS"],
        rows: [
          [
            "3.1",
            "SHIP'S AUDIT",
            "https://drive.google.com/file/d/module-prelims/view",
            "",
            "",
          ],
          ["4.1", "SAFETY", "Prelims module", "Exam guide", ""],
        ],
        links: [
          ["", "", "", "", ""],
          [
            "",
            "",
            "https://drive.google.com/file/d/linked-module/view",
            "https://docs.google.com/document/d/exam-guide/edit",
            "",
          ],
        ],
        truncated: false,
      },
      REVIEWERS: {
        columns: ["Reviewer", "Course"],
        rows: [["Reviewer One", "NAV6"]],
        links: [["", ""]],
        truncated: false,
      },
    },
  },
  "the backend should return both named spreadsheet tabs without blank rows or columns",
);
assert.equal(spreadsheetOpenCount, 1);

const routedDashboard = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "get_resource_dashboard",
          appVersion: "mrh-release-26.10.15-10",
        }),
      },
    })
    .text,
);
assert.equal(
  routedDashboard.status,
  "success",
  "the public backend should expose the spreadsheet dashboard action",
);
assert.equal(spreadsheetOpenCount, 2);

const disabledListing = JSON.parse(
  context
    .doPost({
      postData: {
        contents: JSON.stringify({
          type: "list_public_resources",
          appVersion: "mrh-release-26.10.15-10",
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
          appVersion: "mrh-release-26.10.15-10",
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
  spreadsheetOpenCount,
  2,
  "disabled Drive requests should not open the dashboard spreadsheet",
);

console.log("Resource dashboard and disabled Drive portal checks passed.");
