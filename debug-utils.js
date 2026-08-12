(function (globalScope) {
  function buildDebugSummary(inputState = {}) {
    const state =
      inputState && typeof inputState === "object" ? inputState : {};
    const db = Array.isArray(state.db) ? state.db : [];
    const summary = Array.isArray(state.categorySummary)
      ? state.categorySummary
      : [];
    const stats =
      state.stats && typeof state.stats === "object" ? state.stats : {};
    const prefs =
      state.prefs && typeof state.prefs === "object" ? state.prefs : {};
    const session =
      state.session && typeof state.session === "object" ? state.session : {};

    return {
      dbCount: db.length,
      summaryCount: summary.length,
      totalAnswered: Number(stats.totalAnswered || 0),
      correct: Number(stats.correct || 0),
      sessionActive: Boolean(session.active),
      searchQuery: String(prefs.discoverySearch || ""),
      darkMode: Boolean(prefs.darkMode),
      layoutMode: String(prefs.layoutMode || ""),
    };
  }

  function createDebugLogger(scopeName = "mrh") {
    function snapshot(label, details = {}) {
      const state =
        details && typeof details.state !== "undefined" ? details.state : {};
      const summary = buildDebugSummary(state);
      return {
        label: String(label || "debug"),
        scope: scopeName,
        timestamp: new Date().toISOString(),
        ...summary,
        ...details,
        state,
      };
    }

    function emit(label, details = {}) {
      const entry = snapshot(label, details);
      if (
        typeof globalScope !== "undefined" &&
        globalScope.__MRH_DEBUG__ &&
        typeof console !== "undefined" &&
        typeof console.debug === "function"
      ) {
        console.debug(`[${scopeName}]`, label, entry);
      }
      return entry;
    }

    return { snapshot, emit };
  }

  const DebugUtils = {
    buildDebugSummary,
    createDebugLogger,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = DebugUtils;
  }

  globalScope.DebugUtils = DebugUtils;
})(typeof window !== "undefined" ? window : globalThis);
