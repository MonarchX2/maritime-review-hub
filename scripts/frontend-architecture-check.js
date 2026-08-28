const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const appCore = read("app-core.js");
const reviewCore = read("deck-review-core.js");
const navCore = read("deck-nav-core.js");
const modalCore = read("ui-modal-core.js");
const sessionCore = read("session-core.js");
const quizCore = read("quiz-rendering-core.js");

const checks = [
  [
    "one main scroll listener",
    (appCore.match(/mainEl\.addEventListener\("scroll"/g) || []).length === 1 &&
      !reviewCore.includes('addEventListener("scroll"'),
  ],
  [
    "central sync scheduler",
    appCore.includes("const syncScheduler =") &&
      appCore.includes("syncScheduler.handleVisibility(false)") &&
      appCore.includes("syncScheduler.handleVisibility(true)"),
  ],
  [
    "idempotent navigation",
    navCore.includes(
      'if (viewElement.classList.contains("active")) return true;',
    ),
  ],
  [
    "no chart fallback implementation",
    (appCore.match(/function renderCharts\(\)/g) || []).length === 1 &&
      appCore.includes("return Analytics.renderCharts();"),
  ],
  [
    "private review state and canonical namespaces",
    !reviewCore.includes("globalScope.currentReviewSubject") &&
      !reviewCore.includes("globalScope.currentReviewQuestions") &&
      !navCore.includes("globalScope.DeckNav =") &&
      !modalCore.includes("globalScope.UIModal =") &&
      !sessionCore.includes("globalScope.AppSession =") &&
      !quizCore.includes("globalScope.QuizRendering ="),
  ],
];

const failures = checks.filter(([, passed]) => !passed).map(([name]) => name);
if (failures.length > 0) {
  console.error(`Architecture checks failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log(`Architecture checks passed (${checks.length}).`);
}
