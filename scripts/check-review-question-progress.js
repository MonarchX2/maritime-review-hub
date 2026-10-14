const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const text = { textContent: "" };
const bar = { style: {} };
const track = { setAttribute(name, value) { this[name] = value; } };
const main = {
  scrollTop: 240,
  scrollHeight: 400,
  clientHeight: 400,
  style: { scrollBehavior: "smooth" },
  getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
};
const documentScroller = {
  scrollTop: 240,
  scrollHeight: 1200,
  clientHeight: 400,
  style: { scrollBehavior: "smooth" },
};
const cards = [
  {
    dataset: { questionId: "q1", reviewIndex: "0" },
    getBoundingClientRect: () => ({ top: -300, bottom: 50 }),
  },
  {
    dataset: { questionId: "q2", reviewIndex: "0" },
    getBoundingClientRect: () => ({ top: 80, bottom: 350 }),
  },
];
const container = { querySelectorAll: () => cards };
const questions = [{ ID: "q1" }, { ID: "q2" }, { ID: "q3" }];
function setRenderedPageCards(page, layout, index) {
  cards.splice(0, cards.length);
  if (layout === "single") {
    const question = questions[index];
    cards.push({
      dataset: { questionId: question.ID, reviewIndex: String(index) },
      getBoundingClientRect: () => ({ top: 120, bottom: 390 }),
    });
    return;
  }
  if (page > 1) {
    cards.push({
      dataset: { questionId: "q3", reviewIndex: "2" },
      getBoundingClientRect: () => ({ top: 120, bottom: 390 }),
    });
    return;
  }
  cards.push(
    {
      dataset: { questionId: "q1", reviewIndex: "0" },
      getBoundingClientRect: () => ({ top: -300, bottom: 50 }),
    },
    {
      dataset: { questionId: "q2", reviewIndex: "1" },
      getBoundingClientRect: () => ({ top: 80, bottom: 350 }),
    },
  );
}
const progress = { page: 1, index: 0, scrollY: 0 };
const animationFrameCallbacks = [];
let savedProgress;
let navigatedTo;
let saveCount = 0;
let confirmationResult = true;
const context = {
  module: { exports: {} },
  state: {
    prefs: {
      studyLayout: "scroll",
      studyPageSize: 2,
      studyProgress: { Deck: progress },
    },
  },
  LifecycleUtils: { registerCleanup() {}, clearTimeout() {} },
  window: { innerHeight: 500, scrollSaveTimeout: null },
  clearTimeout() {},
  requestAnimationFrame(callback) {
    animationFrameCallbacks.push(callback);
    return animationFrameCallbacks.length;
  },
  flushAnimationFrames() {
    while (animationFrameCallbacks.length) {
      animationFrameCallbacks.shift()();
    }
  },
  saveState() {
    saveCount += 1;
    savedProgress = JSON.parse(JSON.stringify(progress));
    return Promise.resolve(true);
  },
  requestConfirmation: () => Promise.resolve(confirmationResult),
  navigate: (viewId) => {
    if (viewId !== "deck-review") navigatedTo = viewId;
    return true;
  },
  document: {
    scrollingElement: documentScroller,
    getElementById(id) {
      return {
        "study-progress-text": text,
        "study-progress": bar,
        "study-progress-track": track,
        "deck-review-cards": container,
      }[id] || null;
    },
    querySelector(selector) {
      return selector === "main" ? main : null;
    },
  },
  questions,
  main,
  container,
  setRenderedPageCards,
};

const marker = "  // ===================== MODULE EXPORT =====================";
const source = fs.readFileSync("deck-review-core.js", "utf8");
assert.ok(source.includes(marker));
const setup = `  currentReviewSubject = "Deck";\n  currentReviewQuestions = questions;\n  reviewMainElement = main;\n  reviewContainerElement = container;\n  derivedQuestionsCache = { questions, sortedQuestions: questions };\n  globalScope.setSortedQuestions = (sortedQuestions) => {\n    derivedQuestionsCache.sortedQuestions = sortedQuestions;\n  };\n  renderDeckReview = function () {
  const progress = state.prefs.studyProgress[currentReviewSubject];
  globalScope.setRenderedPageCards(
    progress.page,
    state.prefs.studyLayout,
    progress.index,
  );
  const navigation = navigate("deck-review");
  const requestedScrollPosition = pendingReviewScrollPosition;
  pendingReviewScrollPosition = null;
  if (requestedScrollPosition) {
    const restoreScrollPosition = () => {
      const scrollContainer = scrollReviewContent(
        requestedScrollPosition,
      );
      if (scrollContainer) progress.scrollY = scrollContainer.scrollTop;
      updateStudyProgressIndicator();
      saveState("prefs");
    };
    if (navigation && typeof navigation.then === "function") {
      navigation.then(restoreScrollPosition);
    } else {
      restoreScrollPosition();
    }
  }
};\n${marker}`;
vm.createContext(context);
vm.runInContext(source.replace(marker, setup), context, {
  filename: "deck-review-core.js",
});

