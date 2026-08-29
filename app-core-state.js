(function (globalScope) {
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
      layoutMode: "grid",
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

    const source = { ...question };
    const normalized = {
      Subject: firstAvailableValue(subjectOverride, source.Subject, source.s),
      ID: firstAvailableValue(source.ID, source.i),
      Question: firstAvailableValue(source.Question, source.q),
      ChoiceA: firstAvailableValue(source.ChoiceA, source.c?.[0]),
      ChoiceB: firstAvailableValue(source.ChoiceB, source.c?.[1]),
      ChoiceC: firstAvailableValue(source.ChoiceC, source.c?.[2]),
      ChoiceD: firstAvailableValue(source.ChoiceD, source.c?.[3]),
      Answer: firstAvailableValue(source.Answer, source.a),
      Explanation: firstAvailableValue(source.Explanation, source.e),
      ImageURL: firstAvailableValue(source.ImageURL, source.u),
      Tags: firstAvailableValue(source.Tags, source.t),
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

    (state.db || []).forEach((question) => {
      if (!question || typeof question !== "object") return;

      const normalized = normalizeQuestionRecord(question);
      const subject = String(normalized.Subject || "").trim();
      const id = String(normalized.ID || "").trim();

      if (subject) {
        const subjectList = bySubject.get(subject) || [];
        if (id) subjectList.push(id);
        bySubject.set(subject, subjectList);
      }

      if (id) {
        byId.set(id, normalized);
      }
    });

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
      .slice(0, 2000);
  }

  function normalizeStats(rawStats) {
    const source =
      rawStats && typeof rawStats === "object" && !Array.isArray(rawStats)
        ? rawStats
        : {};

    const subjectAccuracy =
      source.subjectAccuracy &&
      typeof source.subjectAccuracy === "object" &&
      !Array.isArray(source.subjectAccuracy)
        ? Object.fromEntries(
            Object.entries(source.subjectAccuracy)
              .filter(
                ([key, value]) =>
                  typeof key === "string" &&
                  (typeof value === "number" || typeof value === "string"),
              )
              .map(([key, value]) => [key, Number(value) || 0]),
          )
        : {};

    return {
      totalAnswered: Number.isFinite(Number(source.totalAnswered))
        ? Number(source.totalAnswered)
        : 0,
      correct: Number.isFinite(Number(source.correct))
        ? Number(source.correct)
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
      modeLabel.innerText = controls.globalModeToggle ? "Study" : "Quiz";
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
    if (statTotal) statTotal.innerText = state.stats.totalAnswered;

    const statCorrect = document.getElementById("stat-correct");
    if (statCorrect) statCorrect.innerText = state.stats.correct;

    const dbSize = document.getElementById("db-size-display");
    if (dbSize) dbSize.innerText = state.db.length;

    if (typeof globalScope.checkSavedSession === "function") {
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
    const savedStats = getStoredItem("stats");
    const savedPrefs = getStoredItem("prefs");
    const savedSummary =
      getStoredItem("summary") || getAnyNamespaceStoredItem("summary");
    const savedPath =
      typeof globalScope.readStoredNavigationPath === "function"
        ? globalScope.readStoredNavigationPath()
        : [];

    try {
      if (typeof idbKeyval !== "undefined") {
        const savedDb = await idbKeyval.get("mrh_db");
        if (savedDb) {
          state.db = savedDb.map((q) => {
            const normalized = normalizeQuestionRecord(q);
            if (normalized.ID && !normalized.ID.toString().includes("::")) {
              const cleanId = normalized.ID.toString().replace(
                /^[a-zA-Z]+[-\s]?/,
                "",
              );
              normalized.ID = `${normalized.Subject}::${cleanId}`;
            }
            return normalized;
          });
          rebuildQuestionIndex();
        }
      }
    } catch (err) {
      console.error("Error loading DB from IndexedDB", err);
    }

    if (savedSummary) {
      const parsedSummary = StorageUtils.safeParseJSON(savedSummary, null);
      if (Array.isArray(parsedSummary)) {
        state.categorySummary = normalizeCategorySummary(parsedSummary);
      } else {
        console.error("Summary corrupted, resetting.");
        state.categorySummary = [];
      }
    }

    ensureQuestionIndex();

    if (savedStats) {
      const parsedStats = StorageUtils.safeParseJSON(savedStats, null);
      if (parsedStats && typeof parsedStats === "object") {
        state.stats = normalizeStats(parsedStats);
      } else {
        console.error("Stats corrupted, resetting to default.");
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
        console.error("Invalid preferences.");
      }
    }

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
    if (dbSizeEl) {
      dbSizeEl.innerText = state.db ? state.db.length : 0;
    }

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

  function flushStateSave() {
    stateSaveQueued = false;
    try {
      if (typeof globalScope.emitDebugState === "function") {
        globalScope.emitDebugState("save_state:begin", {
          dbCount: state.db.length,
          summaryCount: state.categorySummary.length,
        });
      }

      state.stats = normalizeStats(state.stats);
      state.prefs = normalizePrefs(state.prefs);
      state.categorySummary = normalizeCategorySummary(
        state.categorySummary || [],
      );

      setStoredJSON("stats", state.stats);
      setStoredJSON("prefs", state.prefs);
      setStoredJSON("summary", state.categorySummary || []);
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
    } catch (e) {
      console.error(e);
    }

    if (typeof globalScope.emitDebugState === "function") {
      globalScope.emitDebugState("save_state:complete", {
        dbCount: state.db.length,
        summaryCount: state.categorySummary.length,
      });
    }

    const resolve = resolveStateSave;
    stateSavePromise = null;
    resolveStateSave = null;
    if (resolve) resolve();
  }

  function saveState() {
    if (!stateSavePromise) {
      stateSavePromise = new Promise((resolve) => {
        resolveStateSave = resolve;
      });
    }

    if (!stateSaveQueued) {
      stateSaveQueued = true;
      const scheduleFlush = () => {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(flushStateSave, { timeout: 300 });
        } else {
          setTimeout(flushStateSave, 150);
        }
      };
      if (typeof setTimeout === "function") {
        setTimeout(scheduleFlush, 0);
      } else if (typeof queueMicrotask === "function") {
        queueMicrotask(scheduleFlush);
      } else {
        Promise.resolve().then(scheduleFlush);
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
            console.warn("Unable to persist navigation path.", e);
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
    saveState: async function saveStateAlias() {
      return saveState();
    },
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppState;
  }

  globalScope.AppState = AppState;
})(typeof window !== "undefined" ? window : globalThis);
