const fs = require("fs");
const path = require("path");
const assert = require("assert");

const appCore = fs.readFileSync(path.join(__dirname, "../app-core.js"), "utf8");
const adminJs = fs.readFileSync(path.join(__dirname, "../admin.js"), "utf8");
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

assert.doesNotMatch(
  backendMain,
  /if\s*\(\s*update\.newName\s*===\s*update\.oldName\s*\)\s*\{\s*renamedCount\+\+;\s*continue;\s*\}/s,
  "same-name admin updates should still persist hidden/password changes to the DECK sheet",
);

assert.match(
  adminJs,
  /data-path="\$\{escapeHTML\(subj\.originalFull\)\}"[^]*?data-orig="\$\{String\(subj\.hidden \|\| false\)\}"/s,
  "deck hidden inputs must include their subject path and original hidden value so admin save can persist them",
);

assert.match(
  adminJs,
  /const\s+hasPasswordChange\s*=\s*deckPass\s*!==\s*originalPassword;[\s\S]*?if\s*\(\s*hasPasswordChange\s*\)\s*deckUpdate\.password\s*=\s*deckPass;[\s\S]*?if\s*\(\s*hasHiddenChange\s*\)\s*deckUpdate\.hidden\s*=\s*deckHidden;/s,
  "admin save should only include changed password values, so hidden-only toggles do not clobber the hidden update",
);

console.log("hidden/deck cleanup regression checks passed");
