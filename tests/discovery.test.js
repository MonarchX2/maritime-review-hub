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
console.log("discovery tests passed");
