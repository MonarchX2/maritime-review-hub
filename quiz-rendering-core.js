// ============================================================================
// Quiz Rendering Core - Compatibility adapter for SessionCore
// ============================================================================

(function (globalScope) {
  "use strict";

  const sessionCore = globalScope.SessionCore;

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
    const toggle = document.getElementById("toggle-hide-abcd");
    if (!toggle || !globalScope.state) return false;
    globalScope.state.prefs.hideABCD = toggle.checked;
    globalScope.saveState?.();
    globalScope.reRenderDeckReview?.();
    return true;
  }

  function toggleQuizHideABCD() {
    const toggle = document.getElementById("toggle-quiz-hide-abcd");
    if (!toggle || toggle.disabled || !globalScope.state) return false;
    globalScope.state.prefs.quizHideABCD = toggle.checked;
    globalScope.saveState?.();
    if (
      document.getElementById("view-practice")?.classList.contains("active")
    ) {
      renderQuestion();
    }
    return true;
  }

  function toggleShowWrongChoices() {
    const toggle = document.getElementById("toggle-wrong-choices");
    if (!toggle || !globalScope.state) return false;
    globalScope.state.prefs.showWrongChoices = toggle.checked;
    globalScope.saveState?.();
    globalScope.reRenderDeckReview?.();
    return true;
  }

  function toggleClozeMode(source) {
    const toggle = source || document.getElementById("toggle-cloze-mode");
    if (!globalScope.state) return false;
    globalScope.state.prefs.clozeEnabled = toggle
      ? Boolean(toggle.checked)
      : false;
    globalScope.saveState?.();
    if (globalScope.state.session?.active) renderQuestion();
    return true;
  }

  function toggleSrsMode(source) {
    const toggle = source || document.getElementById("toggle-srs-mode");
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
  globalScope.QuizRendering = QuizRenderingCore;
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
