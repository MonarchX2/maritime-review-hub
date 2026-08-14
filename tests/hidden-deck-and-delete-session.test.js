const fs = require("fs");
const path = require("path");
const assert = require("assert");

const appCore = fs.readFileSync(path.join(__dirname, "../app-core.js"), "utf8");
const adminJs = fs.readFileSync(path.join(__dirname, "../admin.js"), "utf8");
const backendMain = fs.readFileSync(
  path.join(__dirname, "../backend/main.js"),
  "utf8",
);

assert.doesNotMatch(
  backendMain,
  /Subject:\s*key,\s*QuestionCount:\s*state\.summaryMap\[key\],\s*(Locked|Hidden):|Subject:\s*passKey,\s*QuestionCount:\s*0,\s*(Locked|Hidden):/s,
  "summary cache should no longer embed lock/hidden flags in the core deck summary",
);

assert.match(
  backendMain,
  /MRH_Access\.json|ACCESS_SHEET_ID|getDeckAccess/,
  "backend access metadata should be generated in a separate MRH_Access control file",
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

assert.match(
  appCore,
  /clearTimeout\(syncRetryTimer\);[\s\S]*?clearInterval\(syncCountdownTimer\);[\s\S]*?syncConnected\s*=\s*true;[\s\S]*?setGlobalLoadingState\(false\);/,
  "deleteSubjectData should clear any retry state and keep the app connected while removing local downloaded data",
);

assert.match(
  appCore,
  /state\.db\s*=\s*state\.db\.filter\(\(q\)\s*=>\s*q\.Subject\s*!==\s*subject\);[\s\S]*?rebuildQuestionIndex\(\);/,
  "deleteSubjectData should rebuild the subject index immediately so stale deck cache is not reused before refresh",
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

assert.match(
  backendMain,
  /if\s*\(\s*isDeckHidden\(key\)\s*\)\s*continue\s*;|if\s*\(\s*isDeckHidden\(passKey\)\s*\)\s*continue\s*;/s,
  "hidden decks should be filtered out of MRH_Summary.json generation before it is returned to users",
);

assert.doesNotMatch(
  backendMain,
  /uuidSheet\.clearContents\s*\(\);/,
  "admin_update should update the affected UUID row without clearing the entire sheet",
);

console.log("hidden/deck cleanup regression checks passed");
