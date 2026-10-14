const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appSource = fs.readFileSync("app-core.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const activityFunction = appSource.match(
  /async function markQuizActivity\(subject\) \{[\s\S]*?\n  \}/,
);
const cachedStartFunction = appSource.match(
  /async function startReviewDeckQuiz\(subject\) \{[\s\S]*?\n  \}/,
);
const modeToggleFunction = appSource.match(
  /function toggleAppMode\(\) \{[\s\S]*?\n  \}/,
);
assert.ok(activityFunction, "quiz activity synchronization helper should exist");
assert.ok(cachedStartFunction, "quiz switch should start from the loaded deck");
assert.doesNotMatch(
  cachedStartFunction[0],
  /fetchAndStartCategory|fetchDeckQuestions|DeckNavCore/,
  "Review-to-Quiz must not fetch the deck again",
);
assert.ok(modeToggleFunction, "dashboard mode toggle handler should exist");

const modeToggle = { checked: true };
const modeLabel = { innerText: "Study", textContent: "Study" };
const context = {
  Date,
  state: {
    prefs: { lastActivity: { mode: "review", subject: "Deck A" } },
    stats: {
      completedQs: [],
      srsMap: {},
    },
  },
  DeckReviewCore: {
    getCurrentReviewSubject: () => "Deck A",
    getCurrentReviewQuestions: () => [
      {
        ID: "q1",
        Subject: "Deck A",
        ChoiceA: "A",
        ChoiceB: "B",
      },
    ],
  },
  startCustomSession(pool) {
    context.startedPool = pool;
    return Promise.resolve(true);
  },
  markQuizActivity: () => Promise.resolve(true),
  showToast() {},
  document: {
    getElementById(id) {
      if (id === "globalModeToggle") return modeToggle;
      if (id === "modeLabel") return modeLabel;
      return null;
    },
  },
  syncPreferenceControls() {
    modeToggle.checked = context.state.prefs.lastActivity?.mode === "review";
    modeLabel.textContent = modeToggle.checked ? "Study" : "Quiz";
  },
  saveState() {
    return Promise.resolve(true);
  },
  renderCategoryProgress() {},
};
vm.createContext(context);
vm.runInContext(
  `let currentAppMode = "review";\n${activityFunction[0]}\n${cachedStartFunction[0]}\n${modeToggleFunction[0]}\nglobalThis.getCurrentMode = () => currentAppMode;`,
  context,
);

(async () => {
  assert.equal(await context.startReviewDeckQuiz("Deck A"), true);
  assert.equal(context.startedPool.length, 1);
  assert.equal(context.startedPool[0].ID, "q1");

  await context.markQuizActivity("Deck A");
  assert.equal(context.state.prefs.lastActivity.mode, "quiz");
  assert.equal(context.getCurrentMode(), "quiz");
  assert.equal(modeToggle.checked, false);
  assert.equal(modeLabel.textContent, "Quiz");

  context.syncPreferenceControls();
  assert.equal(modeToggle.checked, false, "exiting quiz keeps the toggle in Quiz mode");

  modeToggle.checked = true;
  context.toggleAppMode();
  assert.equal(context.getCurrentMode(), "review");
  assert.equal(context.state.prefs.lastActivity.mode, "review");
  assert.equal(modeToggle.checked, true);

  const switchButton = html.match(
    /<button\s+id="btn-switch-to-quiz"[\s\S]*?<\/button>/,
  )?.[0];
  assert.ok(switchButton, "Review Mode should expose a Quiz switch button");
  assert.match(switchButton, /Switch to Quiz Mode/);
  assert.match(switchButton, /h-10 px-3/);
  assert.match(switchButton, /duration-300/);
  assert.match(switchButton, /text-brand-600 dark:text-brand-400/);
  assert.match(switchButton, /fa-clipboard-question text-brand-600/);

  const switchHandler = appSource.match(
    /async function switchReviewToPractice\(\) \{[\s\S]*?\r?\n  \}/,
  )?.[0];
  assert.ok(switchHandler, "Review-to-Quiz handler should exist");
  assert.match(switchHandler, /"Switch to Quiz Mode"/);
  assert.match(switchHandler, /Study progress is saved/);
  assert.doesNotMatch(switchHandler, /Resume your saved quiz|from where you left off/i);

  const failedSaveContext = {
    appLogger: { error() {} },
    state: {
      session: { active: false },
      prefs: { studyProgress: { "Deck A": { scrollY: 0 } } },
    },
    getCurrentReviewSubject: () => "Deck A",
    getStoredItem: () => null,
    requestConfirmation: async () => true,
    document: { querySelector: () => ({ scrollTop: 120 }) },
    saveState: async () => false,
    startReviewDeckQuiz: async () => {
      failedSaveContext.quizStarted = true;
      return true;
    },
    showToast: (message, type) => {
      failedSaveContext.toast = { message, type };
    },
  };
  vm.createContext(failedSaveContext);
  vm.runInContext(
    `${switchHandler}
globalThis.switchReviewToPractice = switchReviewToPractice;`,
    failedSaveContext,
  );
  assert.equal(
    await failedSaveContext.switchReviewToPractice(),
    false,
    "mode switching must stop when the latest study progress was not persisted",
  );
  assert.equal(failedSaveContext.quizStarted, undefined);
  assert.equal(failedSaveContext.toast.type, "error");

  console.log("Practice/review switch checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});