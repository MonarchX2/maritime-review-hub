const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appCoreState = fs.readFileSync(
  path.join(__dirname, "..", "app-core-state.js"),
  "utf8",
);
const appCore = fs.readFileSync(
  path.join(__dirname, "..", "app-core.js"),
  "utf8",
);
const adminJs = fs.readFileSync(path.join(__dirname, "..", "admin.js"), "utf8");
const indexHtml = fs.readFileSync(
  path.join(__dirname, "..", "index.html"),
  "utf8",
);

const resetProgressIndex = appCore.indexOf("async function resetProgress");
const clearDatabaseIndex = appCore.indexOf("async function clearDatabase");
const clearAppDataIndex = appCore.indexOf("async function clearAppData");

const resetProgressBlock = appCore.slice(
  resetProgressIndex,
  clearDatabaseIndex,
);
const clearDatabaseBlock = appCore.slice(clearDatabaseIndex, clearAppDataIndex);
const clearAppDataBlock = appCore.slice(clearAppDataIndex);

assert.match(appCoreState, /activeRecall:\s*false/);
assert.match(appCoreState, /quizNavigationPosition:\s*"top"/);
assert.match(appCoreState, /quizNavigationMode:\s*"manual"/);
assert.match(appCoreState, /studySingleNavigationPosition:\s*"top"/);
assert.match(appCoreState, /studyScrollNavigationPosition:\s*"both"/);
assert.match(indexHtml, /Main Settings/);
assert.match(indexHtml, /Deck Navigation Buttons/);
assert.match(indexHtml, /Quiz Mode/);
assert.match(indexHtml, /id="main-navigation-scroll-button"/);
assert.match(indexHtml, /on TOP|on Bottom|TOP \+ BOTTOM/);
assert.match(appCore, /const SYNC_INTERVAL_MS = 3 \* 1000/);
assert.match(
  appCore,
  /setTimeout\(\(\) => syncAbortController\.abort\(\), 10000\)/,
);
assert.doesNotMatch(
  adminJs,
  /btn\.classList\.remove\(\s*"bg-green-600"\s*,\s*"hover:bg-green-700"\s*\)/,
  "save button should keep its default green styling while adding only temporary success-state styling",
);
assert.match(
  appCore,
  /isDeckLocked\s*\(|if\s*\(\s*isDeckLocked\(subject\)\s*&&\s*!pass\s*\)/,
  "locked decks should trigger a password prompt before gameplay starts",
);
assert.match(
  indexHtml,
  /Shuffle Choices[\s\S]*?Default to ON[\s\S]*?toggle-shuffle-choices/,
);
assert.match(
  indexHtml,
  /Shuffle Questions[\s\S]*?Default to ON[\s\S]*?toggle-shuffle-questions/,
);
assert.match(indexHtml, /id="shuffle-warning"/);
assert.match(appCore, /function\s+toggleFavoriteDeck\s*\(/);
assert.match(appCore, /cycleScrollNavigationPosition\s*\(/);
assert.match(appCoreState, /loadState\s*:\s*async\s*function/);
assert.match(appCoreState, /saveState\s*:\s*async\s*function/);
assert.match(appCoreState, /syncPreferenceControls\s*:\s*function/);
assert.match(
  appCore,
  /typeof\s+AppSync\s*!==\s*"undefined"\s*&&\s*typeof\s+AppSync\.syncDatabase\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+AppSync\s*!==\s*"undefined"\s*&&\s*typeof\s+AppSync\.updateSyncStatus\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+SessionCore\s*!==\s*"undefined"\s*&&\s*typeof\s+SessionCore\.renderQuestion\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+SessionCore\s*!==\s*"undefined"\s*&&\s*typeof\s+SessionCore\.initSession\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+UIModal\s*!==\s*"undefined"\s*&&\s*typeof\s+UIModal\.toggleModal\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+UIModal\s*!==\s*"undefined"\s*&&\s*typeof\s+UIModal\.openReportModal\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+DeckNav\s*!==\s*"undefined"\s*&&\s*typeof\s+DeckNav\.navigate\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+DeckNav\s*!==\s*"undefined"\s*&&\s*typeof\s+DeckNav\.enterFolder\s*===\s*"function"/,
);assert.match(
  appCore,
  /typeof\s+DeckReview\s*!==\s*"undefined"\s*&&\s*typeof\s+DeckReview\.renderDeckReview\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+DeckReview\s*!==\s*"undefined"\s*&&\s*typeof\s+DeckReview\.changeStudyPage\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+Analytics\s*!==\s*"undefined"\s*&&\s*typeof\s+Analytics\.renderCharts\s*===\s*"function"/,
);
assert.match(
  appCore,
  /typeof\s+Analytics\s*!==\s*"undefined"\s*&&\s*typeof\s+Analytics\.toggleTheme\s*===\s*"function"/,
);
assert.doesNotMatch(resetProgressBlock, /state\.db\s*=\s*\[/);
assert.doesNotMatch(clearDatabaseBlock, /state\.stats\s*=/);
assert.doesNotMatch(clearDatabaseBlock, /state\.prefs\s*=\s*\{/);
assert.match(clearAppDataBlock, /state\.db\s*=\s*\[]/);
assert.match(clearAppDataBlock, /state\.stats\s*=/);
assert.match(clearAppDataBlock, /state\.prefs\s*=\s*\{/);
assert.match(appCore, /clearAppData\s*\(\)/);
assert.match(appCore, /idbKeyval\.clear\(\)/);
assert.match(appCore, /localStorage\.removeItem\(/);
assert.match(appCore, /sessionStorage\.removeItem\(/);
assert.match(appCore, /caches\.keys\(\)/);
assert.match(appCore, /indexedDB\.deleteDatabase/);
assert.match(appCore, /cachedQuestions\.length > 0 && !pass/);
assert.match(
  appCore,
  /function\s+normalizeQuestionRecord\s*\(question,\s*subjectOverride\s*=\s*null\)/,
);
assert.match(appCore, /firstAvailableValue\s*\(/);
assert.match(
  appCore,
  /Subject:\s*firstAvailableValue\(subjectOverride,\s*source\.Subject,\s*source\.s\)/,
);

console.log("quiz defaults and danger-zone cleanup checks passed");
