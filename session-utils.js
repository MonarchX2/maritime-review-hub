(function (globalScope) {
  "use strict";

  const nodeStorage =
    globalThis.__mrhNodeStorage ||
    (globalThis.__mrhNodeStorage = Object.create(null));
  const DEFAULT_PROGRESS_SAVE_TYPE = "save_progress";
  const DEFAULT_PROGRESS_GET_TYPE = "get_progress";

  function getRuntimeState() {
    return globalScope.state && typeof globalScope.state === "object"
      ? globalScope.state
      : {};
  }

  function getFunction(name) {
    return typeof globalScope[name] === "function" ? globalScope[name] : null;
  }

  function safeReadStorage(key, fallback = null) {
    try {
      const reader = getFunction("getStoredItem");
      if (reader) {
        const value = reader(key, fallback);
        return value === undefined || value === null ? fallback : value;
      }
      if (typeof globalThis.localStorage !== "undefined") {
        const value = globalThis.localStorage.getItem(key);
        return value === null ? fallback : value;
      }
    } catch (_) {}
    return Object.prototype.hasOwnProperty.call(nodeStorage, key)
      ? nodeStorage[key]
      : fallback;
  }

  function safeWriteStorage(key, value) {
    try {
      const writer = getFunction("setStoredItem");
      if (writer) return writer(key, value);
      if (typeof globalThis.localStorage !== "undefined") {
        globalThis.localStorage.setItem(key, String(value));
        return value;
      }
    } catch (_) {}
    nodeStorage[key] = value;
    return value;
  }

  function safeDeleteStorage(key) {
    try {
      const remover = getFunction("removeStoredItem");
      if (remover) return remover(key);
      if (typeof globalThis.localStorage !== "undefined") {
        globalThis.localStorage.removeItem(key);
        return;
      }
    } catch (_) {}
    delete nodeStorage[key];
  }

  function safeReadJSON(key, fallback = null) {
    const raw = safeReadStorage(key, null);
    if (raw === null || raw === undefined || raw === "") return fallback;
    if (typeof raw === "object") return raw;
    try {
      return JSON.parse(String(raw));
    } catch (_) {
      return fallback;
    }
  }

  function safeWriteJSON(key, value) {
    return safeWriteStorage(key, JSON.stringify(value));
  }

  function safeBase64Url(value) {
    const text = String(value ?? "");
    let bytes;
    if (typeof TextEncoder === "function") {
      bytes = new TextEncoder().encode(text);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1)
        binary += String.fromCharCode(bytes[i]);
      const encoded =
        typeof btoa === "function"
          ? btoa(binary)
          : typeof Buffer !== "undefined"
            ? Buffer.from(bytes).toString("base64")
            : text;
      return encoded
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
    if (typeof Buffer !== "undefined") {
      return Buffer.from(text, "utf8")
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
    }
    return text;
  }

  function getProgressPayload() {
    const currentState = getRuntimeState();
    const prefs =
      currentState.prefs && typeof currentState.prefs === "object"
        ? currentState.prefs
        : {};
    const stats =
      currentState.stats && typeof currentState.stats === "object"
        ? currentState.stats
        : {};

    return {
      version: 2,
      stats: {
        totalAnswered: Math.max(0, Number(stats.totalAnswered) || 0),
        correct: Math.max(0, Number(stats.correct) || 0),
        mistakes: Array.isArray(stats.mistakes) ? [...stats.mistakes] : [],
        completedQs: Array.isArray(stats.completedQs)
          ? [...stats.completedQs]
          : [],
        subjectAccuracy:
          stats.subjectAccuracy && typeof stats.subjectAccuracy === "object"
            ? stats.subjectAccuracy
            : {},
        srsMap:
          stats.srsMap && typeof stats.srsMap === "object" ? stats.srsMap : {},
      },
      prefs: { ...prefs },
      savedSession: safeReadJSON("saved_session", null),
      deckState: {
        downloadedDecks: Array.isArray(currentState.db)
          ? [...new Set(currentState.db.map((q) => q?.Subject).filter(Boolean))]
          : [],
        archivedDecks: Array.isArray(prefs.archivedDecks)
          ? [...prefs.archivedDecks]
          : [],
        studyProgress:
          prefs.studyProgress && typeof prefs.studyProgress === "object"
            ? prefs.studyProgress
            : {},
        qToggles:
          prefs.qToggles && typeof prefs.qToggles === "object"
            ? prefs.qToggles
            : {},
        lastActivity: prefs.lastActivity || null,
      },
      localState: {
        categorySummary: Array.isArray(currentState.categorySummary)
          ? currentState.categorySummary
          : [],
        currentPath: Array.isArray(currentState.currentPath)
          ? [...currentState.currentPath]
          : [],
        appMode:
          typeof globalScope.currentAppMode === "string"
            ? globalScope.currentAppMode
            : null,
        dbSize: Array.isArray(currentState.db) ? currentState.db.length : 0,
      },
    };
  }

  function getProgressMeta() {
    const meta = safeReadJSON("progress_meta", {});
    return meta && typeof meta === "object" ? meta : {};
  }

  function setProgressMeta(updatedAt, serverUpdatedAt = updatedAt || "") {
    const runtimeState = getRuntimeState();
    const cleanServer = String(serverUpdatedAt || updatedAt || "");
    runtimeState.progressServerUpdatedAt = cleanServer;
    safeWriteJSON("progress_meta", {
      updatedAt: cleanServer,
      localUpdatedAt: String(updatedAt || cleanServer || ""),
      serverUpdatedAt: cleanServer,
    });
    return cleanServer;
  }

  function clearLocalUserProgress() {
    const currentState = getRuntimeState();
    currentState.stats = {
      totalAnswered: 0,
      correct: 0,
      mistakes: [],
      completedQs: [],
      subjectAccuracy: {},
      srsMap: {},
    };
    currentState.session = {
      ...(currentState.session || {}),
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
      autoNextTimeout: null,
    };
    currentState.prefs = currentState.prefs || {};
    currentState.prefs.studyProgress = {};
    currentState.prefs.qToggles = {};
    currentState.prefs.lastActivity = null;

    [
      "stats",
      "saved_session",
      "progress_meta",
      "pending_sync_queue",
      "recovery_snapshot",
    ].forEach(safeDeleteStorage);

    return true;
  }

  function hasLocalProgress() {
    const keys = ["stats", "saved_session", "prefs", "pending_sync_queue"];
    return keys.some((key) => {
      const value = safeReadStorage(key, null);
      return value !== null && value !== undefined && value !== "";
    });
  }

  function applyRemoteProgress(payload, updatedAt) {
    if (!payload || typeof payload !== "object") return false;
    const currentState = getRuntimeState();
    const previousSuppress = globalScope.suppressProgressSync === true;
    globalScope.suppressProgressSync = true;

    try {
      if (payload.stats && typeof payload.stats === "object") {
        currentState.stats = {
          totalAnswered: Math.max(0, Number(payload.stats.totalAnswered) || 0),
          correct: Math.max(0, Number(payload.stats.correct) || 0),
          mistakes: Array.isArray(payload.stats.mistakes)
            ? payload.stats.mistakes
            : [],
          completedQs: Array.isArray(payload.stats.completedQs)
            ? payload.stats.completedQs
            : [],
          subjectAccuracy:
            payload.stats.subjectAccuracy &&
            typeof payload.stats.subjectAccuracy === "object"
              ? payload.stats.subjectAccuracy
              : {},
          srsMap:
            payload.stats.srsMap && typeof payload.stats.srsMap === "object"
              ? payload.stats.srsMap
              : {},
        };
        safeWriteJSON("stats", currentState.stats);
      }

      if (payload.prefs && typeof payload.prefs === "object") {
        const userId = currentState.prefs?.userId;
        currentState.prefs = {
          ...(currentState.prefs || {}),
          ...payload.prefs,
        };
        if (userId !== undefined) currentState.prefs.userId = userId;
        safeWriteJSON("prefs", currentState.prefs);
      }

      if (payload.deckState && typeof payload.deckState === "object") {
        currentState.prefs = currentState.prefs || {};
        if (Array.isArray(payload.deckState.archivedDecks)) {
          currentState.prefs.archivedDecks = payload.deckState.archivedDecks;
        }
        if (
          payload.deckState.studyProgress &&
          typeof payload.deckState.studyProgress === "object"
        ) {
          currentState.prefs.studyProgress = payload.deckState.studyProgress;
        }
        if (
          payload.deckState.qToggles &&
          typeof payload.deckState.qToggles === "object"
        ) {
          currentState.prefs.qToggles = payload.deckState.qToggles;
        }
        if (payload.deckState.lastActivity !== undefined) {
          currentState.prefs.lastActivity = payload.deckState.lastActivity;
        }
        safeWriteJSON("prefs", currentState.prefs);
      }

      if (payload.localState && typeof payload.localState === "object") {
        if (Array.isArray(payload.localState.categorySummary)) {
          currentState.categorySummary = payload.localState.categorySummary;
          safeWriteJSON("summary", currentState.categorySummary);
        }
        if (Array.isArray(payload.localState.currentPath)) {
          currentState.currentPath = [...payload.localState.currentPath];
        }
        if (typeof payload.localState.appMode === "string") {
          globalScope.currentAppMode = payload.localState.appMode;
        }
      }

      if (payload.savedSession && typeof payload.savedSession === "object") {
        safeWriteJSON("saved_session", payload.savedSession);
      } else {
        safeDeleteStorage("saved_session");
      }

      setProgressMeta(updatedAt || new Date().toISOString(), updatedAt || "");
      getFunction("updateDashboard")?.();
      getFunction("syncPreferenceControls")?.();
      return true;
    } finally {
      globalScope.suppressProgressSync = previousSuppress;
    }
  }

  function createIdempotencyKey(payload) {
    const seed = `${JSON.stringify(payload)}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    return safeBase64Url(seed);
  }

  function getPendingOfflineQueue() {
    const queue = safeReadJSON("pending_sync_queue", []);
    if (!Array.isArray(queue)) return [];
    return queue.filter(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        entry.payload &&
        entry.idempotencyKey,
    );
  }

  function savePendingOfflineQueue(queue) {
    const clean = Array.isArray(queue) ? queue : [];
    safeWriteJSON("pending_sync_queue", clean);
    return clean;
  }

  function queueOfflineProgress(
    payload,
    idempotencyKey = createIdempotencyKey(payload),
  ) {
    if (!payload || typeof payload !== "object") return false;
    const queue = getPendingOfflineQueue();
    const key = String(idempotencyKey);
    if (!queue.some((entry) => String(entry.idempotencyKey) === key)) {
      queue.push({
        idempotencyKey: key,
        payload,
        createdAt: new Date().toISOString(),
      });
      savePendingOfflineQueue(queue);
    }
    return key;
  }

  function extractBackendPayload(result) {
    if (!result || typeof result !== "object") return null;
    if (result.payload && typeof result.payload === "object")
      return result.payload;
    if (result.progress && typeof result.progress === "object")
      return result.progress;
    if (result.data?.payload && typeof result.data.payload === "object")
      return result.data.payload;
    if (result.data?.progress && typeof result.data.progress === "object")
      return result.data.progress;
    return null;
  }

  function extractUpdatedAt(result) {
    return String(
      result?.updatedAt ||
        result?.updated_at ||
        result?.serverUpdatedAt ||
        result?.server_updated_at ||
        result?.data?.updatedAt ||
        result?.data?.updated_at ||
        "",
    );
  }

  function isBackendSuccess(result) {
    if (!result || typeof result !== "object") return false;
    if (
      result.status === "error" ||
      result.ok === false ||
      result.success === false
    )
      return false;
    return (
      result.ok === true ||
      result.success === true ||
      result.status === "success" ||
      result.status === "ok"
    );
  }

  async function backendRequest(payload, options = {}) {
    const customSave =
      payload.type === DEFAULT_PROGRESS_SAVE_TYPE &&
      getFunction("saveUserProgressToServer");
    const customGet =
      payload.type === DEFAULT_PROGRESS_GET_TYPE &&
      getFunction("getUserProgressFromServer");

    if (customSave) return customSave(payload, options);
    if (customGet) return customGet(payload, options);

    const callBackend = getFunction("callBackend");
    if (!callBackend)
      throw new Error("Backend request function is not available.");
    return callBackend(payload, options);
  }

  async function saveUserProgress(
    payload = getProgressPayload(),
    force = false,
    options = {},
  ) {
    if (!payload || typeof payload !== "object") return false;
    const idempotencyKey = String(
      options.idempotencyKey || createIdempotencyKey(payload),
    );
    try {
      const result = await backendRequest(
        {
          type: globalScope.PROGRESS_SAVE_TYPE || DEFAULT_PROGRESS_SAVE_TYPE,
          payload,
          force: Boolean(force),
          idempotencyKey,
          updatedAt: new Date().toISOString(),
          clientUpdatedAt: new Date().toISOString(),
        },
        options,
      );

      if (!isBackendSuccess(result)) return false;
      const updatedAt = extractUpdatedAt(result) || new Date().toISOString();
      setProgressMeta(new Date().toISOString(), updatedAt);
      return true;
    } catch (error) {
      console.warn("Progress save failed:", error);
      return false;
    }
  }

  function queueProgressSync(payload = getProgressPayload()) {
    const key = createIdempotencyKey(payload);
    return queueOfflineProgress(payload, key);
  }

  async function flushPendingOfflineProgress() {
    const queue = getPendingOfflineQueue();
    if (!queue.length) return true;

    const remaining = [];
    for (const entry of queue) {
      const ok = await saveUserProgress(entry.payload, false, {
        idempotencyKey: entry.idempotencyKey,
      });
      if (!ok) remaining.push(entry);
    }
    savePendingOfflineQueue(remaining);
    return remaining.length === 0;
  }

  function comparableTimestamp(value) {
    if (!value) return 0;
    const time = Date.parse(String(value));
    return Number.isFinite(time) ? time : 0;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = canonicalize(value[key]);
        return out;
      }, {});
  }

  function areProgressPayloadsEquivalent(left, right) {
    return (
      JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right))
    );
  }

  async function chooseProgressConflict(
    localPayload,
    remotePayload,
    remoteUpdatedAt,
  ) {
    if (areProgressPayloadsEquivalent(localPayload, remotePayload)) {
      applyRemoteProgress(remotePayload, remoteUpdatedAt);
      return true;
    }

    const currentState = getRuntimeState();
    if (currentState.session?.active) {
      safeWriteJSON("recovery_snapshot", {
        timestamp: new Date().toISOString(),
        payload: localPayload,
        source: "recovery",
      });
      getFunction("showToast")?.(
        "A progress conflict was detected during the active session. The server copy was preserved and a recovery snapshot was saved.",
        "warning",
      );
      applyRemoteProgress(remotePayload, remoteUpdatedAt);
      return true;
    }

    const requestConfirmation = getFunction("requestConfirmation");
    const useLocal = requestConfirmation
      ? await requestConfirmation(
          "A newer progress version exists in the database. Choose OK to keep the current device copy; choose Cancel to use the server copy.",
          "Sync Conflict",
        )
      : false;

    if (useLocal) {
      safeWriteJSON("recovery_snapshot", {
        timestamp: new Date().toISOString(),
        payload: localPayload,
        source: "recovery",
      });
      return saveUserProgress(localPayload, true);
    }

    applyRemoteProgress(remotePayload, remoteUpdatedAt);
    return true;
  }

  async function syncUserProgress() {
    await flushPendingOfflineProgress();

    const localPayload = getProgressPayload();
    const meta = getProgressMeta();
    let result;

    try {
      result = await backendRequest({
        type: globalScope.PROGRESS_GET_TYPE || DEFAULT_PROGRESS_GET_TYPE,
        updatedAt: meta?.serverUpdatedAt || meta?.updatedAt || "",
      });
    } catch (error) {
      console.warn("Progress sync fetch failed:", error);
      queueOfflineProgress(localPayload);
      return false;
    }

    if (!isBackendSuccess(result) && !extractBackendPayload(result))
      return false;

    const remotePayload = extractBackendPayload(result);
    if (!remotePayload) return false;

    const remoteUpdatedAt = extractUpdatedAt(result);
    const localUpdatedAt = meta?.localUpdatedAt || meta?.updatedAt || "";
    const remoteTime = comparableTimestamp(remoteUpdatedAt);
    const localTime = comparableTimestamp(localUpdatedAt);

    if (
      remoteTime &&
      localTime &&
      localTime > remoteTime &&
      !areProgressPayloadsEquivalent(localPayload, remotePayload)
    ) {
      return saveUserProgress(localPayload, true);
    }

    if (remoteTime && localTime && remoteTime > localTime) {
      return chooseProgressConflict(
        localPayload,
        remotePayload,
        remoteUpdatedAt,
      );
    }

    if (!areProgressPayloadsEquivalent(localPayload, remotePayload)) {
      return chooseProgressConflict(
        localPayload,
        remotePayload,
        remoteUpdatedAt,
      );
    }

    if (remoteUpdatedAt)
      setProgressMeta(localUpdatedAt || remoteUpdatedAt, remoteUpdatedAt);
    return true;
  }

  const SessionUtils = {
    getProgressPayload,
    getProgressMeta,
    setProgressMeta,
    clearLocalUserProgress,
    hasLocalProgress,
    applyRemoteProgress,
    createIdempotencyKey,
    getPendingOfflineQueue,
    savePendingOfflineQueue,
    queueOfflineProgress,
    flushPendingOfflineProgress,
    chooseProgressConflict,
    saveUserProgress,
    queueProgressSync,
    syncUserProgress,
    areProgressPayloadsEquivalent,
  };

  if (typeof module !== "undefined" && module.exports)
    module.exports = SessionUtils;
  globalScope.SessionUtils = SessionUtils;

  globalScope.getProgressPayload = getProgressPayload;
  globalScope.getProgressMeta = getProgressMeta;
  globalScope.setProgressMeta = setProgressMeta;
  globalScope.clearLocalUserProgress = clearLocalUserProgress;
  globalScope.hasLocalProgress = hasLocalProgress;
  globalScope.applyRemoteProgress = applyRemoteProgress;
  globalScope.createIdempotencyKey = createIdempotencyKey;
  globalScope.getPendingOfflineQueue = getPendingOfflineQueue;
  globalScope.savePendingOfflineQueue = savePendingOfflineQueue;
  globalScope.queueOfflineProgress = queueOfflineProgress;
  globalScope.flushPendingOfflineProgress = flushPendingOfflineProgress;
  globalScope.chooseProgressConflict = chooseProgressConflict;
  globalScope.saveUserProgress = saveUserProgress;
  globalScope.queueProgressSync = queueProgressSync;
  globalScope.syncUserProgress = syncUserProgress;
  globalScope.areProgressPayloadsEquivalent = areProgressPayloadsEquivalent;
})(typeof window !== "undefined" ? window : globalThis);
