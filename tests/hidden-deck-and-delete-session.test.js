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
  /Subject:\s*key,\s*QuestionCount:\s*state\.summaryMap\[key\],\s*Hidden:|Subject:\s*passKey,\s*QuestionCount:\s*0,\s*Hidden:/s,
  "summary rows should not embed hidden state in the core deck summary",
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
assert.doesNotMatch(
  adminJs,
  /fetchAccessMetadata\s*\(|syncDatabase\s*\(false,\s*true\)|reloadAppStateInMemory\s*\(/,
  "successful admin saves should avoid the long sync/reload loop and stay on the summary-only backend update path",
);

assert.match(
  backendMain,
  /if\s*\(\s*isDeckHidden\(key\)\s*\)\s*continue\s*;|if\s*\(\s*isDeckHidden\(passKey\)\s*\)\s*continue\s*;/s,
  "hidden decks should be filtered out of MRH_Summary.json generation before it is returned to users",
);
assert.match(
  backendMain,
  /fileName\.match\(\s*\/\^deck-\[A-Z0-9\]\+\\\.json\$\/i\s*\)/,
  "generated deck cache filenames must be ignored when deriving the human-readable subject name",
);
assert.match(
  backendMain,
  /if\s*\(\s*requestType\s*===\s*["']admin_update["']\s*\)[\s\S]*?triggerBuildDatabaseCache\s*\(/,
  "admin_update should trigger a cache rebuild after a layout save so MRH_Summary.json is refreshed from the current metadata",
);
assert.match(
  backendMain,
  /function\s+bumpCacheVersionForMutation\s*\(|bumpCacheVersionForMutation\s*\(\s*DATABASE_FOLDER_ID\s*\)|setCacheVersionProperties\s*\(\s*new Date\(\)\.getTime\(\)\.toString\(\)\s*\)/,
  "real admin mutations must always bump the cache version and trigger a refresh, even for question edits",
);
assert.match(
  backendMain,
  /folderQueue:\s*\[\{\s*id:\s*DATABASE_FOLDER_ID\s*,\s*pathPrefix:\s*""\s*\}\]/,
  "cache rebuilds must start from the database folder itself so the folder name is not treated as a deck container prefix",
);
assert.match(
  backendMain,
  /function\s+getLastAdminModificationTimestamp\(\)\s*\{\s*var\s+props\s*=\s*PropertiesService\.getScriptProperties\(\);\s*return\s+props\.getProperty\(\s*["']LAST_ADMIN_MODIFICATION_TIMESTAMP["']\s*\)\s*\|\|\s*""\s*;\s*\}/s,
  "admin timestamp reads must remain read-only so a fetch cannot create a fake edit conflict",
);
assert.match(
  backendMain,
  /hasPreviouslySaved\s*&&\s*clientTimestamp\s*&&\s*serverTimestamp\s*&&\s*clientTimestamp\s*!==\s*serverTimestamp/s,
  "admin updates should only report a timestamp conflict when both the client and server timestamps are present and different",
);
assert.match(
  backendMain,
  /hiddenMap\[subjectName\][\s\S]*?buildSummaryArrayFromAccessState\s*\(/s,
  "summary rebuilds must drop hidden decks and derive Locked from the live access map instead of reusing stale summary rows",
);
assert.doesNotMatch(
  adminJs,
  /Syncing with cloud|syncWithRetry\s*\(|fetchAccessMetadata\s*\(|syncDatabase\s*\(false,\s*true\)/,
  "Save Layout should not enter the long cloud-sync retry flow after a successful admin save",
);
assert.doesNotMatch(
  adminJs,
  /subj\.Subject\.startsWith\(folderPath \+ "::"\)|Subject\.startsWith\(folderPath \+ "::"\)/,
  "folder password and hidden changes must not cascade to descendants by prefix match",
);

assert.match(
  appCore,
  /function\s+isDeckHidden\s*\(subject\)|function\s+isDeckLocked\s*\(subject\)|return\s*Boolean\(access\.Hidden\)|return\s*Boolean\(access\.Locked\)/,
  "hidden decks must be filtered by exact subject match, while password-protected decks stay visible with a lock icon",
);
assert.doesNotMatch(
  appCore,
  /parentName\s*=\s*subjectParts\.slice\(0,\s*depth\)\.join\("::"\)|for\s*\(let\s+depth\s*=\s*subjectParts\.length\s*-\s*1;\s*depth\s*>\s*0;\s*depth--\)/s,
  "frontend access must not walk parent subjects when evaluating hidden or lock state",
);
assert.doesNotMatch(
  backendMain,
  /hiddenScope\s*=\s*\[update\.oldName\][\s\S]*?for\s*\(var\s+hiddenKey\s+in\s+passMap\)[\s\S]*?hiddenKey\.indexOf\(update\.oldName\s*\+\s*"::"\)/s,
  "folder toggles must not cascade hidden or lock state to descendant UUID rows",
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
assert.doesNotMatch(
  backendMain,
  /ancestorPassword|ancestorKey|subjectParts\.slice\(0,\s*depth\)\.join\("::"\)|depth\s*>\s*0/,
  "password checks must use exact Subject matches only and never walk parent paths",
);
assert.doesNotMatch(
  appCore,
  /parentName\s*=\s*subjectParts\.slice\(0,\s*depth\)\.join\("::"\)|for\s*\(let\s+depth\s*=\s*subjectParts\.length\s*-\s*1;\s*depth\s*>\s*0;\s*depth--\)/,
  "frontend access resolution must not inherit hidden or lock state from parent subjects",
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
  /fallbackSummary\.push\(\{\s*Subject:\s*fallbackSubject,\s*QuestionCount:\s*0,\s*Locked:\s*true/s,
  "fallback admin summary refresh must preserve the full summary and original question counts instead of building a password-only one-item array",
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
assert.match(
  backendMain,
  /function\s+normalizeUUIDSheetParentSubjects\s*\(|normalizeUUIDSheetParentSubjects\s*\(|newEntries\.push\(\[newUUID,\s*parentPath,\s*"",\s*"",\s*new\s+Date\(\)\.toISOString\(\)\]\)/s,
  "UUID sheet normalization must append missing parent folders for every hierarchical subject path without overwriting existing rows",
);
assert.match(
  backendMain,
  /getCacheInvalidationVersion\s*\(\)\s*\{[\s\S]*?MRH_CACHE_VERSION[\s\S]*?CACHE_VER/s,
  "cache invalidation must read the same version property that admin updates write, or stale summaries never refresh reliably",
);
console.log("hidden/deck cleanup regression checks passed");
