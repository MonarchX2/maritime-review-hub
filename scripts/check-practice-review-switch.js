const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appSource = fs.readFileSync("app-core.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");
const reviewSource = fs.readFileSync("deck-review-core.js", "utf8");
const activityFunction = appSource.match(
  /async function markQuizActivity\(subject\) \{[\s\S]*?\n  \}/,
);
const cachedStartFunction = appSource.match(
  /async function startReviewDeckQuiz\(subject\) \{[\s\S]*?\n  \}/,
);
const practiceToReviewFunction = appSource.match(
  /async function switchPracticeToReview\(\) \{[\s\S]*?\n  \}/,
);
const reviewDeckFunction = appSource.match(
  /async function reviewDeck\([\s\S]*?\) \{[\s\S]*?\n  \}/,
);
const modeToggleFunction = appSource.match(
  /function toggleAppMode\(\) \{[\s\S]*?\n  \}/,
);
const restoreProgressFunction = appSource.match(
  /function hasSessionRestoreProgress\(sessionRoute\) \{[\s\S]*?\n  \}/,
);
const resumeSessionFunction = appSource.match(
  /async function resumeSession\(password = null, options = \{\}\) \{[\s\S]*?\n  \}/,
);
assert.ok(activityFunction, "quiz activity synchronization helper should exist");
assert.ok(cachedStartFunction, "quiz switch should start from the loaded deck");
assert.ok(practiceToReviewFunction, "quiz-to-study switch should exist");
assert.ok(reviewDeckFunction, "deck review loader should exist");
assert.ok(restoreProgressFunction, "session refresh progress check should exist");
assert.ok(resumeSessionFunction, "saved quiz resume handler should exist");
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
  const lockedDeckQuestion = {
    ID: "locked-q1",
    Subject: "Parent::Locked Deck",
    ChoiceA: "A",
    ChoiceB: "B",
  };
  const suspension = {
    session: {
      active: false,
      currentIndex: 0,
      questions: [lockedDeckQuestion],
    },
  };
  const practiceToReviewContext = {
    state: {
      session: {
        active: true,
        currentIndex: 0,
        questions: [lockedDeckQuestion],
      },
    },
    SessionCore: {
      suspendSessionForModeSwitch: () => suspension,
    },
    requestConfirmation: async () => true,
    reviewDeck: async (...args) => {
      practiceToReviewContext.reviewDeckArgs = args;
      return true;
    },
    syncPreferenceControls() {},
    showToast() {},
    appLogger: { error() {} },
    document: {
      getElementById() {
        return null;
      },
    },
  };
  vm.createContext(practiceToReviewContext);
  vm.runInContext(
    `let pendingPracticeReviewSwitch = null;
    let currentAppMode = "quiz";
    ${practiceToReviewFunction[0]}
    globalThis.switchPracticeToReview = switchPracticeToReview;`,
    practiceToReviewContext,
  );
  assert.equal(
    await practiceToReviewContext.switchPracticeToReview(),
    true,
    "switching an already-authorized locked-deck session to Study should succeed",
  );
  assert.equal(
    practiceToReviewContext.reviewDeckArgs[3][0].ID,
    "locked-q1",
    "the authorized session questions should be passed into Study mode",
  );

  let deckFetchCount = 0;
  let renderedReview = null;
  const authorizedReviewContext = {
    document: {
      getElementById: () => ({ classList: { add() {} } }),
    },
    getDeckLoaderId: () => "deck-loader",
    isDeckHidden: () => false,
    isDeckLocked: () => true,
    pendingDeckPayloadRefreshes: new Set(["Parent::Locked Deck"]),
    pendingDeckSubject: null,
    pendingDeckAction: null,
    state: {
      db: [],
      categorySummary: [],
      prefs: {},
    },
    async fetchDeckQuestions() {
      deckFetchCount += 1;
      return [];
    },
    async navigate() {
      return true;
    },
    saveState() {},
    renderDeckReview(subject, questions) {
      renderedReview = { subject, questions };
    },
    updateSessionNavigationUrl() {},
    showToast() {},
  };
  authorizedReviewContext.globalScope = authorizedReviewContext;
  vm.createContext(authorizedReviewContext);
  vm.runInContext(
    `let pendingDeckSubject = null;
    let pendingDeckAction = null;
    ${reviewDeckFunction[0]}
    globalThis.reviewDeck = reviewDeck;`,
    authorizedReviewContext,
  );
  assert.equal(
    await authorizedReviewContext.reviewDeck(
      "Parent::Locked Deck",
      null,
      true,
      [lockedDeckQuestion],
    ),
    true,
    "cached questions from the authorized session should open a locked deck in Study mode",
  );
  assert.equal(deckFetchCount, 0, "mode switching should not refetch a locked deck");
  assert.equal(renderedReview.questions[0].ID, "locked-q1");

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
  const reviewHeader = html.match(
    /<div class="review-header-row[\s\S]*?<\/div>\s*<\/div>\s*<div id="deck-review-list"/,
  )?.[0];
  assert.ok(reviewHeader, "Review header should render before the review list");
  assert.ok(
    reviewHeader.indexOf('id="deck-review-title"') <
      reviewHeader.indexOf('id="btn-switch-to-quiz"'),
    "Deck title and parent label should appear above the review action buttons",
  );
  assert.match(reviewHeader, /text-center[\s\S]*?id="deck-review-title"/);
  assert.match(
    reviewHeader,
    /text-base md:text-xl[\s\S]*?id="deck-review-parent"/,
  );
  assert.match(
    reviewHeader,
    /<div class="mt-2 md:mt-0 flex items-center justify-between/,
  );
  assert.match(reviewHeader, /flex flex-col gap-0/);
  assert.match(
    html,
    /<div id="quiz-navigation-top" class="mt-6"><\/div>/,
    "The session navigation bar should have increased spacing from the progress area above it.",
  );
  assert.match(
    reviewSource,
    /parentElement\.textContent = subjectParts\.at\(-2\) \|\| "";\s*parentElement\.hidden = subjectParts\.length < 2;/,
    "Review header should display the immediate parent deck when available",
  );

  const switchHandler = appSource.match(
    /async function switchReviewToPractice\(\) \{[\s\S]*?\r?\n  \}/,
  )?.[0];
  assert.ok(switchHandler, "Review-to-Quiz handler should exist");
  assert.match(switchHandler, /"Switch to Quiz Mode"/);
  assert.match(switchHandler, /Study progress is saved/);
  assert.doesNotMatch(switchHandler, /Resume your saved quiz|from where you left off/i);
  assert.match(
    switchHandler,
    /authorizedReviewQuestions[\s\S]*?resumeSession\(null,\s*\{[\s\S]*?authorizedReviewQuestions/,
    "Review-to-Quiz should pass its already-authorized deck questions when restoring a saved quiz",
  );

  const authorizedQuestion = {
    ID: "Parent::Locked Deck::1",
    Subject: "Parent::Locked Deck",
    ChoiceA: "Alpha",
    ChoiceB: "Beta",
    Answer: "A",
  };
  const savedLockedSession = {
    active: true,
    currentIndex: 0,
    questions: [{ ...authorizedQuestion }],
    userAnswers: {},
    identificationRatings: {},
  };
  let lockedDeckFetchCount = 0;
  let lockedDeckPasswordPromptCount = 0;
  const resumeContext = {
    state: {
      prefs: {},
      db: [{ ...authorizedQuestion }],
      session: { active: false },
    },
    getStoredItem: () => JSON.stringify(savedLockedSession),
    isDeckHidden: () => false,
    isDeckLocked: () => true,
    openDeckPasswordModal() {
      lockedDeckPasswordPromptCount += 1;
    },
    async fetchDeckQuestions() {
      lockedDeckFetchCount += 1;
    },
    appLogger: { warn() {}, error() {} },
    prepareSessionPool: (questions) => questions,
    async navigate() {},
    document: {
      getElementById: () => ({ classList: { add() {}, remove() {} } }),
    },
    renderQuestion() {},
    async markQuizActivity() {},
    globalScope: { updateSessionNavigationUrl() {} },
  };
  vm.createContext(resumeContext);
  vm.runInContext(
    `let pendingResumeSession = null;
    let currentAppMode = "review";
    ${resumeSessionFunction[0]}
    globalThis.resumeSession = resumeSession;`,
    resumeContext,
  );
  assert.equal(
    await resumeContext.resumeSession(null, {
      allowResume: true,
      authorizedReviewQuestions: [authorizedQuestion],
    }),
    true,
    "Review-to-Quiz should resume the saved locked-deck quiz without a password",
  );
  assert.equal(lockedDeckPasswordPromptCount, 0);
  assert.equal(lockedDeckFetchCount, 0);

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

  assert.match(
    appSource,
    /async function resumeSession\(password = null, options = \{\}\)[\s\S]*?options\.allowResume !== true/,
    "explicit session URLs and mode switches should be able to restore the saved quiz",
  );
  assert.match(
    switchHandler,
    /resumeSession\(null,\s*\{\s*allowResume:\s*true,\s*authorizedReviewQuestions,?\s*\}\)/,
    "Study-to-Quiz should restore the saved quiz with its authorized deck questions",
  );
  assert.match(
    appSource,
    /getSessionNavigationFromUrl\?\.\(\)[\s\S]*?await resumeSession\(null,\s*\{\s*allowResume:\s*true\s*\}\)/,
    "refreshing a quiz URL should restore the active quiz session",
  );
  assert.match(
    appSource,
    /sessionRoute\.mode === "study"[\s\S]*?await reviewDeck\([\s\S]*?sessionRoute\.subject/,
    "refreshing a study URL should reopen that deck in Study Mode",
  );
  assert.match(
    appSource,
    /const shouldRestore = hasProgress\s*\?[\s\S]*?await requestConfirmation\([\s\S]*?"Restore Session"/,
    "refreshing during a session should ask before restoring it",
  );
  assert.match(
    appSource,
    /const hasProgress = hasSessionRestoreProgress\(sessionRoute\)[\s\S]*?const shouldRestore = hasProgress\s*\?/,
    "refresh confirmation should only be considered when that deck has progress",
  );
  assert.match(
    appSource,
    /const sessionDeckName =[\s\S]*?\.split\("::"\)[\s\S]*?\.at\(-1\)[\s\S]*?emphasis: sessionDeckName/,
    "the refresh confirmation should show only the final deck name segment",
  );

  const restoreProgressContext = {
    state: {
      prefs: {
        studyProgress: {
          "Parent 1::Deck A": {
            page: 1,
            index: 0,
            scrollY: 0,
          },
        },
      },
    },
    getStoredItem: () => null,
    appLogger: { error() {} },
  };
  vm.createContext(restoreProgressContext);
  vm.runInContext(
    `${restoreProgressFunction[0]}
globalThis.hasSessionRestoreProgress = hasSessionRestoreProgress;`,
    restoreProgressContext,
  );
  assert.equal(
    restoreProgressContext.hasSessionRestoreProgress({
      mode: "study",
      subject: "Parent 1::Deck A",
    }),
    false,
    "an initialized Study progress record without movement should not prompt",
  );
  restoreProgressContext.state.prefs.studyProgress[
    "Parent 1::Deck A"
  ].scrollY = 24;
  assert.equal(
    restoreProgressContext.hasSessionRestoreProgress({
      mode: "study",
      subject: "Parent 1::Deck A",
    }),
    true,
    "Study scroll progress should prompt to restore",
  );

  let savedQuiz = {
    active: true,
    currentIndex: 0,
    questions: [{ Subject: "Parent 1::Deck A" }],
    userAnswers: {},
    identificationRatings: {},
  };
  restoreProgressContext.getStoredItem = () => savedQuiz;
  assert.equal(
    restoreProgressContext.hasSessionRestoreProgress({
      mode: "quiz",
      subject: "Parent 1::Deck A",
    }),
    false,
    "a new quiz with no answers or advancement should not prompt",
  );
  savedQuiz = {
    ...savedQuiz,
    userAnswers: { 0: "B" },
  };
  assert.equal(
    restoreProgressContext.hasSessionRestoreProgress({
      mode: "quiz",
      subject: "Parent 1::Deck A",
    }),
    true,
    "saved quiz answers should prompt to restore",
  );
  assert.equal(
    restoreProgressContext.hasSessionRestoreProgress({
      mode: "quiz",
      subject: "Parent 2::Deck B",
    }),
    false,
    "progress for a different deck should not trigger this deck's prompt",
  );

  console.log("Practice/review switch checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});