const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createMemoryStorage() {
  const entries = new Map();
  return {
    getItem(key) {
      return entries.has(String(key)) ? entries.get(String(key)) : null;
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
    removeItem(key) {
      entries.delete(String(key));
    },
    key(index) {
      return Array.from(entries.keys())[index] ?? null;
    },
    get length() {
      return entries.size;
    },
  };
}

test("concurrent tabs merge independent preference and progress updates", async () => {
  const originalState = global.state;
  const originalLocalStorage = global.localStorage;
  const originalSessionStorage = global.sessionStorage;
  const originalConfig = global.MRH_CONFIG;
  const originalShowToast = global.showToast;
  const storage = createMemoryStorage();

  global.state = { prefs: { storageIdentity: "concurrency-test" } };
  global.localStorage = storage;
  global.sessionStorage = createMemoryStorage();
  global.MRH_CONFIG = {};
  global.showToast = () => {};

  try {
    const storageUtilsPath = path.join(__dirname, "..", "storage-utils.js");
    delete require.cache[require.resolve(storageUtilsPath)];
    const StorageUtils = require(storageUtilsPath);
    const source = fs.readFileSync(
      path.join(__dirname, "..", "app-core-state.js"),
      "utf8",
    );

    function createTab() {
      const sandbox = {
        StorageUtils,
        DebugUtils: { warn() {}, error() {} },
        LifecycleUtils: {
          setTimeout: global.setTimeout.bind(global),
          clearTimeout: global.clearTimeout.bind(global),
        },
        setTimeout: global.setTimeout.bind(global),
        clearTimeout: global.clearTimeout.bind(global),
        console,
      };
      vm.createContext(sandbox);
      vm.runInContext(source, sandbox);
      return sandbox.AppState;
    }

    const firstTab = createTab();
    const secondTab = createTab();
    firstTab.state.stats.totalAnswered += 1;
    firstTab.state.stats.correct += 1;
    firstTab.state.stats.completedQs.push("question-1");
    firstTab.state.stats.subjectAccuracy.Deck = { total: 1, correct: 1 };
    firstTab.state.prefs.darkMode = false;

    secondTab.state.stats.totalAnswered += 1;
    secondTab.state.stats.completedQs.push("question-2");
    secondTab.state.stats.subjectAccuracy.Deck = { total: 1, correct: 0 };
    secondTab.state.prefs.activeRecall = true;

    const saveResults = await Promise.all([
      firstTab.saveState("stats"),
      firstTab.saveState("prefs"),
      secondTab.saveState("stats"),
      secondTab.saveState("prefs"),
    ]);
    assert(saveResults.every(Boolean));

    const savedStats = StorageUtils.getStoredJSON("stats");
    const savedPrefs = StorageUtils.getStoredJSON("prefs");
    assert.equal(savedStats.totalAnswered, 2);
    assert.equal(savedStats.correct, 1);
    assert.deepEqual(
      [...savedStats.completedQs].sort(),
      ["question-1", "question-2"],
    );
    assert.deepEqual(savedStats.subjectAccuracy.Deck, {
      total: 2,
      correct: 1,
    });
    assert.equal(savedPrefs.darkMode, false);
    assert.equal(savedPrefs.activeRecall, true);
  } finally {
    global.state = originalState;
    global.localStorage = originalLocalStorage;
    global.sessionStorage = originalSessionStorage;
    global.MRH_CONFIG = originalConfig;
    global.showToast = originalShowToast;
  }
});
