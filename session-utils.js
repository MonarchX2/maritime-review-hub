(function (globalScope) {
  function getProgressPayload() {
    const savedSession = getStoredJSON("saved_session", null);
    return {
      version: 2,
      stats: {
        totalAnswered: Number(state.stats.totalAnswered || 0),
        correct: Number(state.stats.correct || 0),
        mistakes: Array.isArray(state.stats.mistakes)
          ? state.stats.mistakes
          : [],
        completedQs: Array.isArray(state.stats.completedQs)
          ? state.stats.completedQs
          : [],
        subjectAccuracy:
          state.stats.subjectAccuracy &&
          typeof state.stats.subjectAccuracy === "object"
            ? state.stats.subjectAccuracy
            : {},
        srsMap:
          state.stats.srsMap && typeof state.stats.srsMap === "object"
            ? state.stats.srsMap
            : {},
      },
      prefs: state.prefs && typeof state.prefs === "object" ? state.prefs : {},
      savedSession,
      deckState: {
        downloadedDecks: Array.isArray(state.db)
          ? [...new Set((state.db || []).map((q) => q.Subject).filter(Boolean))]
          : [],
        archivedDecks: Array.isArray(state.prefs.archivedDecks)
          ? [...state.prefs.archivedDecks]
          : [],
        studyProgress: state.prefs.studyProgress || {},
        qToggles: state.prefs.qToggles || {},
        lastActivity: state.prefs.lastActivity || null,
      },
      localState: {
        categorySummary: Array.isArray(state.categorySummary)
          ? state.categorySummary
          : [],
        currentPath: Array.isArray(state.currentPath) ? state.currentPath : [],
        appMode: typeof currentAppMode === "string" ? currentAppMode : null,
        dbSize: Array.isArray(state.db) ? state.db.length : 0,
      },
    };
  }

  function getProgressMeta() {
    return getStoredJSON("progress_meta", {});
  }

  function setProgressMeta(updatedAt, serverUpdatedAt = updatedAt || "") {
    progressServerUpdatedAt = serverUpdatedAt || updatedAt || "";
    setStoredJSON("progress_meta", {
      username: userState.username,
      updatedAt: progressServerUpdatedAt,
      localUpdatedAt: progressServerUpdatedAt,
      serverUpdatedAt: progressServerUpdatedAt,
    });
  }

  function clearLocalUserProgress() {
    state.stats = {
      totalAnswered: 0,
      correct: 0,
      mistakes: [],
      completedQs: [],
      subjectAccuracy: {},
      srsMap: {},
    };
    state.session = {
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
      autoNextTimeout: null,
    };
    state.prefs.studyProgress = {};
    state.prefs.qToggles = {};
    state.prefs.lastActivity = null;
    removeStoredItem("stats");
    removeStoredItem("saved_session");
    removeStoredItem("progress_meta");
    removeStoredItem("pending_sync_queue");
    removeStoredItem("recovery_snapshot");
  }

  function hasLocalProgress() {
    return Boolean(
      getStoredItem("stats") ||
      getStoredItem("saved_session") ||
      getStoredItem("prefs"),
    );
  }

  function applyRemoteProgress(payload, updatedAt) {
    if (!payload || typeof payload !== "object") return;
    suppressProgressSync = true;
    try {
      if (payload.stats && typeof payload.stats === "object") {
        state.stats = {
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
        setStoredJSON("stats", state.stats);
      }
      if (payload.prefs && typeof payload.prefs === "object") {
        state.prefs = {
          ...state.prefs,
          ...payload.prefs,
          userId: state.prefs.userId,
        };
        setStoredJSON("prefs", state.prefs);
      }
      if (payload.deckState && typeof payload.deckState === "object") {
        if (Array.isArray(payload.deckState.archivedDecks)) {
          state.prefs.archivedDecks = payload.deckState.archivedDecks;
        }
        if (payload.deckState.studyProgress) {
          state.prefs.studyProgress = payload.deckState.studyProgress;
        }
        if (payload.deckState.qToggles) {
          state.prefs.qToggles = payload.deckState.qToggles;
        }
        if (payload.deckState.lastActivity) {
          state.prefs.lastActivity = payload.deckState.lastActivity;
        }
        setStoredJSON("prefs", state.prefs);
      }
      if (payload.localState && typeof payload.localState === "object") {
        if (Array.isArray(payload.localState.categorySummary)) {
          state.categorySummary = payload.localState.categorySummary;
          setStoredJSON("summary", state.categorySummary);
        }
        if (Array.isArray(payload.localState.currentPath)) {
          state.currentPath = payload.localState.currentPath;
        }
        if (payload.localState.appMode) {
          currentAppMode = payload.localState.appMode;
        }
      }
      if (payload.savedSession) {
        setStoredJSON("saved_session", payload.savedSession);
      } else {
        removeStoredItem("saved_session");
      }
      setProgressMeta(updatedAt);
      updateDashboard();
      syncPreferenceControls();
    } finally {
      suppressProgressSync = false;
    }
  }

  function createIdempotencyKey(payload) {
    const keySeed = `${userState.username || "guest"}:${JSON.stringify(payload)}:${Date.now()}`;
    return btoa(unescape(encodeURIComponent(keySeed))).replace(/=+$/g, "");
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
    const syncStatus = document.getElementById("user-sync-status");
    if (syncStatus) syncStatus.textContent = "Saving progress securely...";
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
        if (syncStatus)
          syncStatus.textContent = "Progress synced across devices.";
        updateProfileUI();
        return true;
      }
      if (result.status === "guest") {
        userState.sessionMode = "guest";
        updateProfileUI();
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
      if (syncStatus)
        syncStatus.textContent =
          "Progress sync is unavailable; local progress is saved.";
      updateProfileUI();
      queueOfflineProgress(
        payload,
        options.idempotencyKey || createIdempotencyKey(payload),
      );
      scheduleOfflineSync();
      sendTelemetry("progress_sync_failure", {
        message: e.message || "Network error",
      });
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
        const syncStatus = document.getElementById("user-sync-status");
        if (syncStatus) {
          syncStatus.textContent =
            "Local progress for the previous account was preserved.";
        }
        updateProfileUI();
        return;
      }
      clearLocalUserProgress();
    }
    const syncStatus = document.getElementById("user-sync-status");
    if (syncStatus) syncStatus.textContent = "Checking for newer progress...";
    try {
      const result = await callBackend({
        type: "get_progress",
        sessionToken: userState.sessionToken,
      });
      if (result.status !== "success") return;

      if (!result.exists) {
        if (hasLocalProgress()) await saveUserProgress();
        else if (syncStatus)
          syncStatus.textContent = "Progress syncing is ready.";
        updateProfileUI();
        return;
      }

      const localMeta = getProgressMeta();
      if (!hasLocalProgress() || !localMeta.updatedAt) {
        applyRemoteProgress(result.payload, result.updatedAt);
        if (syncStatus)
          syncStatus.textContent = "Database progress loaded on this device.";
        updateProfileUI();
        return;
      }

      if (areProgressPayloadsEquivalent(getProgressPayload(), result.payload)) {
        applyRemoteProgress(result.payload, result.updatedAt);
        if (syncStatus)
          syncStatus.textContent = "Progress is already up to date.";
        updateProfileUI();
        return;
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
            updateProfileUI();
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
    } catch (e) {
      sendTelemetry("progress_sync_failure", {
        message: e.message || "Network error",
      });
    }
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
