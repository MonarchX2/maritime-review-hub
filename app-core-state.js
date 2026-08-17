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
      showWrongChoices: false,
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

  globalScope.state = state;
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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppState;
  }

  globalScope.AppState = AppState;
})(typeof window !== "undefined" ? window : globalThis);
