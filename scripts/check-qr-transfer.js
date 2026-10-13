const assert = require("node:assert/strict");
const crypto = require("node:crypto");
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
  setTimeout,
  clearTimeout,
  clearInterval,
  btoa,
  atob,
};
const qrSource = fs.readFileSync("qr-transfer-core.js", "utf8");
assert.match(qrSource, /src: "qr-vendor\/qrcode-generator\.js"/);
assert.match(qrSource, /src: "qr-vendor\/jsQR\.js"/);
assert.doesNotMatch(
  qrSource,
  /script\.integrity\s*=|integrity:\s*"sha384-/,
  "runtime QR loading must allow the deployment-minified local vendor scripts",
);
for (const [filename, expectedHash] of [
  [
    "qrcode-generator.js",
    "8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k",
  ],
  [
    "jsQR.js",
    "b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx",
  ],
]) {
  const actualHash = crypto
    .createHash("sha384")
    .update(fs.readFileSync(`qr-vendor/${filename}`))
    .digest("base64");
  assert.equal(
    actualHash,
    expectedHash,
    `${filename} must remain byte-for-byte compatible with cached app versions`,
  );
}
assert.doesNotMatch(
  qrSource,
  /https:\/\/cdn\.jsdelivr\.net\/npm\/(?:qrcode-generator|jsqr)/,
  "QR generation and scanning must not require a CDN at runtime",
);
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
assert.equal(qr.parseTransferFileText(JSON.stringify(transfer)).format, transfer.format);
assert.throws(
  () => qr.parseTransferFileText("{invalid json"),
  /not valid transfer JSON/,
);
assert.throws(
  () => qr.parseTransferFileText(JSON.stringify({ ...transfer, settings: [] })),
  /valid progress data/,
);
assert.throws(
  () => qr.parseTransferFileText(" ".repeat(qr.MAX_TRANSFER_FILE_BYTES + 1)),
  /10 MB limit/,
);
const directOffer = {
  type: "offer",
  sdp: "v=0\r\no=- 123 2 IN IP4 127.0.0.1\r\n",
};
const parsedDirectOffer = qr.parseDirectSignal(
  qr.createDirectSignal(directOffer),
  "offer",
);
assert.equal(parsedDirectOffer.type, directOffer.type);
assert.equal(parsedDirectOffer.sdp, directOffer.sdp);
assert.throws(
  () => qr.parseDirectSignal(qr.createDirectSignal(directOffer), "answer"),
  /not a valid direct connection answer/,
);
assert.throws(
  () => qr.parseDirectSignal("MRH-DIRECT-1|not-base64", "offer"),
  /could not be read/,
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

const uiElements = new Map();
function getUiElement(id) {
  if (!uiElements.has(id)) {
    const classes = new Set();
    uiElements.set(id, {
      classList: {
        add: (...names) => names.forEach((name) => classes.add(name)),
        remove: (...names) => names.forEach((name) => classes.delete(name)),
        toggle: (name, enabled) => {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains: (name) => classes.has(name),
      },
      setAttribute() {},
      remove() {},
      click() {},
      textContent: "",
    });
  }
  return uiElements.get(id);
}
let downloadLink = null;
qrContext.document = {
  getElementById: getUiElement,
  createElement(name) {
    const element = getUiElement(name);
    if (name === "a") downloadLink = element;
    return element;
  },
  body: { appendChild() {} },
};
qrContext.URL = {
  createObjectURL(blob) {
    assert.equal(blob.type, "application/json");
    return "blob:transfer-test";
  },
  revokeObjectURL() {},
};
qrContext.Blob = Blob;
qrContext.setTimeout = () => 1;
qrContext.module.exports.exportFile();
assert.match(
  downloadLink.download,
  /^maritime-review-hub-progress-\d{4}-\d{2}-\d{2}\.mrh-transfer\.json$/,
);

async function checkDirectConnectionSetup() {
  let peerConfiguration = null;
  let createdChannel = null;
  const sentMessages = [];
  class MockPeerConnection {
    constructor(configuration) {
      peerConfiguration = configuration;
      this.iceGatheringState = "complete";
      this.connectionState = "new";
      this.signalingState = "stable";
      this.localDescription = null;
    }

    async createOffer() {
      return directOffer;
    }

    async setLocalDescription(description) {
      this.localDescription = description;
    }

    async setRemoteDescription(description) {
      this.remoteDescription = description;
      this.connectionState = "connected";
      this.dataChannel.readyState = "open";
      this.onconnectionstatechange();
      this.dataChannel.onopen();
    }

    createDataChannel(label, options) {
      assert.equal(label, "mrh-progress-transfer");
      assert.equal(options.ordered, true);
      createdChannel = {
        readyState: "connecting",
        bufferedAmount: 0,
        send(message) {
          sentMessages.push(JSON.parse(message));
        },
        addEventListener() {},
        removeEventListener() {},
        close() {
          this.readyState = "closed";
        },
      };
      this.dataChannel = createdChannel;
      return createdChannel;
    }

    close() {
      this.signalingState = "closed";
    }
  }
  qrContext.RTCPeerConnection = MockPeerConnection;
  qrContext.qrcode = () => ({
    addData() {},
    make() {},
    createDataURL: () => "data:image/png;base64,test",
  });
  qrContext.jsQR = () => null;
  await qrContext.QRTransfer.startDirectSend();
  assert.equal(peerConfiguration.iceServers.length, 0);
  assert.equal(
    qr.parseDirectSignal(
      getUiElement("qr-transfer-direct-code").value,
      "offer",
    ).type,
    "offer",
    "the direct sender displays a valid local-network offer",
  );
  assert.equal(
    getUiElement("qr-transfer-direct").classList.contains("hidden"),
    false,
  );
  assert.ok(createdChannel);
  const input = getUiElement("qr-transfer-signal-input");
  input.value = qr.createDirectSignal({ ...directOffer, type: "answer" });
  let timeoutCount = 0;
  qrContext.setTimeout = () => {
    timeoutCount += 1;
    return timeoutCount;
  };
  await qrContext.QRTransfer.submitDirectSignal();
  await Promise.resolve();
  assert.equal(timeoutCount, 0, "an already-open data channel needs no timeout");
  assert.equal(sentMessages[0]?.type, "mrh-transfer-start");
  assert.equal(sentMessages[1]?.type, "mrh-transfer-chunk");
  assert.equal(input.value, "");
  qrContext.QRTransfer.showHome();
  delete qrContext.RTCPeerConnection;
  delete qrContext.qrcode;
  delete qrContext.jsQR;
}

async function checkFileImport() {
  let importedTransfer = null;
  qrContext.AppState.importTransferredState = async (value, replaceSettings) => {
    importedTransfer = { value, replaceSettings };
    return true;
  };
  const directTransfer = {
    ...transfer,
    settings: { ...transfer.settings, transferNote: "direct-data-".repeat(1400) },
  };
  const directEncoded = Buffer.from(JSON.stringify(directTransfer)).toString(
    "base64url",
  );
  const directId = "direct01";
  const directChunkSize = 12000;
  const directParts = [];
  for (
    let offset = 0;
    offset < directEncoded.length;
    offset += directChunkSize
  ) {
    directParts.push(directEncoded.slice(offset, offset + directChunkSize));
  }
  const directChannelMessages = [];
  const directChannel = {
    send(message) {
      directChannelMessages.push(JSON.parse(message));
    },
  };
  qrContext.module.exports.internals.receiveDirectMessage(
    JSON.stringify({
      type: "mrh-transfer-start",
      id: directId,
      total: directParts.length,
      encodedLength: directEncoded.length,
      checksum: qr.crc32(directEncoded),
    }),
    directChannel,
  );
  for (const index of directParts.map((_, partIndex) => partIndex).reverse()) {
    qrContext.module.exports.internals.receiveDirectMessage(
      JSON.stringify({
        type: "mrh-transfer-chunk",
        id: directId,
        index,
        data: directParts[index],
      }),
      directChannel,
    );
  }
  assert.equal(
    directChannelMessages[0]?.type,
    "mrh-transfer-verified",
    "direct transfer acknowledges only a complete, integrity-checked payload",
  );
  assert.equal(
    getUiElement("qr-transfer-import").classList.contains("hidden"),
    false,
    "a direct transfer opens the same import confirmation as QR and files",
  );
  assert.equal(
    getUiElement("qr-transfer-status").textContent,
    "Transfer verified. Importing progress replaces this device’s saved progress; choose whether to replace its settings too.",
  );
  await qrContext.module.exports.importProgress(false);
  assert.equal(importedTransfer.value.settings.transferNote, directTransfer.settings.transferNote);
  importedTransfer = null;
  let resolveSlowFile;
  const slowInput = {
    files: [
      {
        size: 12,
        text: () =>
          new Promise((resolve) => {
            resolveSlowFile = resolve;
          }),
      },
    ],
    value: "slow-file",
  };
  const slowImport = qrContext.module.exports.importFile(slowInput);
  const input = {
    files: [{ size: 12, text: async () => JSON.stringify(transfer) }],
    value: "selected-file",
  };
  await qrContext.module.exports.importFile(input);
  resolveSlowFile(JSON.stringify({ ...transfer, stats: [] }));
  await slowImport;
  assert.equal(input.value, "", "file input resets so the same file can be selected again");
  assert.equal(
    getUiElement("qr-transfer-import").classList.contains("hidden"),
    false,
    "a valid transfer file opens the import confirmation panel",
  );
  await qrContext.module.exports.importProgress(false);
  assert.equal(importedTransfer.value.format, transfer.format);
  assert.equal(importedTransfer.replaceSettings, false);

  const invalidInput = {
    files: [{ size: 12, text: async () => "{invalid" }],
    value: "invalid-file",
  };
  await qrContext.module.exports.importFile(invalidInput);
  assert.equal(invalidInput.value, "");
  assert.match(
    getUiElement("qr-transfer-status").textContent,
    /not valid transfer JSON/,
  );
}

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

checkDirectConnectionSetup()
  .then(checkFileImport)
  .then(checkStateImport)
  .then(() => console.log("QR transfer checks passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
