const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const savedValues = new Map();
let nextTimeoutId = 0;
const context = {
  module: { exports: {} },
  console,
  Date,
  Math,
  Promise,
  JSON,
  state: {
    prefs: {},
    stats: { totalAnswered: 3, correct: 2 },
    session: {
      active: true,
      currentIndex: 1,
      questions: [{ Subject: "Deck A" }, { Subject: "Deck B" }],
      userAnswers: { 0: "A", 1: "C" },
      answerResults: { 0: true, 1: false },
      identificationRatings: {},
    },
  },
  document: { getElementById() { return null; } },
  LifecycleUtils: {
    setTimeout() {
      nextTimeoutId += 1;
      return nextTimeoutId;
    },
    clearTimeout() {},
    registerCleanup() {},
  },
  setStoredJSON(key, value) {
    savedValues.set(key, JSON.parse(JSON.stringify(value)));
    return true;
  },
  stopVisualTimer() {},
  DebugUtils: { warn() {}, error() {} },
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync("session-core.js", "utf8"),
  context,
  { filename: "session-core.js" },
);

const originalStats = JSON.stringify(context.state.stats);
const originalAnswers = JSON.stringify(context.state.session.userAnswers);
const suspension =
  context.module.exports.suspendSessionForModeSwitch();

assert.ok(suspension, "active quiz session should suspend after persistence");
assert.equal(context.state.session.active, false);
assert.equal(savedValues.get("saved_session").active, true);
assert.equal(savedValues.get("saved_session").currentIndex, 1);
assert.deepEqual(savedValues.get("saved_session").userAnswers, { 0: "A", 1: "C" });
assert.deepEqual(savedValues.get("saved_session").answerResults, { 0: true, 1: false });
assert.equal(context.state.prefs.lastActivity.mode, "quiz");
assert.equal(JSON.stringify(context.state.stats), originalStats);
assert.equal(JSON.stringify(context.state.session.userAnswers), originalAnswers);

console.log("Practice session suspension checks passed.");
