(function (globalScope) {
  function ensureQuestionIndex() {
    if (
      !globalScope.state?.subjectIndex ||
      !globalScope.state.subjectIndex.bySubject
    ) {
      return rebuildQuestionIndex();
    }
    return globalScope.state.subjectIndex;
  }

  function rebuildQuestionIndex() {
    const bySubject = new Map();
    const byId = new Map();

    (globalScope.state?.db || []).forEach((question) => {
      if (!question || typeof question !== "object") return;

      const normalized = normalizeQuestionRecord(question);
      const subject = String(normalized.Subject || "").trim();
      const id = String(normalized.ID || "").trim();

      if (subject) {
        const subjectList = bySubject.get(subject) || [];
        if (id && !subjectList.includes(id)) subjectList.push(id);
        bySubject.set(subject, subjectList);
      }

      if (id) {
        byId.set(id, normalized);
      }
    });

    globalScope.state.subjectIndex = { bySubject, byId };
    return globalScope.state.subjectIndex;
  }

  function firstAvailableValue(...values) {
    for (const value of values) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      return value;
    }
    return "";
  }

  function stripAccessMetadataFromSummary(summaryData) {
    if (!Array.isArray(summaryData)) return summaryData;
    return summaryData.map((deck) => {
      if (!deck || typeof deck !== "object") return deck;
      const { Password, password, Hidden, Locked, ...rest } = deck;
      return rest;
    });
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

    if (normalized.Answer !== "") {
      const answer = String(normalized.Answer).trim().toUpperCase();
      const numericAnswer = Number(answer);
      if (/^\d$/.test(answer) && Number.isInteger(numericAnswer)) {
        normalized.Answer = ["A", "B", "C", "D"][numericAnswer] || "";
      } else {
        const letterMatch = answer.match(/\b([ABCD])\b/);
        normalized.Answer = letterMatch ? letterMatch[1] : "";
      }
    }

    return normalized;
  }

  async function loadState() {
    if (!globalScope.state || typeof globalScope.state !== "object") {
      throw new Error("Application state is not initialized.");
    }
    if (
      !globalScope.state.stats ||
      typeof globalScope.state.stats !== "object"
    ) {
      globalScope.state.stats = {};
    }
    if (
      !globalScope.state.prefs ||
      typeof globalScope.state.prefs !== "object"
    ) {
      globalScope.state.prefs = {};
    }
    globalScope.state.db = Array.isArray(globalScope.state.db)
      ? globalScope.state.db
      : [];
    globalScope.state.categorySummary = Array.isArray(
      globalScope.state.categorySummary,
    )
      ? globalScope.state.categorySummary
      : [];
    if (typeof globalScope.migrateLegacyStorageKeys === "function")
      globalScope.migrateLegacyStorageKeys();
    const getStoredItem =
      typeof globalScope.getStoredItem === "function"
        ? globalScope.getStoredItem.bind(globalScope)
        : (_key, fallback = null) => fallback;
    const savedStats = getStoredItem("stats");
    const savedPrefs = getStoredItem("prefs");
    const savedSummary =
      getStoredItem("summary") ||
      (typeof globalScope.getAnyNamespaceStoredItem === "function"
        ? globalScope.getAnyNamespaceStoredItem("summary")
        : null);

    try {
      if (typeof idbKeyval !== "undefined") {
        const savedDb = await idbKeyval.get("mrh_db");
        if (Array.isArray(savedDb)) {
          globalScope.state.db = savedDb.map((q) => {
            const normalized = normalizeQuestionRecord(q);
            if (normalized.ID && !normalized.ID.toString().includes("::")) {
              let cleanId = normalized.ID.toString().replace(
                /^[a-zA-Z]+[-\s]?/,
                "",
              );
              normalized.ID = `${normalized.Subject}::${cleanId}`;
            }
            return normalized;
          });
          rebuildQuestionIndex();
        }
      } else {
        console.warn("idbKeyval library not loaded.");
      }
    } catch (err) {
      console.error("Error loading DB from IndexedDB", err);
    }

    if (savedSummary) {
      try {
        globalScope.state.categorySummary = stripAccessMetadataFromSummary(
          JSON.parse(savedSummary),
        );
      } catch (e) {
        console.error("Summary corrupted, resetting.", e);
        globalScope.state.categorySummary = [];
      }
    }

    ensureQuestionIndex();

    if (savedStats) {
      try {
        globalScope.state.stats = JSON.parse(savedStats);
      } catch (e) {
        console.error("Stats corrupted, resetting to default.", e);
        globalScope.state.stats = {
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
        globalScope.state.prefs = {
          ...globalScope.state.prefs,
          ...prefs,
        };
        globalScope.state.prefs.favoriteDecks = Array.isArray(
          globalScope.state.prefs.favoriteDecks,
        )
          ? globalScope.state.prefs.favoriteDecks
          : [];
        globalScope.state.prefs.favoriteQuestions = Array.isArray(
          globalScope.state.prefs.favoriteQuestions,
        )
          ? globalScope.state.prefs.favoriteQuestions
          : [];
        globalScope.state.prefs.studyFilterMode =
          globalScope.state.prefs.studyFilterMode === "favorites"
            ? "favorites"
            : "all";
        globalScope.state.prefs.recentDecks = Array.isArray(
          globalScope.state.prefs.recentDecks,
        )
          ? globalScope.state.prefs.recentDecks
          : [];
        globalScope.state.prefs.clozeEnabled =
          globalScope.state.prefs.clozeEnabled === true;
        globalScope.state.prefs.srsEnabled =
          globalScope.state.prefs.srsEnabled === true;
        if (!Object.prototype.hasOwnProperty.call(prefs, "activeRecall")) {
          globalScope.state.prefs.activeRecall = false;
        }
        if (
          !Object.prototype.hasOwnProperty.call(prefs, "quizNavigationMode")
        ) {
          globalScope.state.prefs.quizNavigationMode = "manual";
        }
        if (
          !Object.prototype.hasOwnProperty.call(prefs, "quizNavigationPosition")
        ) {
          globalScope.state.prefs.quizNavigationPosition = "top";
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            prefs,
            "studySingleNavigationPosition",
          ) &&
          globalScope.state.prefs.reviewNavigationPosition
        ) {
          globalScope.state.prefs.studySingleNavigationPosition =
            globalScope.state.prefs.reviewNavigationPosition;
        }
        if (
          !Object.prototype.hasOwnProperty.call(
            prefs,
            "studyScrollNavigationPosition",
          )
        ) {
          globalScope.state.prefs.studyScrollNavigationPosition =
            globalScope.state.prefs.reviewNavigationPosition || "top";
        }
        if (!["wrap", "clip"].includes(globalScope.state.prefs.deckNameMode)) {
          globalScope.state.prefs.deckNameMode = "wrap";
        }
      } catch (e) {
        console.error("Invalid preferences.", e);
      }
    }

    if (
      !["top", "bottom", "auto"].includes(
        globalScope.state.prefs.quizNavigationPosition,
      )
    )
      globalScope.state.prefs.quizNavigationPosition = "top";
    if (
      !["top", "bottom"].includes(
        globalScope.state.prefs.reviewNavigationPosition,
      )
    )
      globalScope.state.prefs.reviewNavigationPosition = "top";
    if (
      !["top", "bottom"].includes(
        globalScope.state.prefs.studySingleNavigationPosition,
      )
    )
      globalScope.state.prefs.studySingleNavigationPosition = "top";
    if (
      !["top", "bottom", "both"].includes(
        globalScope.state.prefs.studyScrollNavigationPosition,
      )
    )
      globalScope.state.prefs.studyScrollNavigationPosition = "both";
    if (globalScope.state.prefs.lastActivity?.mode) {
      globalScope.currentAppMode = globalScope.state.prefs.lastActivity.mode;
    }

    globalScope.state.stats =
      globalScope.state.stats && typeof globalScope.state.stats === "object"
        ? globalScope.state.stats
        : {};
    globalScope.state.stats.totalAnswered = Number(
      globalScope.state.stats.totalAnswered || 0,
    );
    globalScope.state.stats.correct = Number(
      globalScope.state.stats.correct || 0,
    );
    globalScope.state.stats.mistakes = Array.isArray(
      globalScope.state.stats.mistakes,
    )
      ? globalScope.state.stats.mistakes
      : [];
    globalScope.state.stats.completedQs = Array.isArray(
      globalScope.state.stats.completedQs,
    )
      ? globalScope.state.stats.completedQs
      : [];
    globalScope.state.stats.srsMap =
      globalScope.state.stats.srsMap &&
      typeof globalScope.state.stats.srsMap === "object"
        ? globalScope.state.stats.srsMap
        : {};
    globalScope.state.stats.subjectAccuracy =
      globalScope.state.stats.subjectAccuracy &&
      typeof globalScope.state.stats.subjectAccuracy === "object"
        ? globalScope.state.stats.subjectAccuracy
        : {};
    if (
      !["idle", "immediate"].includes(
        globalScope.state.prefs.databaseUpdateMode,
      )
    )
      globalScope.state.prefs.databaseUpdateMode = "immediate";
    if (globalScope.state.prefs?.darkMode && typeof document !== "undefined") {
      document.documentElement.classList.add("dark");
    }

    const savedPath =
      typeof globalScope.readStoredNavigationPath === "function"
        ? globalScope.readStoredNavigationPath()
        : [];
    globalScope.state.currentPath =
      Array.isArray(savedPath) && savedPath.length > 0 ? savedPath : [];

    const dbSizeEl =
      typeof document !== "undefined"
        ? document.getElementById("db-size-display")
        : null;
    if (dbSizeEl) {
      dbSizeEl.innerText = globalScope.state.db
        ? globalScope.state.db.length
        : 0;
    }

    if (typeof globalScope.populateFilters === "function")
      globalScope.populateFilters();
    if (typeof globalScope.bindDiscoveryUi === "function")
      globalScope.bindDiscoveryUi();
    if (typeof globalScope.updateDashboard === "function")
      globalScope.updateDashboard();
    if (typeof globalScope.updateThemeButton === "function")
      globalScope.updateThemeButton();
    if (typeof globalScope.syncPreferenceControls === "function")
      globalScope.syncPreferenceControls();
    if (typeof globalScope.emitDebugState === "function")
      globalScope.emitDebugState("load_state:complete", {
        dbCount: globalScope.state.db.length,
        summaryCount: globalScope.state.categorySummary.length,
      });
  }

  async function saveState() {
    try {
      if (typeof globalScope.emitDebugState === "function")
        globalScope.emitDebugState("save_state:begin", {
          dbCount: globalScope.state.db.length,
          summaryCount: globalScope.state.categorySummary.length,
        });
      if (typeof globalScope.setStoredJSON !== "function")
        throw new Error("Storage helpers are not available.");
      globalScope.setStoredJSON("stats", globalScope.state.stats);
      globalScope.setStoredJSON("prefs", globalScope.state.prefs);
      globalScope.setStoredJSON(
        "summary",
        stripAccessMetadataFromSummary(globalScope.state.categorySummary || []),
      );
      if (typeof globalScope.persistNavigationPath === "function") {
        globalScope.persistNavigationPath(globalScope.state.currentPath || []);
      } else {
        globalScope.setStoredItem(
          "mrh_navigation_path",
          JSON.stringify(
            Array.isArray(globalScope.state.currentPath)
              ? globalScope.state.currentPath
              : [],
          ),
        );
      }
    } catch (e) {
      console.error(e);
    }

    if (typeof globalScope.syncPreferenceControls === "function")
      globalScope.syncPreferenceControls();
    if (typeof globalScope.updateDashboard === "function")
      globalScope.updateDashboard();
    if (typeof globalScope.emitDebugState === "function")
      globalScope.emitDebugState("save_state:complete", {
        dbCount: globalScope.state.db.length,
        summaryCount: globalScope.state.categorySummary.length,
      });
  }

  const StateCore = {
    normalizeQuestionRecord,
    rebuildQuestionIndex,
    ensureQuestionIndex,
    loadState,
    saveState,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = StateCore;
  }

  globalScope.StateCore = StateCore;

  // app-core delegates state persistence through the historical AppState
  // name. Keep that compatibility contract while exposing StateCore.
  globalScope.AppState = StateCore;
})(typeof window !== "undefined" ? window : globalThis);
