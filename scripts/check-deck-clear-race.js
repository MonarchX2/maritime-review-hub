const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appSource = fs
  .readFileSync("app-core.js", "utf8")
  .replace(/\r\n/g, "\n");
const safeIdbSetMatch = appSource.match(
  /  async function safeIdbSet\(key, value\) \{[\s\S]*?\n  \}\n\n  function isDeckFetchCurrent/,
);
const isDeckFetchCurrentMatch = appSource.match(
  /  function isDeckFetchCurrent\(generation\) \{[\s\S]*?\n  \}\n\n  function getDeckFetchGeneration/,
);
const deckGenerationHelpersMatch = appSource.match(
  /  function getDeckFetchGeneration\(subject\) \{[\s\S]*?\n  \}\n\n  async function safeIdbDel/,
);
assert.ok(safeIdbSetMatch, "app must define the guarded IndexedDB writer");
assert.ok(
  isDeckFetchCurrentMatch,
  "app must reject downloads that finish during or after data clearing",
);
assert.ok(
  deckGenerationHelpersMatch,
  "app must invalidate downloads for a deck being deleted",
);

const writes = [];
let finishWrite;
const context = {
  Promise,
  Set,
  appDataClearInProgress: false,
  appDataClearGeneration: 0,
  clearDatabaseInProgress: false,
  clearAppDataInProgress: false,
  inFlightDeckDatabaseWrites: new Set(),
  deckFetchGenerations: new Map(),
  deckMutationsInProgress: new Set(),
  idbKeyval: {
    set(key, value) {
      writes.push({ key, value });
      return new Promise((resolve) => {
        finishWrite = resolve;
      });
    },
  },
  getStorageKey(key) {
    return `mrh_device:${key}`;
  },
};
vm.createContext(context);
vm.runInContext(
  [
    safeIdbSetMatch[0].replace(/\n\n  function isDeckFetchCurrent$/, ""),
    isDeckFetchCurrentMatch[0].replace(/\n\n  function getDeckFetchGeneration$/, ""),
    deckGenerationHelpersMatch[0].replace(/\n\n  async function safeIdbDel$/, ""),
  ].join("\n"),
  context,
  { filename: "app-core.js" },
);

async function main() {
  const initialDeckGeneration = context.getDeckFetchGeneration("Deck A");
  assert.equal(context.canFetchDeck("Deck A"), true);
  context.invalidateDeckFetch("Deck A");
  assert.equal(
    context.isDeckFetchCurrentForSubject("Deck A", initialDeckGeneration),
    false,
    "deleting a deck must invalidate any download already in flight",
  );
  context.deckMutationsInProgress.add("Deck A");
  assert.equal(context.canFetchDeck("Deck A"), false);
  assert.equal(
    context.canFetchDeck("Deck B"),
    true,
    "deleting one deck must not block unrelated deck downloads",
  );
  context.deckMutationsInProgress.delete("Deck A");
  context.clearDatabaseInProgress = true;
  assert.equal(
    context.canFetchDeck("Deck B"),
    false,
    "a pending database clear must prevent new deck fetches",
  );
  context.clearDatabaseInProgress = false;
  context.clearAppDataInProgress = true;
  assert.equal(
    context.canFetchDeck("Deck B"),
    false,
    "a pending app-data clear must prevent new deck fetches",
  );
  context.clearAppDataInProgress = false;

  const requestGeneration = context.appDataClearGeneration;
  const write = context.safeIdbSet("mrh_db", [{ ID: "question-1" }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(context.inFlightDeckDatabaseWrites.size, 1);
  assert.equal(writes.length, 1);

  context.appDataClearInProgress = true;
  context.appDataClearGeneration += 1;
  assert.equal(
    context.isDeckFetchCurrent(requestGeneration),
    false,
    "a deck response started before app-data clearing must be discarded",
  );

  let deletionStarted = false;
  const drain = Promise.allSettled([
    ...context.inFlightDeckDatabaseWrites,
  ]).then(() => {
    deletionStarted = true;
  });

  await assert.rejects(
    context.safeIdbSet("mrh_db", [{ ID: "late-question" }]),
    /Deck persistence is paused/,
  );
  assert.equal(writes.length, 1, "new IndexedDB writes must be blocked");
  assert.equal(
    deletionStarted,
    false,
    "the IndexedDB delete must wait for the active write to settle",
  );

  finishWrite();
  await Promise.all([write, drain]);
  assert.equal(deletionStarted, true);
  assert.equal(context.inFlightDeckDatabaseWrites.size, 0);
  assert.equal(writes.length, 1);

  console.log("Deck-clear IndexedDB race checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
