const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const qrContext = {
  module: { exports: {} },
  console,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  Map,
  Date,
  Math,
  btoa,
  atob,
};
qrContext.window = qrContext;
vm.createContext(qrContext);
vm.runInContext(
  fs.readFileSync("qr-transfer-core.js", "utf8"),
  qrContext,
  { filename: "qr-transfer-core.js" },
);
const qr = qrContext.module.exports.internals;

const text = JSON.stringify({
  label: "Maritime progress transfer 🚢",
  answerHistory: "saved-answer-".repeat(2600),
});
const frames = qr.createFrames(text, "transfer01");
assert.ok(frames.length > 1, "large payloads should be split across QR frames");

let frameSet = null;
for (const frame of [...frames].reverse()) {
  const result = qr.acceptFrame(frameSet, frame);
  frameSet = result.frameSet;
}
const completed = qr.acceptFrame(frameSet, frames[0]);
assert.equal(completed.complete, true);
assert.equal(completed.text, text);

assert.throws(
  () => qr.acceptFrame(null, frames[0].replace("MRH1|", "OTHER|")),
  /not a Maritime Review Hub transfer QR/,
);
const tampered = frames.map((frame) => frame);
tampered[0] = `${tampered[0].slice(0, -1)}${tampered[0].endsWith("A") ? "B" : "A"}`;
let tamperedSet = null;
assert.throws(
  () => {
    for (const frame of tampered) {
      const result = qr.acceptFrame(tamperedSet, frame);
      tamperedSet = result.frameSet;
    }
  },
  /integrity check/,
);

const transfer = {
  format: "mrh-progress-transfer",
  version: 1,
  stats: {
    totalAnswered: 8,
    correct: 6,
    mistakes: [],
    completedQs: ["Q1"],
    subjectAccuracy: {},
    srsMap: {},
  },
  progress: {
    studyProgress: { "Source deck": { page: 2, index: 3, scrollY: 45 } },
    qToggles: { Q1: false },
    lastActivity: { mode: "review", subject: "Source deck" },
  },
  settings: { darkMode: true },
  savedSession: null,
};
assert.equal(qr.validateTransfer(transfer), transfer);
assert.throws(
  () => qr.validateTransfer({ ...transfer, stats: [] }),
  /valid progress data/,
);
assert.throws(
  () =>
    qr.validateTransfer({
      ...transfer,
      stats: { ...transfer.stats, correct: 9 },
    }),
  /valid progress data/,
);
assert.throws(
  () =>
    qr.validateTransfer({
      ...transfer,
      progress: { ...transfer.progress, qToggles: { Q1: "false" } },
    }),
  /valid progress data/,
);

qrContext.state = {
  stats: transfer.stats,
  prefs: {
    darkMode: false,
    layoutMode: "grid",
    studyProgress: transfer.progress.studyProgress,
    qToggles: transfer.progress.qToggles,
    lastActivity: transfer.progress.lastActivity,
    localDownloadDeletedDecks: ["Device only"],
  },
  session: { active: false },
};
qrContext.AppState = { getStoredJSON: () => null };
const exportedTransfer = JSON.parse(qr.createTransferData());
assert.deepEqual(exportedTransfer.progress.studyProgress, {
  "Source deck": { page: 2, index: 3, scrollY: 45 },
});
assert.deepEqual(exportedTransfer.progress.qToggles, { Q1: false });
assert.equal(exportedTransfer.progress.lastActivity.subject, "Source deck");
assert.equal(Object.hasOwn(exportedTransfer.settings, "studyProgress"), false);
assert.equal(Object.hasOwn(exportedTransfer.settings, "qToggles"), false);
assert.equal(
  Object.hasOwn(exportedTransfer.settings, "localDownloadDeletedDecks"),
  false,
);
qrContext.state.session.active = true;
assert.throws(
  () => qr.createTransferData(),
  /active session cannot be saved/,
);
qrContext.saveSessionProgress = () => true;
const savedActiveSession = {
  active: true,
  questions: [{ Subject: "Deck", ID: "1" }],
  currentIndex: 0,
  userAnswers: {},
  autoNextTimeout: 4321,
};
qrContext.AppState.getStoredJSON = () => savedActiveSession;
const activeExport = JSON.parse(qr.createTransferData());
assert.equal(activeExport.savedSession.autoNextTimeout, null);
qrContext.state.session.active = false;

