(function (globalScope) {
  "use strict";

  const root =
    globalScope || (typeof globalThis !== "undefined" ? globalThis : {});

  function asObject(value) {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};
  }

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function buildDebugSummary(inputState = {}) {
    const state =
      inputState && typeof inputState === "object" ? inputState : {};
    const db = Array.isArray(state.db) ? state.db : [];
    const summary = Array.isArray(state.categorySummary)
      ? state.categorySummary
      : [];
    const stats = asObject(state.stats);
    const prefs = asObject(state.prefs);
    const session = asObject(state.session);

    return {
      dbCount: db.length,
      summaryCount: summary.length,
      totalAnswered: Math.max(0, finiteNumber(stats.totalAnswered)),
      correct: Math.max(0, finiteNumber(stats.correct)),
      sessionActive: Boolean(session.active),
      darkMode: Boolean(prefs.darkMode),
      layoutMode: String(prefs.layoutMode ?? ""),
    };
  }

  function cloneDebugSafe(value, seen = new WeakSet()) {
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);

    if (Array.isArray(value))
      return value.map((item) => cloneDebugSafe(item, seen));

    const sensitiveKeys =
      /^(?:password|passcode|deckpassword|folderpassword|token|secret|apikey|api_key|authorization|cookie)$/i;
    const output = {};
    Object.keys(value).forEach((key) => {
      output[key] = sensitiveKeys.test(key)
        ? "[REDACTED]"
        : cloneDebugSafe(value[key], seen);
    });
    return output;
  }

  function createDebugLogger(scopeName = "mrh") {
    const scope = String(scopeName || "mrh");

    function snapshot(label, details = {}) {
      const safeDetails =
        details && typeof details === "object" ? { ...details } : {};
      const state = safeDetails.state;
      delete safeDetails.state;

      return {
        label: String(label || "debug"),
        scope,
        timestamp: new Date().toISOString(),
        ...buildDebugSummary(state),
        ...safeDetails,
        ...(state !== undefined ? { state: cloneDebugSafe(state) } : {}),
      };
    }

    function emit(label, details = {}) {
      const debugEnabled =
        Boolean(root.__MRH_DEBUG__) &&
        typeof console !== "undefined" &&
        typeof console.debug === "function";

      // Avoid deep-cloning the full application state when debug mode is off.
      // This is important because state snapshots can contain large question
      // banks and session arrays.
      if (!debugEnabled) {
        return {
          label: String(label || "debug"),
          scope,
          timestamp: new Date().toISOString(),
          ...buildDebugSummary(details?.state),
          ...(details && typeof details === "object"
            ? Object.fromEntries(
                Object.entries(details).filter(([key]) => key !== "state"),
              )
            : {}),
        };
      }

      const entry = snapshot(label, details);
      console.debug(`[${scope}]`, label, entry);
      return entry;
    }

    return { snapshot, emit };
  }

  const DebugUtils = { buildDebugSummary, createDebugLogger };

  if (typeof module !== "undefined" && module.exports)
    module.exports = DebugUtils;
  root.DebugUtils = DebugUtils;
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
