(function (globalScope) {
  const nodeStorage =
    globalThis.__mrhNodeStorage || (globalThis.__mrhNodeStorage = {});

  function getRuntimeState() {
    if (typeof globalThis !== "undefined" && globalThis.state) {
      return globalThis.state;
    }
    if (typeof state !== "undefined" && state) {
      return state;
    }
    return {};
  }

  function getRuntimeUserState() {
    if (typeof globalThis !== "undefined" && globalThis.userState) {
      return globalThis.userState;
    }
    if (typeof userState !== "undefined" && userState) {
      return userState;
    }
    return {};
  }

  function safeReadStorage(key, fallback = null) {
    if (typeof getStoredItem === "function")
      return getStoredItem(key, fallback);
    if (typeof localStorage !== "undefined") {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    }
    return Object.prototype.hasOwnProperty.call(nodeStorage, key)
      ? nodeStorage[key]
      : fallback;
  }

  function safeWriteStorage(key, value) {
    if (typeof setStoredItem === "function") return setStoredItem(key, value);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(key, value);
      return value;
    }
    nodeStorage[key] = value;
    return value;
  }

  function safeDeleteStorage(key) {
    if (typeof removeStoredItem === "function") return removeStoredItem(key);
    if (typeof localStorage !== "undefined") {
      localStorage.removeItem(key);
      return;
    }
    delete nodeStorage[key];
  }

  function safeReadJSON(key, fallback = null) {
    const raw = safeReadStorage(key, null);
    if (raw === null || raw === undefined) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function safeWriteJSON(key, value) {
    safeWriteStorage(key, JSON.stringify(value));
  }

  function safeBtoa(value) {
    const text = String(value);
    if (typeof btoa === "function") return btoa(text);
    if (typeof Buffer !== "undefined") {
      return Buffer.from(text, "binary").toString("base64");
    }
    return text;
  }

  function getProgressPayload() {
    const currentState = getRuntimeState();
    const savedSession = safeReadJSON("saved_session", null);
    return {
      version: 2,
      stats: {
        totalAnswered: Number(currentState.stats?.totalAnswered || 0),
        correct: Number(currentState.stats?.correct || 0),
        mistakes: Array.isArray(currentState.stats?.mistakes)
          ? currentState.stats.mistakes
          : [],
        completedQs: Array.isArray(currentState.stats?.completedQs)
          ? currentState.stats.completedQs
          : [],
        subjectAccuracy:
          currentState.stats?.subjectAccuracy &&
          typeof currentState.stats.subjectAccuracy === "object"
            ? currentState.stats.subjectAccuracy
            : {},
        srsMap:
          currentState.stats?.srsMap &&
          typeof currentState.stats.srsMap === "object"
            ? currentState.stats.srsMap
            : {},
      },
      prefs:
        currentState.prefs && typeof currentState.prefs === "object"
          ? currentState.prefs
          : {},
      savedSession,
      deckState: {
        downloadedDecks: Array.isArray(currentState.db)
          ? [
              ...new Set(
                (currentState.db || []).map((q) => q.Subject).filter(Boolean),
              ),
            ]
          : [],
        archivedDecks: Array.isArray(currentState.prefs?.archivedDecks)
          ? [...currentState.prefs.archivedDecks]
          : [],
        studyProgress: currentState.prefs?.studyProgress || {},
        qToggles: currentState.prefs?.qToggles || {},
        lastActivity: currentState.prefs?.lastActivity || null,
      },
      localState: {
        categorySummary: Array.isArray(currentState.categorySummary)
          ? currentState.categorySummary
          : [],
        currentPath: Array.isArray(currentState.currentPath)
          ? currentState.currentPath
          : [],
        appMode:
          typeof globalThis?.currentAppMode === "string"
            ? globalThis.currentAppMode
            : null,
        dbSize: Array.isArray(currentState.db) ? currentState.db.length : 0,
      },
    };
  }

  function getProgressMeta() {
    return safeReadJSON("progress_meta", {});
  }

  function setProgressMeta(updatedAt, serverUpdatedAt = updatedAt || "") {
    const runtimeState = getRuntimeState();
    runtimeState.progressServerUpdatedAt = serverUpdatedAt || updatedAt || "";
    safeWriteJSON("progress_meta", {
      username: getRuntimeUserState().username,
      updatedAt: runtimeState.progressServerUpdatedAt,
      localUpdatedAt: runtimeState.progressServerUpdatedAt,
      serverUpdatedAt: runtimeState.progressServerUpdatedAt,
    });
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
    safeDeleteStorage("stats");
    safeDeleteStorage("saved_session");
    safeDeleteStorage("progress_meta");
    safeDeleteStorage("pending_sync_queue");
    safeDeleteStorage("recovery_snapshot");
  }

  function hasLocalProgress() {
    return Boolean(
      safeReadStorage("stats") ||
      safeReadStorage("saved_session") ||
      safeReadStorage("prefs"),
    );
  }

  function applyRemoteProgress(payload, updatedAt) {
    if (!payload || typeof payload !== "object") return;
    const currentState = getRuntimeState();
    const runtimeSuppress = globalThis;
    runtimeSuppress.suppressProgressSync = true;
    try {
      if (payload.stats && typeof payload.stats === "object") {
        currentState.stats = {
          totalAnswered: Number(payload.stats.totalAnswered || 0),
          correct: Number(payload.stats.correct || 0),
          mistakes: Array.isArray(payload.stats.mistakes)
            ? payload.stats.mistakes
            : [],
          completedQs: Array.isArray(payload.stats.completedQs)
            ? payload.stats.completedQs
            : [],
          subjectAccuracy: payload.stats.subjectAccuracy || {},
          srsMap:
            payload.stats.srsMap && typeof payload.stats.srsMap === "object"
              ? payload.stats.srsMap
              : {},
        };
        safeWriteJSON("stats", currentState.stats);
      }
      if (payload.prefs && typeof payload.prefs === "object") {
        currentState.prefs = {
          ...(currentState.prefs || {}),
          ...payload.prefs,
          userId: currentState.prefs?.userId,
        };
        safeWriteJSON("prefs", currentState.prefs);
      }
      if (payload.deckState && typeof payload.deckState === "object") {
        currentState.prefs = currentState.prefs || {};
        if (Array.isArray(payload.deckState.archivedDecks)) {
          currentState.prefs.archivedDecks = payload.deckState.archivedDecks;
        }
        if (payload.deckState.studyProgress) {
          currentState.prefs.studyProgress = payload.deckState.studyProgress;
        }
        if (payload.deckState.qToggles) {
          currentState.prefs.qToggles = payload.deckState.qToggles;
        }
        if (payload.deckState.lastActivity) {
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
          currentState.currentPath = payload.localState.currentPath;
        }
        if (payload.localState.appMode) {
          globalThis.currentAppMode = payload.localState.appMode;
        }
      }
      if (payload.savedSession) {
        safeWriteJSON("saved_session", payload.savedSession);
      } else {
        safeDeleteStorage("saved_session");
      }
      setProgressMeta(updatedAt);
      if (typeof updateDashboard === "function") updateDashboard();
      if (typeof syncPreferenceControls === "function")
        syncPreferenceControls();
    } finally {
      runtimeSuppress.suppressProgressSync = false;
    }
  }

  function createIdempotencyKey(payload) {
    const currentUserState = getRuntimeUserState();
    const keySeed = `${currentUserState.username || "guest"}:${JSON.stringify(payload)}:${Date.now()}`;
    return safeBtoa(unescape(encodeURIComponent(keySeed))).replace(/=+$/g, "");
  }

  function getPendingOfflineQueue() {
    try {
      return JSON.parse(getStoredItem("pending_sync_queue", "[]"));
    } catch (e) {
      return [];
    }
  }

  function savePendingOfflineQueue(queue) {
    setStoredJSON("pending_sync_queue", queue);
  }

  function queueOfflineProgress(payload, idempotencyKey) {
    const queue = getPendingOfflineQueue();
    queue.push({
      idempotencyKey,
      payload,
      createdAt: new Date().toISOString(),
      username: userState.username || "guest",
    });
    savePendingOfflineQueue(queue);
  }

  async function flushPendingOfflineProgress() {
    if (!userState.isLoggedIn || userState.sessionMode === "guest") return;
    const queue = getPendingOfflineQueue();
    if (!queue.length) return;
    const remaining = [];
    for (const entry of queue) {
      const ok = await saveUserProgress(entry.payload, false, {
        idempotencyKey: entry.idempotencyKey,
      });
      if (!ok) remaining.push(entry);
    }
    savePendingOfflineQueue(remaining);
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

    if (state.session.active) {
      const snapshot = {
        timestamp: new Date().toISOString(),
        payload: localPayload,
        source: "recovery",
      };
      setStoredJSON("recovery_snapshot", snapshot);
      showToast(
        "A progress conflict was detected during the active session. The server copy is being preserved and a recovery snapshot was saved.",
        "success",
      );
      applyRemoteProgress(remotePayload, remoteUpdatedAt);
      return true;
    }

    const useLocal = await requestConfirmation(
      "A newer progress version exists in the database. Choose OK to keep your current device progress and create a backup snapshot before overwriting the remote copy. Choose Cancel to merge with the server progress using server timestamps.",
      "Sync Conflict",
    );
    if (useLocal) {
      const snapshot = {
        timestamp: new Date().toISOString(),
        payload: localPayload,
        source: "recovery",
      };
      setStoredJSON("recovery_snapshot", snapshot);
      return saveUserProgress(localPayload, true);
    }
    applyRemoteProgress(remotePayload, remoteUpdatedAt);
    return true;
  }

  async function saveUserProgress(
    payload = getProgressPayload(),
    force = false,
    options = {},
  ) {
    if (
      !userState.isLoggedIn ||
      !userState.sessionToken ||
      progressSyncInFlight
    )
      return false;
    if (userState.sessionMode === "guest") {
      return false;
    }
    progressSyncInFlight = true;
    try {
      const meta = getProgressMeta();
      const idempotencyKey =
        options.idempotencyKey || createIdempotencyKey(payload);
      const result = await callBackend({
        type: "save_progress",
        sessionToken: userState.sessionToken,
        progress: payload,
        baseUpdatedAt: meta.updatedAt || meta.serverUpdatedAt || "",
        deviceUpdatedAt: meta.serverUpdatedAt || new Date().toISOString(),
        force,
        idempotencyKey,
      });
      if (result.status === "success") {
        setProgressMeta(result.updatedAt || result.serverUpdatedAt || "");
        scheduleOfflineSync();
        return true;
      }
      if (result.status === "guest") {
        userState.sessionMode = "guest";
        showToast(
          "This account is already active on another device. This device is now read-only.",
          "error",
        );
        return false;
      }
      if (result.status === "conflict") {
        progressSyncInFlight = false;
        return chooseProgressConflict(
          payload,
          result.payload,
          result.updatedAt,
        );
      }
      return false;
    } catch (e) {
      queueOfflineProgress(
        payload,
        options.idempotencyKey || createIdempotencyKey(payload),
      );
      scheduleOfflineSync();
      return false;
    } finally {
      progressSyncInFlight = false;
    }
  }

  function queueProgressSync() {
    if (!userState?.isLoggedIn || suppressProgressSync) return;
    clearTimeout(progressSyncTimer);
    progressSyncTimer = setTimeout(() => saveUserProgress(), 1200);
  }

  async function syncUserProgress() {
    if (!userState.isLoggedIn || !userState.sessionToken) return;
    const existingMeta = getProgressMeta();
    if (existingMeta.username && existingMeta.username !== userState.username) {
      const snapshot = {
        timestamp: new Date().toISOString(),
        payload: getProgressPayload(),
        source: "account-switch",
      };
      setStoredJSON("recovery_snapshot", snapshot);
      const useRemote = await requestConfirmation(
        "This device already has local progress for a different account. Choose OK to keep the server copy for the current account and preserve the old local progress as a recovery snapshot. Choose Cancel to keep the current local progress and avoid replacing it.",
        "Account Switch",
      );
      if (!useRemote) {
        return;
      }
      clearLocalUserProgress();
    }
    try {
      const result = await callBackend({
        type: "get_progress",
        sessionToken: userState.sessionToken,
      });
      if (result.status !== "success") return;

      if (!result.exists) {
        if (hasLocalProgress()) await saveUserProgress();
        return;
      }

      const localMeta = getProgressMeta();
      if (!hasLocalProgress() || !localMeta.updatedAt) {
        applyRemoteProgress(result.payload, result.updatedAt);
        if (syncStatus)
          syncStatus.textContent = "Database progress loaded on this device.";
        return;
      }

      if (areProgressPayloadsEquivalent(getProgressPayload(), result.payload)) {
        applyRemoteProgress(result.payload, result.updatedAt);
      }

      const remoteTime = Date.parse(
        result.updatedAt || result.deviceUpdatedAt || "",
      );
      const localTime = Date.parse(
        localMeta.serverUpdatedAt ||
          localMeta.updatedAt ||
          localMeta.localUpdatedAt ||
          "",
      );
      if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) {
        if (localTime > remoteTime) {
          await chooseProgressConflict(
            getProgressPayload(),
            result.payload,
            result.updatedAt,
          );
        } else if (remoteTime > localTime) {
          const useRemote = state.session.active
            ? true
            : await requestConfirmation(
                "A newer progress version is available in the database. Choose OK to use the database copy and keep a recovery snapshot if you want to restore local changes later. Choose Cancel to keep your current device progress and upload it.",
                "Sync Conflict",
              );
          if (useRemote) {
            const snapshot = {
              timestamp: new Date().toISOString(),
              payload: getProgressPayload(),
              source: "recovery",
            };
            setStoredJSON("recovery_snapshot", snapshot);
            applyRemoteProgress(result.payload, result.updatedAt);
          } else {
            await saveUserProgress(getProgressPayload(), true);
          }
        }
      } else {
        await chooseProgressConflict(
          getProgressPayload(),
          result.payload,
          result.updatedAt,
        );
      }
    } catch (e) {}
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
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SessionUtils;
  }

  globalScope.SessionUtils = SessionUtils;
})(typeof window !== "undefined" ? window : globalThis);
