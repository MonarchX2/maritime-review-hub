const assert = require("assert");

const state = {
  prefs: {
    deletedDecks: [],
    favoriteDecks: ["Navigation::Basic"],
    starredDecks: ["Navigation::Basic"],
    recentDecks: ["Navigation::Basic"],
  },
  categorySummary: [{ Subject: "Navigation::Basic", QuestionCount: 10 }],
  db: [{ Subject: "Navigation::Basic", ID: "Navigation::Basic::1" }],
};

const visibleSummary = state.categorySummary.filter(
  (deck) => !new Set((state.prefs.deletedDecks || []).filter(Boolean)).has(deck.Subject),
);
assert.deepStrictEqual(visibleSummary, [{ Subject: "Navigation::Basic", QuestionCount: 10 }]);

state.prefs.deletedDecks = Array.from(
  new Set([...(state.prefs.deletedDecks || []), "Navigation::Basic"].filter(Boolean)),
);
const afterDelete = state.categorySummary.filter(
  (deck) => !new Set((state.prefs.deletedDecks || []).filter(Boolean)).has(deck.Subject),
);
assert.deepStrictEqual(afterDelete, []);

assert.strictEqual(
  state.prefs.favoriteDecks.filter((deck) => deck !== "Navigation::Basic").length,
  0,
);

console.log("deleted deck sync checks passed");
