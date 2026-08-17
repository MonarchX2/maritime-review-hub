const fs = require("fs");
const path = require("path");
const assert = require("assert");

const appCore = fs.readFileSync(path.join(__dirname, "../app-core.js"), "utf8");
const indexHtml = fs.readFileSync(
  path.join(__dirname, "../index.html"),
  "utf8",
);
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
  adminJs,
  /reloadAppStateInMemory\s*\(|syncDatabase\s*\(false,\s*true\)/,
  "successful admin saves should refresh the in-memory deck state immediately so password and hidden changes are live across the app",
);

assert.match(
  backendMain,
  /if\s*\(\s*isDeckHidden\(key\)\s*\)\s*continue\s*;|if\s*\(\s*isDeckHidden\(passKey\)\s*\)\s*continue\s*;/s,
  "hidden decks should be filtered out of MRH_Summary.json generation before it is returned to users",
);

assert.match(
  appCore,
  /filterHiddenAndProtectedDecks\s*\(|return\s*!hidden;/,
  "hidden decks should be filtered from display, while password-protected decks remain visible with a lock icon",
);
assert.match(
  appCore,
  /function\s+isDeckHidden\s*\(subject\)|isDeckHidden\(subj\)\s*\|\|\s*\(deckInfo\s*&&\s*deckInfo\.Hidden\)/,
  "hidden decks must be blocked before a session starts and must not be rendered as available",
);
assert.match(
  appCore,
  /resumeSession\s*\(password\s*=\s*null\)|isDeckLocked\(activity\.subject\)|isDeckLocked\(currentSubject\)/,
  "resume flows must prompt for password whenever a locked deck is resumed",
);
assert.match(
  appCore,
  /if \(isDeckLocked\(subject\) && !pass\) \{[\s\S]*?openDeckPasswordModal\(subject, pendingDeckAction \|\| "continue"\)/,
  "locked decks must open the password modal before any offline fallback can trigger",
);
assert.match(
  backendMain,
  /getDeckPassword\s*\(subject\)\s*\{[\s\S]*?ancestorPassword\s*=\s*passwordMap\[ancestorSubject\]|subjectParts\.slice\(0,\s*depth\)\.join\("::"\)/,
  "password checks must inherit from ancestor folder paths so nested locked decks remain protected",
);
assert.match(
  backendMain,
  /if\s*\(\s*requestedSubject\s*\)\s*\{[\s\S]*?var\s+requiredPassword\s*=\s*getDeckPassword\(requestedSubject\)[\s\S]*?return\s+ContentService\.createTextOutput\([\s\S]*?Incorrect Password\./,
  "protected decks must reject access before cached content is served",
);
assert.match(
  backendMain,
  /deckMetadataCache\s*=\s*null;[\s\S]*?deckMetadataCacheTime\s*=\s*0;/,
  "admin updates must clear the cached metadata immediately so password removals and hidden toggles are reflected in real time",
);
assert.match(
  backendMain,
  /for \(var passKey in passMap\) \{[\s\S]*?accessEntries\.push\(\{[\s\S]*?Hidden:\s*!!hiddenMap\[passKey\][\s\S]*?Locked:\s*true/,
  "hidden decks must remain present in the access metadata so the dashboard can hide them immediately after admin updates",
);
assert.match(
  indexHtml,
  /rel="icon"[^>]*href="icon\.svg"/i,
  "site should include an anchor favicon",
);
assert.match(
  appCore,
  /CACHE_VERSION_STORAGE_KEY|readStoredCacheVersion\(|persistLocalCacheVersion\(|localCacheVersion\s*=\s*readStoredCacheVersion\(|setStoredItem\?\.\(CACHE_VERSION_STORAGE_KEY/,
  "stale local cache versions should be persisted and restored so old cached deck data can be refreshed against the latest server version",
);

assert.match(
  appCore,
  /Password.*report|Locked.*report|report.*Locked|report.*Password|do not allow.*report.*password|password.*protected.*report/i,
  "password-protected decks must block question reports before they reach the public community reports feed",
);

assert.doesNotMatch(
  backendMain,
  /uuidSheet\.clearContents\s*\(\);/,
  "admin_update should update the affected UUID row without clearing the entire sheet",
);

assert.match(
  backendMain,
  /subjectIsFolderLike|isFolderLike|indexOf\(.*"::"\).*summaryLookup|startsWith\(.*"::"\)/s,
  "admin_get_subjects must treat parent folder paths as folders even when they only exist in hidden/password metadata",
);

assert.match(
  backendMain,
  /var\s+summaryEntries\s*=\s*\{\};[\s\S]*?summaryEntries\[normalizedSubject\]\s*=\s*normalizeDeckRecord/s,
  "MRH_Summary generation should collapse duplicate subject entries into a single canonical record while preserving important metadata",
);
assert.match(
  backendMain,
  /Locked\s*:\s*subjectIsLocked|Locked\s*:\s*isLocked/s,
  "MRH_Summary should include a single Locked flag for the frontend lock icon metadata",
);
assert.doesNotMatch(
  backendMain,
  /hidden:\s*hiddenValue|locked:\s*lockedValue|Subject:\s*subjectValue,[\s\S]*?hidden:[\s\S]*?locked:/s,
  "MRH_Summary should not embed hidden/locked flags in the generated cache",
);
assert.match(
  appCore,
  /removeStoredItem\("saved_session"\)|clearSessionProgress\(\)/,
  "session cleanup should explicitly remove saved deck progress when a secure session ends",
);
assert.match(
  backendMain,
  /admin_clear_all[\s\S]*?uuidSheet\.getRange\(.*?\"C:C\"|uuidSheet\.getRange\(.*?\"D:D\"|setValues\(\[\[.*?,.*?,\s*\"\",\s*\"\"/s,
  "admin clear-all should clear only the Hidden and Password columns while leaving UUID rows intact",
);

console.log("hidden/deck cleanup regression checks passed");
