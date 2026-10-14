const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const timers = [];
const views = new Map();
const deckNavSource = fs.readFileSync("deck-nav-core.js", "utf8");
const appCoreSource = fs.readFileSync("app-core.js", "utf8");

assert.match(
  deckNavSource,
  /temporary issue with our servers or services, so this session couldn't start\. Please check your internet connection and try again later\./,
  "deck-start failures should explain the temporary service issue and recovery",
);
assert.match(
  deckNavSource,
  /"error",\s*8000/,
  "the deck-start failure notice should remain visible long enough to read",
);
assert.match(
  appCoreSource,
  /temporary issue with our servers or services, so this deck couldn't start\. Please check your internet connection and try again later\./,
  "the outer deck-start failure notice should use the same guidance",
);
assert.match(
  appCoreSource,
  /if \(!pathValid && isInitialSyncComplete\) \{\s*showDeckNotFound\(state\.currentPath\);/,
  "missing deep links should show a not-found message after the first category summary loads",
);
const deckEntryLockFunction = appCoreSource.match(
  /  function setDeckEntryInteractionsLocked\(isLocked\) \{[\s\S]*?\n  \}/,
)?.[0];
assert.ok(deckEntryLockFunction, "deck entry should have a global interaction lock");
const entryLockElements = ["header", "main"].map(() => {
  const attributes = new Map();
  return {
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    attributes,
  };
});
entryLockElements[0].setAttribute("aria-busy", "false");
entryLockElements[1].setAttribute("inert", "");
const entryLockContext = {
  document: {
    querySelectorAll: (selector) => {
      assert.equal(selector, "body");
      return entryLockElements;
    },
  },
};
vm.createContext(entryLockContext);
vm.runInContext(
  `let deckEntryInteractionSnapshots = null;
  ${deckEntryLockFunction}
  globalThis.setDeckEntryInteractionsLocked = setDeckEntryInteractionsLocked;`,
  entryLockContext,
);
entryLockContext.setDeckEntryInteractionsLocked(true);
entryLockContext.setDeckEntryInteractionsLocked(true);
assert.equal(entryLockElements[0].hasAttribute("inert"), true);
assert.equal(entryLockElements[1].hasAttribute("aria-busy"), true);
entryLockContext.setDeckEntryInteractionsLocked(false);
assert.equal(entryLockElements[0].hasAttribute("inert"), false);
assert.equal(entryLockElements[0].getAttribute("aria-busy"), "false");
assert.equal(entryLockElements[1].hasAttribute("inert"), true);
assert.equal(entryLockElements[1].hasAttribute("aria-busy"), false);

const pathValidation = appCoreSource.match(
  /if \(!Array\.isArray\(state\.currentPath\)\) state\.currentPath = \[\];[\s\S]*?if \(!pathValid && isInitialSyncComplete\) \{[\s\S]*?\n      \} else if \(pathValid\) \{[\s\S]*?\n      \}/,
);
assert.ok(pathValidation, "category path validation should be available");
const validateCategoryPath = vm.runInNewContext(
  `function validateCategoryPath(state, tree, isInitialSyncComplete, globalScope, showDeckNotFound, dismissDeckNotFound) {
    ${pathValidation[0]}
    return state.currentPath;
  }
  validateCategoryPath;`,
);
const deepPath = ["BSMT Competencies", "Function 2"];
const persistedPaths = [];
const notFoundPaths = [];
assert.deepEqual(
  Array.from(
    validateCategoryPath(
      { currentPath: [...deepPath] },
      {},
      false,
      { persistNavigationPath: (path) => persistedPaths.push(path) },
      (path) => notFoundPaths.push(Array.from(path)),
      () => {},
    ),
  ),
  deepPath,
  "a valid deep link should survive while the first category summary is loading",
);
assert.deepEqual(
  Array.from(
    validateCategoryPath(
      { currentPath: [...deepPath] },
      {},
      true,
      { persistNavigationPath: (path) => persistedPaths.push(path) },
      (path) => notFoundPaths.push(Array.from(path)),
      () => {},
    ),
  ),
  [],
  "an invalid deep link should still be cleared after the initial summary loads",
);
assert.deepEqual(
  notFoundPaths,
  [deepPath],
  "the not-found message should identify the invalid deck path",
);

function createView(id, active = false) {
  const classes = new Set(["view-section"]);
  if (active) classes.add("active");
  return {
    id: `view-${id}`,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    },
    setAttribute() {},
    removeAttribute() {},
    isActive: () => classes.has("active"),
  };
}

for (const [id, active] of [
  ["dashboard", true],
  ["practice", false],
  ["settings", false],
]) {
  views.set(`view-${id}`, createView(id, active));
}

const context = {
  module: { exports: {} },
  state: { session: { active: false }, currentPath: [] },
  LifecycleUtils: {
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  },
  document: {
    head: { appendChild() {} },
    createElement: () => ({ textContent: "" }),
    getElementById: (id) => views.get(id) || null,
    querySelector: (selector) =>
      selector === ".view-section.active"
        ? [...views.values()].find((view) => view.isActive()) || null
        : null,
  },
  updateDashboard() {},
};
context.globalScope = context;
vm.createContext(context);
vm.runInContext(
  deckNavSource,
  context,
  { filename: "deck-nav-core.js" },
);

async function checkConcurrentNavigation() {
  const firstNavigation = context.module.exports.navigate("practice");
  const secondNavigation = context.module.exports.navigate("settings");

  async function waitForTimerCount(count) {
    for (let attempt = 0; attempt < 10 && timers.length < count; attempt += 1) {
      await Promise.resolve();
    }
    assert.equal(timers.length, count);
  }

  await waitForTimerCount(1);
  assert.equal(timers.length, 1, "the first view transition should start alone");
  timers.shift()();
  await waitForTimerCount(1);
  timers.shift()();
  await Promise.all([firstNavigation, secondNavigation]);

  const activeViews = [...views.values()].filter((view) => view.isActive());
  assert.deepEqual(
    activeViews.map((view) => view.id),
    ["view-settings"],
    "rapid navigation must leave only the last requested view active",
  );
}

checkConcurrentNavigation()
  .then(() => console.log("Deck navigation concurrency checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
