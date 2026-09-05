(function (globalScope) {
  "use strict";

  /**
   * @typedef {Object} SyncCoreOptions
   * @property {Object} state
   * @property {Object} lifecycle
   * @property {Object} appConfig
   * @property {Object} network
   * @property {Object} logger
   * @property {() => boolean} isLeader
   * @property {() => boolean} hasActiveSession
   * @property {() => boolean} isImmediateUpdateMode
   * @property {(value: boolean) => void} setSyncConnected
   * @property {(value: boolean) => void} setColdStart
   * @property {(summary: unknown) => unknown} normalizeSummaryData
   * @property {() => string} readStoredSyncStatusTimestamp
   * @property {(timestamp: string) => void} persistSyncStatusTimestamp
   * @property {(summary: Array, knownChanged?: boolean) => boolean} applySummaryData
   * @property {(summary: Array) => void} setAccessMetadata
   * @property {() => void} sanitizeDeletedDeckReferences
   * @property {(message: string, tone?: string, showOverlay?: boolean) => void} updateSyncStatus
   * @property {(showOverlay?: boolean, ...args: any[]) => void} setGlobalLoadingState
   * @property {() => void} hideConnectionStatusAfterDelay
   * @property {() => void} renderCategoryProgress
   * @property {() => void} showColdStartNotification
   * @property {() => string} getSummarySignature
   */

  /** @typedef {Object} SyncCoreController */
  /** @property {(isRetry?: boolean, isBackgroundCheck?: boolean) => Promise<boolean>} SyncCoreController.syncDatabase */
  /** @property {() => Promise<void>} SyncCoreController.optimizedBackgroundSync */
  /** @typedef {boolean} SyncCoreResult */

  /** @param {SyncCoreOptions} options @returns {SyncCoreController & Object} */
  function createController(options) {
    const lifecycle = options.lifecycle;
    const config = options.appConfig || {};
    const retryIntervalMs = config.syncRetryIntervalMs ?? 3 * 1000;
    const retryMaxDelayMs = config.syncRetryMaxDelayMs ?? 60 * 1000;
    const syncIntervalMs = config.syncIntervalMs ?? 60 * 1000;
    const requestTimeoutMs = config.syncRequestTimeoutMs ?? 60000;
    let abortController = null;
    let retryTimer = null;
    let countdownTimer = null;
    let pollTimer = null;
    let attempt = 0;
    let initialSuccessShown = false;
    let pendingSummaryData = null;
    let connected = false;
    let coldStart = false;
    let inFlightPromise = null;
    let backgroundPromise = null;
    let pollLoopToken = 0;
    let disposed = false;

    const isCached = () => options.state.categorySummary.length > 0;
    const setConnected = (value) => {
      connected = Boolean(value);
      options.setSyncConnected(connected);
    };
    const setIsColdStart = (value) => {
      coldStart = Boolean(value);
      options.setColdStart(coldStart);
    };
    const backoffDelay = (retryCount) => {
      const baseDelay = Math.pow(2, Math.min(retryCount, 5)) * 1000;
      return baseDelay + Math.random() * baseDelay * 0.5;
    };

    function cancelPoll() {
      lifecycle.clearTimeout(pollTimer);
      pollTimer = null;
    }

    function schedulePoll() {
      if (disposed || !options.isLeader()) return cancelPoll();
      const activeToken = ++pollLoopToken;
      cancelPoll();
      pollTimer = lifecycle.setTimeout(() => {
        if (activeToken !== pollLoopToken) return;
        if (typeof document !== "undefined" && document.hidden) return;
        optimizedBackgroundSync().finally(() => {
          if (activeToken === pollLoopToken && options.isLeader())
            schedulePoll();
        });
      }, syncIntervalMs);
    }

    function scheduleRetry(showOverlay = true) {
      if (disposed) return;
      lifecycle.clearTimeout(retryTimer);
      lifecycle.clearInterval(countdownTimer);
      const retryCount = Math.max(0, Number(attempt || 1) - 1);
      const delay = Math.min(
        retryMaxDelayMs,
        Math.max(retryIntervalMs, backoffDelay(retryCount)),
      );
      const retryAt = Date.now() + delay;
      const wasConnected = connected;
      const effectiveShowOverlay = showOverlay && !options.hasActiveSession();
      setConnected(false);
      if (wasConnected) options.renderCategoryProgress();
      const renderCountdown = () => {
        const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
        options.updateSyncStatus(
          `<i class="fa-solid fa-xmark mr-1"></i> Database unavailable. Trying to reconnect (attempt ${attempt}) in ${seconds}s...`,
          "warning",
          effectiveShowOverlay,
        );
        if (seconds === 0) lifecycle.clearInterval(countdownTimer);
      };
      renderCountdown();
      countdownTimer = lifecycle.setInterval(renderCountdown, 1000);
      retryTimer = lifecycle.setTimeout(
        () => syncDatabase(true, !effectiveShowOverlay),
        delay,
      );
    }

    function normalizeSummary(summary) {
      return options.normalizeSummaryData(summary);
    }

    async function checkSyncStatusLightweight() {
      try {
        if (typeof options.network?.getSyncStatus !== "function")
          throw new Error("AppNetwork sync status API is unavailable.");
        return await options.network.getSyncStatus({ timeoutMs: 20000 });
      } catch (error) {
        options.logger.warn("[SYNC] Lightweight status check failed:", error);
        return null;
      }
    }

    async function optimizedBackgroundSync() {
      if (disposed) return;
      if (backgroundPromise) return backgroundPromise;
      backgroundPromise = (async () => {
        if (disposed) return;
        if (!options.isLeader()) return;
        try {
          const status = await checkSyncStatusLightweight();
          if (disposed) return;
          if (!status || typeof status !== "object" || status.status !== "ok") {
            if (isCached()) {
              setConnected(false);
              options.updateSyncStatus(
                '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.',
                "warning",
                false,
              );
              schedulePoll();
              return;
            }
            await syncDatabase(true, true);
            return;
          }
          if (status.isColdStart === true) {
            setIsColdStart(true);
            if (!isCached()) options.showColdStartNotification();
            scheduleRetry(!isCached());
            return;
          }
          const timestamp = String(status.syncTimestamp || "").trim();
          const storedTimestamp = options.readStoredSyncStatusTimestamp();
          if (storedTimestamp && storedTimestamp === timestamp) {
            setConnected(true);
            setIsColdStart(false);
            return;
          }
          if (timestamp) options.persistSyncStatusTimestamp(timestamp);
          await syncDatabase(true, true);
        } catch (error) {
          options.logger.error(
            "[SYNC] Simplified background sync error:",
            error,
          );
          if (isCached()) {
            setConnected(false);
            options.updateSyncStatus(
              '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.',
              "warning",
              false,
            );
            schedulePoll();
            return;
          }
          await syncDatabase(true, true);
        } finally {
          backgroundPromise = null;
        }
      })();
      return backgroundPromise;
    }

    function getDecision(summary, wasConnected) {
      const changed =
        options.getSummarySignature(options.state.categorySummary || []) !==
        options.getSummarySignature(summary);
      const canApply =
        options.isImmediateUpdateMode() || !options.hasActiveSession();
      return {
        changed,
        canApply,
        shouldApply: canApply && (changed || !wasConnected),
        shouldQueue: !canApply && changed,
      };
    }

    /** @returns {Promise<SyncCoreResult>} */
    async function syncDatabase(isRetry = false, isBackgroundCheck = false) {
      if (disposed) return false;
      if (inFlightPromise) return inFlightPromise;
      inFlightPromise = (async () => {
        lifecycle.clearTimeout(retryTimer);
        lifecycle.clearInterval(countdownTimer);
        cancelPoll();
        abortController?.abort();
        const silent = isBackgroundCheck || options.hasActiveSession();
        if (!isRetry) attempt = 0;
        attempt += 1;
        abortController = new AbortController();
        const requestController = abortController;
        let timedOut = false;
        const timeoutId = lifecycle.setTimeout(() => {
          timedOut = true;
          requestController.abort();
        }, requestTimeoutMs);
        if (!(isBackgroundCheck && isCached()))
          options.updateSyncStatus(
            `<i class="fa-solid fa-spinner fa-spin mr-1"></i> ${isRetry ? "Checking for database updates" : "Connecting to database"}...`,
            "info",
            !isBackgroundCheck,
          );
        try {
          if (typeof options.network?.getDeckSummary !== "function")
            throw new Error("AppNetwork summary API is unavailable.");
          const summaryData = normalizeSummary(
            await options.network.getDeckSummary({
              timeoutMs: requestTimeoutMs,
              signal: requestController.signal,
            }),
          );
          if (disposed) return false;
          if (
            summaryData &&
            !Array.isArray(summaryData) &&
            summaryData.isColdStart === true
          ) {
            lifecycle.clearTimeout(timeoutId);
            setIsColdStart(true);
            if (!isCached()) options.showColdStartNotification();
            scheduleRetry(!isBackgroundCheck && !isCached());
            return false;
          }
          if (Array.isArray(summaryData)) {
            lifecycle.clearTimeout(timeoutId);
            const wasConnected = connected;
            attempt = 0;
            setConnected(true);
            setIsColdStart(false);
            options.sanitizeDeletedDeckReferences();
            const decision = getDecision(summaryData, wasConnected);
            if (decision.shouldApply) {
              pendingSummaryData = null;
              options.applySummaryData(summaryData, decision.changed);
              options.setAccessMetadata(summaryData);
            } else if (!decision.canApply) {
              if (decision.shouldQueue) pendingSummaryData = summaryData;
              if (!wasConnected) options.renderCategoryProgress();
            }
            options.updateSyncStatus(
              `<i class="fa-solid fa-check mr-1"></i> Connected. ${decision.changed && !decision.canApply ? "Update waiting until your session ends." : `Checked ${summaryData.length} subjects.`}`,
              "success",
              !silent && !initialSuccessShown,
            );
            options.setGlobalLoadingState(false);
            if (!silent && !initialSuccessShown) {
              initialSuccessShown = true;
              options.hideConnectionStatusAfterDelay();
            }
            schedulePoll();
            return true;
          }
          lifecycle.clearTimeout(timeoutId);
          if (isBackgroundCheck && isCached()) {
            options.updateSyncStatus(
              '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Using locally cached deck list. Background sync temporarily unavailable.',
              "warning",
              false,
            );
            scheduleRetry(!silent);
            return false;
          }
          scheduleRetry(!silent);
          return false;
        } catch (error) {
          lifecycle.clearTimeout(timeoutId);
          if (requestController !== abortController) return false;
          if (error?.name === "AbortError" || error?.name === "TimeoutError") {
            if (timedOut || error?.name === "TimeoutError")
              options.logger.warn(
                `[SYNC] Database response exceeded ${requestTimeoutMs / 1000}s; retrying automatically.`,
              );
            scheduleRetry(!silent);
            return false;
          }
          options.logger.error("[SYNC] Error:", error);
          if (isBackgroundCheck && isCached()) {
            options.updateSyncStatus(
              '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.',
              "warning",
              false,
            );
            scheduleRetry(!silent);
            return false;
          }
          scheduleRetry(!silent);
          options.setGlobalLoadingState(
            !silent,
            "Database reconnecting",
            "The app is retrying the connection automatically. This may take a moment.",
            "warning",
          );
          options.renderCategoryProgress();
          return false;
        } finally {
          if (requestController === abortController) abortController = null;
          inFlightPromise = null;
        }
      })();
      return inFlightPromise;
    }

    return {
      syncDatabase,
      optimizedBackgroundSync,
      checkSyncStatusLightweight,
      scheduleSyncPoll: schedulePoll,
      scheduleSyncRetry: scheduleRetry,
      showColdStartNotification: options.showColdStartNotification,
      cancel: cancelPoll,
      handleVisibility(isHidden) {
        cancelPoll();
        if (!isHidden)
          optimizedBackgroundSync().finally(() => {
            if (options.isLeader() && !document.hidden) schedulePoll();
          });
      },
      getStatus: () => ({ connected, coldStart, pendingSummaryData }),
      cleanup() {
        disposed = true;
        cancelPoll();
        lifecycle.clearTimeout(retryTimer);
        lifecycle.clearInterval(countdownTimer);
        abortController?.abort();
      },
    };
  }

  globalScope.SyncCore = { createController };
})(typeof window !== "undefined" ? window : globalThis);
