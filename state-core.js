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
        if (id) subjectList.push(id);
        bySubject.set(subject, subjectList);
      }

      if (id) {
        byId.set(id, normalized);
      }
    });

    globalScope.state.subjectIndex = { bySubject, byId };
    return globalScope.state.subjectIndex;
  }

  function normalizeQuestionRecord(question) {
    if (!question || typeof question !== "object") return {};

    const source = { ...question };
    const normalized = {
      Subject: source.Subject ?? source.s ?? "",
      ID: source.ID ?? source.i ?? "",
      Question: source.Question ?? source.q ?? "",
      ChoiceA: source.ChoiceA ?? source.c?.[0] ?? "",
      ChoiceB: source.ChoiceB ?? source.c?.[1] ?? "",
      ChoiceC: source.ChoiceC ?? source.c?.[2] ?? "",
      ChoiceD: source.ChoiceD ?? source.c?.[3] ?? "",
      Answer: source.Answer ?? source.a ?? "",
      Explanation: source.Explanation ?? source.e ?? "",
      ImageURL: source.ImageURL ?? source.u ?? "",
      Tags: source.Tags ?? source.t ?? "",
    };

    if (typeof normalized.Answer === "number") {
      normalized.Answer = ["A", "B", "C", "D"][normalized.Answer] || "";
    }

    if (normalized.Answer) {
      normalized.Answer = String(normalized.Answer).trim().toUpperCase();
    }

    return normalized;
  }

  async function loadState() {
    globalScope.migrateLegacyStorageKeys();
    const savedStats = globalScope.getStoredItem("stats");
    const savedPrefs = globalScope.getStoredItem("prefs");
    const savedSummary =
      globalScope.getStoredItem("summary") ||
      globalScope.getAnyNamespaceStoredItem("summary");

    try {
      if (typeof idbKeyval !== "undefined") {
        const savedDb = await idbKeyval.get("mrh_db");
        if (savedDb) {
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
        globalScope.state.categorySummary = JSON.parse(savedSummary);
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
        globalScope.state.prefs.recentDecks = Array.isArray(
          globalScope.state.prefs.recentDecks,
        )
          ? globalScope.state.prefs.recentDecks
          : [];
        globalScope.state.prefs.discoverySearch =
          globalScope.state.prefs.discoverySearch || "";
        if (
          !Object.prototype.hasOwnProperty.call(prefs, "quizNavigationMode") &&
          prefs.quizNavigationPosition === "bottom"
        ) {
          globalScope.state.prefs.quizNavigationPosition = "auto";
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
      globalScope.state.prefs.quizNavigationPosition = "auto";
    if (
      !["top", "bottom"].includes(
        globalScope.state.prefs.reviewNavigationPosition,
      )
    )
      globalScope.state.prefs.reviewNavigationPosition = "top";
    if (globalScope.state.prefs.lastActivity?.mode) {
      globalScope.currentAppMode = globalScope.state.prefs.lastActivity.mode;
    }

    if (!globalScope.state.stats.subjectAccuracy)
      globalScope.state.stats.subjectAccuracy = {};
    if (
      !["idle", "immediate"].includes(
        globalScope.state.prefs.databaseUpdateMode,
      )
    )
      globalScope.state.prefs.databaseUpdateMode = "idle";
    if (globalScope.state.prefs?.darkMode)
      document.documentElement.classList.add("dark");

    const dbSizeEl = document.getElementById("db-size-display");
    if (dbSizeEl) {
      dbSizeEl.innerText = globalScope.state.db
        ? globalScope.state.db.length
        : 0;
    }

    globalScope.populateFilters();
    globalScope.bindDiscoveryUi();
    globalScope.updateDashboard();
    globalScope.updateThemeButton();
    globalScope.syncPreferenceControls();
    globalScope.emitDebugState("load_state:complete", {
      dbCount: globalScope.state.db.length,
      summaryCount: globalScope.state.categorySummary.length,
    });
  }

  async function saveState() {
    try {
      globalScope.emitDebugState("save_state:begin", {
        dbCount: globalScope.state.db.length,
        summaryCount: globalScope.state.categorySummary.length,
      });
      globalScope.setStoredJSON("stats", globalScope.state.stats);
      globalScope.setStoredJSON("prefs", globalScope.state.prefs);
      globalScope.setStoredJSON("summary", globalScope.state.categorySummary);
      if (
        !globalScope.suppressProgressSync &&
        typeof userState !== "undefined" &&
        userState.isLoggedIn
      ) {
        const meta = globalScope.getProgressMeta();
        meta.localUpdatedAt = new Date().toISOString();
        globalScope.setStoredJSON("progress_meta", meta);
        globalScope.queueProgressSync();
      }
    } catch (e) {
      console.error(e);
    }

    globalScope.syncPreferenceControls();
    globalScope.updateDashboard();
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
})(typeof window !== "undefined" ? window : globalThis);
