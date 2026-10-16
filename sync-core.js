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
   * @property {() => boolean} [markInitialSyncCompleteFromCache]
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

  /**
   * Create the cross-tab leader coordinator used by background synchronization.
   * The coordinator owns the channel and heartbeat lifecycle; the app facade
   * only observes leadership changes so it can keep its public API stable.
   *
   * @param {Object} options
   * @returns {{isLeader: () => boolean, start: () => void, cleanup: () => void}}
   */
  function createLeaderCoordinator(options = {}) {
    const lifecycle = options.lifecycle || globalScope;
    const logger = options.logger || console;
    const protocol = options.protocol || "mrh-broadcast-v1";
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10 * 1000;
    const peerTtlMs = options.peerTtlMs ?? 25000;
    let channel = null;
    let heartbeatTimer = null;
    let leader = false;
    let started = false;
    const peers = new Map();
    const tabId =
      options.tabId ||
      `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const notify = (nextLeader, wasLeader) => {
      if (wasLeader === nextLeader) return;
      leader = nextLeader;
      logger.info?.(`[LEADER] ${leader ? "Became" : "Yielded"} leadership`);
      options.onLeaderChange?.(leader);
    };

    const electLeader = () => {
      const now = Date.now();
      for (const [peerId, seenAt] of peers) {
        if (now - seenAt > peerTtlMs) peers.delete(peerId);
      }
      const candidates = [tabId, ...peers.keys()].sort();
      notify((candidates[0] || tabId) === tabId, leader);
    };

    const sendHeartbeat = () => {
      try {
        channel?.postMessage({
          protocol,
          type: "leader_heartbeat",
          tabId,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.warn?.("[LEADER] Heartbeat failed:", error);
      }
      electLeader();
    };

    function start() {
      if (started) return;
      started = true;

      if (typeof BroadcastChannel === "undefined") {
        leader = true;
        options.onLeaderChange?.(true);
        logger.info?.(
          "[LEADER] BroadcastChannel unavailable; this tab is the leader",
        );
        return;
      }

      try {
        channel = new BroadcastChannel("mrh_leader_election");
        channel.onmessage = (event) => {
          const data = event?.data;
          if (
            !data ||
            typeof data !== "object" ||
            data.protocol !== protocol ||
            data.type !== "leader_heartbeat"
          ) {
            return;
          }

          const peerId = String(data.tabId || "");
          const timestamp = Number(data.timestamp);
          if (
            peerId === tabId ||
            !/^[a-z0-9_-]{8,128}$/i.test(peerId) ||
            !Number.isFinite(timestamp) ||
            Math.abs(Date.now() - timestamp) > peerTtlMs * 2
          ) {
            return;
          }

          peers.set(peerId, Date.now());
          electLeader();
        };
        heartbeatTimer = lifecycle.setInterval(
          sendHeartbeat,
          heartbeatIntervalMs,
        );
        sendHeartbeat();
      } catch (error) {
        logger.error?.("[LEADER] Failed to setup leader election:", error);
        leader = true;
        options.onLeaderChange?.(true);
      }
    }

    function cleanup() {
      started = false;
      lifecycle.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      peers.clear();
      if (channel) {
        channel.close();
        channel = null;
      }
    }

    return { isLeader: () => leader, start, cleanup };
  }

  /** @param {SyncCoreOptions} options @returns {SyncCoreController & Object} */
  function createController(options) {
    const lifecycle = options.lifecycle;
    const config = options.appConfig || {};
    const retryIntervalMs = config.syncRetryIntervalMs ?? 3 * 1000;
    const retryMaxDelayMs = config.syncRetryMaxDelayMs ?? 60 * 1000;
    const syncIntervalMs = config.syncIntervalMs ?? 60 * 1000;
    const requestTimeoutMs = config.syncRequestTimeoutMs ?? 60000;
    const payloadSchemaVersion = Number(
      config.backendPayloadSchemaVersion ?? 2,
    );
    let abortController = null;
    let retryTimer = null;
    let countdownTimer = null;
    let pollTimer = null;
    let attempt = 0;
    let retryAttempt = 0;
    let initialSuccessShown = false;
    let pendingSummaryData = null;
    let pendingSyncTimestamp = "";
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
      if (connected && isCached()) {
        options.markInitialSyncCompleteFromCache?.();
      }
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
      if (pollTimer !== null) return;
      const activeToken = ++pollLoopToken;
      pollTimer = lifecycle.setTimeout(() => {
        pollTimer = null;
        if (activeToken !== pollLoopToken) return;
        if (typeof document !== "undefined" && document.hidden) return;
        optimizedBackgroundSync().finally(() => {
          if (activeToken === pollLoopToken && options.isLeader())
            schedulePoll();
        });
      }, syncIntervalMs);
    }

    function scheduleRetry(showOverlay = true) {
      if (disposed || !options.isLeader()) return;
      cancelPoll();
      if (retryTimer !== null) return;
      retryAttempt += 1;
      const delay = Math.min(
        retryMaxDelayMs,
        Math.max(retryIntervalMs, backoffDelay(retryAttempt - 1)),
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
      retryTimer = lifecycle.setTimeout(() => {
        retryTimer = null;
        lifecycle.clearInterval(countdownTimer);
        countdownTimer = null;
        if (!options.isLeader()) return;
        syncDatabase(true, !effectiveShowOverlay);
      }, delay);
    }

    function clearScheduledRetry(resetAttempt = true) {
      lifecycle.clearTimeout(retryTimer);
      retryTimer = null;
      lifecycle.clearInterval(countdownTimer);
      countdownTimer = null;
      if (resetAttempt) retryAttempt = 0;
    }

    function normalizeSummary(summary) {
      const normalized = options.normalizeSummaryData(summary);
      if (!Array.isArray(normalized)) return normalized;
      for (const [index, deck] of normalized.entries()) {
        if (
          !deck ||
          typeof deck !== "object" ||
          !String(deck.Subject || "").trim() ||
          !Number.isFinite(Number(deck.QuestionCount)) ||
          Number(deck.QuestionCount) < 0 ||
          !/^[a-f0-9]{64}$/i.test(String(deck.PayloadVersion || ""))
        ) {
          throw new Error(
            `Backend summary entry ${index} is malformed or incompatible with payload schema ${payloadSchemaVersion}.`,
          );
        }
      }
      return normalized;
    }

    async function checkSyncStatusLightweight() {
      try {
        if (typeof options.network?.getSyncStatus !== "function")
          throw new Error("AppNetwork sync status API is unavailable.");
        return await options.network.getSyncStatus({
          timeoutMs: 20000,
          maxRetries: 0,
        });
      } catch (error) {
        options.logger.warn("[SYNC] Lightweight status check failed:", error);
        return null;
      }
    }

    async function optimizedBackgroundSync() {
      if (disposed) return;
      if (backgroundPromise) return backgroundPromise;
      if (inFlightPromise) return inFlightPromise;
      backgroundPromise = (async () => {
        if (disposed) return;
        if (!options.isLeader()) return;
        try {
          const storedTimestamp = options.readStoredSyncStatusTimestamp();
          const hasSnapshotApi =
            typeof options.network?.getDeckSyncSnapshot === "function";
          const status = hasSnapshotApi
            ? await options.network.getDeckSyncSnapshot({
                since: isCached() ? storedTimestamp : "",
                timeoutMs: 20000,
                maxRetries: 0,
              })
            : await checkSyncStatusLightweight();
          const hasSnapshotSummary =
            hasSnapshotApi && Array.isArray(status?.summary);
          if (disposed) return;
          if (!status || typeof status !== "object" || status.status !== "ok") {
            if (isCached()) {
              setConnected(false);
              options.updateSyncStatus(
                '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.',
                "warning",
                false,
              );
              scheduleRetry(false);
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
          if (
            Number(status.payloadSchemaVersion) !== payloadSchemaVersion
          ) {
            options.logger.warn(
              "[SYNC] Backend payload schema is incompatible with this app.",
              {
                expected: payloadSchemaVersion,
                received: status.payloadSchemaVersion ?? null,
              },
            );
            setConnected(false);
            options.updateSyncStatus(
              '<i class="fa-solid fa-triangle-exclamation mr-1"></i> Backend data format update required. Continuing with the last compatible cached data.',
              "warning",
              false,
            );
            scheduleRetry(false);
            return;
          }
          clearScheduledRetry();
          const timestamp = String(status.syncTimestamp || "").trim();
          const timestampMs = Date.parse(timestamp);
          const storedTimestampMs = Date.parse(storedTimestamp);
          if (
            storedTimestamp &&
            timestamp &&
            Number.isFinite(timestampMs) &&
            Number.isFinite(storedTimestampMs) &&
            timestampMs < storedTimestampMs
          ) {
            options.logger.warn(
              "[SYNC] Ignoring an older backend sync timestamp.",
              { timestamp, storedTimestamp },
            );
            setConnected(true);
            setIsColdStart(false);
            await options.refreshPendingPayloads?.();
            schedulePoll();
            return;
          }
          if (storedTimestamp && storedTimestamp === timestamp) {
            setConnected(true);
            setIsColdStart(false);
            await options.refreshPendingPayloads?.();
            schedulePoll();
            return;
          }
          if (timestamp && pendingSyncTimestamp === timestamp) {
            if (options.hasActiveSession()) {
              setConnected(true);
              setIsColdStart(false);
              schedulePoll();
              return;
            }
            pendingSyncTimestamp = "";
          }
          const synchronized = await syncDatabase(
            true,
            true,
            timestamp,
            hasSnapshotSummary ? status : null,
          );
          if (timestamp && synchronized) {
            if (pendingSummaryData) pendingSyncTimestamp = timestamp;
            else options.persistSyncStatusTimestamp(timestamp);
          }
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
            scheduleRetry(false);
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
        shouldApply:
          canApply && (changed || !wasConnected || Boolean(pendingSummaryData)),
        shouldQueue: !canApply && changed,
      };
    }

    /** @returns {Promise<SyncCoreResult>} */
    async function syncDatabase(
      isRetry = false,
      isBackgroundCheck = false,
      expectedSyncTimestamp = "",
      prefetchedSnapshot = null,
    ) {
      if (disposed) return false;
      if (inFlightPromise) return inFlightPromise;
      inFlightPromise = (async () => {
        lifecycle.clearTimeout(retryTimer);
        retryTimer = null;
        lifecycle.clearInterval(countdownTimer);
        countdownTimer = null;
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
          let syncSnapshot = prefetchedSnapshot;
          if (
            !syncSnapshot &&
            typeof options.network?.getDeckSyncSnapshot === "function"
          ) {
            syncSnapshot = await options.network.getDeckSyncSnapshot({
              since: isCached()
                ? options.readStoredSyncStatusTimestamp()
                : "",
              timeoutMs: requestTimeoutMs,
              signal: requestController.signal,
              maxRetries: 0,
            });
            if (syncSnapshot?.status !== "ok") {
              throw new Error(
                syncSnapshot?.message || "Backend sync snapshot is invalid.",
              );
            }
            if (syncSnapshot.isColdStart === true) {
              lifecycle.clearTimeout(timeoutId);
              setIsColdStart(true);
              if (!isCached()) options.showColdStartNotification();
              scheduleRetry(!isBackgroundCheck && !isCached());
              return false;
            }
            if (
              Number(syncSnapshot.payloadSchemaVersion) !== payloadSchemaVersion
            ) {
              throw new Error(
                "Backend data format is incompatible with this app.",
              );
            }
            if (syncSnapshot.notModified === true) {
              lifecycle.clearTimeout(timeoutId);
              attempt = 0;
              retryAttempt = 0;
              setConnected(true);
              setIsColdStart(false);
              options.updateSyncStatus(
                '<i class="fa-solid fa-check mr-1"></i> Connected. Database is up to date.',
                "success",
                false,
              );
              options.setGlobalLoadingState(false);
              schedulePoll();
              return true;
            }
            expectedSyncTimestamp = String(
              syncSnapshot.syncTimestamp || expectedSyncTimestamp,
            ).trim();
          }

          const summaryData = normalizeSummary(
            syncSnapshot
              ? syncSnapshot.summary
              : await options.network.getDeckSummary({
                  timeoutMs: requestTimeoutMs,
                  signal: requestController.signal,
                  maxRetries: 0,
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
            if (
              expectedSyncTimestamp &&
              (!syncSnapshot ||
                (syncSnapshot.legacySnapshot === true &&
                  syncSnapshot.consistencyVerified !== true)) &&
              typeof options.network?.getSyncStatus === "function"
            ) {
              const latestStatus = await options.network.getSyncStatus({
                timeoutMs: 20000,
                signal: requestController.signal,
                maxRetries: 0,
              });
              const latestTimestamp = String(
                latestStatus?.syncTimestamp || "",
              ).trim();
              if (
                latestStatus?.status !== "ok" ||
                latestTimestamp !== expectedSyncTimestamp
              ) {
                lifecycle.clearTimeout(timeoutId);
                options.logger.warn(
                  "[SYNC] Discarding a summary fetched across a backend update.",
                  { expectedSyncTimestamp, latestTimestamp },
                );
                scheduleRetry(!isBackgroundCheck && !options.hasActiveSession());
                return false;
              }
            }
            lifecycle.clearTimeout(timeoutId);
            const wasConnected = connected;
            attempt = 0;
            retryAttempt = 0;
            setConnected(true);
            setIsColdStart(false);
            options.sanitizeDeletedDeckReferences();
            const decision = getDecision(summaryData, wasConnected);
            if (decision.shouldApply) {
              pendingSummaryData = null;
              options.setPendingSummaryData?.(null);
              options.applySummaryData(summaryData, decision.changed);
              options.setAccessMetadata(summaryData);
            } else if (!decision.canApply) {
              if (decision.shouldQueue) {
                pendingSummaryData = summaryData;
                options.setPendingSummaryData?.(summaryData);
              }
              if (!wasConnected) options.renderCategoryProgress();
            }
            if (
              typeof options.persistSummaryData === "function" &&
              (await options.persistSummaryData()) === false
            ) {
              throw new Error("Unable to persist the synchronized summary.");
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
          lifecycle.clearTimeout(timeoutId);
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
      confirmPendingSummaryApplied() {
        if (!pendingSummaryData) return false;
        pendingSummaryData = null;
        if (pendingSyncTimestamp) {
          options.persistSyncStatusTimestamp(pendingSyncTimestamp);
          pendingSyncTimestamp = "";
        }
        return true;
      },
      getStatus: () => ({ connected, coldStart, pendingSummaryData }),
      cleanup() {
        disposed = true;
        cancelPoll();
        lifecycle.clearTimeout(retryTimer);
        retryTimer = null;
        lifecycle.clearInterval(countdownTimer);
        countdownTimer = null;
        abortController?.abort();
      },
    };
  }

  globalScope.SyncCore = { createController, createLeaderCoordinator };
})(typeof window !== "undefined" ? window : globalThis);
