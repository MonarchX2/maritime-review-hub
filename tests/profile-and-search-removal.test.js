const assert = require("assert");
const fs = require("fs");
const path = require("path");

const workspace = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(workspace, "index.html"), "utf8");
const appCore = fs.readFileSync(path.join(workspace, "app-core.js"), "utf8");

const combined = `${html}\n${appCore}`;

assert.ok(
  !/view-profile|profile-login-state|userLogout|submitUserLogin|submitUserSignup/i.test(
    combined,
  ),
  "Profile UI and auth code should be removed",
);
assert.ok(
  !/header-search-panel|toggleDiscoverySearchPanel|handleDiscoverySearchInput|discoverySearch/i.test(
    combined,
  ),
  "Search/discovery UI and handlers should be removed",
);

console.log("profile and search removal checks passed");
