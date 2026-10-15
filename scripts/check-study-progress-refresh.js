const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const progress = { index: 0, page: 1, questionId: "q1", scrollY: 0 };
global.state = {
  categorySummary: [],
  db: [],
  currentPath: [],
  stats: { completedQs: [], mistakes: [] },
  accessMetadata: {},
  prefs: {
    layoutMode: "grid",
    deckSourceFilter: "all",
    deckSortBy: "name",
    deckSortDirection: "asc",
    deckNameMode: "wrap",
    favoriteDecks: [],
    favoriteQuestions: [],
    archivedDecks: [],
    expandedArchivedPaths: [],
    studyLayout: "scroll",
    studyPageSize: "All",
    studyFilterMode: "all",
    studyProgress: { Deck: progress },
  },
};

const dashboardCore = require("../dashboard-core.js");
global.getSummarySignature = () => "";
global.getCollectionSignature = (values) =>
  Array.isArray(values) ? values.join("\u001f") : "";

const appSource = fs.readFileSync("app-core.js", "utf8");
const progressHelper = appSource.match(
  /const getStudyDeckProgress = \(subject, total\) => \{[\s\S]*?\n      \};/,
);
assert.ok(progressHelper, "dashboard should have a Study progress calculation");
const getStudyDeckProgress = (position) => {
  progress.index = position;
  progress.questionId = `q${position + 1}`;
  return vm.runInNewContext(
    `${progressHelper[0]}; getStudyDeckProgress("Deck", 3)`,
    {
      state: global.state,
      rootScope: {
        getDeckSessionSetting(mode, key, subject) {
          return (
            global.state.prefs.deckSessionSettings?.[subject]?.[mode]?.[key] ??
            global.state.prefs[key]
          );
        },
      },
    },
  );
};
assert.equal(
  getStudyDeckProgress(0).current,
  1,
  "the first question counts as position one once its stable ID is saved",
);
assert.equal(getStudyDeckProgress(1).current, 2);
progress.index = 0;
progress.questionId = "q1";

const initialSignature =
  dashboardCore.getCategoryProgressRenderSignature({
    currentAppMode: "review",
    isInitialSyncComplete: true,
  });
progress.index = 1;
progress.questionId = "q2";
const movedQuestionSignature =
  dashboardCore.getCategoryProgressRenderSignature({
    currentAppMode: "review",
    isInitialSyncComplete: true,
  });
assert.notEqual(
  movedQuestionSignature,
  initialSignature,
  "a changed question position must invalidate cached dashboard progress",
);

progress.index = 0;
progress.questionId = "q1";
const returnedToFirstQuestionSignature =
  dashboardCore.getCategoryProgressRenderSignature({
    currentAppMode: "review",
    isInitialSyncComplete: true,
  });
assert.notEqual(
  returnedToFirstQuestionSignature,
  movedQuestionSignature,
  "returning to the first question must refresh its dashboard progress",
);

console.log("Study progress dashboard refresh checks passed.");
