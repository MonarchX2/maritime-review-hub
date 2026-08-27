// ============================================================================
// Deck Review Core - Deck study/review controller and pagination
// ============================================================================

(function (globalScope) {
  let currentReviewSubject = null;
  let currentReviewQuestions = [];
  let reviewRenderFrame = null;

  function reRenderDeckReview() {
    if (reviewRenderFrame !== null) return;

    const render = () => {
      reviewRenderFrame = null;
      renderDeckReview(currentReviewSubject, currentReviewQuestions);
    };

    if (typeof requestAnimationFrame === "function") {
      reviewRenderFrame = requestAnimationFrame(render);
    } else {
      reviewRenderFrame = setTimeout(render, 0);
    }
  }

  function renderDeckReview(subject, questions) {
    currentReviewSubject = subject;
    currentReviewQuestions = Array.isArray(questions) ? questions : [];
    globalScope.currentReviewSubject = currentReviewSubject;
    globalScope.currentReviewQuestions = currentReviewQuestions;

    if (typeof globalScope.renderDeckReviewImplementation !== "function") {
      return false;
    }
    return globalScope.renderDeckReviewImplementation(
      subject,
      currentReviewQuestions,
    );
  }

  const state = globalScope.state;
  const saveState = globalScope.saveState;

  function changeStudyLayout(layout) {
    if (!(state && ["scroll", "single"].includes(layout))) return;
    state.prefs.studyLayout = layout;
    if (
      layout === "single" &&
      !state.prefs.studyProgress[currentReviewSubject]
    ) {
      state.prefs.studyProgress[currentReviewSubject] = {
        page: 1,
        index: 0,
        scrollY: 0,
      };
    }
    saveState();
    reRenderDeckReview();
  }

  function changeStudyPageSize(size) {
    const validSizes = [10, 25, 50, 100, "All"];
    if (!validSizes.includes(Number(size)) && size !== "All") return;
    state.prefs.studyPageSize = size === "" ? 50 : Number(size) || size;
    if (state.prefs.studyProgress[currentReviewSubject]) {
      state.prefs.studyProgress[currentReviewSubject].page = 1;
    }
    saveState();
    reRenderDeckReview();
  }

  function changeStudyPage(delta) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (!progress) return;
    progress.page = Math.max(1, (progress.page || 1) + delta);
    saveState();
    reRenderDeckReview();
  }

  function changeStudyIndex(delta) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    if (!progress) return;
    const maxIndex = Math.max(0, currentReviewQuestions.length - 1);
    progress.index = Math.max(
      0,
      Math.min(maxIndex, (progress.index || 0) + delta),
    );
    saveState();
    reRenderDeckReview();
  }

  function jumpToStudyPage(pageNumber) {
    const progress = state.prefs.studyProgress[currentReviewSubject];
    const page = parseInt(pageNumber, 10);
    if (!progress || Number.isNaN(page)) return;
    progress.page = Math.max(1, page);
    saveState();
    reRenderDeckReview();
  }

  // ===================== MODULE EXPORT =====================
  const DeckReviewCore = {
    renderDeckReview,
    reRenderDeckReview,
    changeStudyLayout,
    changeStudyPageSize,
    changeStudyPage,
    changeStudyIndex,
    jumpToStudyPage,
    // Expose state accessors
    getCurrentReviewSubject: () => currentReviewSubject,
    getCurrentReviewQuestions: () => currentReviewQuestions,
  };

  // Alias for backward compatibility
  const DeckReview = DeckReviewCore;

  // Export to global scope
  globalScope.DeckReviewCore = DeckReviewCore;
  globalScope.DeckReview = DeckReview;

  // Export individual functions for backward compatibility
  globalScope.renderDeckReview = renderDeckReview;
  globalScope.reRenderDeckReview = reRenderDeckReview;
  globalScope.changeStudyLayout = changeStudyLayout;
  globalScope.changeStudyPageSize = changeStudyPageSize;
  globalScope.changeStudyPage = changeStudyPage;
  globalScope.changeStudyIndex = changeStudyIndex;
  globalScope.jumpToStudyPage = jumpToStudyPage;
  globalScope.currentReviewSubject = currentReviewSubject;
  globalScope.currentReviewQuestions = currentReviewQuestions;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DeckReviewCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
