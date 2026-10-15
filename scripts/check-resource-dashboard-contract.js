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
  /"resource-dashboard-link-button",\s*fileTitle \|\| \(isResourceDashboardLink\(value\) \? "Open resource" : value\)/,
  "resource buttons should use the Drive title rather than expose its URL",
);
assert.match(
  appCore,
  /tab\.linkTitles\?\.\[rowIndex\]\?\.\[index\]/,
  "dashboard rendering should use backend-resolved Drive titles",
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
