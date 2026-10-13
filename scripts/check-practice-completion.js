const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createClassList() {
  const classes = new Set();
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
  };
}

function createModal() {
  const attributes = new Map();
  const inner = { classList: createClassList() };
  const button = { focus() {} };
  const modal = {
    classList: createClassList(),
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    getAttribute(name) {
      return attributes.get(name);
    },
    querySelector(selector) {
      if (selector === ":scope > div") return inner;
      if (selector === "button") return button;
      return null;
    },
  };
  return modal;
}

const completionMessage = { innerHTML: "" };
const completionModal = createModal();
const resumeContainer = { classList: createClassList() };
const elements = new Map([
  ["practice-completion-message", completionMessage],
  ["practice-completion-modal", completionModal],
  ["resume-container", resumeContainer],
]);
const scheduledTimeouts = new Map();
let nextTimeoutId = 0;
const stats = {
  totalAnswered: 17,
  correct: 11,
  mistakes: ["existing-mistake"],
  completedQs: ["existing-question"],
  subjectAccuracy: { Existing: { total: 17, correct: 11 } },
};
const session = {
  active: true,
  currentIndex: 6,
  questions: [
    { Answer: "A" },
    { Answer: "A" },
    { Answer: "A" },
    { Answer: "A" },
    { Answer: "A" },
    { Answer: "A" },
    { Answer: "A" },
  ],
  userAnswers: {
    0: "A",
    1: "A",
    2: "REVEALED",
    3: "REVEALED",
    4: "REVEALED",
    5: "REVEALED",
  },
  answerResults: {
    0: true,
    1: false,
    2: false,
    4: false,
    5: true,
  },
  identificationRatings: { 4: false, 5: true },
  identificationRatingPending: { 3: true },
  autoNextTimeout: null,
};

const context = {
  module: { exports: {} },
  console,
  Date,
  Math,
  Promise,
  JSON,
  state: { prefs: {}, stats, session },
  document: {
    getElementById(id) {
      return elements.get(id) || null;
    },
  },
  LifecycleUtils: {
    setTimeout(callback) {
      const id = ++nextTimeoutId;
      scheduledTimeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      scheduledTimeouts.delete(id);
    },
    registerCleanup() {},
  },
  DebugUtils: { warn() {}, error() {} },
  stopVisualTimer() {},
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync("session-core.js", "utf8"),
  context,
  { filename: "session-core.js" },
);

const statsBeforeCompletion = structuredClone(stats);
context.module.exports.nextQuestion();
const firstCompletionMessage = completionMessage.innerHTML;

assert.match(firstCompletionMessage, /Total questions answered<\/span><strong>5 \/ 7/);
assert.match(firstCompletionMessage, /Correct<\/span><strong>2/);
assert.match(firstCompletionMessage, /Wrong<\/span><strong>3/);
assert.match(firstCompletionMessage, /Accuracy<\/span><strong>40\.0%/);
assert.doesNotMatch(firstCompletionMessage, /correct answers divided by total questions answered/);
assert.doesNotMatch(firstCompletionMessage, /Skipped questions are not included/);
assert.deepEqual(stats, statsBeforeCompletion, "completion must not change recorded statistics");
assert.equal(session.active, false);

session.active = true;
context.module.exports.nextQuestion();
assert.equal(
  completionMessage.innerHTML,
  firstCompletionMessage,
  "repeated completion events must retain the original summary",
);
assert.deepEqual(stats, statsBeforeCompletion, "repeated completion must not duplicate scoring");

console.log("Practice completion summary checks passed.");
