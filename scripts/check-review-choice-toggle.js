const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createCard(id) {
  const choices = { innerHTML: "initial choices" };
  const button = { innerHTML: "initial label" };
  return {
    dataset: { questionId: id },
    choices,
    button,
    querySelector(selector) {
      if (selector === "[data-review-choices]") return choices;
      if (selector === "[data-review-choice-toggle]") return button;
      return null;
    },
  };
}

const firstCard = createCard("q1");
const secondCard = createCard("q2");
firstCard.expandedPanel = { open: true };
const cards = [firstCard, secondCard];
const container = {
  querySelectorAll(selector) {
    assert.equal(selector, ".review-question-card");
    return cards;
  },
};
const main = { scrollTop: 310 };

const context = {
  module: { exports: {} },
  console,
  state: {
    prefs: {
      showWrongChoices: true,
      qToggles: { q2: false },
      hideABCD: false,
    },
  },
  LifecycleUtils: { registerCleanup() {} },
  document: {
    getElementById(id) {
      return id === "deck-review-list" ? container : null;
    },
    querySelector(selector) {
      return selector === "main" ? main : null;
    },
  },
  getQuestionTypeMode() {
    return { isIdent: false };
  },
  escapeHTML(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  },
};

context.state.prefs.qToggles = { q2: false };
context.DeckReviewQuestions = [
  {
    ID: "q1",
    Answer: "A",
    ChoiceA: "Correct <answer>",
    ChoiceB: "Distractor",
  },
  { ID: "q2", Answer: "B", ChoiceA: "Other", ChoiceB: "Correct" },
];

vm.createContext(context);
vm.runInContext(
  `globalThis.state = state;
globalThis.getQuestionTypeMode = getQuestionTypeMode;
globalThis.escapeHTML = escapeHTML;
${fs.readFileSync("deck-review-core.js", "utf8")}`,
  context,
  { filename: "deck-review-core.js" },
);

const reviewCore = context.module.exports;
main.scrollTop = 310;

assert.equal(
  reviewCore.updateQuestionChoices("q1", context.DeckReviewQuestions),
  true,
);
assert.match(firstCard.choices.innerHTML, /Correct &lt;answer&gt;/);
assert.match(firstCard.choices.innerHTML, /Distractor/);
assert.match(firstCard.button.innerHTML, /Hide Choices/);
assert.equal(secondCard.choices.innerHTML, "initial choices");
assert.equal(main.scrollTop, 310);
assert.equal(cards[0], firstCard);
assert.equal(cards[1], secondCard);
assert.equal(firstCard.expandedPanel.open, true);

assert.equal(
  reviewCore.updateQuestionChoices(null, context.DeckReviewQuestions),
  true,
);
assert.match(firstCard.choices.innerHTML, /Distractor/);
assert.match(secondCard.choices.innerHTML, /Correct/);
assert.doesNotMatch(secondCard.choices.innerHTML, /Other/);
assert.match(secondCard.button.innerHTML, /Show Choices/);
assert.equal(main.scrollTop, 310);

context.state.prefs.showWrongChoices = false;
reviewCore.updateQuestionChoices(null, context.DeckReviewQuestions);
assert.doesNotMatch(firstCard.choices.innerHTML, /Distractor/);
assert.match(firstCard.choices.innerHTML, /Correct &lt;answer&gt;/);
assert.match(secondCard.choices.innerHTML, /Correct/);

context.state.prefs.hideABCD = true;
reviewCore.updateQuestionChoices(null, context.DeckReviewQuestions);
assert.doesNotMatch(firstCard.choices.innerHTML, /A\./);
assert.doesNotMatch(secondCard.choices.innerHTML, /B\./);
assert.equal(main.scrollTop, 310);

console.log("Review choice toggle checks passed.");
