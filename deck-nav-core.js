// ============================================================================
// Deck Navigation Core - Category browsing, folder navigation, and deck lifecycle
// Extracted from app-core.js - Phase 5
// ============================================================================

(function (globalScope) {
  const lifecycle = globalScope.LifecycleUtils || globalScope;
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

  if (typeof document !== "undefined") {
    const existingStyle = document.getElementById(
      "mrh-reset-deck-bounce-style",
    );
    if (!existingStyle) {
      const style = document.createElement("style");
      style.id = "mrh-reset-deck-bounce-style";
      style.textContent = `
        @keyframes mrhResetDeckBounce {
          0%, 100% { transform: translateY(0) scale(1); filter: saturate(1); }
          30% { transform: translateY(-2px) scale(1.04); filter: saturate(1.1); }
          55% { transform: translateY(1px) scale(0.99); filter: saturate(1.05); }
          75% { transform: translateY(-1px) scale(1.02); filter: saturate(1.08); }
        }
        .reset-deck-btn.mrh-reset-bouncing {
          animation: mrhResetDeckBounce 1.8s ease-in-out 2;
        }
      `;
      document.head.appendChild(style);
    }
  }

  // ===================== VIEW NAVIGATION =====================
  async function navigate(viewId) {
    const viewElement = document.getElementById(`view-${viewId}`);
    if (!viewElement) return false;
    if (viewElement.classList.contains("active")) return true;

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

    document
      .querySelectorAll(".view-section")
      .forEach((el) => el.classList.remove("active"));
    viewElement.classList.add("active");
    globalScope.updateDashboard();
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
    globalScope.invalidateCategoryProgressRenderSignature?.();
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
    globalScope.invalidateCategoryProgressRenderSignature?.();
    globalScope.renderCategoryProgress();
  }

  function triggerDeckResetBounce(subject) {
    const normalized = String(subject || "").trim();
    if (!normalized) return;

    const buttons = Array.from(
      document.querySelectorAll(".reset-deck-btn[data-reset-subject]"),
    );
    const button =
      buttons.find((el) => {
        const value = String(el.dataset.resetSubject || "").trim();
        return value === normalized || value === decodeURIComponent(normalized);
      }) || document.querySelector(".reset-deck-btn");

    if (!button) return;

    button.classList.remove("mrh-reset-bouncing");
    void button.offsetWidth;
    button.classList.add("mrh-reset-bouncing");
    clearTimeout(button.__mrhResetBounceTimer);
    button.__mrhResetBounceTimer = lifecycle.setTimeout(() => {
      button.classList.remove("mrh-reset-bouncing");
    }, 1600);
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

    // Fallback check if fetch returned empty; keep the user in-app and let them retry.
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
      globalScope.showToast?.(
        `Could not refresh "${subject}". Please try again in a moment.`,
        "warning",
      );
      return;
    }

    if (!state.stats.completedQs) state.stats.completedQs = [];
    if (!state.stats.srsMap) state.stats.srsMap = {};

    // Set membership turns repeated O(n) includes() checks into O(1) lookups
    // for large question banks.
    const completedSet = new Set(state.stats.completedQs);
    const mistakesSet = new Set(state.stats.mistakes || []);

    let pool = [];
    if (mode === "continue") {
      pool = validQuestions.filter((q) => !completedSet.has(q.ID));

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
          if (pool.length > 0) {
            // Keep the existing pool; no copy is needed.
          }
        }
      }

      if (pool.length === 0) {
        if (state.prefs.srsEnabled === true) {
          const queue = validQuestions.filter((q) => !completedSet.has(q.ID));
          if (queue.length > 0) {
            pool = queue;
          } else {
            triggerDeckResetBounce(subject);
            globalScope.showToast?.(
              "You have answered all available questions. Reset to start over.",
              "info",
            );
            return;
          }
        } else {
          triggerDeckResetBounce(subject);
          globalScope.showToast?.(
            "You have answered all available questions. Reset to start over.",
            "info",
          );
          return;
        }
      }
    } else if (mode === "mistakes") {
      pool = validQuestions.filter((q) => mistakesSet.has(q.ID));
      if (pool.length === 0) {
        globalScope.showToast?.(
          `No mistakes to review for ${subject}. Great job.`,
          "success",
        );
        return;
      }
    }

    startCustomSession(pool).catch((error) => {
      DebugUtils.error("Unable to start deck session:", error);
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
      const subjectIdSet = new Set(subjectQIDs);

      if (state.stats.completedQs) {
        state.stats.completedQs = state.stats.completedQs.filter(
          (id) => !subjectIdSet.has(id),
        );
      }

      if (state.stats.mistakes) {
        state.stats.mistakes = state.stats.mistakes.filter(
          (id) => !subjectIdSet.has(id),
        );
      }

      if (state.stats.srsMap) {
        for (const id of subjectQIDs) {
          delete state.stats.srsMap[id];
        }
      }

      saveState();
      globalScope.invalidateCategoryProgressRenderSignature?.();
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

  // Export to global scope
  globalScope.DeckNavCore = DeckNavCore;

  // Export individual functions for backward compatibility
  globalScope.navigate = navigate;
  globalScope.getVisibleCategorySummary = getVisibleCategorySummary;
  globalScope.enterFolder = enterFolder;
  globalScope.goToPath = goToPath;
  globalScope.fetchAndStartCategory = fetchAndStartCategory;
  globalScope.startCustomSession = startCustomSession;
  globalScope.resetCategory = resetCategory;
  globalScope.triggerDeckResetBounce = triggerDeckResetBounce;

  // For Node.js testing - export as CommonJS if in test environment
  if (typeof module !== "undefined" && module.exports) {
    module.exports = DeckNavCore;
  }
})(
  typeof globalScope !== "undefined"
    ? globalScope
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
