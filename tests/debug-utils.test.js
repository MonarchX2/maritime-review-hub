const assert = require("assert");
const { createDebugLogger } = require("../debug-utils.js");

const logger = createDebugLogger("mrh-test");
const state = {
  db: [{ Subject: "Navigation::Basic", ID: "N-1" }],
  stats: { totalAnswered: 1, correct: 1 },
  prefs: { darkMode: true, discoverySearch: "nav" },
  session: { active: false },
};

const snapshot = logger.snapshot("debug-check", { state });
assert.strictEqual(snapshot.label, "debug-check");
assert.strictEqual(snapshot.dbCount, 1);
assert.strictEqual(snapshot.sessionActive, false);
assert.strictEqual(snapshot.searchQuery, "nav");
assert.strictEqual(snapshot.summaryCount, 0);

console.log("debug utility tests passed");
