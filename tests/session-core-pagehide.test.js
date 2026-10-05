const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

test("session cleanup flushes a pending debounced progress save", () => {
  const globals = [
    "state",
    "LifecycleUtils",
    "DebugUtils",
    "setStoredJSON",
    "saveState",
  ];
  const previous = new Map(
    globals.map((key) => [key, global[key]]),
  );
  const writes = [];
  global.state = {
    session: {
      active: true,
      questions: [{ Subject: "Deck" }],
      currentIndex: 0,
      userAnswers: {},
    },
    prefs: {},
    stats: {},
  };
  global.LifecycleUtils = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    registerCleanup() {},
  };
  global.DebugUtils = { warn() {}, error() {} };
  global.setStoredJSON = (key, value) => {
    writes.push([key, value]);
    return true;
  };
  global.saveState = () => Promise.resolve(true);

  try {
    const sessionCorePath = path.join(__dirname, "..", "session-core.js");
    delete require.cache[require.resolve(sessionCorePath)];
    const SessionCore = require(sessionCorePath);
    assert.equal(SessionCore.saveSessionProgress(), true);
    assert.equal(writes.length, 0, "debounced save has not fired yet");

    SessionCore.cleanup();

    assert.equal(
      writes.filter(([key]) => key === "saved_session").length,
      1,
      "cleanup flushes session progress synchronously",
    );
    assert.equal(global.state.session.active, true);
  } finally {
    globals.forEach((key) => {
      if (previous.get(key) === undefined) delete global[key];
      else global[key] = previous.get(key);
    });
  }
});
