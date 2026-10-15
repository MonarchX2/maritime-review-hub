const assert = require("node:assert/strict");
const fs = require("node:fs");

const appCore = fs.readFileSync("app-core.js", "utf8");
const network = fs.readFileSync("app-core-network.js", "utf8");

assert.match(
  appCore,
  /AppNetwork\.callBackend\(\s*\{\s*type:\s*"get_resource_dashboard"/,
  "the dashboard should send its request through the shared backend client",
);
assert.match(
  appCore,
  /resource-dashboard-filter-column[\s\S]*?resource-dashboard-filter-value/,
  "the dashboard should provide a column and value filter",
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
  /tab\.linkTitles\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use backend-resolved Drive titles",
);
assert.match(
  appCore,
  /isReviewerResource \? "fa-file-pdf" : "fa-folder"/,
  "reviewer links should show PDF icons while module links show folders",
);
assert.match(
  appCore,
  /resourceTitle\.replace\(\/\\\.pdf\$\/i,\s*""\)/,
  "reviewer button labels should omit the PDF extension",
);
assert.match(
  network,
  /get_resource_dashboard:\s*\{\s*required:\s*\[\],\s*allowed:\s*\["type",\s*"appVersion"\]/,
  "the backend request validator should allow the dashboard action and app version",
);
assert.match(
  network,
  /const versionedPayload = \{ \.\.\.payload, appVersion \};\s*validateBackendPayload\(versionedPayload\)/,
  "the allowlisted dashboard request should pass the common payload validator",
);

console.log("Resource dashboard request contract check passed.");
