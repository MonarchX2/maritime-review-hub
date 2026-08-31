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

  function toggleHideABCD() {
    const toggle = getToggle("toggle-hide-abcd");
    if (!toggle || !globalScope.state) return false;
    globalScope.state.prefs.hideABCD = toggle.checked;
    globalScope.saveState?.();
    globalScope.reRenderDeckReview?.();
    return true;
  }

  function toggleQuizHideABCD() {
    const toggle = getToggle("toggle-quiz-hide-abcd");
    if (!toggle || toggle.disabled || !globalScope.state) return false;
    globalScope.state.prefs.quizHideABCD = toggle.checked;
    globalScope.saveState?.();
    if (getElementCached("view-practice")?.classList.contains("active")) {
      renderQuestion();
    }
    return true;
  }

  function toggleShowWrongChoices() {
    const toggle = getToggle("toggle-wrong-choices");
    if (!toggle || !globalScope.state) return false;
    globalScope.state.prefs.showWrongChoices = toggle.checked;
    globalScope.saveState?.();
    globalScope.reRenderDeckReview?.();
    return true;
  }

  function toggleClozeMode(source) {
    const toggle = source || getToggle("toggle-cloze-mode");
    if (!globalScope.state) return false;
    globalScope.state.prefs.clozeEnabled = toggle
      ? Boolean(toggle.checked)
      : false;
    globalScope.saveState?.();
    if (globalScope.state.session?.active) renderQuestion();
    return true;
  }

  function toggleSrsMode(source) {
    const toggle = source || getToggle("toggle-srs-mode");
    if (!globalScope.state) return false;
    globalScope.state.prefs.srsEnabled = toggle
      ? Boolean(toggle.checked)
      : false;
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
