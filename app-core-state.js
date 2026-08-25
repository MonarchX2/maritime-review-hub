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
    return setStoredItem(key, JSON.stringify(value));
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
      try {
        state.categorySummary = JSON.parse(savedSummary);
      } catch (e) {
        console.error("Summary corrupted, resetting.", e);
        state.categorySummary = [];
      }
    }

    ensureQuestionIndex();

    if (savedStats) {
      try {
        state.stats = JSON.parse(savedStats);
      } catch (e) {
        console.error("Stats corrupted, resetting to default.", e);
        state.stats = {
          totalAnswered: 0,
          correct: 0,
          mistakes: [],
          subjectAccuracy: {},
        };
      }
    }

    if (savedPrefs) {
      try {
        const prefs = JSON.parse(savedPrefs);
        state.prefs = {
          ...state.prefs,
          ...prefs,
        };
        state.prefs.favoriteDecks = Array.isArray(state.prefs.favoriteDecks)
          ? state.prefs.favoriteDecks
          : [];
        state.prefs.recentDecks = Array.isArray(state.prefs.recentDecks)
          ? state.prefs.recentDecks
          : [];
        const canonicalDeckNameMode = ["wrap", "clip"].includes(
          state.prefs.deckNameMode,
        )
          ? state.prefs.deckNameMode
          : ["wrap", "clip"].includes(state.prefs.titleMode)
            ? state.prefs.titleMode
            : "wrap";
        state.prefs.deckNameMode = canonicalDeckNameMode;
        state.prefs.titleMode = canonicalDeckNameMode;
        if (!Object.prototype.hasOwnProperty.call(prefs, "activeRecall")) {
          state.prefs.activeRecall = false;
        }
        if (
          !Object.prototype.hasOwnProperty.call(prefs, "quizNavigationMode")
        ) {
          state.prefs.quizNavigationMode = "manual";
        }
        if (
          !Object.prototype.hasOwnProperty.call(prefs, "quizNavigationPosition")
        ) {
          state.prefs.quizNavigationPosition = "top";
        }
      } catch (e) {
        console.error("Invalid preferences.", e);
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

  async function saveState() {
    try {
      if (typeof globalScope.emitDebugState === "function") {
        globalScope.emitDebugState("save_state:begin", {
          dbCount: state.db.length,
          summaryCount: state.categorySummary.length,
        });
      }
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

    syncPreferenceControls();
    if (typeof globalScope.updateDashboard === "function") {
      globalScope.updateDashboard();
    }
    if (typeof globalScope.emitDebugState === "function") {
      globalScope.emitDebugState("save_state:complete", {
        dbCount: state.db.length,
        summaryCount: state.categorySummary.length,
      });
    }
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
