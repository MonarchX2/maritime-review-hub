const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const sessionSource = fs.readFileSync("session-core.js", "utf8");
const appSource = fs.readFileSync("app-core.js", "utf8");
const modalSource = fs.readFileSync("ui-modal-core.js", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const submitStart = sessionSource.indexOf("function submitPracticeAnswer(");
const submitEnd = sessionSource.indexOf("\n  function cancelAnswerScroll(", submitStart);
assert.ok(submitStart >= 0 && submitEnd > submitStart);
const submitBody = sessionSource.slice(submitStart, submitEnd);
assert.ok(
  submitBody.indexOf("showExplanation(q)") <
    submitBody.indexOf("scheduleAnswerScroll()"),
  "choice feedback must render before the answer scroll is scheduled",
);

const revealStart = sessionSource.indexOf("function revealAnswer()");
const revealEnd = sessionSource.indexOf(
  "\n  function rateIdentificationAnswer(",
  revealStart,
);
assert.ok(revealStart >= 0 && revealEnd > revealStart);
const revealBody = sessionSource.slice(revealStart, revealEnd);
assert.ok(
  revealBody.indexOf("renderQuestion()") <
    revealBody.indexOf("scheduleAnswerScroll()"),
  "revealed-answer feedback must render before the bottom scroll is scheduled",
);

assert.match(
  sessionSource,
  /function scheduleAnswerScroll\(\) \{[\s\S]*?const scrollAfterRender = \(\) => \{[\s\S]*?if \(getSession\(\)\?\.active\) scrollSessionViewToBottom\(\);[\s\S]*?requestAnimationFrame\(scrollAfterRender\)/,
  "feedback scrolling must run after rendering and only while a session is active",
);
assert.match(
  sessionSource,
  /function renderQuestion\(\) \{[\s\S]*?cancelAnswerScroll\(\);\s*scrollSessionView\(0\);/,
  "rendering a question must cancel stale answer scrolling and reset the view to the top",
);
assert.match(
  sessionSource,
  /questionCountEl\.textContent = `Question \$\{currentCard\} \/ \$\{totalCards\}`/,
  "quiz sessions should update the current question count and progress bar",
);
assert.match(
  sessionSource,
  /questionProgressTrack\.setAttribute\([\s\S]*?Math\.round\(progressPercent\)/,
);
assert.match(
  sessionSource,
  /questionProgressBar\.style\.width = `\$\{progressPercent\}%`/,
);
assert.match(
  html,
  /id="quiz-question-count" aria-live="polite"[\s\S]*?Question 1 \/ 1/,
);
assert.match(html, /id="quiz-question-progress-track"[\s\S]*?role="progressbar"/);
assert.match(
  sessionSource,
  /function scheduleAutoNext\(session[\s\S]*?if \(getSession\(\) === session && session\.active\) nextQuestion\(\);/,
  "timer expiry must advance only the active session",
);
assert.match(
  sessionSource,
  /function nextQuestion\(\) \{[\s\S]*?session\.currentIndex \+= 1;[\s\S]*?renderQuestion\(\);/,
  "advancing to the next question must render it and trigger its top reset",
);
assert.match(
  sessionSource,
  /function scrollSessionViewToBottom\(\) \{[\s\S]*?target\.scrollHeight - target\.clientHeight[\s\S]*?behavior: "auto"/,
  "feedback scrolling must target the scroll container's actual bottom without animated movement",
);

const displayStart = appSource.indexOf("function getQuestionTypeDisplayName(");
const displayEnd = appSource.indexOf(
  "\n  async function changeQuestionTypeMode(",
  displayStart,
);
const changeStart = displayEnd;
const changeEnd = appSource.indexOf("\n  let lastScrollTop", changeStart);
assert.ok(displayStart >= 0 && displayEnd > displayStart && changeEnd > changeStart);

const confirmations = [];
const toasts = [];
const questionTypeSelect = { value: "" };
let confirmationResult = true;
const modeContextState = {
  prefs: { qTypeOverride: "" },
  session: {
    active: true,
    currentIndex: 0,
    questions: [{ Subject: "Deck" }],
  },
};
const modeContext = {
  state: modeContextState,
  rootScope: {
    getDeckSessionSetting(mode, key, subject) {
      return (
        modeContextState.prefs.deckSessionSettings?.[subject]?.[mode]?.[key] ??
        modeContextState.prefs[key]
      );
    },
    setDeckSessionSetting(mode, key, value, subject) {
      if (!subject) return false;
      modeContextState.prefs.deckSessionSettings ??= {};
      modeContextState.prefs.deckSessionSettings[subject] ??= {};
      modeContextState.prefs.deckSessionSettings[subject][mode] ??= {};
      modeContextState.prefs.deckSessionSettings[subject][mode][key] = value;
      return true;
    },
  },
  document: {
    getElementById(id) {
      return id === "toggle-question-type" ? questionTypeSelect : null;
    },
  },
  async requestConfirmation(message, title) {
    confirmations.push({ message, title });
    return confirmationResult;
  },
  showToast(message) {
    toasts.push(message);
  },
  saveState() {},
  renderQuestion() {},
};
vm.createContext(modeContext);
vm.runInContext(
  `function setActiveDeckSessionPreference(mode, key, value, subject) {
    return rootScope.setDeckSessionSetting(mode, key, value, subject);
  }
${appSource.slice(displayStart, displayEnd)}
${appSource.slice(changeStart, changeEnd)}
globalThis.changeQuestionTypeMode = changeQuestionTypeMode;`,
  modeContext,
  { filename: "app-core.js question type mode dialog" },
);

async function verifyMode(mode, expandedName) {
  modeContext.state.prefs.qTypeOverride = "";
  delete modeContext.state.prefs.deckSessionSettings;
  questionTypeSelect.value = mode;
  confirmationResult = true;
  confirmations.length = 0;
  await modeContext.changeQuestionTypeMode(mode);
  assert.equal(
    modeContext.state.prefs.deckSessionSettings.Deck.quiz.qTypeOverride,
    mode,
    "the selected question type should be saved for the active deck",
  );
  assert.equal(
    modeContext.state.prefs.qTypeOverride,
    "",
    "changing the question type should not update the global default",
  );
  assert.equal(confirmations.length, 1);
  assert.deepEqual(
    JSON.parse(JSON.stringify(confirmations[0])),
    {
      message: {
        before: "Are you sure you want to switch to ",
        emphasis: expandedName,
        after: " mode?",
      },
      title: "Change Question Type",
    },
  );
}

(async () => {
  await verifyMode("auto", "Auto (Mixed)");
  await verifyMode("ident", "Identification");
  await verifyMode("mcq", "Multiple Choices");

  modeContext.state.prefs.qTypeOverride = "";
  modeContext.state.prefs.deckSessionSettings = {
    Deck: { quiz: { qTypeOverride: "auto" } },
  };
  questionTypeSelect.value = "ident";
  confirmationResult = false;
  const toastCountBeforeCancel = toasts.length;
  await modeContext.changeQuestionTypeMode("ident");
  assert.equal(
    questionTypeSelect.value,
    "auto",
    "canceling a question type override should immediately restore the previous selection",
  );
  assert.equal(
    modeContext.state.prefs.deckSessionSettings.Deck.quiz.qTypeOverride,
    "auto",
    "canceling a question type override should not change the saved preference",
  );
  assert.equal(
    toasts.length,
    toastCountBeforeCancel,
    "canceling a question type override should not show an enabled-mode toast",
  );

  assert.match(
    modalSource,
    /const emphasis = document\.createElement\("strong"\);[\s\S]*?messageEl\.replaceChildren\([\s\S]*?emphasis/,
    "confirmation dialog must render expanded mode names in bold",
  );
  assert.match(html, /id="confirm-title"/);
  assert.match(html, /id="confirm-message"/);

  console.log("Question answer scrolling and mode-dialog checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
