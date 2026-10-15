// ============================================================================
// Quiz Rendering Core - Compatibility adapter for SessionCore
// ============================================================================

(function (globalScope) {
  "use strict";

  const sessionCore = globalScope.SessionCore;
  let cachedToggles = null;

  function getElementCached(id) {
    if (!cachedToggles) cachedToggles = Object.create(null);
    if (!cachedToggles[id] && typeof document !== "undefined") {
      cachedToggles[id] = document.getElementById(id);
    }
    return cachedToggles[id] || null;
  }

  function getToggle(id) {
    return getElementCached(id);
  }

  function callSession(method, ...args) {
    const handler = sessionCore?.[method];
    return typeof handler === "function" ? handler(...args) : false;
  }

  function renderQuestion() {
    return callSession("renderQuestion");
  }

  function showExplanation(question) {
    return callSession("showExplanation", question);
  }

  function revealAnswer() {
    return callSession("revealAnswer");
  }

  function startVisualTimer() {
    return callSession("startVisualTimer");
  }

  function stopVisualTimer() {
    return callSession("stopVisualTimer");
  }

  function setScopedPreference(mode, key, value) {
    if (globalScope.setDeckSessionSetting?.(mode, key, value) === true) {
      return true;
    }
    if (typeof globalScope.showToast === "function") {
      globalScope.showToast(
        "Open a deck session before changing this setting.",
        "warning",
      );
      return false;
    }
    throw new Error("Unable to save a session setting without an active deck.");
  }

  function toggleHideABCD() {
    const toggle = getToggle("toggle-hide-abcd");
    if (!toggle || !globalScope.state) return false;
    if (!setScopedPreference("study", "hideABCD", toggle.checked)) return false;
    globalScope.saveState?.();
    globalScope.DeckReviewCore?.updateQuestionChoices();
    return true;
  }

  function toggleQuizHideABCD() {
    const toggle = getToggle("toggle-quiz-hide-abcd");
    if (!toggle || toggle.disabled || !globalScope.state) return false;
    if (!setScopedPreference("quiz", "quizHideABCD", toggle.checked))
      return false;
    globalScope.saveState?.();
    if (getElementCached("view-practice")?.classList.contains("active")) {
      renderQuestion();
    }
    return true;
  }

  function toggleShowWrongChoices() {
    const toggle = getToggle("toggle-wrong-choices");
    if (!toggle || !globalScope.state) return false;
    if (!setScopedPreference("study", "showWrongChoices", toggle.checked))
      return false;
    globalScope.saveState?.();
    globalScope.DeckReviewCore?.updateQuestionChoices();
    return true;
  }

  function toggleQuizShowExplanations(source) {
    const toggle = source || getToggle("toggle-quiz-show-explanations");
    if (!globalScope.state) return false;
    if (!setScopedPreference(
      "quiz",
      "quizShowExplanations",
      toggle ? Boolean(toggle.checked) : false,
    )) return false;
    globalScope.saveState?.();
    if (globalScope.state.session?.active) renderQuestion();
    return true;
  }

  function toggleStudyShowExplanations(source) {
    const toggle = source || getToggle("toggle-study-show-explanations");
    if (!globalScope.state) return false;
    if (!setScopedPreference(
      "study",
      "studyShowExplanations",
      toggle ? Boolean(toggle.checked) : false,
    )) return false;
    globalScope.saveState?.();
    if (getElementCached("view-deck-review")?.classList.contains("active")) {
      globalScope.reRenderDeckReview?.();
    }
    return true;
  }

  function toggleStudyShowAnswers(source) {
    const toggle = source || getToggle("toggle-study-show-answers");
    if (!globalScope.state) return false;
    if (!setScopedPreference(
      "study",
      "studyShowAnswers",
      toggle ? Boolean(toggle.checked) : false,
    )) return false;
    globalScope.saveState?.();
    if (getElementCached("view-deck-review")?.classList.contains("active")) {
      globalScope.reRenderDeckReview?.();
    }
    return true;
  }

  function toggleClozeMode(source) {
    const toggle = source || getToggle("toggle-cloze-mode");
    if (!globalScope.state) return false;
    if (!setScopedPreference(
      "quiz",
      "clozeEnabled",
      toggle ? Boolean(toggle.checked) : false,
    )) return false;
    globalScope.saveState?.();
    if (globalScope.state.session?.active) renderQuestion();
    return true;
  }

  function toggleSrsMode(source) {
    const toggle = source || getToggle("toggle-srs-mode");
    if (!globalScope.state) return false;
    if (!setScopedPreference(
      "quiz",
      "srsEnabled",
      toggle ? Boolean(toggle.checked) : false,
    )) return false;
    globalScope.saveState?.();
    if (globalScope.state.session?.active) renderQuestion();
    return true;
  }

  const QuizRenderingCore = {
    renderQuestion,
    showExplanation,
    revealAnswer,
    startVisualTimer,
    stopVisualTimer,
    toggleHideABCD,
    toggleQuizHideABCD,
    toggleShowWrongChoices,
    toggleQuizShowExplanations,
    toggleStudyShowExplanations,
    toggleStudyShowAnswers,
    toggleClozeMode,
    toggleSrsMode,
  };

  globalScope.QuizRenderingCore = QuizRenderingCore;
  Object.assign(globalScope, QuizRenderingCore);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = QuizRenderingCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
