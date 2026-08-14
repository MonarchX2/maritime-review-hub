const assert = require("assert");

const makeElement = (id) => {
  const classes = new Set();
  return {
    id,
    innerHTML: "",
    title: "",
    dataset: {},
    className: "",
    classList: {
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      add: (...names) => names.forEach((name) => classes.add(name)),
      toggle: (name, force) => {
        if (force === undefined) {
          if (classes.has(name)) {
            classes.delete(name);
            return false;
          }
          classes.add(name);
          return true;
        }
        if (force) {
          classes.add(name);
          return true;
        }
        classes.delete(name);
        return false;
      },
      contains: (name) => classes.has(name),
    },
    setAttribute: () => {},
    getAttribute: () => null,
  };
};

const ids = [
  "sync-status",
  "database-connection-icon",
  "connection-status",
  "app-loading-overlay",
  "app-loading-title",
  "app-loading-detail",
  "app-loading-icon",
];

const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id)]));

globalThis.window = globalThis;
globalThis.document = {
  getElementById: (id) => elements[id] || null,
};
globalThis.state = { session: { active: false }, prefs: {} };
globalThis.syncStatusHideTimer = null;

eval(require("fs").readFileSync("./sync-core.js", "utf8"));

assert.ok(globalThis.SyncCore, "SyncCore should be registered");
assert.strictEqual(
  globalThis.SyncCore.getSyncStatusVisualState("warning").title,
  "Database reconnecting",
);
assert.strictEqual("telemetryEnabled" in globalThis.state.prefs, false);

const syncStatusEl = elements["sync-status"];
const iconEl = elements["database-connection-icon"];
const overlayEl = elements["app-loading-overlay"];

globalThis.state.session.active = false;
globalThis.SyncCore.updateSyncStatus(
  '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Connecting to database...',
  "info",
  true,
);

assert.match(syncStatusEl.className, /bg-blue-50/);
assert.match(iconEl.className, /fa-spinner fa-spin/);
assert.strictEqual(overlayEl.classList.contains("hidden"), false);

globalThis.state.session.active = true;
globalThis.SyncCore.updateSyncStatus(
  '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Database reconnecting...',
  "warning",
  true,
);
assert.strictEqual(overlayEl.classList.contains("hidden"), true);

console.log("sync visual status tests passed");
