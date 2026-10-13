const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const timers = [];
const views = new Map();

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
  fs.readFileSync("deck-nav-core.js", "utf8"),
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
