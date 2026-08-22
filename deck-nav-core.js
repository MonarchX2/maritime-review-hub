// ============================================================================
// Deck Navigation Core - Category browsing, folder navigation, and deck lifecycle
// Extracted from app-core.js - Phase 5
// ============================================================================

(function (globalScope) {
  const {
    state,
    saveState,
    requestConfirmation,
    saveSessionProgress,
    getQuestionsForSubject,
    decodeHandlerValue,
    renderQuestion,
    isDeckHidden,
    isDeckLocked,
    fetchDeckQuestions,
    prepareSessionPool,
    openDeckPasswordModal,
  } = globalScope;

  // ===================== VIEW NAVIGATION =====================
  async function navigate(viewId) {
    if (
      state.session.active &&
      viewId !== "practice" &&
      !(await requestConfirmation(
        "You have an active session. Do you want to pause and return? Your progress will be saved.",
        "Pause Session",
      ))
    )
      return;

    if (state.session.active && viewId !== "practice") {
      saveSessionProgress();
      state.session.active = false;
      saveState();
    }

    globalScope.updateDashboard();

    document
      .querySelectorAll(".view-section")
      .forEach((el) => el.classList.remove("active"));
    const viewElement = document.getElementById(`view-${viewId}`);
    if (!viewElement) return false;
    viewElement.classList.add("active");
    if (viewId === "stats") globalScope.renderCharts();
  }

  // ===================== CATEGORY VISIBILITY & FILTERING =====================
  function getVisibleCategorySummary() {
    return (state.categorySummary || []).filter((deck) => {
      if (!deck || !deck.Subject) return false;
      const subject = String(deck.Subject || "").trim();
      if (!subject) return false;
      const accessEntry = state.accessMetadata?.[subject] || {};
      const hidden =
        accessEntry.Hidden === true ||
        deck.Hidden === true ||
        String(deck.Hidden || "").toLowerCase() === "true" ||
        String(accessEntry.Hidden || "").toLowerCase() === "true";
      if (hidden) return false;
      return true;
    });
  }

  // ===================== FOLDER NAVIGATION =====================
  function enterFolder(folderName, isLockedFolder) {
    const fullPath =
      state.currentPath && state.currentPath.length > 0
        ? state.currentPath.join("::") + "::" + folderName
        : folderName;

    const isUnlockedByUi =
      typeof globalScope.isFolderUnlocked === "function"
        ? globalScope.isFolderUnlocked(fullPath)
        : false;

    if (isLockedFolder && !isUnlockedByUi) {
      globalScope.openFolderPasswordModal(fullPath, folderName);
      return;
    }

    if (!state.currentPath) state.currentPath = [];
    state.currentPath.push(folderName);
    globalScope.persistNavigationPath(state.currentPath);
    globalScope.renderCategoryProgress();
  }

  function goToPath(index) {
    if (!state.currentPath) state.currentPath = [];
    if (index === -1) {
      state.currentPath = [];
    } else {
      state.currentPath = state.currentPath.slice(0, index + 1);
    }
    globalScope.persistNavigationPath(state.currentPath);
    globalScope.renderCategoryProgress();
  }

  // ===================== DECK LIFECYCLE & SESSION MANAGEMENT =====================
  async function fetchAndStartCategory(subject, mode, pass = null) {
    const loader = document.getElementById(
      globalScope.getDeckLoaderId(subject),
    );
    if (
      typeof globalScope.isDeckHidden === "function" &&
      globalScope.isDeckHidden(subject)
    ) {
      globalScope.showToast(
        "This deck is hidden and not available.",
        "warning",
      );
      return;
    }
    if (
      typeof globalScope.isDeckLocked === "function" &&
      globalScope.isDeckLocked(subject)
    ) {
      if (!pass) {
        globalScope.pendingDeckSubject = subject;
        globalScope.pendingDeckAction = mode;
        openDeckPasswordModal(subject, mode);
        return;
      }
    }

    // Define strict MCQ filter condition conditionally based on user preference
    const isForcedMCQ = state.prefs.qTypeOverride === "mcq";
    const customFilter = isForcedMCQ
      ? (q) =>
          q.ChoiceA &&
          q.ChoiceA.trim() !== "" &&
          q.ChoiceB &&
          q.ChoiceB.trim() !== ""
      : null;

    // Always attempt to fetch fresh data for gameplay sessions
    if (typeof globalScope.fetchDeckQuestions !== "function") {
      throw new Error("fetchDeckQuestions is not available.");
    }
    let validQuestions = await globalScope.fetchDeckQuestions(
      subject,
      pass,
      loader,
      customFilter,
    );
    if (!Array.isArray(validQuestions)) validQuestions = [];

    // Fallback check if offline and fetch returned empty
    if (validQuestions.length === 0) {
      if (
        typeof globalScope.isDeckLocked === "function" &&
        globalScope.isDeckLocked(subject)
      ) {
        globalScope.pendingDeckSubject = subject;
        globalScope.pendingDeckAction = mode;
        openDeckPasswordModal(subject, mode);
        return;
      }
      alert(
        `Cannot start session. You are offline and "${subject}" has not been downloaded to your device yet.`,
      );
      return;
    }

    if (!state.stats.completedQs) state.stats.completedQs = [];
    if (!state.stats.srsMap) state.stats.srsMap = {};

    let pool = [];
    if (mode === "continue") {
      pool = validQuestions.filter(
        (q) => !state.stats.completedQs.includes(q.ID),
      );

      if (state.prefs.srsEnabled === true) {
        const now = Date.now();
        const duePool = pool.filter((q) => {
          const srs = state.stats.srsMap?.[q.ID];
          if (!srs) return true;
          return Number(srs.due || 0) <= now;
        });

        if (duePool.length > 0) {
          pool = duePool;
        } else {
          const retryQueue = pool.slice(0);
          if (retryQueue.length > 0) {
            pool = retryQueue;
          }
        }
      }

      if (pool.length === 0) {
        if (state.prefs.srsEnabled === true) {
          const queue = validQuestions.filter(
            (q) => !state.stats.completedQs.includes(q.ID),
          );
          if (queue.length > 0) {
            pool = queue;
          } else {
            alert(
              `You have answered all available questions for ${subject}! Reset the category to start over.`,
            );
            return;
          }
        } else {
          alert(
            `You have answered all available questions for ${subject}! Reset the category to start over.`,
          );
          return;
        }
      }
    } else if (mode === "mistakes") {
      pool = validQuestions.filter((q) => state.stats.mistakes.includes(q.ID));
      if (pool.length === 0) {
        alert(`No mistakes to review for ${subject}! Great job.`);
        return;
      }
    }

    startCustomSession(pool).catch((error) => {
      console.error("Unable to start deck session:", error);
      globalScope.showToast?.(
        "Unable to start this session. Check your connection and try again.",
        "error",
      );
    });
  }

  async function startCustomSession(pool) {
    if (!Array.isArray(pool) || pool.length === 0) return false;
    if (typeof globalScope.prepareSessionPool !== "function")
      throw new Error("prepareSessionPool is not available.");
    if (
      typeof globalScope.navigate === "function" &&
      globalScope.navigate !== navigate
    ) {
      await globalScope.navigate("practice");
    } else {
      await navigate("practice");
    }
    document.getElementById("session-setup")?.classList.add("hidden");
    document.getElementById("session-active")?.classList.remove("hidden");

    pool = globalScope.prepareSessionPool(pool);
    if (!Array.isArray(pool) || pool.length === 0) return false;

    state.session = {
      active: true,
      questions: pool,
      currentIndex: 0,
      userAnswers: {},
      mode: "quiz",
      revealedCloze: false,
    };

    if (typeof globalScope.renderQuestion === "function")
      globalScope.renderQuestion();
    if (typeof globalScope.saveSessionProgress === "function")
      globalScope.saveSessionProgress();
    return true;
  }

  async function resetCategory(subject) {
    subject = decodeHandlerValue(subject);
    if (
      await requestConfirmation(
        `Are you sure you want to reset your accuracy and progress statistics for "${subject}"? This cannot be undone.`,
        "Reset Progress",
      )
    ) {
      if (state.stats.subjectAccuracy[subject]) {
        state.stats.subjectAccuracy[subject] = { total: 0, correct: 0 };
      }

      const subjectQIDs = getQuestionsForSubject(subject).map((q) => q.ID);

      if (state.stats.completedQs) {
        state.stats.completedQs = state.stats.completedQs.filter(
          (id) => !subjectQIDs.includes(id),
        );
      }

      if (state.stats.mistakes) {
        state.stats.mistakes = state.stats.mistakes.filter(
          (id) => !subjectQIDs.includes(id),
        );
      }

      if (state.stats.srsMap) {
        for (const id of subjectQIDs) {
          delete state.stats.srsMap[id];
        }
      }

      saveState();
      globalScope.renderCategoryProgress();
    }
  }

  // ===================== MODULE EXPORT =====================
  const DeckNavCore = {
    navigate,
    getVisibleCategorySummary,
    enterFolder,
    goToPath,
    fetchAndStartCategory,
    startCustomSession,
    resetCategory,
  };

  // Alias for backward compatibility
  const DeckNav = DeckNavCore;

  // Export to global scope
  globalScope.DeckNavCore = DeckNavCore;
  globalScope.DeckNav = DeckNav;

  // Export individual functions for backward compatibility
  globalScope.navigate = navigate;
  globalScope.getVisibleCategorySummary = getVisibleCategorySummary;
  globalScope.enterFolder = enterFolder;
  globalScope.goToPath = goToPath;
  globalScope.fetchAndStartCategory = fetchAndStartCategory;
  globalScope.startCustomSession = startCustomSession;
  globalScope.resetCategory = resetCategory;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DeckNavCore;
  }
})(typeof globalScope !== "undefined"
  ? globalScope
  : typeof globalThis !== "undefined"
    ? globalThis
    : this);