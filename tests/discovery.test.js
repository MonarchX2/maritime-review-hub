const assert = require("assert");
const {
  buildDiscoveryViewModel,
  matchesFavoriteEntry,
  filterQuestionsByStudyPreference,
} = require("../discovery.js");

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
assert.strictEqual(
  matchesFavoriteEntry("Navigation::Basic", "Navigation", ["Navigation"]),
  true,
);
assert.strictEqual(
  matchesFavoriteEntry("Navigation::Basic", "Navigation", ["Safety"]),
  false,
);
assert.strictEqual(
  matchesFavoriteEntry("Navigation::Basic", "Navigation", ["Navigation::Basic"]),
  true,
);

const sampleQuestions = [
  { ID: "q-1" },
  { ID: "q-2" },
  { ID: "q-3" },
];
assert.deepStrictEqual(
  filterQuestionsByStudyPreference(sampleQuestions, new Set(["q-2"]), "all"),
  sampleQuestions,
);
assert.deepStrictEqual(
  filterQuestionsByStudyPreference(sampleQuestions, new Set(["q-2"]), "favorites"),
  [{ ID: "q-2" }],
);
console.log("discovery tests passed");
