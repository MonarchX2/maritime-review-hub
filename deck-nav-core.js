// ============================================================================
// Deck Navigation Core - Category browsing, folder navigation, and deck lifecycle
// Extracted from app-core.js - Phase 5
// ============================================================================

(function (globalScope) {
  // Import global dependencies
  const {
    state,
    saveState,
    requestConfirmation,
    saveSessionProgress,
    startVisualTimer,
    getQuestionsForSubject,
    encodeHandlerValue,
    decodeHandlerValue,
    renderQuestion,
    navigate: originalNavigate,
    ensureAdminLoaded,
    getAdminToken,
    loadAdminSubjects,
    isDeckHidden,
    isDeckLocked,
    fetchDeckQuestions,
    prepareSessionPool,
    openDeckPasswordModal,
  } = globalScope;

  // ===================== VIEW NAVIGATION =====================
  let settingsClickCount = 0;
  let settingsClickTimeout = null;

  async function navigate(viewId) {
    if (viewId === "settings") {
      settingsClickCount++;
      clearTimeout(settingsClickTimeout);
      if (settingsClickCount >= 5) {
        const adminBtn = document.getElementById("btn-admin-nav");
        adminBtn.classList.remove("hidden");
        adminBtn.classList.add("animate-card-in");
        settingsClickCount = 0;
      } else {
        settingsClickTimeout = setTimeout(() => {
          settingsClickCount = 0;
        }, 2000);
      }
    }

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
    document.getElementById(`view-${viewId}`).classList.add("active");

    if (viewId === "stats") globalScope.renderCharts();

    // FIXED: Safely check if adminState is defined globally
    if (viewId === "admin") {
      await ensureAdminLoaded();
      const activeAdminToken =
        typeof getAdminToken === "function" ? getAdminToken() : "";
      if (activeAdminToken && typeof loadAdminSubjects === "function") {
        loadAdminSubjects();
      }
    }
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

    if (isLockedFolder) {
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
    if (isDeckHidden(subject)) {
      globalScope.showToast(
        "This deck is hidden and not available.",
        "warning",
      );
      return;
    }
    if (isDeckLocked(subject)) {
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
    let validQuestions = await fetchDeckQuestions(
      subject,
      pass,
      loader,
      customFilter,
    );

    // Fallback check if offline and fetch returned empty
    if (validQuestions.length === 0) {
      if (isDeckLocked(subject)) {
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

    startCustomSession(pool);
  }

  function startCustomSession(pool) {
    navigate("practice");
    document.getElementById("session-setup").classList.add("hidden");
    document.getElementById("session-active").classList.remove("hidden");

    pool = prepareSessionPool(pool);

    state.session = {
      active: true,
      questions: pool,
      currentIndex: 0,
      userAnswers: {},
      mode: "quiz",
      revealedCloze: false,
    };

    renderQuestion();
    saveSessionProgress();
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
})(globalScope);
