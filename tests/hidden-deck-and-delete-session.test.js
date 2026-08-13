const fs = require("fs");
const path = require("path");
const assert = require("assert");

const appCore = fs.readFileSync(path.join(__dirname, "../app-core.js"), "utf8");
const backendMain = fs.readFileSync(
  path.join(__dirname, "../backend/main.js"),
  "utf8",
);

assert.match(
  backendMain,
  /Hidden:\s*hiddenMap\[/,
  "summary cache should preserve hidden status for deck filtering",
);

assert.match(
  appCore,
  /state\.prefs\.lastActivity\s*\?\.subject\s*===\s*subject|lastActivity.*subject.*===\s*subject/,
  "deleteSubjectData should clear deck-specific resume state when a deck is deleted",
);

assert.match(
  appCore,
  /removeStoredItem\("saved_session"\)/,
  "session cleanup should remove the saved quiz state",
);

console.log("hidden/deck cleanup regression checks passed");
