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
    const activeSink =
      root.__MRH_LOGGER__ && typeof root.__MRH_LOGGER__ === "object"
        ? root.__MRH_LOGGER__
        : null;

    function write(level, ...args) {
      if (!activeSink) return;
      const writer = activeSink?.[level];
      if (typeof writer !== "function") return;
      writer.call(activeSink, `[${scope}]`, ...args);
    }

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
      const sink =
        root.__MRH_LOGGER__ && typeof root.__MRH_LOGGER__ === "object"
          ? root.__MRH_LOGGER__
          : null;
      const debugEnabled =
        Boolean(root.__MRH_DEBUG__) && sink && typeof sink.debug === "function";

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
      sink.debug(`[${scope}]`, label, entry);
      return entry;
    }

    return {
      snapshot,
      emit,
      debug: (...args) => write("debug", ...args),
      info: (...args) => write("info", ...args),
      warn: (...args) => write("warn", ...args),
      error: (...args) => write("error", ...args),
    };
  }

  const defaultLogger = createDebugLogger("mrh");
  const DebugUtils = {
    buildDebugSummary,
    createDebugLogger,
    debug: (...args) => defaultLogger.debug(...args),
    info: (...args) => defaultLogger.info(...args),
    warn: (...args) => defaultLogger.warn(...args),
    error: (...args) => defaultLogger.error(...args),
  };

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
