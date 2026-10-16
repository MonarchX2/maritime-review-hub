const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const appCore = fs.readFileSync(path.join(rootDir, "app-core.js"), "utf8");
const styles = fs.readFileSync(path.join(rootDir, "styles.css"), "utf8");

assert.match(
  appCore,
  /"grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"/,
  "Grid deck cards should use the shared 1.25rem spacing.",
);
assert.match(
  appCore,
  /"flex flex-col gap-5"/,
  "List deck cards should use the same spacing as the grid.",
);
assert.match(
  appCore,
  /<div data-deck-breadcrumb class="deck-breadcrumb-nav\b/,
  "The breadcrumb should use the shared navbar spacing styles.",
);
assert.match(
  styles,
  /\.dashboard-header-row\s*\{[^}]*min-height:\s*2\.375rem;[\s\S]*?\.deck-breadcrumb-nav\s*\{[^}]*height:\s*2\.375rem;[^}]*margin-block:\s*0 1rem;/,
  "The breadcrumb should sit against the Home/controls row and retain its 1rem gap below.",
);
assert.doesNotMatch(
  appCore,
  /"flex flex-col space-y-4"/,
  "List layout should not use a different vertical spacing utility.",
);
assert.ok(
  appCore.includes('class="deck-card ${') &&
    appCore.includes("relative w-full flex flex-col"),
  "Deck cards should size from their content and grid track instead of 100% height.",
);
assert.ok(
  /<div class="mb-4">\s*<div class="flex items-start justify-between gap-2">[\s\S]*?<div class="flex items-center gap-1\.5">\s*\$\{countBadgeHTML\}[\s\S]*?<\/div>\s*<div class="deck-card-badges mt-1 flex flex-wrap items-start gap-1">/.test(
    appCore,
  ),
  "Quizzable deck counts should remain in the top-right header, with badges below across the card width.",
);
assert.match(
  appCore,
  /const cardCountLabel = isQuiz[\s\S]*?\$\{completedCount\} \/ \$\{totalQuestionsInDb\} cards[\s\S]*?<span class="text-sm font-black \$\{themeColorText\} transition-colors">\$\{cardCountLabel\}<\/span>/,
  "Quiz deck cards should show completed/total cards while review cards show the total.",
);
assert.match(
  appCore,
  /isQuiz && hasQuizProgress\s*\?\s*`<div class="mb-4 h-1\.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="progressbar" aria-label="Quiz progress for \$\{safeName\}"[\s\S]*?width: \$\{quizProgressPercent\}%/,
  "Deck cards should render a progress bar only for Quiz-mode decks with progress.",
);
assert.doesNotMatch(
  appCore,
  /const studyProgress = getStudyDeckProgress\(subj, totalQuestionsInDb\)/,
  "Review-mode deck cards should not render a reset button based on study progress.",
);
assert.ok(
  appCore.indexOf("const isQuiz = currentAppMode === \"quiz\";") <
    appCore.indexOf("const cardCountLabel = isQuiz"),
  "Quiz mode must be initialized before it is used to render card labels.",
);
assert.match(
  styles,
  /#deck-sort-menu > div,[\s\S]*?#deck-source-menu > div\s*\{[^}]*width:\s*min\(11rem,\s*calc\(100vw - 2rem\)\);[^}]*max-height:\s*calc\(100dvh - 2rem\);[^}]*overflow-y:\s*auto;/,
  "Sort and source filter menus should stay within small viewports and scroll when too tall.",
);
assert.match(
  appCore,
  /<div class="p-4 flex flex-col flex-1">\s*<div class="flex justify-between items-start w-full gap-2">[\s\S]*?<\/div>\s*<div class="deck-card-badges mt-1 w-full flex flex-wrap items-start gap-1">[\s\S]*?<\/div>\s*<div class="mt-auto pt-2 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">[\s\S]*?<span>\$\{totalCards\} cards<\/span>[\s\S]*?\$\{popularBadge\}/,
  "Folder labels should span below the title and action buttons, above the bottom-anchored count footer.",
);
const popularMatcherSource = appCore.match(
  /const popularDeckPaths = new Set\([\s\S]*?\n      const pinnedDecks =/,
);
assert.ok(popularMatcherSource, "the Popular deck path matcher should exist");
const isPopularDeckPath = new Function(
  `${popularMatcherSource[0].replace(/\n      const pinnedDecks =$/, "")}; return isPopularDeckPath;`,
)();
for (const deckName of [
  "GENERAL KNOWLEDGE",
  "BSMT COMPETENCIES",
  "REVIEW NOTES FOR DECK OFFICERS (BOOK)",
]) {
  assert.equal(isPopularDeckPath(deckName), true, `${deckName} should be Popular`);
  assert.equal(
    isPopularDeckPath(`Parent Folder::${deckName.toLocaleLowerCase()}`),
    true,
    `${deckName} should match when nested and differently cased`,
  );
}
assert.match(
  appCore,
  /const popularBadge = isPopularDeckPath\(subj\)\s*\?\s*renderDeckBadge\("Popular", "fa-fire"\)/,
  "deck cards should render matching popular paths with the fire-icon Popular badge.",
);
assert.ok(
  appCore.includes("group bg-white dark:bg-gray-800 rounded-xl") &&
    appCore.includes("overflow-hidden flex flex-col relative"),
  "Folder cards should size from their content without a forced height.",
);
assert.match(styles, /\*\s*\{\s*scrollbar-width:\s*none;/);
assert.match(styles, /::-webkit-scrollbar\s*\{\s*display:\s*none;/);
assert.match(
  styles,
  /\.deck-card-title-text\s*\{\s*overflow-wrap:\s*anywhere;/,
);
assert.match(styles, /\.deck-card-badges\s*\{\s*align-content:\s*flex-start;/);
assert.match(
  styles,
  /#category-list \[data-deck-list-layout\]\.grid\s*\{\s*grid-auto-rows:\s*auto;/,
  "Each grid row should size to its tallest card.",
);
assert.doesNotMatch(
  styles,
  /#category-list \[data-deck-list-layout\]\.grid\s*>[^}]*align-self:\s*start;/,
  "Grid cards should stretch to fill their equal-height rows.",
);
assert.doesNotMatch(styles, /\.deck-card-title(?:,|\s*\{)[^}]*min-height:/);
assert.doesNotMatch(styles, /\.deck-card-badges\s*\{[^}]*max-height:/);
assert.doesNotMatch(styles, /\.deck-folder-card\s*\{[^}]*min-height:/);

console.log("Deck layout spacing checks passed.");
