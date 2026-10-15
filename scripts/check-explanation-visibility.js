const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createClassList(initial = []) {
  const classes = new Set(initial);
  return {
    add(...names) {
      names.forEach((name) => classes.add(name));
    },
    remove(...names) {
      names.forEach((name) => classes.delete(name));
    },
    toggle(name, force) {
      if (force === undefined) force = !classes.has(name);
      if (force) classes.add(name);
      else classes.delete(name);
      return force;
    },
    contains(name) {
      return classes.has(name);
    },
  };
}

const explanationBox = { classList: createClassList(["hidden"]) };
const explanationText = { textContent: "", innerHTML: "" };
const quizToggle = { checked: false };
const studyToggle = { checked: false };
const practiceView = { classList: createClassList(["active"]) };
const reviewView = { classList: createClassList() };
const elements = new Map([
  ["q-explanation-box", explanationBox],
  ["q-explanation-text", explanationText],
  ["toggle-quiz-show-explanations", quizToggle],
  ["toggle-study-show-explanations", studyToggle],
  ["view-practice", practiceView],
  ["view-deck-review", reviewView],
]);
let saveCount = 0;
let renderCount = 0;
let reviewRenderCount = 0;
let warningToastCount = 0;
let reviewSubject = "Deck A";

const context = {
  module: { exports: {} },
  console,
  state: {
    prefs: {
      quizShowExplanations: true,
      studyShowExplanations: true,
    },
    session: {
      active: true,
      questions: [{ Subject: "Deck A" }],
      currentIndex: 0,
    },
  },
  getCurrentReviewSubject() {
    return reviewSubject;
  },
  getDeckSessionSetting(mode, key, subject) {
    const deck =
      subject ||
      (context.state.session.active
        ? context.state.session.questions[context.state.session.currentIndex]
            ?.Subject
        : reviewSubject);
    return (
      context.state.prefs.deckSessionSettings?.[deck]?.[mode]?.[key] ??
      context.state.prefs[key]
    );
  },
  getDeckSessionSettings(mode, subject) {
    const deck =
      subject ||
      (context.state.session.active
        ? context.state.session.questions[context.state.session.currentIndex]
            ?.Subject
        : reviewSubject);
    return context.state.prefs.deckSessionSettings?.[deck]?.[mode] || {};
  },
  setDeckSessionSetting(mode, key, value, subject) {
    const deck =
      subject ||
      (context.state.session.active
        ? context.state.session.questions[context.state.session.currentIndex]
            ?.Subject
        : reviewSubject);
    if (!deck) return false;
    context.state.prefs.deckSessionSettings ??= {};
    context.state.prefs.deckSessionSettings[deck] ??= {};
    context.state.prefs.deckSessionSettings[deck][mode] ??= {};
    context.state.prefs.deckSessionSettings[deck][mode][key] = value;
    return true;
  },
  document: {
    getElementById(id) {
      return elements.get(id) || null;
    },
  },
  formatQuestionText(value) {
    return `formatted:${value}`;
  },
  saveState() {
    saveCount += 1;
  },
  showToast(message, type) {
    if (type === "warning") warningToastCount += 1;
  },
  reRenderDeckReview() {
    reviewRenderCount += 1;
  },
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync("session-core.js", "utf8"),
  context,
  { filename: "session-core.js" },
);
vm.runInContext(
  fs.readFileSync("quiz-rendering-core.js", "utf8"),
  context,
  { filename: "quiz-rendering-core.js" },
);
context.SessionCore.renderQuestion = () => {
  renderCount += 1;
  context.SessionCore.showExplanation({ Explanation: "Visible explanation" });
};

context.module.exports.showExplanation({ Explanation: "Visible explanation" });
assert.equal(explanationBox.classList.contains("hidden"), false);
assert.equal(explanationText.innerHTML, "formatted:Visible explanation");

context.QuizRenderingCore.toggleQuizShowExplanations(quizToggle);
assert.equal(
  context.state.prefs.deckSessionSettings["Deck A"].quiz
    .quizShowExplanations,
  false,
);
assert.equal(context.state.prefs.quizShowExplanations, true);
assert.equal(context.state.prefs.studyShowExplanations, true);
assert.equal(explanationBox.classList.contains("hidden"), true);
assert.equal(explanationText.textContent, "");
assert.equal(renderCount, 1);
assert.equal(saveCount, 1);

context.module.exports.showExplanation({ Explanation: "Hidden explanation" });
assert.equal(explanationBox.classList.contains("hidden"), true);
assert.equal(explanationText.textContent, "");

context.module.exports.showExplanation({ Explanation: "" });
assert.equal(explanationBox.classList.contains("hidden"), true);
assert.equal(explanationText.textContent, "");

practiceView.classList.remove("active");
reviewView.classList.add("active");
context.state.session.active = false;
studyToggle.checked = false;
context.QuizRenderingCore.toggleStudyShowExplanations(studyToggle);
assert.equal(
  context.state.prefs.deckSessionSettings["Deck A"].study
    .studyShowExplanations,
  false,
);
assert.equal(context.state.prefs.studyShowExplanations, true);
assert.equal(context.state.prefs.quizShowExplanations, true);
assert.equal(
  context.getDeckSessionSetting("study", "studyShowExplanations", "Deck B"),
  true,
  "Study explanation visibility overrides must remain isolated by deck",
);
assert.equal(reviewRenderCount, 1);
assert.equal(renderCount, 1);
assert.equal(saveCount, 2);

reviewSubject = "";
const saveCountBeforeMissingDeck = saveCount;
quizToggle.checked = true;
assert.equal(
  context.QuizRenderingCore.toggleQuizShowExplanations(quizToggle),
  false,
  "session settings should not be saved without an active deck",
);
assert.equal(context.state.prefs.quizShowExplanations, true);
assert.equal(saveCount, saveCountBeforeMissingDeck);
assert.equal(warningToastCount, 1);

const html = fs.readFileSync("index.html", "utf8");
assert.equal((html.match(/id="toggle-quiz-show-explanations"/g) || []).length, 1);
assert.equal((html.match(/id="toggle-study-show-explanations"/g) || []).length, 1);
assert.equal(
  (html.match(/Note: Explanations are shown only where applicable\. Not all questions have explanations\./g) || []).length,
  2,
);

console.log("Explanation visibility checks passed.");
