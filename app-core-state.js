(function (globalScope) {
  const rootScope =
    globalScope || (typeof globalThis !== "undefined" ? globalThis : {});
  const lifecycle = rootScope.LifecycleUtils || rootScope;
  const MAX_CATEGORY_SUMMARY_ENTRIES =
    rootScope.MRH_CONFIG?.maxCategorySummaryEntries ?? 2000;

  /** @typedef {{Subject?: string, ID?: string, Question?: string, Answer?: string}} MrhQuestion */
  /** @typedef {{db: MrhQuestion[], categorySummary: object[], accessMetadata: object, prefs: object, stats: object, session: object, currentPath: string[]}} MrhState */

  /**
   * Shared application state object used by the runtime and persisted to storage.
   * This module intentionally keeps the state contract explicit to avoid implicit
   * global lookups during startup and reload.
   *
   * @type {MrhState}
   */

  /** @type {MrhState} */
  const state = {
    db: [],
    categorySummary: [],
    accessMetadata: {},
    subjectIndex: {
      bySubject: new Map(),
      byId: new Map(),
    },
    stats: {
      totalAnswered: 0,
      correct: 0,
      mistakes: [],
      subjectAccuracy: {},
      completedQs: [],
      srsMap: {},
    },
    prefs: {
      darkMode: true,
      layoutMode: "tree",
      activeRecall: false,
      shuffleChoices: true,
      shuffleQuestions: true,
      hideABCD: true,
      quizHideABCD: false,
      showWrongChoices: true,
      clozeEnabled: false,
      srsEnabled: false,
      archivedDecks: [],
      databaseUpdateMode: "immediate",
      quizNavigationPosition: "top",
      quizNavigationMode: "manual",
      reviewNavigationPosition: "top",
      studySingleNavigationPosition: "top",
      studyScrollNavigationPosition: "both",
      deckNavigationOverrides: {},
      deckSortBy: "letters",
      deckSortDirection: "asc",
      deckNameMode: "wrap",
      favoriteDecks: [],
      favoriteQuestions: [],
      studyFilterMode: "all",
      recentDecks: [],
      treeCollapsedPaths: [],
      deletedDecks: [],
      localDownloadDeletedDecks: [],
      lastActivity: null,
    },
    session: {
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
      autoNextTimeout: null,
      revealedCloze: false,
    },
    currentPath: [],
    reportQuestion: null,
    unlockedFolders: {},
  };
  function getStoredItem(key, fallback = null) {
    return StorageUtils.getStoredItem(key, fallback);
  }

  function getAnyNamespaceStoredItem(key, fallback = null) {
    return StorageUtils.getAnyNamespaceStoredItem(key, fallback);
  }

  function setStoredItem(key, value) {
    return StorageUtils.setStoredItem(key, value);
  }

  function removeStoredItem(key) {
    return StorageUtils.removeStoredItem(key);
  }

  function getStoredJSON(key, fallback = null) {
    return StorageUtils.getStoredJSON(key, fallback);
  }

  function setStoredJSON(key, value) {
    try {
      return StorageUtils.setStoredJSON(key, value);
    } catch (error) {
      return false;
    }
  }

  function getSessionStoredItem(key, fallback = null) {
    return StorageUtils.getSessionStoredItem(key, fallback);
  }

  function setSessionStoredItem(key, value) {
    return StorageUtils.setSessionStoredItem(key, value);
  }

  function removeSessionStoredItem(key) {
    return StorageUtils.removeSessionStoredItem(key);
  }

  function getSessionStoredJSON(key, fallback = null) {
    return StorageUtils.getSessionStoredJSON(key, fallback);
  }

  function setSessionStoredJSON(key, value) {
    return StorageUtils.setSessionStoredJSON(key, value);
  }

  function migrateLegacyStorageKeys() {
    return StorageUtils.migrateLegacyStorageKeys();
  }

  function purgeOrphanedStorage(identityToKeep = null) {
    return StorageUtils.purgeOrphanedStorage(identityToKeep);
  }

  function firstAvailableValue(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      return value;
    }
    return "";
  }

  function normalizeQuestionRecord(question, subjectOverride = null) {
    if (!question || typeof question !== "object") return {};

    const source = question;
    const choices = Array.isArray(source.c) ? source.c : null;
    const normalized = {
      Subject: firstAvailableValue(subjectOverride, source.Subject, source.s),
      ID: firstAvailableValue(source.ID, source.i),
      Question: firstAvailableValue(source.Question, source.q),
      ChoiceA: firstAvailableValue(source.ChoiceA, choices?.[0]),
      ChoiceB: firstAvailableValue(source.ChoiceB, choices?.[1]),
      ChoiceC: firstAvailableValue(source.ChoiceC, choices?.[2]),
      ChoiceD: firstAvailableValue(source.ChoiceD, choices?.[3]),
      Answer: firstAvailableValue(source.Answer, source.a),
      Explanation: firstAvailableValue(source.Explanation, source.e),
      ImageURL: firstAvailableValue(source.ImageURL, source.u),
      QuestionType: firstAvailableValue(source.QuestionType, source.t),
    };

    if (typeof normalized.Answer === "number") {
      normalized.Answer = ["A", "B", "C", "D"][normalized.Answer] || "";
    }

    if (normalized.Answer) {
      normalized.Answer = String(normalized.Answer).trim().toUpperCase();
    }

    return normalized;
  }

  function rebuildQuestionIndex() {
    const bySubject = new Map();
    const byId = new Map();

    for (const question of state.db || []) {
      if (!question || typeof question !== "object") continue;

      // The database is normalized on load. Re-normalize only legacy/unshaped
      // records instead of allocating a new object for every indexed question.
      const normalized =
        question.Subject !== undefined && question.ID !== undefined
          ? question
          : normalizeQuestionRecord(question);

      const subject = String(normalized.Subject || "").trim();
      const id = String(normalized.ID || "").trim();

      if (subject) {
        let subjectList = bySubject.get(subject);
        if (!subjectList) {
          subjectList = [];
          bySubject.set(subject, subjectList);
        }
        if (id) subjectList.push(id);
      }

      if (id) byId.set(id, normalized);
    }

    state.subjectIndex = { bySubject, byId };
    return state.subjectIndex;
  }

  function ensureQuestionIndex() {
    if (!state.subjectIndex || !state.subjectIndex.bySubject) {
      return rebuildQuestionIndex();
    }
    return state.subjectIndex;
  }

  function getQuestionsForSubject(subject, customFilter = null) {
    const index = ensureQuestionIndex();
    const targetSubject = String(subject || "").trim();
    if (!targetSubject) return [];

    const ids = index.bySubject.get(targetSubject) || [];
    const questions = ids
      .map((id) => index.byId.get(String(id)))
      .filter(Boolean);

    if (typeof customFilter === "function") {
      return questions.filter(customFilter);
    }

    return questions;
  }

  function normalizeCacheVersion(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function coerceBoolean(value, fallback = false) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return fallback;
  }

  function normalizeCategorySummary(rawSummary) {
    if (!Array.isArray(rawSummary)) return [];
    return rawSummary
      .filter((entry) => entry && typeof entry === "object")
      .slice(0, MAX_CATEGORY_SUMMARY_ENTRIES);
  }

  function normalizeStats(rawStats) {
    const source =
      rawStats && typeof rawStats === "object" && !Array.isArray(rawStats)
        ? rawStats
        : {};

    const subjectAccuracy = {};
    const rawSubjectAccuracy =
      source.subjectAccuracy &&
      typeof source.subjectAccuracy === "object" &&
      !Array.isArray(source.subjectAccuracy)
        ? source.subjectAccuracy
        : {};

    for (const [key, value] of Object.entries(rawSubjectAccuracy)) {
      if (!key) continue;

      if (value && typeof value === "object" && !Array.isArray(value)) {
        subjectAccuracy[key] = {
          total: Math.max(0, Number(value.total) || 0),
          correct: Math.max(0, Number(value.correct) || 0),
        };
      } else if (typeof value === "number" || typeof value === "string") {
        // Backward compatibility for older percentage/number-shaped data.
        const numeric = Math.max(0, Number(value) || 0);
        subjectAccuracy[key] = { total: 0, correct: numeric };
      }
    }

    return {
      totalAnswered: Number.isFinite(Number(source.totalAnswered))
        ? Math.max(0, Number(source.totalAnswered))
        : 0,
      correct: Number.isFinite(Number(source.correct))
        ? Math.max(0, Number(source.correct))
        : 0,
      mistakes: Array.isArray(source.mistakes)
        ? source.mistakes.filter(
            (entry) => entry !== null && entry !== undefined,
          )
        : [],
      subjectAccuracy,
      completedQs: Array.isArray(source.completedQs)
        ? source.completedQs.filter(
            (entry) => entry !== null && entry !== undefined,
          )
        : [],
      srsMap:
        source.srsMap &&
        typeof source.srsMap === "object" &&
        !Array.isArray(source.srsMap)
          ? source.srsMap
          : {},
    };
  }

  function normalizePrefs(rawPrefs) {
    const source =
      rawPrefs && typeof rawPrefs === "object" && !Array.isArray(rawPrefs)
        ? rawPrefs
        : {};

    const normalized = {
      ...state.prefs,
      ...source,
    };

    normalized.darkMode = coerceBoolean(normalized.darkMode, true);
    normalized.activeRecall = coerceBoolean(normalized.activeRecall, false);
    normalized.shuffleChoices = coerceBoolean(normalized.shuffleChoices, true);
    normalized.shuffleQuestions = coerceBoolean(
      normalized.shuffleQuestions,
      true,
    );
    normalized.hideABCD = coerceBoolean(normalized.hideABCD, true);
    normalized.quizHideABCD = coerceBoolean(normalized.quizHideABCD, false);
    normalized.showWrongChoices = coerceBoolean(
      normalized.showWrongChoices,
      true,
    );
    normalized.clozeEnabled = coerceBoolean(normalized.clozeEnabled, false);
    normalized.srsEnabled = coerceBoolean(normalized.srsEnabled, false);
    normalized.layoutMode = ["grid", "list", "tree"].includes(
      normalized.layoutMode,
    )
      ? normalized.layoutMode
      : "tree";

    normalized.archivedDecks = Array.isArray(normalized.archivedDecks)
      ? normalized.archivedDecks.filter((entry) => typeof entry === "string")
      : [];
    normalized.favoriteDecks = Array.isArray(normalized.favoriteDecks)
      ? normalized.favoriteDecks.filter((entry) => typeof entry === "string")
      : [];
    normalized.favoriteQuestions = Array.isArray(normalized.favoriteQuestions)
      ? normalized.favoriteQuestions.filter(
          (entry) => typeof entry === "string",
        )
      : [];
    normalized.recentDecks = Array.isArray(normalized.recentDecks)
      ? normalized.recentDecks.filter((entry) => typeof entry === "string")
      : [];
    normalized.treeCollapsedPaths = Array.isArray(normalized.treeCollapsedPaths)
      ? normalized.treeCollapsedPaths.filter(
          (entry) => typeof entry === "string",
        )
      : [];
    normalized.deletedDecks = Array.isArray(normalized.deletedDecks)
      ? normalized.deletedDecks.filter((entry) => typeof entry === "string")
      : [];
    normalized.localDownloadDeletedDecks = Array.isArray(
      normalized.localDownloadDeletedDecks,
    )
      ? normalized.localDownloadDeletedDecks.filter(
          (entry) => typeof entry === "string",
        )
      : [];

    const canonicalDeckNameMode = ["wrap", "clip"].includes(
      normalized.deckNameMode,
    )
      ? normalized.deckNameMode
      : ["wrap", "clip"].includes(normalized.titleMode)
        ? normalized.titleMode
        : "wrap";

    normalized.deckNameMode = canonicalDeckNameMode;
    normalized.titleMode = canonicalDeckNameMode;
    normalized.databaseUpdateMode = ["idle", "immediate"].includes(
      normalized.databaseUpdateMode,
    )
      ? normalized.databaseUpdateMode
      : "idle";
    normalized.quizNavigationPosition = ["top", "bottom", "auto"].includes(
      normalized.quizNavigationPosition,
    )
      ? normalized.quizNavigationPosition
      : "top";
    normalized.reviewNavigationPosition = ["top", "bottom"].includes(
      normalized.reviewNavigationPosition,
    )
      ? normalized.reviewNavigationPosition
      : "top";
    normalized.quizNavigationMode = ["manual", "auto"].includes(
      normalized.quizNavigationMode,
    )
      ? normalized.quizNavigationMode
      : "manual";
    normalized.studySingleNavigationPosition = [
      "top",
      "bottom",
      "auto",
    ].includes(normalized.studySingleNavigationPosition)
      ? normalized.studySingleNavigationPosition
      : "top";
    normalized.studyScrollNavigationPosition = [
      "top",
      "bottom",
      "both",
    ].includes(normalized.studyScrollNavigationPosition)
      ? normalized.studyScrollNavigationPosition
      : "both";
    normalized.lastActivity =
      normalized.lastActivity && typeof normalized.lastActivity === "object"
        ? normalized.lastActivity
        : null;

    return normalized;
  }

  function syncPreferenceControls() {
    if (typeof document === "undefined") return;

    const controls = {
      "toggle-active-recall": state.prefs.activeRecall === true,
      "toggle-shuffle-choices": state.prefs.shuffleChoices !== false,
      "toggle-modal-shuffle-choices": state.prefs.shuffleChoices !== false,
      "toggle-shuffle-questions": state.prefs.shuffleQuestions !== false,
      "toggle-hide-abcd": state.prefs.hideABCD === true,
      "toggle-quiz-hide-abcd": state.prefs.quizHideABCD === true,
      "toggle-cloze-mode": state.prefs.clozeEnabled === true,
      "toggle-main-cloze-mode": state.prefs.clozeEnabled === true,
      "toggle-srs-mode": state.prefs.srsEnabled === true,
      "toggle-main-srs-mode": state.prefs.srsEnabled === true,
      "toggle-wrong-choices": state.prefs.showWrongChoices !== false,
      "toggle-main-navigation-quiz":
        state.prefs.quizNavigationPosition === "bottom",
      "toggle-main-navigation-single":
        state.prefs.studySingleNavigationPosition === "bottom",
      "toggle-main-navigation-scroll":
        state.prefs.studyScrollNavigationPosition === "bottom",
      "toggle-session-navigation-bottom":
        state.prefs.quizNavigationPosition === "bottom",
      "toggle-review-navigation-bottom":
        typeof globalScope.getStudyNavigationPosition === "function" &&
        globalScope.getStudyNavigationPosition(
          state.prefs.studyLayout || "scroll",
        ) === "bottom",
      globalModeToggle: state.prefs.lastActivity?.mode === "review",
    };

    Object.entries(controls).forEach(([id, checked]) => {
      const control = document.getElementById(id);
      if (control) control.checked = checked;
    });

    const databaseUpdateMode = document.getElementById("database-update-mode");
    if (databaseUpdateMode) {
      databaseUpdateMode.value = state.prefs.databaseUpdateMode || "idle";
    }

    const deckNameMode = document.getElementById("deck-name-mode");
    if (deckNameMode) {
      deckNameMode.value = ["wrap", "clip"].includes(state.prefs.deckNameMode)
        ? state.prefs.deckNameMode
        : "wrap";
    }

    const modeLabel = document.getElementById("modeLabel");
    if (modeLabel) {
      modeLabel.textContent = controls.globalModeToggle ? "Study" : "Quiz";
    }

    const navigationSelect = document.getElementById(
      "navigation-position-select",
    );
    if (navigationSelect) {
      const reviewIsActive = document
        .getElementById("view-deck-review")
        ?.classList.contains("active");
      const navigationPosition = reviewIsActive
        ? globalScope.getStudyNavigationPosition?.(
            state.prefs.studyLayout || "scroll",
          )
        : globalScope.getQuizNavigationPosition?.();
      if (navigationPosition) navigationSelect.value = navigationPosition;
    }

    const sortBy = state.prefs.deckSortBy || "letters";
    const sortDirection =
      state.prefs.deckSortDirection === "desc" ? "desc" : "asc";
    const deckSortIcon = document.getElementById("deck-sort-icon");
    if (deckSortIcon) {
      deckSortIcon.className = `fa-solid fa-arrow-${sortDirection === "desc" ? "down" : "up"}`;
    }
    document
      .querySelectorAll(".deck-sort-option[data-sort-value]")
      .forEach((option) => {
        const check = option.querySelector(".sort-check");
        if (check)
          check.style.opacity = option.dataset.sortValue === sortBy ? "1" : "0";
      });
    document
      .querySelectorAll(".deck-sort-option[data-sort-direction]")
      .forEach((option) => {
        const check = option.querySelector(".sort-direction-check");
        if (check) {
          check.style.opacity =
            option.dataset.sortDirection === sortDirection ? "1" : "0";
        }
      });

    const warning = document.getElementById("shuffle-warning");
    if (warning) {
      const shouldShowWarning =
        state.prefs.shuffleChoices === false ||
        state.prefs.shuffleQuestions === false;
      warning.classList.toggle("hidden", !shouldShowWarning);
      warning.setAttribute("aria-hidden", String(!shouldShowWarning));
    }
  }

  function updateDashboard() {
    if (typeof document === "undefined") return;

    const statTotal = document.getElementById("stat-total");
    if (statTotal) statTotal.textContent = String(state.stats.totalAnswered);

    const statCorrect = document.getElementById("stat-correct");
    if (statCorrect) statCorrect.textContent = String(state.stats.correct);

    const dbSize = document.getElementById("db-size-display");
    if (dbSize) dbSize.textContent = String(state.db.length);

    if (
      typeof globalScope.checkSavedSession === "function" &&
      typeof globalScope.SessionCore?.checkSavedSession === "function"
    ) {
      globalScope.checkSavedSession();
    }
    if (typeof globalScope.renderCategoryProgress === "function") {
      globalScope.renderCategoryProgress();
    }
  }

  async function loadState() {
    if (typeof globalScope.emitDebugState === "function") {
      globalScope.emitDebugState("load_state:start");
    }

    globalScope.migrateLegacyStorageKeys?.();

    // Start IndexedDB immediately so its async I/O overlaps the synchronous
    // local-storage parsing below.
    let savedDbPromise = null;
    if (typeof idbKeyval !== "undefined") {
      try {
        savedDbPromise = idbKeyval.get("mrh_db");
      } catch (err) {
        DebugUtils.error("Error starting DB load from IndexedDB", err);
      }
    }

    const savedStats = getStoredItem("stats");
    const savedPrefs = getStoredItem("prefs");
    const savedSummary =
      getStoredItem("summary") || getAnyNamespaceStoredItem("summary");
    const savedPath =
      typeof globalScope.readStoredNavigationPath === "function"
        ? globalScope.readStoredNavigationPath()
        : [];

    if (savedSummary) {
      const parsedSummary = StorageUtils.safeParseJSON(savedSummary, null);
      if (Array.isArray(parsedSummary)) {
        state.categorySummary = normalizeCategorySummary(parsedSummary);
      } else {
        DebugUtils.error("Summary corrupted, resetting.");
        state.categorySummary = [];
      }
    }

    if (savedStats) {
      const parsedStats = StorageUtils.safeParseJSON(savedStats, null);
      if (parsedStats && typeof parsedStats === "object") {
        state.stats = normalizeStats(parsedStats);
      } else {
        DebugUtils.error("Stats corrupted, resetting to default.");
        state.stats = {
          totalAnswered: 0,
          correct: 0,
          mistakes: [],
          subjectAccuracy: {},
          completedQs: [],
          srsMap: {},
        };
      }
    }

    if (savedPrefs) {
      const parsedPrefs = StorageUtils.safeParseJSON(savedPrefs, null);
      if (parsedPrefs && typeof parsedPrefs === "object") {
        state.prefs = normalizePrefs({
          ...state.prefs,
          ...parsedPrefs,
        });
      } else {
        DebugUtils.error("Invalid preferences.");
      }
    }

    if (savedDbPromise) {
      try {
        const savedDb = await savedDbPromise;
        if (Array.isArray(savedDb)) {
          state.db = savedDb.map((q) => {
            const normalized = normalizeQuestionRecord(q);
            if (normalized.ID && !String(normalized.ID).includes("::")) {
              const cleanId = String(normalized.ID).replace(
                /^[a-zA-Z]+[-\s]?/,
                "",
              );
              normalized.ID = `${normalized.Subject}::${cleanId}`;
            }
            return normalized;
          });
        }
      } catch (err) {
        DebugUtils.error("Error loading DB from IndexedDB", err);
      }
    }

    rebuildQuestionIndex();

    if (
      !["top", "bottom", "auto"].includes(state.prefs.quizNavigationPosition)
    ) {
      state.prefs.quizNavigationPosition = "top";
    }
    if (!["top", "bottom"].includes(state.prefs.reviewNavigationPosition)) {
      state.prefs.reviewNavigationPosition = "top";
    }
    if (state.prefs.lastActivity?.mode) {
      globalScope.currentAppMode = state.prefs.lastActivity.mode;
    }

    if (!state.stats.subjectAccuracy) state.stats.subjectAccuracy = {};
    if (!["idle", "immediate"].includes(state.prefs.databaseUpdateMode)) {
      state.prefs.databaseUpdateMode = "idle";
    }
    if (state.prefs?.darkMode && typeof document !== "undefined") {
      document.documentElement.classList.add("dark");
    }

    state.currentPath =
      Array.isArray(savedPath) && savedPath.length > 0 ? savedPath : [];

    const dbSizeEl =
      typeof document !== "undefined"
        ? document.getElementById("db-size-display")
        : null;
    if (dbSizeEl) dbSizeEl.textContent = String(state.db.length);

    if (typeof globalScope.populateFilters === "function") {
      globalScope.populateFilters();
    }
    if (typeof globalScope.updateDashboard === "function") {
      globalScope.updateDashboard();
    }
    if (typeof globalScope.updateThemeButton === "function") {
      globalScope.updateThemeButton();
    }
    syncPreferenceControls();

    if (typeof globalScope.emitDebugState === "function") {
      globalScope.emitDebugState("load_state:complete", {
        dbCount: state.db.length,
        summaryCount: state.categorySummary.length,
      });
    }
  }

  let stateSavePromise = null;
  let resolveStateSave = null;
  let stateSaveQueued = false;
  let pendingSaveMask = 0;

  const SAVE_STATS = 1;
  const SAVE_PREFS = 2;
  const SAVE_SUMMARY = 4;
  const SAVE_PATH = 8;
  const SAVE_ALL = SAVE_STATS | SAVE_PREFS | SAVE_SUMMARY | SAVE_PATH;

  function flushStateSave() {
    stateSaveQueued = false;
    const saveMask = pendingSaveMask || SAVE_ALL;
    pendingSaveMask = 0;

    try {
      if (typeof globalScope.emitDebugState === "function") {
        globalScope.emitDebugState("save_state:begin", {
          dbCount: state.db.length,
          summaryCount: state.categorySummary.length,
          saveMask,
        });
      }

      // State is normalized at load/mutation boundaries. Avoid re-walking large
      // arrays and rebuilding objects every time a small statistic changes.
      if (saveMask & SAVE_STATS) setStoredJSON("stats", state.stats);
      if (saveMask & SAVE_PREFS) setStoredJSON("prefs", state.prefs);
      if (saveMask & SAVE_SUMMARY)
        setStoredJSON("summary", state.categorySummary || []);
      if (saveMask & SAVE_PATH) {
        if (typeof globalScope.persistNavigationPath === "function") {
          globalScope.persistNavigationPath(state.currentPath || []);
        } else {
          setStoredItem(
            "mrh_navigation_path",
            JSON.stringify(
              Array.isArray(state.currentPath) ? state.currentPath : [],
            ),
          );
        }
      }
    } catch (e) {
      DebugUtils.error(e);
    }

    if (typeof globalScope.emitDebugState === "function") {
      globalScope.emitDebugState("save_state:complete", {
        dbCount: state.db.length,
        summaryCount: state.categorySummary.length,
        saveMask,
      });
    }

    const resolve = resolveStateSave;
    stateSavePromise = null;
    resolveStateSave = null;
    if (resolve) resolve();
  }

  function saveState(dirty = "all") {
    if (!stateSavePromise) {
      stateSavePromise = new Promise((resolve) => {
        resolveStateSave = resolve;
      });
    }

    if (dirty === "stats") pendingSaveMask |= SAVE_STATS;
    else if (dirty === "prefs") pendingSaveMask |= SAVE_PREFS;
    else if (dirty === "summary") pendingSaveMask |= SAVE_SUMMARY;
    else if (dirty === "path") pendingSaveMask |= SAVE_PATH;
    else pendingSaveMask |= SAVE_ALL;

    if (!stateSaveQueued) {
      stateSaveQueued = true;
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(flushStateSave, { timeout: 300 });
      } else if (typeof setTimeout === "function") {
        lifecycle.setTimeout(flushStateSave, 100);
      } else if (typeof queueMicrotask === "function") {
        queueMicrotask(flushStateSave);
      } else {
        Promise.resolve().then(flushStateSave);
      }
    }

    return stateSavePromise;
  }

  globalScope.state = state;
  globalScope.persistNavigationPath =
    typeof globalScope.persistNavigationPath === "function"
      ? globalScope.persistNavigationPath
      : (path) => {
          const normalized = Array.isArray(path)
            ? path
                .filter((entry) => typeof entry === "string" && entry.trim())
                .map((entry) => String(entry).trim())
            : [];
          if (globalScope.state) globalScope.state.currentPath = normalized;
          try {
            setStoredItem("mrh_navigation_path", JSON.stringify(normalized));
          } catch (e) {
            DebugUtils.warn("Unable to persist navigation path.", e);
          }
        };
  globalScope.readStoredNavigationPath =
    typeof globalScope.readStoredNavigationPath === "function"
      ? globalScope.readStoredNavigationPath
      : () => {
          try {
            const raw = getStoredItem("mrh_navigation_path", "");
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) return [];
            return parsed
              .filter((entry) => typeof entry === "string" && entry.trim())
              .map((entry) => String(entry).trim());
          } catch (e) {
            return [];
          }
        };
  globalScope.getStoredItem = getStoredItem;
  globalScope.getAnyNamespaceStoredItem = getAnyNamespaceStoredItem;
  globalScope.setStoredItem = setStoredItem;
  globalScope.removeStoredItem = removeStoredItem;
  globalScope.getStoredJSON = getStoredJSON;
  globalScope.setStoredJSON = setStoredJSON;
  globalScope.getSessionStoredItem = getSessionStoredItem;
  globalScope.setSessionStoredItem = setSessionStoredItem;
  globalScope.removeSessionStoredItem = removeSessionStoredItem;
  globalScope.getSessionStoredJSON = getSessionStoredJSON;
  globalScope.setSessionStoredJSON = setSessionStoredJSON;
  globalScope.migrateLegacyStorageKeys = migrateLegacyStorageKeys;
  globalScope.purgeOrphanedStorage = purgeOrphanedStorage;
  globalScope.normalizeQuestionRecord = normalizeQuestionRecord;
  globalScope.rebuildQuestionIndex = rebuildQuestionIndex;
  globalScope.ensureQuestionIndex = ensureQuestionIndex;
  globalScope.getQuestionsForSubject = getQuestionsForSubject;
  globalScope.syncPreferenceControls = syncPreferenceControls;
  globalScope.updateDashboard = updateDashboard;

  const AppState = {
    state,
    getStoredItem,
    getAnyNamespaceStoredItem,
    setStoredItem,
    removeStoredItem,
    getStoredJSON,
    setStoredJSON,
    getSessionStoredItem,
    setSessionStoredItem,
    removeSessionStoredItem,
    getSessionStoredJSON,
    setSessionStoredJSON,
    migrateLegacyStorageKeys,
    purgeOrphanedStorage,
    normalizeQuestionRecord,
    rebuildQuestionIndex,
    ensureQuestionIndex,
    getQuestionsForSubject,
    syncPreferenceControls: function syncPreferenceControlsAlias() {
      return syncPreferenceControls();
    },
    normalizeCacheVersion,
    updateDashboard: function updateDashboardAlias() {
      return updateDashboard();
    },
    loadState: async function loadStateAlias() {
      return loadState();
    },
    saveState: async function saveStateAlias(dirty = "all") {
      return saveState(dirty);
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppState;
  }

  globalScope.AppState = AppState;
})(typeof window !== "undefined" ? window : globalThis);
