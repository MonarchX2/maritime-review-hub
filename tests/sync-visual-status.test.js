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

const ids = ["sync-status", "database-connection-icon", "connection-status"];

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
const connectionStatusEl = elements["connection-status"];

globalThis.state.session.active = false;
globalThis.SyncCore.updateSyncStatus(
  '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Connecting to database...',
  "info",
  true,
);

assert.match(syncStatusEl.className, /bg-blue-50/);
assert.match(iconEl.className, /fa-spinner fa-spin/);
assert.match(connectionStatusEl.innerHTML, /Connecting to database/i);

globalThis.SyncCore.updateSyncStatus(
  '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Checking for database updates...',
  "info",
  false,
);

assert.strictEqual(
  connectionStatusEl.innerHTML,
  '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Connecting to database...',
  "background sync should not overwrite the visible connection-status toast",
);

globalThis.state.session.active = true;
globalThis.SyncCore.updateSyncStatus(
  '<i class="fa-solid fa-spinner fa-spin mr-1"></i> Database reconnecting...',
  "warning",
  true,
);

const dashboardFallback = makeElement("category-list");
globalThis.document.getElementById = (id) => {
  if (id === "category-list") return dashboardFallback;
  if (id in elements) return elements[id];
  return null;
};

globalThis.state = {
  session: { active: false },
  categorySummary: [],
  prefs: {},
  stats: {},
  db: [],
};
globalThis.renderCategoryProgress = () => {
  dashboardFallback.innerHTML =
    '<div class="dashboard-shell">Dashboard ready</div>';
};
globalThis.DB_URL = "https://example.test/data";
globalThis.fetch = async () => {
  throw new Error("simulated outage");
};
globalThis.setTimeout = () => 0;
globalThis.clearTimeout = () => {};
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.syncAbortController = null;
globalThis.syncRetryTimer = null;
globalThis.syncCountdownTimer = null;
globalThis.syncPollTimer = null;
globalThis.syncAttempt = 0;
globalThis.syncConnected = false;
globalThis.initialSyncSuccessShown = false;

(async () => {
  await globalThis.SyncCore.syncDatabase(false, false);
  assert.match(
    dashboardFallback.innerHTML,
    /Dashboard ready/i,
    "empty-data sync failure should keep the normal dashboard shell",
  );
  assert.doesNotMatch(
    dashboardFallback.innerHTML,
    /Database Connection Failed/i,
    "empty-data sync failure should not replace the dashboard with the failure state",
  );
  console.log("sync visual status tests passed");
})();