const stateContext = {
  module: { exports: {} },
  console,
  TextEncoder,
  TextDecoder,
  Uint8Array,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  requestIdleCallback(callback) {
    setTimeout(callback, 0);
  },
  MRH_CONFIG: { storageMaxJsonPayloadBytes: 250000 },
  DebugUtils: {
    warn() {},
    error() {},
  },
};
vm.createContext(stateContext);
vm.runInContext(
  fs.readFileSync("storage-utils.js", "utf8"),
  stateContext,
  { filename: "storage-utils.js" },
);
stateContext.module = { exports: {} };
vm.runInContext(
  fs.readFileSync("app-core-state.js", "utf8"),
  stateContext,
  { filename: "app-core-state.js" },
);
const appState = stateContext.module.exports;

async function checkStateImport() {
  const state = appState.state;
  state.prefs.darkMode = false;
  state.prefs.lastActivity = { mode: "review", subject: "Local deck" };
  state.prefs.studyProgress = { "Local deck": { page: 9, index: 2, scrollY: 0 } };
  state.prefs.qToggles = { Q1: true };
  state.prefs.localDownloadDeletedDecks = ["Local only"];
  await appState.importTransferredState(transfer, false);
  assert.equal(state.stats.totalAnswered, 8);
  assert.equal(state.prefs.darkMode, false, "progress-only import keeps local settings");
  assert.equal(state.prefs.studyProgress["Source deck"].page, 2);
  assert.equal(state.prefs.qToggles.Q1, false);
  assert.equal(state.prefs.lastActivity.subject, "Source deck");

  await appState.importTransferredState(
    {
      ...transfer,
      settings: {
        darkMode: true,
        layoutMode: "list",
        localDownloadDeletedDecks: ["Source local marker"],
      },
    },
    true,
  );
  assert.equal(state.prefs.darkMode, true);
  assert.equal(state.prefs.layoutMode, "list");
  assert.equal(state.prefs.lastActivity.mode, "review");
  assert.equal(state.prefs.lastActivity.subject, "Source deck");
  assert.equal(state.prefs.localDownloadDeletedDecks[0], "Local only");

  await appState.importTransferredState(
    {
      ...transfer,
      savedSession: {
        active: true,
        questions: [{ Subject: "Deck", ID: "1" }],
        currentIndex: 0,
        userAnswers: {},
        autoNextTimeout: 4321,
      },
    },
    false,
  );
  assert.equal(
    stateContext.StorageUtils.getStoredJSON("saved_session").autoNextTimeout,
    null,
    "an imported session must not reuse the sender device's timer handle",
  );

  state.session.active = true;
  await assert.rejects(
    appState.importTransferredState(transfer, false),
    /End the active quiz before importing progress/,
  );
  state.session.active = false;

  const savedStats = JSON.stringify(state.stats);
  const savedStatsInStorage = JSON.stringify(
    stateContext.StorageUtils.getStoredJSON("stats"),
  );
  const originalSetStoredJSON = stateContext.StorageUtils.setStoredJSON;
  stateContext.StorageUtils.setStoredJSON = (key, value) =>
    key === "saved_session" ? false : originalSetStoredJSON(key, value);
  await assert.rejects(
    appState.importTransferredState(
      {
        ...transfer,
        stats: { ...transfer.stats, totalAnswered: 99 },
        savedSession: {
          active: true,
          questions: [{ Subject: "Deck", ID: "1" }],
          currentIndex: 0,
          userAnswers: {},
          autoNextTimeout: 4321,
        },
      },
      false,
    ),
    /Unable to save imported saved session/,
  );
  stateContext.StorageUtils.setStoredJSON = originalSetStoredJSON;
  assert.equal(JSON.stringify(state.stats), savedStats);
  assert.equal(
    JSON.stringify(stateContext.StorageUtils.getStoredJSON("stats")),
    savedStatsInStorage,
    "a failed import restores the previously saved progress",
  );
}

checkStateImport()
  .then(() => console.log("QR transfer checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
