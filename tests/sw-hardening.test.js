const assert = require("assert");
const fs = require("fs");
const path = require("path");

const swSource = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

assert.match(
  swSource,
  /APP_SHELL|OFFLINE_CACHE_NAME|caches\.open/i,
  "service worker should cache a defined app shell",
);
assert.match(
  swSource,
  /new URL\(request\.url\)|url\.origin === self\.location\.origin|request\.mode === "navigate"/i,
  "service worker should guard upgrades and same-origin navigation requests",
);
assert.match(
  swSource,
  /event\.respondWith\(|fetch\(request\)\.catch\(/i,
  "service worker should use a fallback offline response",
);

console.log("service worker hardening checks passed");
