const assert = require("assert");
const { buildDiscoveryViewModel } = require("../discovery.js");

const state = {
  prefs: {
    favoriteDecks: ["Navigation::Basic"],
    recentDecks: ["Safety::Fire", "Navigation::Basic"],
    discoverySearch: "nav",
  },
};

const punctuationState = {
  prefs: {
    discoverySearch: "basic!",
  },
};

const deletedState = {
  prefs: {
    favoriteDecks: ["Navigation::Basic", "Safety::Fire"],
    recentDecks: ["Navigation::Basic", "Construction::Stability"],
    discoverySearch: "",
    deletedDecks: ["Navigation::Basic"],
  },
};

const categorySummary = [
  { Subject: "Navigation::Basic", QuestionCount: 12 },
  { Subject: "Safety::Fire", QuestionCount: 4 },
  { Subject: "Construction::Stability", QuestionCount: 8 },
];

const viewModel = buildDiscoveryViewModel(state, categorySummary);
const punctuationViewModel = buildDiscoveryViewModel(
  punctuationState,
  categorySummary,
);
const deletedViewModel = buildDiscoveryViewModel(deletedState, categorySummary);

assert.deepStrictEqual(viewModel.favoriteDecks, ["Navigation::Basic"]);
assert.deepStrictEqual(viewModel.recentDecks, [
  "Safety::Fire",
  "Navigation::Basic",
]);
assert.deepStrictEqual(
  viewModel.visibleDecks.map((deck) => deck.Subject),
  ["Navigation::Basic"],
);
assert.strictEqual(viewModel.hasQuickAccess, true);
assert.deepStrictEqual(
  punctuationViewModel.visibleDecks.map((deck) => deck.Subject),
  ["Navigation::Basic"],
);
assert.deepStrictEqual(deletedViewModel.favoriteDecks, ["Safety::Fire"]);
assert.deepStrictEqual(deletedViewModel.recentDecks, [
  "Construction::Stability",
]);
assert.deepStrictEqual(
  deletedViewModel.visibleDecks.map((deck) => deck.Subject),
  ["Safety::Fire", "Construction::Stability"],
);
console.log("discovery tests passed");