const reviewCore = context.module.exports;
reviewCore.updateStudyProgressIndicator();
assert.equal(progress.questionId, "q2");
assert.equal(progress.index, 1, "the stable ID, not a stale DOM index, sets progress");
assert.equal(progress.questionScrollOffsets.q2, -20);
assert.equal(text.textContent, "Questions 1 - 2 / 3");
assert.equal(Math.round(parseFloat(bar.style.width)), 67);
assert.doesNotMatch(text.textContent, /at\s+\d+/i);

cards[1].getBoundingClientRect = () => ({ top: 130, bottom: 400 });
reviewCore.updateStudyProgressIndicator();
assert.equal(
  progress.questionScrollOffsets.q2,
  30,
  "content-height changes update the offset for the same stable question ID",
);
cards[1].getBoundingClientRect = () => ({ top: 80, bottom: 350 });
reviewCore.updateStudyProgressIndicator();

reviewCore.changeStudyPage(1);
assert.equal(progress.page, 2);
assert.equal(progress.index, 2);
assert.equal(progress.questionId, "q3");
assert.equal(progress.questionScrollOffsets.q2, -20);
context.flushAnimationFrames();
assert.equal(documentScroller.scrollTop, 0, "Next returns the document to the top");

reviewCore.changeStudyPage(-1);
assert.equal(progress.page, 1);
assert.equal(progress.index, 0);
assert.equal(progress.questionId, "q1");
assert.equal(progress.questionScrollOffsets.q2, -20);
assert.equal(animationFrameCallbacks.length, 1, "Previous schedules only the review render");
animationFrameCallbacks.shift()();
assert.equal(
  documentScroller.scrollTop,
  800,
  "Previous restores the bottom during the render instead of waiting for another scroll frame",
);
assert.equal(animationFrameCallbacks.length, 0);
assert.equal(documentScroller.scrollTop, 800, "Previous returns the document to the bottom");
assert.equal(progress.scrollY, 800, "Previous saves its final bottom position");

documentScroller.scrollTop = 640;
reviewCore.jumpToStudyPage(2);
context.flushAnimationFrames();
assert.equal(documentScroller.scrollTop, 0, "a direct page jump returns the document to the top");
assert.equal(progress.questionId, "q3");

progress.page = 1;
setRenderedPageCards(1);
context.state.prefs.studyLayout = "single";
progress.questionId = "q2";
setRenderedPageCards(1, "single", 1);
reviewCore.updateStudyProgressIndicator();
assert.equal(progress.index, 1);
assert.equal(text.textContent, "Question 2 / 3");

reviewCore.changeStudyIndex(1);
assert.equal(progress.questionId, "q3");
context.flushAnimationFrames();
const singleCardScrollPosition = documentScroller.scrollTop;
reviewCore.changeStudyIndex(-1);
assert.equal(progress.questionId, "q2");
context.flushAnimationFrames();
assert.equal(documentScroller.scrollTop, singleCardScrollPosition);

context.state.prefs.studyLayout = "scroll";
setRenderedPageCards(1, "scroll", 0);
questions.splice(0, questions.length, questions[1], questions[0], questions[2]);
cards[0].dataset.questionId = "q2";
cards[0].getBoundingClientRect = () => ({ top: 80, bottom: 350 });
cards[1].dataset.questionId = "q1";
cards[1].getBoundingClientRect = () => ({ top: 360, bottom: 630 });
progress.questionId = "q2";
context.state.prefs.studyLayout = "scroll";
context.state.prefs.studyPageSize = "All";
reviewCore.updateStudyProgressIndicator();
assert.equal(progress.index, 0, "reordering keeps progress attached to its question ID");
assert.equal(progress.questionId, "q2");
assert.equal(text.textContent, "Questions 1 / 3");
assert.equal(Math.round(parseFloat(bar.style.width)), 33);

context.state.prefs.studyLayout = "single";
context.setSortedQuestions([questions[0]]);
progress.index = 0;
progress.questionId = "q2";
reviewCore.changeStudyIndex(1);
assert.equal(progress.index, 0, "navigation is bounded by the filtered question list");
assert.equal(progress.questionId, "q2");

(async () => {
  context.setSortedQuestions(questions);
  context.state.prefs.studyLayout = "scroll";
  progress.questionId = "";
  progress.index = 0;
  main.scrollTop = 420;
  confirmationResult = false;
  const previousSaveCount = saveCount;
  const canceled = await reviewCore.returnFromStudyMode();
  assert.equal(canceled, false);
  assert.equal(navigatedTo, undefined, "cancel must keep the user in Study Mode");
  assert.equal(saveCount, previousSaveCount, "cancel must not persist an exit");

  confirmationResult = true;
  const returned = await reviewCore.returnFromStudyMode();
  assert.equal(returned, true);
  assert.equal(navigatedTo, "dashboard");
  assert.equal(progress.questionId, "q2");
  assert.equal(progress.index, 0);
  assert.equal(savedProgress.questionId, "q2");
  assert.equal(savedProgress.index, 0);
  assert.equal(savedProgress.scrollY, 420);

  console.log("Review question progress checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
