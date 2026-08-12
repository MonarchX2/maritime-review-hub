(function (globalScope) {
  function updateSyncStatus(message, tone = "info", showOverlay = true) {
    const shouldSuppressOverlay =
      globalScope.state.session.active &&
      showOverlay &&
      /database|reconnect|waiting until your session ends/i.test(message);
    const effectiveShowOverlay = shouldSuppressOverlay ? false : showOverlay;
    const statusElements = [document.getElementById("sync-status")].filter(
      Boolean,
    );
    const classes = {
      info: "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300",
      success:
        "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300",
      warning:
        "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300",
      error: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300",
    };

    statusElements.forEach((element) => {
      element.classList.remove("hidden");
      element.innerHTML = message;
      element.className = `text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-500 overflow-hidden ${classes[tone] || classes.info}`;
    });

    const icon = document.getElementById("database-connection-icon");
    if (icon) {
      const iconByTone = {
        info: "fa-spinner fa-spin text-yellow-300",
        success: "fa-check-circle text-green-300",
        warning: "fa-xmark-circle text-red-300",
        error: "fa-xmark-circle text-red-300",
      };
      icon.className = `database-connection-icon fa-solid ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 p-1 text-xs transition-all duration-300 ${iconByTone[tone] || iconByTone.info}`;
      icon.title =
        tone === "success"
          ? "Database connected"
          : "Database connection unavailable";
    }

    const connectionStatus = document.getElementById("connection-status");
    if (connectionStatus && effectiveShowOverlay) {
      clearTimeout(globalScope.syncStatusHideTimer);
      connectionStatus.classList.remove("hidden", "opacity-0", "scale-95");
      connectionStatus.innerHTML = message;
      connectionStatus.className = `fixed bottom-5 left-1/2 z-[60] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg px-4 py-2 text-center text-xs font-medium shadow-lg transition-all duration-500 ${classes[tone] || classes.info}`;
    }
  }

  function hideConnectionStatusAfterDelay(delay = 3000) {
    clearTimeout(globalScope.syncStatusHideTimer);
    globalScope.syncStatusHideTimer = setTimeout(() => {
      const element = document.getElementById("connection-status");
      if (!element) return;
      element.classList.add("opacity-0", "scale-95");
      setTimeout(() => element.classList.add("hidden"), 500);
    }, delay);
  }

  function scheduleSyncPoll() {
    clearTimeout(globalScope.syncPollTimer);
    globalScope.syncPollTimer = setTimeout(
      () => globalScope.syncDatabase(true, true),
      globalScope.SYNC_INTERVAL_MS,
    );
  }

  function applySummaryData(summaryData) {
    const previousSummary = JSON.stringify(
      globalScope.state.categorySummary || [],
    );
    const nextSummary = JSON.stringify(summaryData);
    const changed = previousSummary !== nextSummary;

    globalScope.state.categorySummary = summaryData;
    globalScope.syncConnected = true;
    globalScope.saveState();
    globalScope.populateFilters();
    return changed;
  }

  function scheduleSyncRetry(showOverlay = true) {
    clearTimeout(globalScope.syncRetryTimer);
    clearInterval(globalScope.syncCountdownTimer);
    const delay = globalScope.SYNC_INTERVAL_MS;
    const retryAt = Date.now() + delay;
    const wasConnected = globalScope.syncConnected;
    globalScope.syncConnected = false;
    if (wasConnected) globalScope.renderCategoryProgress();
    const renderCountdown = () => {
      const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      updateSyncStatus(
        `<i class="fa-solid fa-xmark mr-1"></i> Database unavailable. Trying to reconnect (attempt ${globalScope.syncAttempt}) in ${seconds}s...`,
        "warning",
        showOverlay,
      );
      if (seconds === 0) clearInterval(globalScope.syncCountdownTimer);
    };
    renderCountdown();
    globalScope.syncCountdownTimer = setInterval(renderCountdown, 1000);
    globalScope.syncRetryTimer = setTimeout(
      () => globalScope.syncDatabase(true, !showOverlay),
      delay,
    );
  }

  async function syncDatabase(isRetry = false, isBackgroundCheck = false) {
    clearTimeout(globalScope.syncRetryTimer);
    clearInterval(globalScope.syncCountdownTimer);
    clearTimeout(globalScope.syncPollTimer);
    if (globalScope.syncAbortController) {
      globalScope.syncAbortController.abort();
    }

    if (!isRetry) globalScope.syncAttempt = 0;
    globalScope.syncAttempt++;
    globalScope.syncAbortController = new AbortController();
    const requestController = globalScope.syncAbortController;
    const timeoutId = setTimeout(
      () => globalScope.syncAbortController.abort(),
      20000,
    );

    const url = `${globalScope.DB_URL}?_t=${Date.now()}`;
    updateSyncStatus(
      `<i class="fa-solid fa-spinner fa-spin mr-1"></i> ${isRetry ? "Checking for database updates" : "Connecting to database"}...`,
      "info",
      !isBackgroundCheck,
    );
    globalScope.sendTelemetry("sync_attempt", {
      attempt: globalScope.syncAttempt,
      retry: isRetry,
    });

    try {
      const response = await fetch(url, {
        signal: requestController.signal,
        redirect: "follow",
        cache: "no-store",
      });

      if (!response.ok) throw new Error("Network response failed");
      const text = await response.text();
      let summaryData;
      try {
        summaryData = JSON.parse(text);
      } catch (parseError) {
        throw new Error(
          `Invalid backend response while syncing database: ${text.slice(0, 200)}`,
        );
      }

      if (Array.isArray(summaryData) && summaryData.length > 0) {
        clearTimeout(timeoutId);
        globalScope.lastSyncAt = Date.now();
        const completedAttempt = globalScope.syncAttempt;
        const wasConnected = globalScope.syncConnected;
        globalScope.syncAttempt = 0;
        globalScope.syncConnected = true;
        const changed =
          JSON.stringify(globalScope.state.categorySummary || []) !==
          JSON.stringify(summaryData);
        const canApplyNow =
          globalScope.state.prefs.databaseUpdateMode === "immediate" ||
          !globalScope.state.session.active;

        if (canApplyNow && (changed || !wasConnected)) {
          globalScope.pendingSummaryData = null;
          applySummaryData(summaryData);
        } else if (!canApplyNow) {
          if (changed) globalScope.pendingSummaryData = summaryData;
          if (!wasConnected) globalScope.renderCategoryProgress();
        }

        globalScope.sendTelemetry("sync_success", {
          attempt: completedAttempt,
          subjectCount: summaryData.length,
          changed,
          applied: canApplyNow,
        });

        updateSyncStatus(
          `<i class="fa-solid fa-check mr-1"></i> Connected. ${changed && !canApplyNow ? "Update waiting until your session ends." : `Checked ${summaryData.length} subjects.`}`,
          "success",
          !isBackgroundCheck && !globalScope.initialSyncSuccessShown,
        );
        if (!isBackgroundCheck && !globalScope.initialSyncSuccessShown) {
          globalScope.initialSyncSuccessShown = true;
          hideConnectionStatusAfterDelay();
        }
        scheduleSyncPoll();
      } else {
        clearTimeout(timeoutId);
        globalScope.sendTelemetry("sync_empty", {
          attempt: globalScope.syncAttempt,
        });
        scheduleSyncRetry(!isBackgroundCheck);
        if (
          globalScope.state.categorySummary.length &&
          globalScope.syncConnected
        )
          globalScope.renderCategoryProgress();
      }
    } catch (err) {
      clearTimeout(timeoutId);
      if (requestController !== globalScope.syncAbortController) return;
      console.error(err);
      globalScope.sendTelemetry("sync_failure", {
        attempt: globalScope.syncAttempt,
        error: err.name || "NetworkError",
        message: err.message || "Unknown sync error",
      });
      scheduleSyncRetry(!isBackgroundCheck);

      const catList = document.getElementById("category-list");
      if (catList && globalScope.state.categorySummary.length === 0) {
        catList.innerHTML = `
          <div class="text-center py-10 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 animate-card-in">
            <i class="fa-solid fa-triangle-exclamation text-3xl text-red-500 mb-3 hover:scale-110 transition-transform"></i>
            <h3 class="font-bold text-red-700 dark:text-red-400">Database Connection Failed</h3>
            <p class="text-sm text-red-600 dark:text-red-300 mt-1">The app is retrying the database connection automatically. You can keep this page open.</p>
          </div>`;
      }
    }
  }

  const SyncCore = {
    updateSyncStatus,
    hideConnectionStatusAfterDelay,
    scheduleSyncPoll,
    applySummaryData,
    scheduleSyncRetry,
    syncDatabase,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SyncCore;
  }

  globalScope.SyncCore = SyncCore;
})(typeof window !== "undefined" ? window : globalThis);
