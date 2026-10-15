const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

let activeView = "dashboard";
let currentReviewSubject = "";
const context = {
  module: { exports: {} },
  state: {
    prefs: {
      activeRecall: false,
      shuffleChoices: true,
      studyLayout: "scroll",
      studyFilterMode: "all",
      studyShowExplanations: true,
      quizNavigationPosition: "top",
      studyScrollNavigationPosition: "both",
    },
    session: { active: false },
  },
  document: {
    getElementById(id) {
      if (id !== "view-deck-review") return null;
      return {
        classList: {
          contains: (className) =>
            className === "active" && activeView === "study",
        },
      };
    },
  },
  window: { innerWidth: 1024 },
  getCurrentReviewSubject: () => currentReviewSubject,
  saveState() {},
};

vm.createContext(context);
vm.runInContext(
  fs.readFileSync("preferences-core.js", "utf8"),
  context,
  { filename: "preferences-core.js" },
);

const preferences = context.module.exports;
assert.equal(
  preferences.getDeckSessionSetting("quiz", "activeRecall", "Deck A"),
  false,
  "deck settings should fall back to global defaults until overridden",
);
assert.equal(
  preferences.setDeckSessionSetting("quiz", "activeRecall", true, "Deck A"),
  true,
);
assert.equal(
  preferences.setDeckSessionSetting("quiz", "activeRecall", true),
  false,
  "session settings must not be changed without an active deck",
);
assert.equal(context.state.prefs.activeRecall, false);
assert.equal(
  preferences.getDeckSessionSetting("quiz", "activeRecall", "Deck A"),
  true,
);
assert.equal(
  preferences.getDeckSessionSetting("quiz", "activeRecall", "Deck B"),
  false,
  "a quiz setting override must not affect other decks",
);
assert.equal(
  context.state.prefs.activeRecall,
  false,
  "saving a deck override must leave the global default untouched",
);

preferences.setDeckSessionSetting(
  "study",
  "studyLayout",
  "single",
  "Deck A",
);
assert.equal(
  preferences.getDeckSessionSetting("study", "studyLayout", "Deck A"),
  "single",
);
assert.equal(
  preferences.getDeckSessionSetting("study", "studyLayout", "Deck B"),
  "scroll",
  "a study setting override must not affect other decks",
);
assert.equal(
  preferences.getDeckSessionSetting("quiz", "studyLayout", "Deck A"),
  "scroll",
  "quiz and study settings must remain isolated",
);
assert.deepEqual(
  JSON.parse(
    JSON.stringify(preferences.getDeckSessionSettings("quiz", "Deck A")),
  ),
  { activeRecall: true },
  "effective quiz settings should expose only that deck's quiz overrides",
);
assert.equal(
  preferences.setDeckSessionSetting("quiz", "layoutMode", "tree", "Deck A"),
  false,
  "unrelated application preferences must not be accepted as session overrides",
);

activeView = "study";
currentReviewSubject = "Active Study Deck";
preferences.setDeckSessionSetting("study", "studyFilterMode", "favorites");
assert.equal(
  preferences.getDeckSessionSetting("study", "studyFilterMode"),
  "favorites",
  "settings changed from Study mode should target the active deck",
);
assert.equal(
  preferences.getDeckSessionSetting(
    "study",
    "studyFilterMode",
    "Another Study Deck",
  ),
  "all",
);

activeView = "quiz";
context.state.session = {
  active: true,
  questions: [{ Subject: "Active Quiz Deck" }],
  currentIndex: 0,
};
preferences.setDeckSessionSetting("quiz", "shuffleChoices", false);
assert.equal(
  preferences.getDeckSessionSetting("quiz", "shuffleChoices"),
  false,
  "settings changed from Quiz mode should target the active deck",
);
assert.equal(
  preferences.getDeckSessionSetting(
    "quiz",
    "shuffleChoices",
    "Another Quiz Deck",
  ),
  true,
);
preferences.setDeckNavigationOverride("Active Quiz Deck", "quiz", "bottom");
assert.equal(
  preferences.getQuizNavigationPosition("Active Quiz Deck"),
  "bottom",
);
assert.equal(
  preferences.getQuizNavigationPosition("Another Quiz Deck"),
  "top",
  "quiz navigation overrides must remain deck-specific",
);
activeView = "study";
currentReviewSubject = "Active Study Deck";
context.state.session.active = false;
preferences.setStudyNavigationPosition("scroll", "top");
assert.equal(
  preferences.getStudyNavigationPosition("scroll", "Active Study Deck"),
  "top",
);
assert.equal(
  preferences.getStudyNavigationPosition("scroll", "Another Study Deck"),
  "both",
  "study navigation overrides must remain deck-specific",
);
assert.equal(
  preferences.setStudyNavigationPosition("scroll", "top", ""),
  false,
  "study navigation must not update global defaults without a deck",
);
assert.equal(
  context.state.prefs.studyScrollNavigationPosition,
  "both",
  "navigation changes without a deck must leave the global default unchanged",
);
assert.equal(
  preferences.setDeckNavigationOverride("", "quiz", "bottom"),
  false,
  "quiz navigation changes must not be saved without an active deck",
);
assert.equal(
  context.state.prefs.quizNavigationPosition,
  "top",
  "navigation changes without a deck must preserve the quiz default",
);

console.log("Deck-specific session settings checks passed.");
