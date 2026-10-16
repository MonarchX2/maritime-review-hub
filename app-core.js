(function (globalScope) {
  "use strict";

  /**
   * Shared runtime boundary for the browser app.
   * The app intentionally uses a single rootScope to avoid mixed implicit
   * globals and keep the lifecycle/state contract explicit.
   *
   * @typedef {Object} MrhAppRuntimeState
   * @property {Array<Object>} db
   * @property {Array<Object>} categorySummary
   * @property {Object} prefs
   * @property {Object} session
   * @property {Array<string>} currentPath
   */

  const rootScope = globalScope || globalThis;
  const appConfig = rootScope.MRH_CONFIG || {};
  const state = rootScope.state;
  const lifecycle = rootScope.LifecycleUtils || rootScope;
  const uiEventController = new AbortController();
  const renderingScheduler = rootScope.RenderingCore?.createScheduler?.() || {
    schedule: (callback) => lifecycle.setTimeout(callback, 0),
    cancelAll: () => undefined,
  };
  const SYNC_INTERVAL_MS = appConfig.syncIntervalMs ?? 60 * 1000;
  const SYNC_RETRY_INTERVAL_MS = appConfig.syncRetryIntervalMs ?? 3 * 1000;
  const STALE_CACHE_MAX_AGE_MS = appConfig.staleCacheMaxAgeMs ?? 10 * 1000;
  const SYNC_RETRY_MAX_DELAY_MS = appConfig.syncRetryMaxDelayMs ?? 60 * 1000;
  const DATA_CACHE_TIMESTAMP_KEY = "mrh_last_sync_complete_ms";

  let syncAbortController = null;
  let syncRetryTimer = null;
  let syncCountdownTimer = null;
  let syncStatusHideTimer = null;
  let syncPollTimer = null;
  let syncAttempt = 0;
  let initialSyncSuccessShown = false;
  let pendingSummaryData = null;
  let syncConnected = false;
  let isColdStart = false;
  let lastSyncStatusTimestamp = "";
  let isInitialSyncComplete = false; // Track if the first sync from startup has completed
  let lastSyncAt = 0;
  const deckFetchInFlight = new Map();
  const pendingDeckPayloadRefreshes = new Set();
  let deckPayloadRefreshPromise = null;

  // Performance caches for stable render signatures. WeakMap keeps entries tied to
  // the current array/object identity, so replacing state arrays automatically
  // invalidates the cached value.
  const arraySignatureCache = new WeakMap();
  const subjectListSignatureCache = new WeakMap();
  const SYNC_STATUS_STORAGE_KEY = "mrh_last_applied_sync_status_timestamp";
  const SYNC_REQUEST_TIMEOUT_MS = appConfig.syncRequestTimeoutMs ?? 60000;
  const BROADCAST_PROTOCOL = "mrh-broadcast-v1";
  const inFlightDeckDatabaseWrites = new Set();
  const inFlightDeckMutations = new Set();
  const deckFetchGenerations = new Map();
  const deckMutationsInProgress = new Set();
  let appDataClearInProgress = false;
  let appDataClearGeneration = 0;
  let clearDatabaseInProgress = false;
  let clearAppDataInProgress = false;
  let __mrhAppInitialized = false;
  let __mrhAppReady = false;
  let __mrhAppInitializationPromise = null;
  let __mrhInitializationTimer = null;
  let __mrhPollLoopToken = 0;
  let treeViewNoticeDismissed = false;
  let treeViewResizeListenerInstalled = false;
  const collapsedTreePaths = new Set();
  let treeCollapseInitialized = false;

  function isTreeViewConstrained() {
    const treeView = document.querySelector(".deck-tree-view");
    if (
      state.prefs.layoutMode !== "tree" ||
      !treeView?.querySelector(".deck-tree-row")
    ) {
      return false;
    }

    const availableWidth = treeView.getBoundingClientRect().width;
    return availableWidth > 0 && availableWidth < 600;
  }

  function updateTreeViewReadabilityNotice() {
    const notice = document.getElementById("tree-view-readability-notice");
    if (!notice) return;

    notice.hidden = treeViewNoticeDismissed || !isTreeViewConstrained();
  }

  function dismissTreeViewReadabilityNotice() {
    treeViewNoticeDismissed = true;
    updateTreeViewReadabilityNotice();
  }

  function scheduleAppAnimationFrame(callback) {
    return renderingScheduler.schedule(callback);
  }

  function cancelAppAnimationFrames() {
    renderingScheduler.cancelAll();
  }

  /**
   * Ensure the bootstrap lifecycle has reached the ready state before app work
   * continues.
   *
   * @returns {void}
   */
  function ensureAppReady() {
    const bootstrapStatus =
      typeof window !== "undefined" ? window.__MRH_BOOTSTRAP__?.status : null;

    if (bootstrapStatus !== "ready" && !__mrhAppReady) {
      throw new Error("App bootstrap not complete yet.");
    }
  }

  function hasRequiredAppRuntime() {
    if (typeof document === "undefined") {
      return false;
    }

    return ["StorageUtils", "TextUtils", "AppState", "AppNetwork"].every(
      (name) => typeof globalThis[name] !== "undefined",
    );
  }

  function scheduleDeferredInitialization() {
    if (__mrhInitializationTimer !== null) return false;

    __mrhInitializationTimer = lifecycle.setTimeout(() => {
      __mrhInitializationTimer = null;
      if (
        typeof window !== "undefined" &&
        typeof window.initializeApp === "function"
      ) {
        window.initializeApp();
      }
    }, appConfig.deferredInitializationDelayMs ?? 50);

    return true;
  }

  function readStoredSyncStatusTimestamp() {
    const stored = getStoredItem?.(SYNC_STATUS_STORAGE_KEY, "") || "";
    return String(stored).trim();
  }

  function persistSyncStatusTimestamp(timestamp) {
    lastSyncStatusTimestamp = String(timestamp || "").trim();
    try {
      setStoredItem?.(SYNC_STATUS_STORAGE_KEY, lastSyncStatusTimestamp);
    } catch (e) {
      appLogger.warn("Unable to persist sync status timestamp.", e);
    }
  }

  // OPTIMIZATION: Leader election pattern - only one tab polls
  let isLeaderTab = false;
  let leaderHeartbeatTimer = null;
  let leaderElectionChannel = null;
  let cacheInvalidationChannel = null;

  const debugLogger =
    typeof DebugUtils !== "undefined" && DebugUtils.createDebugLogger
      ? DebugUtils.createDebugLogger("mrh-app")
      : {
          snapshot: (label, details = {}) => ({ label, ...details }),
          emit: () => undefined,
        };
  const appLogger =
    typeof DebugUtils !== "undefined" && DebugUtils.createDebugLogger
      ? DebugUtils.createDebugLogger("mrh-app")
      : { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

  function createDebugSnapshot(label, details = {}) {
    return debugLogger.snapshot(label, {
      state,
      ...details,
    });
  }

  function emitDebugState(label, details = {}) {
    return debugLogger.emit(label, {
      state,
      ...details,
    });
  }

  if (typeof window !== "undefined") {
    const existingDebugApi = window.MRHDebug || {};
    window.MRHDebug = {
      ...existingDebugApi,
      enable: () => {
        window.__MRH_DEBUG__ = true;
        return true;
      },
      disable: () => {
        window.__MRH_DEBUG__ = false;
        return false;
      },
      snapshot: createDebugSnapshot,
      emit: emitDebugState,
      inspect: createDebugSnapshot,
    };
  }

  function normalizeQuestionRecord(question, subjectOverride = null) {
    if (
      typeof AppState !== "undefined" &&
      typeof AppState.normalizeQuestionRecord === "function"
    ) {
      return AppState.normalizeQuestionRecord(question, subjectOverride);
    }
    throw new Error(
      "AppState is required before normalizing application questions.",
    );
  }

  const {
    escapeHTML,
    renderMathExpression,
    encodeHandlerValue,
    decodeHandlerValue,
  } = TextUtils;

  Object.assign(
    typeof globalThis !== "undefined" ? globalThis : window,
    TextUtils,
  );

  function sanitizeDeletedDeckReferences() {
    const deletedSet = new Set(
      (state.prefs?.deletedDecks || [])
        .map((item) => String(item || "").trim())
        .filter(Boolean),
    );

    if (deletedSet.size === 0) return;

    state.prefs.favoriteDecks = (state.prefs.favoriteDecks || []).filter(
      (item) => !deletedSet.has(String(item || "").trim()),
    );
    state.prefs.recentDecks = (state.prefs.recentDecks || []).filter(
      (item) => !deletedSet.has(String(item || "").trim()),
    );
    state.categorySummary = (state.categorySummary || []).filter((deck) => {
      if (!deck || !deck.Subject) return true;
      return !deletedSet.has(String(deck.Subject || "").trim());
    });
  }

  const actionLocks = {};

  function runWithActionLock(lockKey, action) {
    if (actionLocks[lockKey]) {
      return Promise.resolve(false);
    }
    actionLocks[lockKey] = true;
    return Promise.resolve()
      .then(action)
      .finally(() => {
        delete actionLocks[lockKey];
      });
  }

  async function runWithBusyButton(button, loadingText, action) {
    if (!button) {
      return action();
    }

    const previousNodes = Array.from(button.childNodes).map((node) =>
      node.cloneNode(true),
    );
    const previousDisabled = button.disabled;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const spinner = document.createElement("i");
    spinner.className = "fa-solid fa-spinner fa-spin mr-2";
    button.replaceChildren(
      spinner,
      document.createTextNode(` ${String(loadingText ?? "")}`),
    );

    try {
      return await action();
    } finally {
      button.disabled = previousDisabled;
      button.removeAttribute("aria-busy");
      button.replaceChildren(...previousNodes);
    }
  }

  function setInlineError(element, message) {
    if (!element) return;
    element.textContent = message || "";
    element.classList.toggle("hidden", !message);
  }

  function showDeckNotFound(path) {
    const notice = document.getElementById("deck-not-found-notice");
    const pathLabel = document.getElementById("deck-not-found-path");
    if (!notice || !pathLabel) return;

    pathLabel.textContent = Array.isArray(path) ? path.join(" / ") : "";
    notice.classList.remove("hidden");
  }

  function dismissDeckNotFound() {
    document.getElementById("deck-not-found-notice")?.classList.add("hidden");
  }

  function setFormError(inputId, message) {
    const input = inputId ? document.getElementById(inputId) : null;
    const errorElement = inputId
      ? document.getElementById(`${inputId}-error`)
      : null;

    if (errorElement) {
      setInlineError(errorElement, message);
    }

    if (input) {
      input.setAttribute("aria-invalid", message ? "true" : "false");
      input.classList.toggle("border-red-500", Boolean(message));
      input.classList.toggle("focus:ring-red-500", Boolean(message));
    }
  }

  async function loadState() {
    if (
      typeof AppState !== "undefined" &&
      typeof AppState.loadState === "function"
    ) {
      return AppState.loadState();
    }
    throw new Error("AppState is required before loading application state.");
  }

  async function saveState(dirty = "all") {
    if (
      typeof AppState !== "undefined" &&
      typeof AppState.saveState === "function"
    ) {
      return AppState.saveState(dirty);
    }
    throw new Error("AppState is required before saving application state.");
  }

  function syncPreferenceControls() {
    if (
      typeof PreferencesCore !== "undefined" &&
      typeof PreferencesCore.syncPreferenceControls === "function"
    ) {
      return PreferencesCore.syncPreferenceControls();
    }
    throw new Error(
      "PreferencesCore is required before synchronizing preference controls.",
    );
  }

  async function safeIdbSet(key, value) {
    if (appDataClearInProgress) {
      throw new Error("Deck persistence is paused while app data is cleared.");
    }

    if (typeof idbKeyval !== "undefined") {
      const write = Promise.resolve().then(() =>
        idbKeyval.set(
          key.includes(":") || key.startsWith("mrh_")
            ? key
            : getStorageKey(key),
          value,
        ),
      );
      inFlightDeckDatabaseWrites.add(write);
      try {
        await write;
      } finally {
        inFlightDeckDatabaseWrites.delete(write);
      }
    }
  }

  function isDeckFetchCurrent(generation) {
    return !appDataClearInProgress && generation === appDataClearGeneration;
  }

  function getDeckFetchGeneration(subject) {
    const key = String(subject || "").trim();
    return deckFetchGenerations.get(key) || 0;
  }

  function invalidateDeckFetch(subject) {
    const key = String(subject || "").trim();
    if (!key) return;
    deckFetchGenerations.set(key, getDeckFetchGeneration(key) + 1);
  }

  function canFetchDeck(subject) {
    const key = String(subject || "").trim();
    return (
      !appDataClearInProgress &&
      !clearDatabaseInProgress &&
      !clearAppDataInProgress &&
      !deckMutationsInProgress.has(key)
    );
  }

  function isDeckFetchCurrentForSubject(subject, generation) {
    return (
      canFetchDeck(subject) && getDeckFetchGeneration(subject) === generation
    );
  }

  async function safeIdbDel(key) {
    if (
      typeof idbKeyval === "undefined" ||
      typeof idbKeyval.del !== "function" ||
      typeof idbKeyval.get !== "function"
    ) {
      throw new Error("IndexedDB storage is unavailable.");
    }

    const storageKey =
      key.includes(":") || key.startsWith("mrh_") ? key : getStorageKey(key);
    await idbKeyval.del(storageKey);
    if ((await idbKeyval.get(storageKey)) !== undefined) {
      throw new Error(`Unable to remove IndexedDB entry "${storageKey}".`);
    }
  }

  function getSyncStatusVisualState(tone = "info") {
    const byTone = {
      info: {
        panelClass:
          "bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-300",
        badgeClass: "fa-spinner fa-spin text-yellow-300",
        title: "Checking database connection",
        overlayTitle: "Syncing database",
        overlayDetail: "Checking for the latest subjects and data updates.",
      },
      success: {
        panelClass:
          "bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-300",
        badgeClass: "fa-check-circle text-green-300",
        title: "Database connected",
        overlayTitle: "Database ready",
        overlayDetail: "The latest data is loaded and ready to use.",
      },
      warning: {
        panelClass:
          "bg-yellow-50 text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-300",
        badgeClass: "fa-triangle-exclamation text-yellow-300",
        title: "Database reconnecting",
        overlayTitle: "Database reconnecting",
        overlayDetail:
          "The app is retrying the connection and will resume shortly.",
      },
      error: {
        panelClass:
          "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300",
        badgeClass: "fa-xmark-circle text-red-300",
        title: "Database unavailable",
        overlayTitle: "Database unavailable",
        overlayDetail: "The app is retrying the connection automatically.",
      },
    };
    return byTone[tone] || byTone.info;
  }

  function setGlobalLoadingState(
    isLoading,
    title = "Loading...",
    detail = "Preparing the latest data...",
    tone = "info",
  ) {
    if (typeof document === "undefined") return false;
    const overlay = document.getElementById("app-loading-overlay");
    if (!overlay) return false;

    const titleEl = document.getElementById("app-loading-title");
    const detailEl = document.getElementById("app-loading-detail");
    const iconEl = document.getElementById("app-loading-icon");
    const toneState = getSyncStatusVisualState(tone);

    if (titleEl) titleEl.textContent = title || "Loading...";
    if (detailEl)
      detailEl.textContent = detail || "Preparing the latest data...";
    if (iconEl) {
      const iconClass =
        tone === "success"
          ? "fa-solid fa-check-circle text-green-300"
          : tone === "warning" || tone === "error"
            ? `fa-solid ${toneState.badgeClass}`
            : "fa-solid fa-spinner fa-spin text-yellow-300";
      iconEl.className = `text-3xl ${iconClass}`;
    }

    overlay.classList.toggle("hidden", !isLoading);
    overlay.setAttribute("aria-hidden", String(!isLoading));

    return isLoading;
  }

  function updateSyncStatus(message, tone = "info", showOverlay = true) {
    const visualState = getSyncStatusVisualState(tone);
    const activeSessionBlocking = Boolean(state.session?.active);
    const shouldSuppressOverlay =
      activeSessionBlocking &&
      showOverlay &&
      /database|reconnect|waiting until your session ends/i.test(message);
    const effectiveShowOverlay = showOverlay && !shouldSuppressOverlay;
    const statusElements = [document.getElementById("sync-status")].filter(
      Boolean,
    );

    statusElements.forEach((element) => {
      element.classList.remove("hidden");
      element.innerHTML = String(message ?? "");
      element.className = `text-xs font-medium px-3 py-1.5 rounded-lg transition-all duration-500 overflow-hidden ${visualState.panelClass}`;
      element.dataset.syncTone = tone;
    });

    const icon = document.getElementById("database-connection-icon");
    if (icon) {
      icon.className = `database-connection-icon fa-solid ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/10 p-1 text-xs transition-all duration-300 ${visualState.badgeClass}`;
      icon.title = visualState.title;
      icon.dataset.syncTone = tone;
    }

    if (tone === "info") {
      setGlobalLoadingState(
        effectiveShowOverlay,
        visualState.overlayTitle,
        visualState.overlayDetail,
        tone,
      );
    } else if (tone === "warning" || tone === "error") {
      setGlobalLoadingState(
        effectiveShowOverlay,
        visualState.overlayTitle,
        visualState.overlayDetail,
        tone,
      );
    } else {
      setGlobalLoadingState(false);
    }

    const isStartupVisibleSuccess =
      showOverlay &&
      !state.session?.active &&
      tone === "success" &&
      /Connected\./i.test(message);
    const shouldShowStatusToast =
      !shouldSuppressOverlay &&
      showOverlay &&
      (isStartupVisibleSuccess ||
        tone === "info" ||
        tone === "warning" ||
        tone === "error" ||
        /database|reconnect|retry/i.test(message));
    const connectionStatus = document.getElementById("connection-status");
    if (connectionStatus) {
      if (shouldShowStatusToast) {
        lifecycle.clearTimeout(syncStatusHideTimer);
        connectionStatus.classList.remove("hidden", "opacity-0", "scale-95");
        connectionStatus.textContent = String(message ?? "");
        connectionStatus.className = `fixed bottom-5 left-1/2 z-[60] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg px-4 py-2 text-center text-xs font-medium shadow-lg transition-all duration-500 ${visualState.panelClass}`;
      } else {
        lifecycle.clearTimeout(syncStatusHideTimer);
        connectionStatus.classList.add("opacity-0", "scale-95");
        lifecycle.setTimeout(() => {
          if (connectionStatus) {
            connectionStatus.classList.add("hidden");
            connectionStatus.classList.remove("opacity-0", "scale-95");
          }
        }, appConfig.statusHideAnimationDelayMs ?? 250);
      }
    }
  }

  function hideConnectionStatusAfterDelay(delay = 3000) {
    lifecycle.clearTimeout(syncStatusHideTimer);
    syncStatusHideTimer = lifecycle.setTimeout(() => {
      const element = document.getElementById("connection-status");
      if (!element) return;
      element.classList.add("opacity-0", "scale-95");
      lifecycle.setTimeout(
        () => element.classList.add("hidden"),
        appConfig.statusHiddenDelayMs ?? 500,
      );
    }, delay);
  }

  function formatCacheAge(ageMs) {
    const ageValue = Number(ageMs || 0);
    if (!Number.isFinite(ageValue) || ageValue <= 0) return "just now";
    const minutes = Math.floor(ageValue / 60000);
    if (minutes <= 0) return "under a minute ago";
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  function readStoredDeckCacheTimestamp() {
    const raw = getStoredItem?.(DATA_CACHE_TIMESTAMP_KEY, "0") || "0";
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function persistDeckCacheTimestamp(timestampMs = Date.now()) {
    const normalized = Number(timestampMs) || Date.now();
    lastSyncAt = normalized;
    try {
      setStoredItem?.(DATA_CACHE_TIMESTAMP_KEY, String(normalized));
    } catch (error) {
      appLogger.warn("Unable to persist deck cache timestamp.", error);
    }
  }

  function getDeckDataFreshnessState() {
    const summaryCount = Array.isArray(state.categorySummary)
      ? state.categorySummary.length
      : 0;
    const hasCachedData = summaryCount > 0;
    const lastSuccessfulSyncMs = Number(
      lastSyncAt || readStoredDeckCacheTimestamp(),
    );
    const cacheAgeMs =
      lastSuccessfulSyncMs > 0 ? Date.now() - lastSuccessfulSyncMs : Infinity;
    const isEmpty = !hasCachedData;
    const coldStartState = Boolean(isColdStart && isEmpty);
    const isStale =
      hasCachedData &&
      (!syncConnected ||
        !Number.isFinite(lastSuccessfulSyncMs) ||
        cacheAgeMs >= STALE_CACHE_MAX_AGE_MS ||
        lastSuccessfulSyncMs <= 0);
    const isHealthy =
      syncConnected &&
      hasCachedData &&
      Number.isFinite(lastSuccessfulSyncMs) &&
      lastSuccessfulSyncMs > 0 &&
      cacheAgeMs < STALE_CACHE_MAX_AGE_MS;

    return {
      hasCachedData,
      isEmpty,
      isColdStart: coldStartState,
      isStale,
      isHealthy,
      cacheAgeMs: Number.isFinite(cacheAgeMs) ? cacheAgeMs : 0,
      lastUpdatedAt: lastSuccessfulSyncMs > 0 ? lastSuccessfulSyncMs : 0,
      summaryCount,
    };
  }

  function getDeckDataReadinessState() {
    const freshness = getDeckDataFreshnessState();
    const isOffline = !syncConnected;
    const isBlocked = isOffline && freshness.isColdStart && freshness.isEmpty;
    const shouldPromptForCachedData =
      isOffline && freshness.isStale && freshness.hasCachedData;
    const isUsingCachedData = isOffline && freshness.hasCachedData;
    const isReady = freshness.isHealthy;

    return {
      ...freshness,
      isOffline,
      isBlocked,
      shouldPromptForCachedData,
      isUsingCachedData,
      isReady,
    };
  }

  function getDeckDataFreshnessBannerHtml() {
    const freshness = getDeckDataFreshnessState();

    if (!freshness.hasCachedData && !freshness.isColdStart) {
      return "";
    }

    if (freshness.isHealthy) {
      return "";
    }

    if (freshness.isColdStart) {
      return `
      <div data-deck-freshness class="mb-4 flex items-center gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-medium text-yellow-700 dark:border-yellow-900/60 dark:bg-yellow-900/20 dark:text-yellow-300">
        <i class="fa-solid fa-hourglass-half"></i>
        <span>Waiting for fresh deck data. The app is reconnecting and may be temporarily empty.</span>
      </div>
    `;
    }

    if (freshness.isEmpty) {
      return `
      <div data-deck-freshness class="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>No deck data is available yet. Please wait for the database to reconnect.</span>
      </div>
    `;
    }

    return "";
  }

  async function optimizedBackgroundSync() {
    return getSyncController().optimizedBackgroundSync();
  }

  function scheduleSyncPoll() {
    getSyncController().scheduleSyncPoll();
  }

  const syncScheduler = {
    schedule: scheduleSyncPoll,
    cancel: () => getSyncController().cancel(),
    scheduleForLeader: scheduleSyncPoll,
    handleVisibility: (isHidden) =>
      getSyncController().handleVisibility(isHidden),
  };

  function scheduleSinglePollLoop() {
    if (!isLeaderTab) {
      return;
    }

    scheduleSyncPoll();
  }

  let syncController = null;
  function getSyncController() {
    if (syncController) return syncController;
    if (typeof SyncCore === "undefined") {
      throw new Error("SyncCore is unavailable; sync cannot start yet.");
    }
    syncController = SyncCore.createController({
      state,
      lifecycle,
      appConfig,
      network: AppNetwork,
      logger: appLogger,
      isLeader: () => isLeaderTab,
      hasActiveSession: () => Boolean(state.session?.active),
      isImmediateUpdateMode: () =>
        state.prefs.databaseUpdateMode === "immediate",
      setSyncConnected: (value) => {
        syncConnected = value;
      },
      markInitialSyncCompleteFromCache: () => {
        if (
          isInitialSyncComplete ||
          !Array.isArray(state.categorySummary) ||
          state.categorySummary.length === 0
        )
          return false;
        isInitialSyncComplete = true;
        renderCategoryProgress();
        return true;
      },
      setColdStart: (value) => {
        isColdStart = value;
      },
      normalizeSummaryData,
      readStoredSyncStatusTimestamp,
      persistSyncStatusTimestamp,
      persistSummaryData: async () => {
        const saved = await saveState("summary");
        if (saved === false) {
          throw new Error("Unable to persist the synchronized summary.");
        }
        return true;
      },
      setPendingSummaryData: (summary) => {
        pendingSummaryData = summary;
      },
      applySummaryData,
      setAccessMetadata: (summary) => {
        state.accessMetadata = buildAccessMetadataMap(summary);
      },
      sanitizeDeletedDeckReferences,
      updateSyncStatus,
      setGlobalLoadingState,
      hideConnectionStatusAfterDelay,
      renderCategoryProgress,
      showColdStartNotification,
      getSummarySignature,
      refreshPendingPayloads: refreshPendingDeckPayloads,
    });
    return syncController;
  }

  function stripAccessMetadataFromSummary(summaryData) {
    // Backend response includes deck counts, type, access, and explanation availability.
    // This function ensures no Password/Hidden fields are in stored data
    if (!Array.isArray(summaryData)) return summaryData;
    return summaryData.map((deck) => {
      if (!deck || typeof deck !== "object") return deck;
      const {
        Subject,
        QuestionCount,
        QuestionType,
        Locked,
        HasExplanations,
        PayloadVersion,
      } = deck;
      return {
        Subject,
        QuestionCount,
        QuestionType,
        Locked,
        HasExplanations,
        PayloadVersion,
      };
    });
  }

  function normalizeSummaryData(summaryData) {
    if (
      summaryData &&
      !Array.isArray(summaryData) &&
      summaryData.v === 1 &&
      Array.isArray(summaryData.p) &&
      Array.isArray(summaryData.d)
    ) {
      if (
        !Array.isArray(summaryData.h) ||
        summaryData.h.length !== summaryData.d.length ||
        summaryData.p.some((prefix) => typeof prefix !== "string") ||
        summaryData.h.some(
          (fingerprint) => !/^[a-f0-9]{64}$/i.test(String(fingerprint || "")),
        )
      ) {
        throw new Error("Backend compact summary fingerprints are malformed.");
      }
      summaryData = summaryData.d.map((row, index) => {
        if (
          !Array.isArray(row) ||
          row.length < 5 ||
          row.length > 6 ||
          typeof row[0] !== "number" ||
          !Number.isInteger(row[0]) ||
          row[0] < 0 ||
          row[0] >= summaryData.p.length ||
          typeof row[1] !== "string" ||
          !row[1].trim() ||
          typeof row[2] !== "number" ||
          !Number.isInteger(row[2]) ||
          row[2] < 0 ||
          typeof row[3] !== "string" ||
          !row[3].trim() ||
          (row[4] !== 0 && row[4] !== 1) ||
          (row.length === 6 && row[5] !== 1)
        ) {
          throw new Error("Backend compact summary row is malformed.");
        }
        const prefix = summaryData.p[row[0]];
        const suffix = row[1];
        return {
          s: prefix ? `${prefix}::${suffix}` : suffix,
          c: row[2],
          t: row[3],
          ...(row[4] ? { l: "t" } : {}),
          ...(row.length > 5 ? { e: "t" } : {}),
          h: Array.isArray(summaryData.h)
            ? String(summaryData.h[index] || "")
            : "",
        };
      });
    }

    if (!Array.isArray(summaryData)) return summaryData;

    return summaryData.map((deck) => {
      if (!deck || typeof deck !== "object") return deck;

      const subject = deck.s !== undefined ? deck.s : deck.Subject;
      const questionCount = deck.c !== undefined ? deck.c : deck.QuestionCount;
      const questionType = deck.t !== undefined ? deck.t : deck.QuestionType;
      const locked = deck.l !== undefined ? deck.l : deck.Locked;
      const hasExplanations =
        Object.prototype.hasOwnProperty.call(deck, "e") ||
        (typeof deck.HasExplanations === "boolean"
          ? deck.HasExplanations
          : normalizeAccessFlag(deck.HasExplanations));

      return {
        Subject: subject,
        QuestionCount: Number(questionCount || 0),
        QuestionType: questionType || "ID",
        Locked: normalizeAccessFlag(locked),
        HasExplanations: hasExplanations,
        PayloadVersion: String(deck.h ?? deck.PayloadVersion ?? ""),
      };
    });
  }

  function normalizeAccessFlag(value, fallback = false) {
    if (value === null || value === undefined || value === "") {
      return fallback;
    }

    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;

    const normalized = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y", "on", "t"].includes(normalized)) return true;
    if (["false", "0", "no", "n", "off", "f"].includes(normalized))
      return false;

    return Boolean(value);
  }

  function ensureUnlockedFolderState() {
    const rootState =
      rootScope.state && typeof rootScope.state === "object"
        ? rootScope.state
        : null;

    if (!rootState) {
      if (
        !globalThis.__mrhUnlockedFolders ||
        typeof globalThis.__mrhUnlockedFolders !== "object"
      ) {
        globalThis.__mrhUnlockedFolders = {};
      }
      return globalThis.__mrhUnlockedFolders;
    }

    if (
      !rootState.unlockedFolders ||
      typeof rootState.unlockedFolders !== "object"
    ) {
      rootState.unlockedFolders = {};
    }
    return rootState.unlockedFolders;
  }

  function setFolderUnlocked(subject, unlocked = true) {
    const subjectName = String(subject || "").trim();
    if (!subjectName) return false;
    const unlockedFolders = ensureUnlockedFolderState();
    unlockedFolders[subjectName] = Boolean(unlocked);
    if (typeof saveState === "function") saveState();
    return true;
  }

  function isFolderUnlocked(subject) {
    const subjectName = String(subject || "").trim();
    if (!subjectName) return false;
    return Boolean(ensureUnlockedFolderState()[subjectName]);
  }

  function resolveSubjectAccess(subject, accessMap = {}, summaryEntries = []) {
    const subjectName = String(subject || "").trim();
    if (!subjectName) {
      return { Hidden: false, Password: "", Locked: false };
    }

    const directEntry = accessMap?.[subjectName] || {};
    const summaryEntry =
      Object.keys(directEntry).length > 0
        ? {}
        : (Array.isArray(summaryEntries)
            ? summaryEntries.find(
                (item) => String(item?.Subject || "") === subjectName,
              )
            : null) || {};

    const hidden =
      normalizeAccessFlag(directEntry.Hidden) ||
      normalizeAccessFlag(summaryEntry.Hidden);
    const password = String(
      directEntry.Password ||
        summaryEntry.Password ||
        summaryEntry.password ||
        "",
    ).trim();
    const locked =
      !isFolderUnlocked(subjectName) &&
      (normalizeAccessFlag(directEntry.Locked) ||
        normalizeAccessFlag(summaryEntry.Locked) ||
        password !== "");

    return {
      Hidden: hidden,
      Password: password,
      Locked: locked,
    };
  }

  function buildAccessMetadataMap(accessData) {
    const map = {};
    const rows = Array.isArray(accessData) ? accessData : [];

    rows.forEach((entry) => {
      if (!entry || !entry.Subject) return;
      const subject = String(entry.Subject).trim();
      if (!subject) return;

      const normalizedLocked =
        entry.Locked === true ||
        String(entry.Locked || "").toLowerCase() === "true";
      const normalizedHidden =
        entry.Hidden === true ||
        String(entry.Hidden || "").toLowerCase() === "true";
      const password = String(entry.Password || entry.password || "").trim();

      map[subject] = {
        Subject: subject,
        Password: password,
        Hidden: normalizedHidden,
        Locked: normalizedLocked || password !== "",
      };
    });

    return map;
  }

  function getSummarySignature(summaryData) {
    if (!Array.isArray(summaryData)) return "";
    const cached = arraySignatureCache.get(summaryData);
    if (cached !== undefined) return cached;

    const signature = summaryData
      .map((deck) =>
        [
          deck?.Subject,
          deck?.QuestionCount,
          deck?.QuestionType,
          deck?.Locked,
          deck?.HasExplanations,
          deck?.PayloadVersion,
          deck?.Hidden,
          deck?.IsFolder,
          deck?.Downloaded,
          deck?.IsDownloaded,
          deck?.LocalQuestionCount,
        ]
          .map((value) => String(value ?? ""))
          .join("\u001f"),
      )
      .join("\u001e");

    arraySignatureCache.set(summaryData, signature);
    return signature;
  }

  function getSubjectListSignature(summaryData) {
    if (!Array.isArray(summaryData)) return "";
    const cached = subjectListSignatureCache.get(summaryData);
    if (cached !== undefined) return cached;

    const signature = [
      ...new Set(
        summaryData
          .map((deck) => String(deck?.Subject || "").trim())
          .filter(Boolean),
      ),
    ]
      .sort()
      .join("\u001e");

    subjectListSignatureCache.set(summaryData, signature);
    return signature;
  }

  function scheduleStartupSync() {
    const runStartupSync = () => {
      if (typeof window === "undefined") return;

      const runIdleTasks = () => {
        if (typeof fetchAccessMetadata === "function") {
          fetchAccessMetadata().catch((error) => {
            appLogger.warn(
              "Initial access metadata fetch failed, will retry:",
              error,
            );
          });
        }

        if (typeof syncDatabase === "function") {
          syncDatabase(false, true).catch((error) => {
            appLogger.warn("Background startup sync was skipped:", error);
          });
        }
      };

      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(runIdleTasks, { timeout: 2000 });
        return;
      }

      lifecycle.setTimeout(runIdleTasks, 250);
    };

    runStartupSync();
  }

  // REMOVED: mergeAccessMetadataIntoSummary - NOT USED
  // Backend handles all access control in filterSummaryDataByAccess()
  // Frontend should never merge or modify backend response

  async function fetchAccessMetadata() {
    // Backend v8 does not expose the old ?access=1 endpoint. The public summary
    // is the authoritative client-safe access representation: it contains
    // Locked and excludes hidden subjects entirely.
    state.accessMetadata = buildAccessMetadataMap(
      Array.isArray(state.categorySummary) ? state.categorySummary : [],
    );
    return state.accessMetadata;
  }

  function isDeckPasswordProtected(subject) {
    const rawSubject = String(subject || "").trim();
    if (!rawSubject) return false;

    const access = resolveSubjectAccess(
      rawSubject,
      state.accessMetadata || {},
      state.categorySummary || [],
    );
    return Boolean(access.Password) || Boolean(access.Locked);
  }

  function isDeckHidden(subject) {
    const rawSubject = String(subject || "").trim();
    if (!rawSubject) return false;

    const access = resolveSubjectAccess(
      rawSubject,
      state.accessMetadata || {},
      state.categorySummary || [],
    );
    return Boolean(access.Hidden);
  }

  function isDeckLocked(subject) {
    const rawSubject = String(subject || "").trim();
    if (!rawSubject) return false;

    const access = resolveSubjectAccess(
      rawSubject,
      state.accessMetadata || {},
      state.categorySummary || [],
    );
    return Boolean(access.Locked) || Boolean(access.Password);
  }

  function getChangedDownloadedDecks(
    previousSummary,
    nextSummary,
    downloadedSubjects,
  ) {
    const previousDecks = Array.isArray(previousSummary) ? previousSummary : [];
    const nextDecks = Array.isArray(nextSummary) ? nextSummary : [];
    const previousVersions = new Map();
    previousDecks.forEach((deck) => {
      const subject = String(deck?.Subject || "").trim();
      if (subject) {
        previousVersions.set(subject, String(deck?.PayloadVersion || ""));
      }
    });
    const nextSubjects = new Set(
      nextDecks
        .map((deck) => String(deck?.Subject || "").trim())
        .filter(Boolean),
    );
    const downloaded = new Set(downloadedSubjects || []);
    const changedSubjects = new Set();
    nextDecks.forEach((deck) => {
      const subject = String(deck?.Subject || "").trim();
      const nextVersion = String(deck?.PayloadVersion || "");
      if (
        subject &&
        nextVersion &&
        previousVersions.get(subject) !== nextVersion &&
        downloaded.has(subject)
      ) {
        changedSubjects.add(subject);
      }
    });
    previousDecks.forEach((deck) => {
      const subject = String(deck?.Subject || "").trim();
      if (subject && !nextSubjects.has(subject) && downloaded.has(subject)) {
        changedSubjects.add(subject);
      }
    });
    return changedSubjects;
  }

  function broadcastBackendPayloadChange() {
    if (!isLeaderTab || !cacheInvalidationChannel) return;
    try {
      cacheInvalidationChannel.postMessage({
        protocol: BROADCAST_PROTOCOL,
        type: "backend_payload_changed",
      });
    } catch (error) {
      appLogger.warn(
        "[CACHE] Unable to notify other tabs about updated backend payloads.",
        error,
      );
    }
  }

  function applySummaryData(summaryData, knownChanged = null) {
    // CRITICAL FIX: Don't double-filter - backend already filters hidden decks
    // Only use the data as-is from the backend response
    const changed =
      knownChanged === null
        ? getSummarySignature(state.categorySummary || []) !==
          getSummarySignature(summaryData || [])
        : Boolean(knownChanged);
    const pendingSummaryToApply = pendingSummaryData;
    const applyingPendingSummary = Boolean(pendingSummaryToApply);

    if (!Array.isArray(summaryData)) {
      return false;
    }

    const downloadedSubjects = new Set(
      (state.db || [])
        .map((question) => String(question?.Subject || "").trim())
        .filter(Boolean),
    );
    getChangedDownloadedDecks(
      state.categorySummary || [],
      summaryData,
      downloadedSubjects,
    ).forEach((subject) => {
      pendingDeckPayloadRefreshes.add(subject);
    });
    state.prefs.pendingDeckPayloadRefreshes = [...pendingDeckPayloadRefreshes];

    state.categorySummary = summaryData;
    syncConnected = true;
    invalidateCategoryProgressRenderSignature();
    persistDeckCacheTimestamp(Date.now());
    // FEATURE: Mark initial sync as complete after first successful sync
    if (!isInitialSyncComplete) {
      isInitialSyncComplete = true;
    }
    const summaryStateSavePromise = Promise.resolve(saveState());
    summaryStateSavePromise.then(
      (saved) => {
        if (saved === false) {
          appLogger.error(
            applyingPendingSummary
              ? "Unable to persist the deferred database summary."
              : "Unable to persist the database summary.",
          );
          return;
        }
        if (
          !applyingPendingSummary ||
          pendingSummaryData !== pendingSummaryToApply
        ) {
          return;
        }
        pendingSummaryData = null;
        syncController?.confirmPendingSummaryApplied?.();
        updateSyncStatus(
          '<i class="fa-solid fa-check mr-1"></i> Database update applied after your session.',
          "success",
        );
      },
      (error) => {
        appLogger.error(
          applyingPendingSummary
            ? "Unable to persist the deferred database summary."
            : "Unable to persist the database summary.",
          error,
        );
      },
    );
    if (changed) broadcastBackendPayloadChange();
    if (!hasActiveContentSession()) {
      populateFilters();
      renderCategoryProgress();
      Promise.resolve().then(() => refreshPendingDeckPayloads());
    }
    return changed;
  }

  function hasActiveContentSession() {
    return Boolean(state.session?.active || isReviewViewActive());
  }

  function isReviewViewActive() {
    return Boolean(
      typeof document !== "undefined" &&
      document.getElementById("view-deck-review")?.classList.contains("active"),
    );
  }

  async function refreshPendingDeckPayloads() {
    if (state.session?.active) return false;
    if (deckPayloadRefreshPromise) return deckPayloadRefreshPromise;

    deckPayloadRefreshPromise = (async () => {
      for (const subject of [...pendingDeckPayloadRefreshes]) {
        if (state.session?.active) break;
        if (isReviewViewActive() && getCurrentReviewSubject() === subject) {
          continue;
        }
        const summaryEntry = (state.categorySummary || []).find(
          (deck) => String(deck?.Subject || "").trim() === subject,
        );
        if (!summaryEntry) {
          const previousDatabase = state.db;
          state.db = (state.db || []).filter(
            (question) => String(question?.Subject || "").trim() !== subject,
          );
          rebuildQuestionIndex();
          invalidateCategoryProgressRenderSignature();
          try {
            await safeIdbSet("mrh_db", state.db);
            pendingDeckPayloadRefreshes.delete(subject);
          } catch (error) {
            state.db = previousDatabase;
            rebuildQuestionIndex();
            appLogger.error(
              `Unable to persist removal of deleted deck "${subject}".`,
              error,
            );
          }
          continue;
        }
        if (summaryEntry.Locked) {
          continue;
        }
        const expectedQuestionCount = Math.max(
          0,
          Number(summaryEntry.QuestionCount) || 0,
        );
        if (expectedQuestionCount === 0) {
          const previousDatabase = state.db;
          state.db = (state.db || []).filter(
            (question) => String(question?.Subject || "").trim() !== subject,
          );
          rebuildQuestionIndex();
          invalidateCategoryProgressRenderSignature();
          try {
            await safeIdbSet("mrh_db", state.db);
            pendingDeckPayloadRefreshes.delete(subject);
          } catch (error) {
            state.db = previousDatabase;
            rebuildQuestionIndex();
            appLogger.error(
              `Unable to persist the empty updated payload for "${subject}".`,
              error,
            );
          }
          continue;
        }
        const refreshed = await fetchDeckQuestions(
          subject,
          null,
          null,
          null,
          expectedQuestionCount,
          true,
        );
        if (refreshed.length === expectedQuestionCount) {
          pendingDeckPayloadRefreshes.delete(subject);
        }
      }
      const pendingSubjects = [...pendingDeckPayloadRefreshes];
      if (
        JSON.stringify(state.prefs.pendingDeckPayloadRefreshes || []) !==
        JSON.stringify(pendingSubjects)
      ) {
        state.prefs.pendingDeckPayloadRefreshes = pendingSubjects;
        try {
          if ((await saveState("prefs")) === false) {
            appLogger.error(
              "Unable to persist pending backend payload refreshes.",
            );
          }
        } catch (error) {
          appLogger.error(
            "Unable to persist pending backend payload refreshes.",
            error,
          );
        }
      }
      return pendingDeckPayloadRefreshes.size === 0;
    })().finally(() => {
      deckPayloadRefreshPromise = null;
    });

    return deckPayloadRefreshPromise;
  }

  function scheduleSyncRetry(showOverlay = true) {
    return getSyncController().scheduleSyncRetry(showOverlay);
  }

  // ============================================
  // COLD START NOTIFICATION
  // ============================================
  function showColdStartNotification() {
    const overlay = document.getElementById("app-loading-overlay");
    if (!overlay) return;
    const titleEl = document.getElementById("app-loading-title");
    const detailEl = document.getElementById("app-loading-detail");
    const iconEl = document.getElementById("app-loading-icon");
    if (titleEl) titleEl.textContent = "Cold Start Detected";
    if (detailEl)
      detailEl.textContent =
        "The database is being rebuilt. The app will retry automatically...";
    if (iconEl)
      iconEl.className =
        "text-3xl fa-solid fa-exclamation-triangle text-yellow-300";
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
  }

  // ============================================
  // LIGHTWEIGHT SYNC STATUS CHECK
  // ============================================
  async function checkSyncStatusLightweight() {
    return getSyncController().checkSyncStatusLightweight();
  }

  // ============================================
  // ENHANCED SYNC DATABASE WITH ALL FIXES
  // ============================================
  function getSummarySyncDecision(summaryData, wasConnected) {
    const changed =
      getSummarySignature(state.categorySummary || []) !==
      getSummarySignature(summaryData);
    const canApplyNow =
      state.prefs.databaseUpdateMode === "immediate" || !state.session.active;

    return {
      changed,
      canApplyNow,
      shouldApply: canApplyNow && (changed || !wasConnected),
      shouldQueue: !canApplyNow && changed,
    };
  }

  /**
   * @param {boolean} [isRetry]
   * @param {boolean} [isBackgroundCheck]
   * @returns {Promise<boolean>}
   */
  async function syncDatabaseImplementation(
    isRetry = false,
    isBackgroundCheck = false,
    expectedSyncTimestamp = "",
  ) {
    return getSyncController().syncDatabase(
      isRetry,
      isBackgroundCheck,
      expectedSyncTimestamp,
    );
  }

  /**
   * Synchronize the summary cache while preserving active-session state.
   * @param {boolean} [isRetry]
   * @param {boolean} [isBackgroundCheck]
   * @returns {Promise<boolean>}
   */
  async function syncDatabase(
    isRetry = false,
    isBackgroundCheck = false,
    expectedSyncTimestamp = "",
  ) {
    const bootstrapStatus =
      typeof window !== "undefined" ? window.__MRH_BOOTSTRAP__?.status : null;

    if (bootstrapStatus === "failed") {
      throw new Error("App bootstrap failed; database sync is unavailable.");
    }

    if (bootstrapStatus !== "ready" && !__mrhAppReady) {
      appLogger.debug(
        "Skipping syncDatabase until app bootstrap has reached ready state.",
      );
      return false;
    }

    return getSyncController().syncDatabase(
      isRetry,
      isBackgroundCheck,
      expectedSyncTimestamp,
    );
  }

  function enterFolder(folderName, isLockedFolder) {
    return DeckNavCore.enterFolder(folderName, isLockedFolder);
  }

  function goToPath(index) {
    return DeckNavCore.goToPath(index);
  }

  function closeAllDropdownMenus(exceptElement = null) {
    if (
      typeof ModalCore === "undefined" ||
      typeof ModalCore.closeAllDropdownMenus !== "function"
    ) {
      return false;
    }
    return ModalCore.closeAllDropdownMenus(exceptElement);
  }

  function initDetailsExclusivity() {
    if (
      typeof ModalCore === "undefined" ||
      typeof ModalCore.initDetailsExclusivity !== "function"
    ) {
      return false;
    }
    return ModalCore.initDetailsExclusivity();
  }

  let categoryProgressRenderScheduled = false;
  let categoryProgressRenderInFlight = false;
  let categoryProgressRenderQueued = false;
  let categoryProgressLastRenderSignature = "";
  let categoryTreeCache = null;
  let categoryTreeFolderStatsCache = null;
  let categoryTreeNodeMetadataCache = null;
  function invalidateCategoryProgressRenderSignature() {
    globalScope.invalidateCategoryProgressSignatureCache?.();
    categoryProgressLastRenderSignature = "";
  }

  function renderCategoryProgress() {
    if (
      typeof window !== "undefined" &&
      window.__MRH_BOOTSTRAP__?.status !== "ready" &&
      !__mrhAppReady
    ) {
      return;
    }

    if (categoryProgressRenderQueued) return;
    categoryProgressRenderQueued = true;

    const render = () => {
      categoryProgressRenderQueued = false;
      renderCategoryProgressNow();
    };

    if (typeof requestAnimationFrame === "function") {
      scheduleAppAnimationFrame(render);
    } else {
      lifecycle.setTimeout(render, 0);
    }
  }

  function toggleTreeNode(encodedPath) {
    const path = decodeHandlerValue(encodedPath);
    if (!path) return;

    if (collapsedTreePaths.has(path)) {
      collapsedTreePaths.delete(path);
    } else {
      collapsedTreePaths.add(path);
    }

    state.prefs.treeCollapsedPaths = [...collapsedTreePaths];
    saveState();

    invalidateCategoryProgressRenderSignature();
    renderCategoryProgress();
  }

  function renderCategoryProgressNow({ allowInactive = false } = {}) {
    if (!document.body) {
      if (!categoryProgressRenderScheduled) {
        categoryProgressRenderScheduled = true;
        scheduleAppAnimationFrame(() => {
          categoryProgressRenderScheduled = false;
          if (document.body && typeof renderCategoryProgress === "function") {
            renderCategoryProgress();
          }
        });
      }
      return;
    }

    const dashboardView = document.getElementById("view-dashboard");
    if (
      !allowInactive &&
      dashboardView &&
      !dashboardView.classList.contains("active")
    ) {
      categoryProgressRenderQueued = false;
      return;
    }

    const renderSignature = getCategoryProgressRenderSignature({
      currentAppMode,
      isInitialSyncComplete,
    });
    if (renderSignature === categoryProgressLastRenderSignature) {
      categoryProgressRenderQueued = false;
      return;
    }

    if (categoryProgressRenderInFlight) {
      if (!categoryProgressRenderScheduled) {
        categoryProgressRenderScheduled = true;
        scheduleAppAnimationFrame(() => {
          categoryProgressRenderScheduled = false;
          if (document.body && typeof renderCategoryProgress === "function") {
            renderCategoryProgress();
          }
        });
      }
      return;
    }

    categoryProgressRenderInFlight = true;

    try {
      const dashboardControls = dashboardView || document;
      syncDashboardControls(dashboardControls);

      const container = document.getElementById("category-list");
      const isTree = state.prefs.layoutMode === "tree";
      const isGrid = state.prefs.layoutMode === "grid";
      const completedSet = new Set(state.stats?.completedQs || []);
      const mistakesSet = new Set(state.stats?.mistakes || []);
      const subjectIdsBySubject = ensureQuestionIndex().bySubject;
      const deckHasExplanations = (deckData) =>
        Object.prototype.hasOwnProperty.call(deckData || {}, "e") ||
        deckData?.HasExplanations === true;
      const folderExplanationAvailabilityCache = new WeakMap();
      function getFolderExplanationStatus(node) {
        if (!node || typeof node !== "object") {
          return { hasDecks: false, allHaveExplanations: true };
        }
        if (folderExplanationAvailabilityCache.has(node)) {
          return folderExplanationAvailabilityCache.get(node);
        }

        const status = { hasDecks: false, allHaveExplanations: true };
        if (node._data && node._data.IsFolder !== true) {
          status.hasDecks = true;
          status.allHaveExplanations = deckHasExplanations(node._data);
        }

        Object.values(node._children || {}).forEach((child) => {
          const childStatus = getFolderExplanationStatus(child);
          if (!childStatus.hasDecks) return;
          status.hasDecks = true;
          status.allHaveExplanations =
            status.allHaveExplanations && childStatus.allHaveExplanations;
        });

        folderExplanationAvailabilityCache.set(node, status);
        return status;
      }
      function folderHasOnlyExplainedDecks(node) {
        const status = getFolderExplanationStatus(node);
        return status.hasDecks && status.allHaveExplanations;
      }
      const downloadedSubjects = new Set(
        (state.db || []).map((question) => question?.Subject).filter(Boolean),
      );
      const databaseUnavailable = !isInitialSyncComplete;
      const getStudyDeckProgress = (subject, total) => {
        const safeTotal = Math.max(0, Number(total) || 0);
        const progress = state.prefs?.studyProgress?.[subject];
        if (safeTotal === 0 || !progress) {
          return { current: 0, total: safeTotal, percent: 0 };
        }

        let current = 0;
        const layout =
          rootScope.getDeckSessionSetting?.("study", "studyLayout", subject) ||
          state.prefs.studyLayout ||
          "scroll";
        const pageSize =
          rootScope.getDeckSessionSetting?.(
            "study",
            "studyPageSize",
            subject,
          ) ||
          state.prefs.studyPageSize ||
          10;
        const hasQuestionPosition =
          Boolean(progress.questionId) || Number(progress.index) > 0;
        if (layout === "single") {
          current = Number(progress.index || 0) + 1;
        } else if (pageSize === "All") {
          current = hasQuestionPosition
            ? Number(progress.index || 0) + 1
            : Math.floor(Math.max(0, Number(progress.scrollY) || 0) / 420);
        } else if (hasQuestionPosition) {
          current = Number(progress.index) + 1;
        } else {
          current = Math.max(0, (Number(progress.page || 1) - 1) * pageSize);
        }

        current = Math.min(safeTotal, Math.max(0, current));
        return {
          current,
          total: safeTotal,
          percent: safeTotal > 0 ? (current / safeTotal) * 100 : 0,
        };
      };
      const visibleSummary = getVisibleCategorySummary();
      const visibleSummarySignature = getSummarySignature(visibleSummary);
      const visibleSubjectSignature = getSubjectListSignature(visibleSummary);
      let tree;
      if (
        categoryTreeCache &&
        categoryTreeCache.summarySignature === visibleSummarySignature
      ) {
        tree = categoryTreeCache.tree;
      } else {
        tree = buildCategoryTree(visibleSummary);
        categoryTreeCache = {
          summarySignature: visibleSummarySignature,
          subjectSignature: visibleSubjectSignature,
          tree,
        };
        // Tree nodes are stable until the tree itself is rebuilt. Keep metadata
        // alongside the cached tree instead of recalculating subtree totals on
        // every dashboard render.
        categoryTreeFolderStatsCache = new WeakMap();
        categoryTreeNodeMetadataCache = new WeakMap();
      }

      if (isTree && !treeCollapseInitialized && Object.keys(tree).length > 0) {
        const collapseGroups = (node, path = []) => {
          const children = node?._children || node || {};
          Object.keys(children).forEach((key) => {
            const child = children[key];
            const childPath = path.concat(key);
            const hasChildren = Object.keys(child?._children || {}).length > 0;
            const isExplicitFolder = child?._data?.IsFolder === true;
            if (hasChildren || isExplicitFolder) {
              collapsedTreePaths.add(childPath.join("::"));
              collapseGroups(child, childPath);
            }
          });
        };
        collapsedTreePaths.clear();
        const savedCollapsedPaths = Array.isArray(
          state.prefs.treeCollapsedPaths,
        )
          ? state.prefs.treeCollapsedPaths.filter(Boolean)
          : [];
        if (savedCollapsedPaths.length > 0) {
          savedCollapsedPaths.forEach((path) => collapsedTreePaths.add(path));
        } else {
          collapseGroups(tree);
          state.prefs.treeCollapsedPaths = [...collapsedTreePaths];
          saveState();
        }
        treeCollapseInitialized = true;
      }

      if (!Array.isArray(state.currentPath)) state.currentPath = [];
      let currentNode = tree;
      let pathValid = true;

      for (let dir of state.currentPath) {
        if (currentNode[dir]) {
          currentNode = currentNode[dir]._children;
        } else {
          pathValid = false;
          break;
        }
      }

      if (!pathValid && isInitialSyncComplete) {
        showDeckNotFound(state.currentPath);
        state.currentPath = [];
        globalScope.persistNavigationPath(state.currentPath);
        currentNode = tree;
      } else if (pathValid) {
        dismissDeckNotFound();
      }

      const folderStatsCache = categoryTreeFolderStatsCache || new WeakMap();
      const nodeMetadataCache = categoryTreeNodeMetadataCache || new WeakMap();
      categoryTreeFolderStatsCache = folderStatsCache;
      categoryTreeNodeMetadataCache = nodeMetadataCache;

      const freshnessBannerHtml = getDeckDataFreshnessBannerHtml();
      const treeReadabilityNoticeHtml = isTree
        ? `<div id="tree-view-readability-notice" class="tree-view-readability-notice" role="note" hidden>
            <p class="tree-view-readability-message">Tree view may be difficult to read on your current screen. For a better experience, use a larger screen or rotate your device to landscape mode.</p>
            <div class="tree-view-readability-actions">
              <button type="button" onclick="dismissTreeViewReadabilityNotice()">Dismiss</button>
            </div>
          </div>`
        : "";

      let html = isTree
        ? treeReadabilityNoticeHtml
        : `
      <div data-deck-breadcrumb class="deck-breadcrumb-nav flex flex-nowrap items-center gap-2 text-sm font-medium text-gray-600 dark:text-gray-400 overflow-x-auto">
        <button onclick="goToPath(-1)" aria-label="Home" title="Home" class="deck-breadcrumb-home hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
          <i class="fa-solid fa-house text-brand-500" aria-hidden="true"></i>
        </button>
        ${state.currentPath
          .map(
            (dir, i) => `
              <i class="fa-solid fa-chevron-right text-xs text-gray-400 flex-shrink-0"></i>
              <button onclick="goToPath(${i})" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap flex-shrink-0">${escapeHTML(dir.toUpperCase())}</button>
            `,
          )
          .join("")}
      </div>
      ${freshnessBannerHtml}`;

      const layoutClass = isTree
        ? "deck-tree-view overflow-visible rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm"
        : isGrid
          ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5"
          : "flex flex-col gap-5";

      html += `<div data-deck-list-layout class="${layoutClass}">`;
      const sortBy = state.prefs.deckSortBy || "letters";
      const sortDirection = state.prefs.deckSortDirection === "desc" ? -1 : 1;
      const popularDeckPaths = new Set(
        [
          "BSMT 3.1 - ALPHA (Finals)",
          "Mock Exams",
          "GENERAL KNOWLEDGE",
          "BSMT COMPETENCIES",
          "REVIEW NOTES FOR DECK OFFICERS (BOOK)",
        ].map((path) => path.toLocaleLowerCase()),
      );
      const isPopularDeckPath = (path) =>
        popularDeckPaths.has(
          String(path || "")
            .split("::")
            .pop()
            .trim()
            .toLocaleLowerCase(),
        );
      const pinnedDecks = new Set(
        Array.isArray(state.prefs.pinnedDecks)
          ? state.prefs.pinnedDecks.filter((entry) => typeof entry === "string")
          : [],
      );
      const getPinnedSortKey = (key) => {
        const fullKey =
          state.currentPath && state.currentPath.length > 0
            ? [...state.currentPath, key].join("::")
            : key;
        return fullKey;
      };
      const isLockedListingEntry = (entry, path) =>
        Boolean(entry.node?._data?.Locked) ||
        isDeckLocked([...path, entry.key].join("::"));
      const keys = Object.keys(currentNode)
        .map((key) => {
          const node = currentNode[key];
          const metadata = getNodeMetadata(
            node,
            nodeMetadataCache,
            folderStatsCache,
          );
          return { key, metadata, node };
        })
        .sort((leftEntry, rightEntry) => {
          const leftLocked = isLockedListingEntry(
            leftEntry,
            state.currentPath || [],
          );
          const rightLocked = isLockedListingEntry(
            rightEntry,
            state.currentPath || [],
          );
          if (leftLocked !== rightLocked) {
            return leftLocked ? 1 : -1;
          }

          const leftKey = getPinnedSortKey(leftEntry.key);
          const rightKey = getPinnedSortKey(rightEntry.key);

          const leftPinned =
            leftEntry.metadata.isFolder && pinnedDecks.has(leftKey);
          const rightPinned =
            rightEntry.metadata.isFolder && pinnedDecks.has(rightKey);

          if (leftPinned !== rightPinned) {
            return leftPinned ? -1 : 1;
          }

          const left = leftEntry.key;
          const right = rightEntry.key;

          if (sortBy === "questions") {
            const leftCount = leftEntry.metadata.totalCards;
            const rightCount = rightEntry.metadata.totalCards;
            return (
              (leftCount - rightCount) * sortDirection ||
              TextUtils.naturalSortStrings(left, right) * sortDirection
            );
          }

          return TextUtils.naturalSortStrings(left, right) * sortDirection;
        })
        .map((entry) => entry.key);

      const sourceFilter = state.prefs.deckSourceFilter || "all";
      const archivedDecks = Array.isArray(state.prefs?.archivedDecks)
        ? state.prefs.archivedDecks
        : [];
      const archiveScopePath = (state.currentPath || []).join("::");
      const expandedArchivedPaths = Array.isArray(
        state.prefs?.expandedArchivedPaths,
      )
        ? state.prefs.expandedArchivedPaths
        : [];
      const showArchivedDecks =
        expandedArchivedPaths.includes(archiveScopePath);
      const favoriteDecks = Array.isArray(state.prefs.favoriteDecks)
        ? state.prefs.favoriteDecks
        : [];
      const favoriteMatchCache = new WeakMap();

      function matchesFavoriteDeck(node, currentKey) {
        const subject = node?._data?.Subject || "";
        const folderKey = String(currentKey || "").trim();
        const childKeys = Object.keys(node?._children || {});
        const cachedMatches = favoriteMatchCache.get(node);
        if (cachedMatches?.has(folderKey)) {
          return cachedMatches.get(folderKey);
        }

        const matchesNode = favoriteDecks.some((entry) => {
          const favoriteText = String(entry || "").trim();
          if (!favoriteText) return false;
          if (favoriteText === subject) return true;
          if (folderKey && favoriteText === folderKey) return true;
          return (
            subject.startsWith(favoriteText + "::") ||
            subject.startsWith(favoriteText + "/")
          );
        });
        if (matchesNode) {
          const matches = true;
          if (!cachedMatches) favoriteMatchCache.set(node, new Map());
          (favoriteMatchCache.get(node) || cachedMatches).set(
            folderKey,
            matches,
          );
          return matches;
        }

        const matches = childKeys.some((childKey) =>
          matchesFavoriteDeck(node._children[childKey], childKey),
        );
        if (!cachedMatches) favoriteMatchCache.set(node, new Map());
        (favoriteMatchCache.get(node) || cachedMatches).set(folderKey, matches);
        return matches;
      }

      function nodeMatchesFilter(node, filter, currentKey = null) {
        let isArchived = false;

        if (
          node._data &&
          node._data.Subject &&
          archivedDecks.includes(node._data.Subject)
        ) {
          isArchived = true;
        }
        if (node._data && node._data.Subject) {
          const topLevel = node._data.Subject.split("::")[0];
          if (archivedDecks.includes(topLevel)) {
            isArchived = true;
          }
        }
        if (
          currentKey &&
          (!state.currentPath || state.currentPath.length === 0)
        ) {
          if (archivedDecks.includes(currentKey)) {
            isArchived = true;
          }
        }
        if (
          state.currentPath &&
          state.currentPath.length > 0 &&
          archivedDecks.includes(state.currentPath[0])
        ) {
          isArchived = true;
        }

        if (filter === "archived") return isArchived;
        if (isArchived && !showArchivedDecks) return false;

        const childKeys = Object.keys(node._children || {});
        const nodePath = [...(state.currentPath || []), currentKey]
          .filter(Boolean)
          .join("::");
        const hasArchivedDescendant = archivedDecks.some((entry) =>
          String(entry || "").startsWith(`${nodePath}::`),
        );
        if (filter === "all" && !isArchived && hasArchivedDescendant) {
          return true;
        }

        if (filter === "all") return true;
        if (filter === "favorites") {
          if (matchesFavoriteDeck(node, currentKey)) return true;
          const childKeys = Object.keys(node._children || {});
          return childKeys.some((childKey) =>
            nodeMatchesFilter(node._children[childKey], filter, childKey),
          );
        }

        if (
          node._data !== null &&
          node._data !== undefined &&
          !node._data.IsFolder
        ) {
          const isDownloaded = downloadedSubjects.has(node._data.Subject);
          if (filter === "downloaded") return isDownloaded;
          if (filter === "cloud") return !isDownloaded;
        }

        if (childKeys.length > 0) {
          return childKeys.some((childKey) =>
            nodeMatchesFilter(node._children[childKey], filter, childKey),
          );
        }

        return false;
      }

      let visibleKeys = keys.filter((key) => {
        const item = currentNode[key];
        if (
          item._data &&
          !item._data.IsFolder &&
          Number(item._data.QuestionCount || 0) === 0
        ) {
          return false;
        }
        return nodeMatchesFilter(currentNode[key], sourceFilter, key);
      });

      if (isTree) {
        const treeStatsCache = new WeakMap();
        const allCountColor =
          currentAppMode === "review"
            ? "text-purple-600 dark:text-purple-400"
            : "text-blue-400 dark:text-blue-300";
        const allHeaderColor =
          currentAppMode === "review"
            ? "text-purple-600 dark:text-purple-400"
            : "text-blue-600 dark:text-blue-300";
        const latestRecentlyViewed = String(
          state.prefs?.recentDecks?.[0] || "",
        ).trim();
        const latestRecentlyViewedSegments =
          getPathSegments(latestRecentlyViewed);
        let visibleRecentlyViewedPath = latestRecentlyViewed;
        for (
          let index = 1;
          index < latestRecentlyViewedSegments.length;
          index += 1
        ) {
          const ancestorPath = latestRecentlyViewedSegments
            .slice(0, index)
            .join("::");
          if (collapsedTreePaths.has(ancestorPath)) {
            visibleRecentlyViewedPath = ancestorPath;
            break;
          }
        }

        function getTreeStats(node) {
          if (!node || typeof node !== "object") {
            return { total: 0, correctCount: 0, mistakesCount: 0 };
          }
          if (treeStatsCache.has(node)) return treeStatsCache.get(node);

          const stats = { total: 0, correctCount: 0, mistakesCount: 0 };
          if (node._data) {
            const subject = node._data.Subject;
            const total = Math.max(0, Number(node._data.QuestionCount || 0));
            const ids = subjectIdsBySubject.get(subject) || [];
            stats.total = total;
            if (ids.length > 0) {
              const completed = ids.filter((id) => completedSet.has(id)).length;
              const mistakes = ids.filter((id) => mistakesSet.has(id)).length;
              stats.correctCount = Math.max(0, completed - mistakes);
              stats.mistakesCount = mistakes;
            } else {
              const recorded = state.stats?.subjectAccuracy?.[subject] || {};
              stats.correctCount = Math.min(
                total,
                Math.max(0, Number(recorded.correct || 0)),
              );
              stats.mistakesCount = Math.min(
                Math.max(0, total - stats.correctCount),
                Math.max(0, Number(recorded.total || 0) - stats.correctCount),
              );
            }
          }
          Object.keys(node._children || {}).forEach((childKey) => {
            const childStats = getTreeStats(node._children[childKey]);
            stats.total += childStats.total;
            stats.correctCount += childStats.correctCount;
            stats.mistakesCount += childStats.mistakesCount;
          });
          treeStatsCache.set(node, stats);
          return stats;
        }

        function renderTreeStat(value, colorClass, clickHandler = "") {
          const numericValue = Math.max(0, Number(value) || 0);
          const clickableClass = clickHandler
            ? "cursor-pointer hover:underline"
            : "";
          return `<span class="text-right tabular-nums ${clickableClass} ${numericValue === 0 ? "text-gray-500 dark:text-gray-600" : colorClass}"${clickHandler ? ` onclick="event.stopPropagation(); ${clickHandler}" title="Quiz mistakes"` : ""}>${numericValue}</span>`;
        }

        function sortTreeKeys(node, path = []) {
          const children = node?._children || node || {};
          return Object.keys(children)
            .map((key) => ({
              key,
              node: children[key],
              metadata: getNodeMetadata(
                children[key],
                nodeMetadataCache,
                folderStatsCache,
              ),
            }))
            .sort((leftEntry, rightEntry) => {
              const leftLocked = isLockedListingEntry(leftEntry, path);
              const rightLocked = isLockedListingEntry(rightEntry, path);
              if (leftLocked !== rightLocked) {
                return leftLocked ? 1 : -1;
              }
              if (
                leftEntry.metadata.isFolder !== rightEntry.metadata.isFolder
              ) {
                return leftEntry.metadata.isFolder ? -1 : 1;
              }
              if (sortBy === "questions") {
                return (
                  (leftEntry.metadata.totalCards -
                    rightEntry.metadata.totalCards) *
                    sortDirection ||
                  TextUtils.naturalSortStrings(leftEntry.key, rightEntry.key) *
                    sortDirection
                );
              }
              return (
                TextUtils.naturalSortStrings(leftEntry.key, rightEntry.key) *
                sortDirection
              );
            })
            .map((entry) => entry.key);
        }

        function renderTreeRows(
          node,
          depth = 0,
          showAllChildren = false,
          path = [],
        ) {
          const children = node?._children || node || {};
          return sortTreeKeys(node, path)
            .map((key) => {
              const item = children[key];
              const matches =
                showAllChildren || nodeMatchesFilter(item, sourceFilter, key);
              if (!matches) return "";

              const childPath = path.concat(key);
              const hasChildren = Object.keys(item._children || {}).length > 0;
              const explicitFolder = item._data && item._data.IsFolder === true;
              const stats = getTreeStats(item);
              const indent = Math.min(depth * 24 + 12, 420);
              const folderSubject = childPath.join("::");
              const isPopular = isPopularDeckPath(folderSubject);
              const isGroup = hasChildren || explicitFolder;
              const deckSubject = item._data?.Subject || folderSubject;
              const isPasswordProtected =
                !isGroup &&
                (isDeckLocked(deckSubject) || Boolean(item._data?.Locked));
              const safeKey = escapeHTML(
                isPasswordProtected ? TextUtils.scrambleWords(key) : key,
              );
              const isCollapsed = collapsedTreePaths.has(folderSubject);
              const isActive = state.currentPath?.join("::") === folderSubject;
              const isTopLevelGroup = depth === 0 && isGroup;
              const isFavorite = (state.prefs.favoriteDecks || []).includes(
                folderSubject,
              );
              const isArchived = (state.prefs.archivedDecks || []).includes(
                folderSubject,
              );
              const recentlyViewedIcon =
                folderSubject === visibleRecentlyViewedPath
                  ? '<i class="fa-regular fa-clock deck-tree-recent" title="Recently viewed" aria-label="Recently viewed"></i>'
                  : "";
              const favoriteIcon = isFavorite
                ? '<i class="fa-solid fa-star deck-tree-favorite" title="Favorite deck" aria-label="Favorite deck"></i>'
                : "";
              const popularBadge = isPopular
                ? renderDeckBadge("Popular", "fa-fire")
                : "";
              const deckTypeBadge = getFolderDeckTypeBadgeLabel(item);
              const explanationsAvailableBadge = (
                isGroup
                  ? folderHasOnlyExplainedDecks(item)
                  : deckHasExplanations(item._data)
              )
                ? renderDeckBadge("Explanations Available", "fa-lightbulb")
                : "";
              const action = isGroup
                ? `toggleTreeNode('${encodeHandlerValue(folderSubject)}')`
                : `handleDeckClick('${encodeHandlerValue(item._data?.Subject || folderSubject)}')`;
              const icon = isGroup
                ? `<span class="deck-tree-toggle" aria-hidden="true">${isCollapsed ? "+" : "−"}</span>`
                : '<span class="deck-tree-toggle" aria-hidden="true"></span>';
              const typeIcon = isGroup
                ? '<i class="fa-solid fa-folder deck-tree-type-icon deck-tree-folder-icon" aria-hidden="true"></i>'
                : '<i class="fa-regular fa-file-lines deck-tree-type-icon" aria-hidden="true"></i>';
              const nameCaseClass = isGroup ? "uppercase" : "";
              const mistakesActionIcon =
                !isGroup && stats.mistakesCount > 0
                  ? `<button type="button" class="deck-tree-action deck-tree-mistakes-action" onclick="event.stopPropagation(); handleDeckClick('${encodeHandlerValue(deckSubject)}', 'mistakes')" title="Review mistakes (${stats.mistakesCount})" aria-label="Review mistakes (${stats.mistakesCount})"><i class="fa-solid fa-triangle-exclamation"></i></button>`
                  : "";
              const resetActionIcon =
                !isGroup && (stats.correctCount > 0 || stats.mistakesCount > 0)
                  ? `<button type="button" ${databaseUnavailable ? "disabled" : ""} class="deck-tree-action deck-tree-reset-action" onclick="event.stopPropagation(); resetCategory('${encodeHandlerValue(deckSubject)}')" title="Reset progress" aria-label="Reset progress"><i class="fa-solid fa-rotate-left"></i></button>`
                  : "";
              const rowClass = isActive ? "deck-tree-row-active" : "";
              const interactionClass =
                deckInteractionLocked &&
                folderSubject !== activeDeckInteractionSubject
                  ? "deck-interaction-blocked"
                  : "";
              const syncLockClass =
                databaseUnavailable && !isGroup ? "deck-sync-locked" : "";

              const settingsHtml = isTopLevelGroup
                ? `<details class="deck-tree-settings" onclick="event.stopPropagation()">
                    <summary class="deck-tree-settings-trigger" aria-label="Deck settings" title="Deck settings"><i class="fa-solid fa-gear"></i></summary>
                    <div class="deck-tree-settings-menu" onclick="event.stopPropagation()">
                      <button type="button" onclick="toggleFavoriteDeck('${encodeHandlerValue(folderSubject)}')">${isFavorite ? "Remove from Favorites" : "Add to Favorites"}</button>
                      <button type="button" onclick="toggleArchiveDeck('${encodeHandlerValue(folderSubject)}')">${isArchived ? "Unarchive Folder" : "Archive Folder"}</button>
                    </div>
                  </details>`
                : "";

              return `<div data-tree-key="${escapeHTML(childPath.join("::"))}" onclick="${action}" class="deck-tree-row deck-tree-grid ${rowClass} ${interactionClass} ${syncLockClass} ${isPasswordProtected ? "password-protected-deck" : ""} items-center gap-2 px-3 py-2.5 cursor-pointer transition-all duration-150" ${databaseUnavailable && !isGroup ? 'aria-disabled="true"' : ""}>
                <div class="min-w-0 flex items-center text-base sm:text-lg text-gray-700 dark:text-gray-200" style="padding-left: ${indent}px">${icon}${typeIcon}<span class="deck-tree-name ${nameCaseClass}">${safeKey}</span>${deckTypeBadge ? renderDeckBadge(deckTypeBadge) : ""}${explanationsAvailableBadge}${popularBadge}${recentlyViewedIcon}${favoriteIcon}</div>
                <span class="deck-tree-actions">${mistakesActionIcon}</span>
                ${renderTreeStat(stats.total, allCountColor)}
                ${renderTreeStat(stats.correctCount, "text-green-400 dark:text-green-300")}
                ${renderTreeStat(
                  stats.mistakesCount,
                  "text-red-400 dark:text-red-300",
                  !isGroup
                    ? `handleDeckClick('${encodeHandlerValue(deckSubject)}', 'mistakes')`
                    : "",
                )}
                <div class="flex items-center justify-end gap-1">${isTopLevelGroup ? settingsHtml : resetActionIcon}</div>
              </div>${isGroup && !isCollapsed ? renderTreeRows(item, depth + 1, showAllChildren || (sourceFilter === "favorites" && matchesFavoriteDeck(item, key)), childPath) : ""}`;
            })
            .join("");
        }

        const treeRows = renderTreeRows(tree);
        html += `<div data-tree-header class="deck-tree-grid gap-2 px-3 py-3 border-b border-gray-200 dark:border-gray-700 text-sm font-semibold text-gray-700 dark:text-gray-100">
          <span>Deck</span><span></span><span class="tree-stat-label tree-stat-label-all text-right ${allHeaderColor}"><span class="tree-stat-label-text">All</span></span><span class="tree-stat-label text-right text-green-600 dark:text-green-300" title="Correct" aria-label="Correct"><span class="tree-stat-label-text">Correct</span><i class="tree-stat-label-icon fa-solid fa-check"></i></span><span class="tree-stat-label text-right text-red-600 dark:text-red-300" title="Mistakes" aria-label="Mistakes"><span class="tree-stat-label-text">Mistakes</span><i class="tree-stat-label-icon fa-solid fa-xmark"></i></span><span></span>
        </div>${treeRows || '<div data-deck-empty class="col-span-full text-center py-10 text-gray-500 dark:text-gray-400">No decks match your filter.</div>'}`;
      } else if (visibleKeys.length === 0) {
        html += `<div data-deck-empty class="col-span-full text-center py-10 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">No decks match your filter.</div>`;
      }

      function getDeckTypeBadgeLabel(deckData) {
        const rawType = String(deckData?.QuestionType ?? "")
          .trim()
          .toUpperCase();
        if (!rawType) return "";

        if (rawType === "ID") return "Identification";
        if (rawType === "MCQ" || rawType === "MC") return "Multiple Choices";
        if (
          rawType === "MX" ||
          rawType === "MIXED" ||
          rawType === "MCQ/ID" ||
          rawType === "ID/MCQ"
        ) {
          return "Mixed";
        }

        return "";
      }

      function renderDeckBadge(label, icon = "") {
        const normalizedLabel = String(label || "").trim();
        if (!normalizedLabel) return "";

        const toneNames = {
          identification: "identification",
          "multiple choices": "multiple-choices",
          mixed: "mixed",
          popular: "popular",
          "explanations available": "explanations",
        };
        const tone = toneNames[normalizedLabel.toLowerCase()] || "other";
        const defaultIcons = {
          identification: "fa-pen-to-square",
          "multiple choices": "fa-list-check",
          mixed: "fa-shuffle",
          popular: "fa-fire",
          "explanations available": "fa-lightbulb",
        };
        const iconClass =
          icon || defaultIcons[normalizedLabel.toLowerCase()] || "";
        const iconHtml = iconClass
          ? `<i class="deck-label-icon deck-label-icon-${tone} fa-solid ${iconClass}" aria-hidden="true"></i>`
          : "";

        return `<span class="deck-label-badge deck-label-${tone}">${iconHtml}${escapeHTML(normalizedLabel)}</span>`;
      }

      function getFolderDeckTypeBadgeLabel(folderNode) {
        const directBadge = getDeckTypeBadgeLabel(folderNode?._data);
        if (directBadge) return directBadge;

        const badges = new Set();
        const collectChildBadges = (node) => {
          if (!node) return;
          const childBadge = getDeckTypeBadgeLabel(node._data);
          if (childBadge) badges.add(childBadge);
          Object.values(node._children || {}).forEach(collectChildBadges);
        };
        Object.values(folderNode?._children || {}).forEach(collectChildBadges);

        if (badges.size === 1) return [...badges][0];
        return badges.size > 1 ? "Mixed" : "";
      }

      function generateCardHTML(cat, displayName) {
        const subj = cat.Subject;
        const safeSubj = escapeHTML(subj);
        const encodedSubj = encodeHandlerValue(subj);
        const isLocked = isDeckLocked(subj) || Boolean(cat?.Locked);
        const safeName = escapeHTML(
          isLocked ? TextUtils.scrambleWords(displayName) : displayName,
        );
        const loaderId = getDeckLoaderId(subj);
        const deckTypeBadge = getDeckTypeBadgeLabel(cat);
        const explanationsAvailableBadge = deckHasExplanations(cat)
          ? renderDeckBadge("Explanations Available", "fa-lightbulb")
          : "";
        const popularBadge = isPopularDeckPath(subj)
          ? renderDeckBadge("Popular", "fa-fire")
          : "";
        const deckNameMode =
          state.prefs.deckNameMode === "clip"
            ? "truncate"
            : "whitespace-normal";
        const deckTitleModeClass =
          state.prefs.deckNameMode === "clip" ? "deck-card-title-clip" : "";
        const totalQuestionsInDb = cat.QuestionCount;

        const isRoot = !state.currentPath || state.currentPath.length === 0;

        const data = state.stats.subjectAccuracy[subj] || {
          total: 0,
          correct: 0,
        };
        const progressStats = getSubjectProgressStats(
          subj,
          subjectIdsBySubject,
          completedSet,
          mistakesSet,
        );
        const isReview = currentAppMode === "review";
        const isQuiz = currentAppMode === "quiz";
        const completedCount = progressStats.completedCount;
        const mistakesCount = progressStats.mistakesCount;
        const hasQuizProgress = completedCount > 0 || mistakesCount > 0;
        const cardCountLabel = isQuiz
          ? `${completedCount} / ${totalQuestionsInDb} cards`
          : `${totalQuestionsInDb} cards`;
        const quizProgressPercent =
          totalQuestionsInDb > 0
            ? Math.min(100, (completedCount / totalQuestionsInDb) * 100)
            : 0;
        const isCompleted = progressStats.isCompleted;
        const cardClasses = isCompleted
          ? "bg-green-50 dark:bg-green-900/30 border-green-300"
          : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700";
        const unfinishedBadge =
          mistakesCount > 0
            ? '<i class="fa-solid fa-file-circle-xmark text-white mr-2 flex-shrink-0" title="Unfinished"></i>'
            : "";
        const isRecentlyViewed = getRecentPathDepth(subj) > 0;
        const recentViewedBadge = isRecentlyViewed
          ? '<i class="fa-regular fa-clock text-base text-amber-500 mr-0.5 flex-shrink-0" title="Recently Viewed"></i>'
          : "";
        const primaryActionText = isReview
          ? "Review"
          : completedCount === 0
            ? "Quiz"
            : "Continue";
        const primaryActionIcon = isReview ? "fa-eye" : "fa-play";
        const primaryActionColor = isReview
          ? "bg-purple-600 hover:bg-purple-700"
          : "bg-brand-600 hover:bg-brand-700";
        const themeColorText = isReview
          ? "text-purple-600 dark:text-purple-400"
          : "text-brand-600 dark:text-brand-400";
        const themeShadowHover = isReview
          ? "hover:shadow-purple-500/10"
          : "hover:shadow-brand-500/10";
        const loaderColor = isReview ? "text-purple-500" : "text-brand-500";
        const isDeckInteractionBusy =
          (deckInteractionLocked && subj !== activeDeckInteractionSubject) ||
          databaseUnavailable;
        const syncLockClass = databaseUnavailable ? "deck-sync-locked" : "";
        const isDeckLoading =
          deckInteractionLocked && subj === activeDeckInteractionSubject;

        let statsHTML = "";
        let countBadgeHTML = "";
        let resetBtnHTML = "";

        countBadgeHTML = `
          <div class="flex items-center gap-1.5 flex-shrink-0 pt-1">
            <span class="text-sm font-black ${themeColorText} transition-colors">${cardCountLabel}</span>
          </div>`;

        if (!isReview) {
          if (completedCount > 0 || mistakesCount > 0) {
            resetBtnHTML = `
            <button ${databaseUnavailable ? "disabled" : ""} data-reset-subject="${escapeHTML(subj)}" onclick="resetCategory('${encodedSubj}')" class="reset-deck-btn w-10 sm:w-12 shrink-0 bg-red-50 text-red-600 dark:bg-red-900/20 py-2 px-1 rounded-lg font-bold hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-90 transition-all duration-300 text-xs sm:text-sm border border-red-100 dark:border-red-800 flex items-center justify-center" title="Reset Progress">
              <i class="fa-solid fa-rotate-left"></i>
            </button>`;
          }
        }

        return `
        <div data-deck-key="${escapeHTML(subj)}" onclick="handleDeckClick('${encodedSubj}')" class="deck-card ${isDeckInteractionBusy ? "deck-interaction-blocked" : "cursor-pointer"} ${syncLockClass} ${isLocked ? "password-protected-deck" : ""} ${cardClasses} p-5 rounded-xl shadow-sm hover:shadow-lg ${themeShadowHover} border relative w-full flex flex-col" aria-busy="${isDeckInteractionBusy || isDeckLoading}">
          <div id="${loaderId}" data-deck-loader class="hidden absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10 rounded-xl flex-col items-center justify-center transition-opacity">
            <i class="fa-solid fa-spinner fa-spin text-3xl ${loaderColor} mb-2"></i>
            <span class="text-sm font-bold text-gray-700 dark:text-gray-200">Loading...</span>
          </div>
          <div class="mb-4">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <h3 class="deck-card-title font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center transition-colors min-w-0 gap-1" title="${safeName}">
                  ${recentViewedBadge}
                  ${unfinishedBadge}
                  <span class="deck-card-title-text ${deckTitleModeClass} ${deckNameMode} break-words">${safeName}</span>
                </h3>
                ${statsHTML}
              </div>
              <div class="flex items-center gap-1.5">
                ${countBadgeHTML}
              </div>
            </div>
            <div class="deck-card-badges mt-1 flex flex-wrap items-start gap-1">${deckTypeBadge ? renderDeckBadge(deckTypeBadge) : ""}${explanationsAvailableBadge}</div>
          </div>
          ${
            isQuiz && hasQuizProgress
              ? `<div class="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700" role="progressbar" aria-label="Quiz progress for ${safeName}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(quizProgressPercent)}">
                  <div class="h-full rounded-full bg-brand-500 transition-all duration-300" style="width: ${quizProgressPercent}%"></div>
                </div>`
              : ""
          }

          <div class="flex gap-2 mt-auto w-full" onclick="event.stopPropagation()">
            <button ${databaseUnavailable ? "disabled" : ""} onclick="handleDeckClick('${encodedSubj}')" class="flex-1 ${primaryActionColor} text-white py-2 px-2 rounded-lg font-bold active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="${primaryActionText}">
              <i class="fa-solid ${primaryActionIcon} mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i>
              <span class="truncate">${primaryActionText}</span>
            </button>

            ${
              !isReview && mistakesCount > 0
                ? `
                  <button ${databaseUnavailable ? "disabled" : ""} onclick="handleDeckClick('${encodedSubj}', 'mistakes')" class="flex-1 bg-yellow-500 text-white py-2 px-2 rounded-lg font-bold hover:bg-yellow-600 active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="Review Mistakes">
                    <i class="fa-solid fa-triangle-exclamation mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i>
                    <span class="truncate">Review (${mistakesCount})</span>
                  </button>
                `
                : ""
            }

            ${resetBtnHTML}
            ${popularBadge ? `<div class="ml-auto">${popularBadge}</div>` : ""}
          </div>
        </div>
      `;
      }

      if (!isTree)
        visibleKeys.forEach((key) => {
          const item = currentNode[key];
          const hasChildren = Object.keys(item._children).length > 0;
          const hasData = item._data !== null;

          const isExplicitFolder = hasData && item._data.IsFolder === true;
          if (hasChildren || isExplicitFolder) {
            const totalCards = getFolderStats(item, folderStatsCache);
            const isReview = currentAppMode === "review";
            const isRecentlyViewedFolder =
              getRecentPathDepth(
                (state.currentPath || []).concat(key).join("::"),
              ) > 0;
            const folderColorClass = isReview
              ? "bg-purple-500 dark:bg-purple-700 group-hover:bg-purple-600 dark:group-hover:bg-purple-600"
              : "bg-brand-500 dark:bg-brand-700 group-hover:bg-brand-600 dark:group-hover:bg-brand-600";
            const folderTextHover = isReview
              ? "group-hover:text-purple-600 dark:group-hover:text-purple-400"
              : "group-hover:text-brand-600 dark:group-hover:text-brand-400";

            const folderSubject =
              (state.currentPath || []).concat(key).join("::") || key;
            const popularBadge = isPopularDeckPath(folderSubject)
              ? renderDeckBadge("Popular", "fa-fire")
              : "";
            const deckTypeBadge = getFolderDeckTypeBadgeLabel(item);
            const explanationsAvailableBadge = folderHasOnlyExplainedDecks(item)
              ? renderDeckBadge("Explanations Available", "fa-lightbulb")
              : "";
            const isLocked =
              isDeckLocked(folderSubject) || Boolean(item?._data?.Locked);

            const isRoot = !state.currentPath || state.currentPath.length === 0;
            let pinBtnHtml = "";
            let archiveBtnHtml = "";
            let favoriteBtnHtml = "";
            const isArchived = (state.prefs?.archivedDecks || []).includes(
              folderSubject,
            );
            const isFavorite = (state.prefs?.favoriteDecks || []).includes(
              folderSubject,
            );
            const isPinned = (state.prefs?.pinnedDecks || []).includes(
              folderSubject,
            );
            pinBtnHtml = `
            <button onclick="event.stopPropagation(); togglePinDeck('${encodeHandlerValue(folderSubject)}')"
              class="deck-icon-action deck-icon-action-pin ${isPinned ? "is-active" : ""}"
              aria-label="${isPinned ? "Unpin Folder" : "Pin Folder"}"
              title="${isPinned ? "Unpin Folder" : "Pin Folder"}">
              <i class="fa-solid fa-thumbtack text-lg" style="${isPinned ? "" : "transform: rotate(45deg); display: inline-block;"}"></i>
            </button>
          `;
            archiveBtnHtml = `
            <button onclick="event.stopPropagation(); toggleArchiveDeck('${encodeHandlerValue(folderSubject)}')"
              class="deck-icon-action deck-icon-action-archive ${isArchived ? "is-active" : ""}"
              aria-label="${isArchived ? "Unarchive Folder" : "Archive Folder"}"
              title="${isArchived ? "Unarchive Folder" : "Archive Folder"}">
              <i class="fa-solid fa-box-archive text-lg"></i>
            </button>
          `;
            favoriteBtnHtml = `
            <button onclick="event.stopPropagation(); toggleFavoriteDeck('${encodeHandlerValue(folderSubject)}')"
              class="deck-icon-action deck-icon-action-favorite ${isFavorite ? "is-active" : ""}"
              aria-label="${isFavorite ? "Remove from Favorites" : "Add to Favorites"}"
              title="${isFavorite ? "Remove from Favorites" : "Add to Favorites"}">
              <i class="fa-solid fa-star text-lg"></i>
            </button>
          `;

            html += `
          <div data-folder-key="${escapeHTML(key)}" onclick="enterFolder(decodeHandlerValue('${encodeHandlerValue(key)}'), ${isLocked})" class="${deckInteractionLocked ? "deck-interaction-blocked" : "cursor-pointer"} ${isLocked ? "password-protected-deck" : ""} group bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col relative">
            <div class="h-12 ${folderColorClass} transition-colors relative">
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
            </div>
            <div class="p-4 flex flex-col flex-1">
              <div class="flex justify-between items-start w-full gap-2">
                <div class="min-w-0 flex flex-col flex-1">
                  <h3 class="deck-folder-title font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide ${folderTextHover} transition-colors text-lg flex items-center min-w-0 gap-1" title="${escapeHTML(isLocked ? TextUtils.scrambleWords(key) : key)}">
                    ${isRecentlyViewedFolder ? '<i class="fa-regular fa-clock text-base text-amber-500 mr-0.5 flex-shrink-0" title="Recently Viewed"></i>' : ""}
                    <span class="deck-card-title-text ${state.prefs.deckNameMode === "clip" ? "deck-card-title-clip truncate" : "whitespace-normal break-words"}">${escapeHTML(isLocked ? TextUtils.scrambleWords(key) : key)}</span>
                  </h3>
                </div>
                <div class="flex items-center gap-0">
                  ${pinBtnHtml}
                  ${favoriteBtnHtml}
                  ${archiveBtnHtml}
                </div>
              </div>
              <div class="deck-card-badges mt-1 w-full flex flex-wrap items-start gap-1">${deckTypeBadge ? renderDeckBadge(deckTypeBadge) : ""}${explanationsAvailableBadge}</div>
              <div class="mt-auto pt-2 flex justify-between items-center text-sm text-gray-500 dark:text-gray-400">
                <span>${totalCards} cards</span>
                ${popularBadge}
              </div>
            </div>
          </div>`;
          } else if (hasData && !isExplicitFolder) {
            html += generateCardHTML(item._data, key);
          }
        });

      html += `</div>`;
      const archivedDeckCount = new Set(
        archivedDecks.filter((entry) => {
          if (typeof entry !== "string" || !entry.trim()) return false;
          return archiveScopePath
            ? entry === archiveScopePath ||
                entry.startsWith(`${archiveScopePath}::`)
            : true;
        }),
      ).size;
      if (archivedDeckCount > 0 && sourceFilter !== "archived") {
        const archivedToggleLabel = showArchivedDecks ? "Hide" : "Show";
        const archivedDeckNoun = archivedDeckCount === 1 ? "Deck" : "Decks";
        html += `<div data-archived-deck-toggle class="w-full flex justify-center mt-4 mb-2">
          <button type="button" onclick="toggleArchivedDeckVisibility()" class="text-sm font-bold text-gray-600 dark:text-gray-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors">
            ${archivedToggleLabel} (${archivedDeckCount}) Archived ${archivedDeckNoun}
          </button>
        </div>`;
      }
      if (container) {
        const template = document.createElement("template");
        template.innerHTML = html;
        const getNodeKey = (node) => {
          if (!(node instanceof Element)) return "";
          for (const attribute of [
            "data-deck-list-layout",
            "data-deck-breadcrumb",
            "data-deck-freshness",
            "data-deck-empty",
            "data-archived-deck-toggle",
            "data-deck-key",
            "data-folder-key",
            "data-tree-header",
            "data-tree-key",
          ]) {
            if (node.hasAttribute(attribute)) {
              return `${attribute}:${node.getAttribute(attribute) || ""}`;
            }
          }
          return "";
        };
        const syncAttributes = (current, next) => {
          Array.from(current.attributes).forEach((attribute) => {
            if (!next.hasAttribute(attribute.name)) {
              current.removeAttribute(attribute.name);
            }
          });
          Array.from(next.attributes).forEach((attribute) => {
            if (current.getAttribute(attribute.name) !== attribute.value) {
              current.setAttribute(attribute.name, attribute.value);
            }
          });
        };
        const reconcileChildren = (currentParent, nextParent) => {
          Array.from(currentParent.childNodes).forEach((node) => {
            if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) {
              node.remove();
            }
          });

          const currentByKey = new Map();
          Array.from(currentParent.children).forEach((node) => {
            const key = getNodeKey(node);
            if (key) currentByKey.set(key, node);
          });

          let cursor = currentParent.firstElementChild;
          Array.from(nextParent.children).forEach((nextNode) => {
            const key = getNodeKey(nextNode);
            let currentNode = key ? currentByKey.get(key) : null;

            if (currentNode) {
              syncAttributes(currentNode, nextNode);
              if (currentNode.hasAttribute("data-deck-list-layout")) {
                reconcileChildren(currentNode, nextNode);
              } else if (currentNode.innerHTML !== nextNode.innerHTML) {
                currentNode.innerHTML = nextNode.innerHTML;
              }
            } else {
              currentNode = nextNode.cloneNode(true);
            }

            if (currentNode !== cursor) {
              currentParent.insertBefore(currentNode, cursor);
            }
            cursor = currentNode.nextElementSibling;
          });

          while (cursor) {
            const nextNode = cursor.nextElementSibling;
            cursor.remove();
            cursor = nextNode;
          }
        };

        reconcileChildren(container, template.content);
        container.className = "";
      }
      if (isTree && !treeViewResizeListenerInstalled) {
        if (typeof rootScope.addEventListener === "function") {
          rootScope.addEventListener(
            "resize",
            updateTreeViewReadabilityNotice,
            { signal: uiEventController.signal },
          );
          treeViewResizeListenerInstalled = true;
        }
      }
      updateTreeViewReadabilityNotice();

      categoryProgressLastRenderSignature = renderSignature;

      applyTitleMode();
    } finally {
      categoryProgressRenderInFlight = false;
    }
  }

  async function fetchAndStartCategory(subject, mode, pass = null) {
    const started = await DeckNavCore.fetchAndStartCategory(
      subject,
      mode,
      pass,
    );
    if (started && state.session?.active) {
      await markQuizActivity(subject);
    }
    return started;
  }

  function startCustomSession(pool) {
    return DeckNavCore.startCustomSession(pool);
  }

  async function resetCategory(subject) {
    return DeckNavCore.resetCategory(subject);
  }

  function markLocalDownloadDeleted(subject) {
    const normalized = String(subject || "").trim();
    if (!normalized) return;
    const set = new Set(
      (state.prefs.localDownloadDeletedDecks || []).filter(Boolean),
    );
    set.add(normalized);
    state.prefs.localDownloadDeletedDecks = [...set];
  }

  function clearLocalDownloadDeleted(subject) {
    const normalized = String(subject || "").trim();
    if (!normalized) return;
    state.prefs.localDownloadDeletedDecks = (
      state.prefs.localDownloadDeletedDecks || []
    ).filter((deck) => deck !== normalized);
  }

  async function deleteSubjectData(subject) {
    subject = decodeHandlerValue(subject);
    if (
      await requestConfirmation(
        `Are you sure you want to delete the downloaded questions for "${subject}"? Your accuracy and progress stats will remain, but the app will remove the local data to save space. The deck will remain in your list until you download it again.`,
        "Delete Downloaded Data",
      )
    ) {
      if (
        appDataClearInProgress ||
        clearDatabaseInProgress ||
        clearAppDataInProgress
      ) {
        return;
      }
      let finishMutation;
      const mutation = new Promise((resolve) => {
        finishMutation = resolve;
      });
      inFlightDeckMutations.add(mutation);
      const clearGeneration = appDataClearGeneration;
      invalidateDeckFetch(subject);
      deckMutationsInProgress.add(String(subject || "").trim());

      try {
        // Clear any pending sync timers - deletion is a local operation
        lifecycle.clearTimeout(syncRetryTimer);
        lifecycle.clearInterval(syncCountdownTimer);

        // Reset sync state after local deletion succeeds
        // (deletion doesn't depend on backend connectivity)
        syncAttempt = 0;
        syncConnected = true;
        setGlobalLoadingState(false);

        const beforeSummary = (state.categorySummary || []).find(
          (deck) => deck && deck.Subject === subject,
        );

        state.db = state.db.filter((q) => q.Subject !== subject);
        rebuildQuestionIndex();
        markLocalDownloadDeleted(subject);
        invalidateCategoryProgressRenderSignature();

        if (beforeSummary) {
          beforeSummary.Downloaded = false;
          beforeSummary.IsDownloaded = false;
          beforeSummary.LocalQuestionCount = 0;
          beforeSummary.QuestionCount = Math.max(
            0,
            Number(beforeSummary.QuestionCount || 0),
          );
        }

        state.prefs.favoriteDecks = (state.prefs.favoriteDecks || []).filter(
          (deck) => deck !== subject,
        );
        state.prefs.recentDecks = (state.prefs.recentDecks || []).filter(
          (deck) => deck !== subject,
        );
        if (state.prefs.lastActivity?.subject === subject) {
          state.prefs.lastActivity = null;
        }

        state.prefs.deletedDecks = Array.from(
          new Set((state.prefs.deletedDecks || []).filter(Boolean)),
        ).filter((deck) => deck !== subject);

        saveState();
        await Promise.allSettled([...inFlightDeckDatabaseWrites]);
        if (!isDeckFetchCurrent(clearGeneration)) return;
        await safeIdbSet("mrh_db", state.db);
        if (!isDeckFetchCurrent(clearGeneration)) return;
        renderCategoryProgress();

        const saved = getStoredItem("saved_session");
        if (saved) {
          try {
            const sessionObj = JSON.parse(saved);
            const hasDeletedQuestions = Array.isArray(sessionObj.questions)
              ? sessionObj.questions.some((q) => q.Subject === subject)
              : false;

            if (hasDeletedQuestions) {
              let newQuestions = [];
              let newUserAnswers = {};
              let newIdentificationRatings = {};
              let newIdentificationSrsSnapshots = {};
              let keptBeforeCurrent = 0;

              let newIdx = 0;
              for (let i = 0; i < sessionObj.questions.length; i++) {
                if (sessionObj.questions[i].Subject !== subject) {
                  newQuestions.push(sessionObj.questions[i]);

                  if (sessionObj.userAnswers && sessionObj.userAnswers[i]) {
                    newUserAnswers[newIdx] = sessionObj.userAnswers[i];
                  }
                  if (
                    Object.prototype.hasOwnProperty.call(
                      sessionObj.identificationRatings || {},
                      i,
                    )
                  ) {
                    newIdentificationRatings[newIdx] =
                      sessionObj.identificationRatings[i];
                  }
                  if (
                    Object.prototype.hasOwnProperty.call(
                      sessionObj.identificationSrsSnapshots || {},
                      i,
                    )
                  ) {
                    newIdentificationSrsSnapshots[newIdx] =
                      sessionObj.identificationSrsSnapshots[i];
                  }

                  if (i < sessionObj.currentIndex) {
                    keptBeforeCurrent++;
                  }

                  newIdx++;
                }
              }

              if (newQuestions.length === 0) {
                clearSessionProgress();
                state.session = {
                  active: false,
                  questions: [],
                  currentIndex: 0,
                  userAnswers: {},
                };
              } else {
                sessionObj.questions = newQuestions;
                sessionObj.userAnswers = newUserAnswers;
                sessionObj.identificationRatings = newIdentificationRatings;
                sessionObj.identificationSrsSnapshots =
                  newIdentificationSrsSnapshots;
                sessionObj.currentIndex = Math.min(
                  keptBeforeCurrent,
                  newQuestions.length - 1,
                );
                setStoredJSON("saved_session", sessionObj);

                if (state.session.active) {
                  state.session = { ...sessionObj };
                }
              }
            } else if (
              state.session?.questions?.some((q) => q.Subject === subject) ||
              state.prefs.lastActivity?.subject === subject
            ) {
              clearSessionProgress();
              state.session = {
                active: false,
                questions: [],
                currentIndex: 0,
                userAnswers: {},
              };
            }
          } catch (e) {
            appLogger.error("Error parsing saved session during deletion.", e);
          }
        }

        if (
          state.session?.questions?.some((q) => q.Subject === subject) ||
          state.prefs.lastActivity?.subject === subject
        ) {
          clearSessionProgress();
          state.session = {
            active: false,
            questions: [],
            currentIndex: 0,
            userAnswers: {},
          };
        }

        updateDashboard();
      } finally {
        deckMutationsInProgress.delete(String(subject || "").trim());
        inFlightDeckMutations.delete(mutation);
        finishMutation();
      }
    }
  }

  function getDeckFetchKey(subject, pass = null, customFilter = null) {
    return `${String(subject || "").trim()}::${String(pass || "")}::${typeof customFilter === "function" ? "custom" : "all"}`;
  }

  async function fetchDeckQuestions(
    subject,
    pass = null,
    loaderElement = null,
    customFilter = null,
    expectedQuestionCount = null,
    suppressRender = false,
  ) {
    const subjectKey = String(subject || "").trim();
    if (!subjectKey) return [];
    if (!canFetchDeck(subjectKey)) return [];

    return await fetchDeckQuestionsFromNetwork(
      subject,
      pass,
      customFilter,
      loaderElement,
      expectedQuestionCount,
      suppressRender,
    );
  }

  function getDeckFetchFailureMessage(subject, error) {
    const message =
      error && error.message
        ? error.message
        : "Unable to load deck data from the backend.";
    if (/incorrect password/i.test(message)) return "Incorrect Password";
    return `Unable to load "${subject}" from the database. ${message}`;
  }

  /**
   * @param {string} subject
   * @param {string|null} pass
   * @param {((question: Record<string, unknown>) => boolean)|null} customFilter
   * @param {HTMLElement|null} [loaderElement]
   * @param {number|null} [expectedQuestionCount]
   * @param {boolean} [suppressRender]
   * @returns {Promise<Array<Record<string, unknown>>>}
   */
  async function fetchDeckQuestionsFromNetwork(
    subject,
    pass,
    customFilter,
    loaderElement = null,
    expectedQuestionCount = null,
    suppressRender = false,
  ) {
    if (!canFetchDeck(subject)) return [];

    const subjectKey = getDeckFetchKey(subject, pass, customFilter);
    const hasPendingPayloadUpdate = pendingDeckPayloadRefreshes.has(
      String(subject || "").trim(),
    );
    if (hasPendingPayloadUpdate) invalidateDeckFetch(subject);
    if (deckFetchInFlight.has(subjectKey) && !hasPendingPayloadUpdate) {
      return deckFetchInFlight.get(subjectKey);
    }

    const clearGeneration = appDataClearGeneration;
    const deckGeneration = getDeckFetchGeneration(subject);
    const request = (async () => {
      let previousDatabaseForRollback = null;
      if (loaderElement) {
        loaderElement.classList.remove("hidden");
        loaderElement.classList.add("flex");
      }

      if (isDeckLocked(subject) && !pass) {
        pendingDeckSubject = subject;
        pendingDeckAction = pendingDeckAction || "continue";
        openDeckPasswordModal(subject, pendingDeckAction || "continue");
        if (loaderElement) {
          loaderElement.classList.add("hidden");
          loaderElement.classList.remove("flex");
        }
        return [];
      }

      try {
        if (
          typeof AppNetwork === "undefined" ||
          typeof AppNetwork.getDeck !== "function"
        ) {
          throw new Error("AppNetwork deck API is unavailable.");
        }
        const response = await AppNetwork.getDeck(subject, pass || "", {
          timeoutMs: 15000,
        });
        if (
          !isDeckFetchCurrent(clearGeneration) ||
          !isDeckFetchCurrentForSubject(subject, deckGeneration)
        ) {
          return [];
        }

        let newQuestions = response;
        if (newQuestions && newQuestions.error) {
          const errorText = String(newQuestions.error || "").toLowerCase();
          if (errorText.includes("incorrect password") && pass) {
            throw new Error("Incorrect password.");
          }
          if (
            errorText.includes("incorrect password") ||
            errorText.includes("requires a password") ||
            errorText.includes("not available")
          ) {
            if (!pass) {
              pendingDeckSubject = subject;
              pendingDeckAction = pendingDeckAction || "continue";
              openDeckPasswordModal(subject, pendingDeckAction || "continue");
            }
            return [];
          }
          throw new Error(newQuestions.error);
        }
        if (!Array.isArray(newQuestions)) {
          throw new Error(
            "Unexpected backend response format while loading deck.",
          );
        }

        const normalizedSubject = String(subject || "").trim();
        if (pendingDeckPayloadRefreshes.has(normalizedSubject)) {
          const summaryEntry = (state.categorySummary || []).find(
            (deck) => String(deck?.Subject || "").trim() === normalizedSubject,
          );
          const expectedPayloadVersion = String(
            summaryEntry?.PayloadVersion || "",
          );
          if (!/^[a-f0-9]{64}$/i.test(expectedPayloadVersion)) {
            throw new Error(
              `Backend payload version for "${subject}" is unavailable.`,
            );
          }
          if (typeof AppNetwork.getPayloadFingerprint !== "function") {
            throw new Error(
              "Backend payload fingerprint verification is unavailable.",
            );
          }
          const receivedPayloadVersion =
            await AppNetwork.getPayloadFingerprint(newQuestions);
          if (receivedPayloadVersion !== expectedPayloadVersion) {
            throw new Error(
              `Backend returned a stale or incompatible payload for "${subject}".`,
            );
          }
        }

        let validQuestions = newQuestions
          .map((q) => normalizeQuestionRecord(q, subject))
          .filter((q) => q.Question && q.Question.trim() !== "");
        if (typeof customFilter === "function")
          validQuestions = validQuestions.filter(customFilter);

        if (
          expectedQuestionCount === null &&
          pendingDeckPayloadRefreshes.has(String(subject || "").trim())
        ) {
          const summaryEntry = (state.categorySummary || []).find(
            (deck) =>
              String(deck?.Subject || "").trim() ===
              String(subject || "").trim(),
          );
          if (summaryEntry) {
            expectedQuestionCount = Math.max(
              0,
              Number(summaryEntry.QuestionCount) || 0,
            );
          }
        }

        const existingSubjectQuestions = getQuestionsForSubject(subject);
        const existingById = new Map();
        for (const existingQuestion of existingSubjectQuestions) {
          if (existingQuestion?.ID) {
            existingById.set(String(existingQuestion.ID), existingQuestion);
          }
        }

        let stableIdBySignature = null;
        const getQuestionSignature = (question) =>
          [
            String(question?.Question || "").trim(),
            String(question?.Answer || "").trim(),
            String(question?.ChoiceA || "").trim(),
            String(question?.ChoiceB || "").trim(),
            String(question?.ChoiceC || "").trim(),
            String(question?.ChoiceD || "").trim(),
            String(question?.ChoiceE || "").trim(),
            String(question?.Explanation || "").trim(),
          ].join("||");
        const getStableIdBySignature = (question) => {
          if (!stableIdBySignature) {
            stableIdBySignature = new Map();
            for (const existingQuestion of existingSubjectQuestions) {
              const signature = getQuestionSignature(existingQuestion);
              const stableKey = `${String(existingQuestion?.Subject || subject).trim()}::${signature}`;
              if (signature && existingQuestion?.ID) {
                stableIdBySignature.set(stableKey, String(existingQuestion.ID));
              }
            }
          }

          const signature = getQuestionSignature(question);
          if (!signature) return "";
          return (
            stableIdBySignature.get(
              `${String(question?.Subject || subject).trim()}::${signature}`,
            ) || ""
          );
        };

        const normalizeDeckQuestionId = (rawId, questionSubject) => {
          const subjectKey = String(questionSubject || subject || "").trim();
          const incomingId = String(rawId ?? "").trim();

          if (!subjectKey) {
            return (
              incomingId ||
              `question-${Math.random().toString(36).substr(2, 6)}`
            );
          }

          if (!incomingId) {
            return `${subjectKey}::${Math.random().toString(36).substr(2, 6)}`;
          }

          const segments = incomingId
            .split("::")
            .map((segment) => segment.trim())
            .filter(Boolean);
          const lastSegment = segments[segments.length - 1] || incomingId;

          if (incomingId.startsWith(`${subjectKey}::`)) {
            return incomingId;
          }

          return `${subjectKey}::${lastSegment}`;
        };

        validQuestions = validQuestions.map((q) => {
          const incomingId = String(q.ID ?? "").trim();
          const existing = incomingId ? existingById.get(incomingId) : null;
          if (existing) {
            q.ID = existing.ID;
            return q;
          }

          if (!incomingId) {
            const existingId = getStableIdBySignature(q);
            if (existingId) {
              q.ID = existingId;
              return q;
            }
          }

          q.ID = normalizeDeckQuestionId(q.ID, q.Subject || subject);
          return q;
        });

        if (
          expectedQuestionCount !== null &&
          validQuestions.length !== expectedQuestionCount
        ) {
          throw new Error(
            `Backend payload for "${subject}" is incomplete: expected at least ${expectedQuestionCount} questions, received ${validQuestions.length}.`,
          );
        }

        if (
          suppressRender &&
          (state.session?.active ||
            (isReviewViewActive() && getCurrentReviewSubject() === subject))
        ) {
          return [];
        }

        if (validQuestions.length === 0) {
          return [];
        }

        if (suppressRender) previousDatabaseForRollback = state.db;
        const otherQuestions = state.db.filter(
          (q) => String(q?.Subject || "").trim() !== subject,
        );
        state.db = [...otherQuestions, ...validQuestions];
        rebuildQuestionIndex();
        invalidateCategoryProgressRenderSignature();
        await safeIdbSet("mrh_db", state.db);
        clearLocalDownloadDeleted(subject);
        if (pendingDeckPayloadRefreshes.delete(normalizedSubject)) {
          state.prefs.pendingDeckPayloadRefreshes = [
            ...pendingDeckPayloadRefreshes,
          ];
          try {
            if ((await saveState("prefs")) === false) {
              pendingDeckPayloadRefreshes.add(normalizedSubject);
              state.prefs.pendingDeckPayloadRefreshes = [
                ...pendingDeckPayloadRefreshes,
              ];
              appLogger.error(
                `Unable to persist completion of the updated payload for "${subject}".`,
              );
            }
          } catch (error) {
            pendingDeckPayloadRefreshes.add(normalizedSubject);
            state.prefs.pendingDeckPayloadRefreshes = [
              ...pendingDeckPayloadRefreshes,
            ];
            appLogger.error(
              `Unable to persist completion of the updated payload for "${subject}".`,
              error,
            );
          }
        }
        if (!suppressRender && typeof renderCategoryProgress === "function") {
          renderCategoryProgress();
        }

        return validQuestions;
      } catch (err) {
        if (previousDatabaseForRollback) {
          state.db = previousDatabaseForRollback;
          rebuildQuestionIndex();
        }
        appLogger.warn("Network fetch failed.", err);
        if (
          pass &&
          (/incorrect password/i.test(String(err?.message || "")) ||
            String(err?.code || "").toUpperCase() === "PASSWORD_REQUIRED")
        ) {
          throw err;
        }
        if (!suppressRender) {
          showToast(getDeckFetchFailureMessage(subject, err), "error");
        }
        return [];
      } finally {
        if (loaderElement) {
          loaderElement.classList.add("hidden");
          loaderElement.classList.remove("flex");
        }
      }
    })();

    deckFetchInFlight.set(subjectKey, request);
    try {
      return await request;
    } finally {
      if (deckFetchInFlight.get(subjectKey) === request) {
        deckFetchInFlight.delete(subjectKey);
      }
    }
  }

  async function reviewDeck(
    subject,
    pass = null,
    preferCachedQuestions = false,
    authorizedSessionQuestions = null,
  ) {
    const loader = document.getElementById(getDeckLoaderId(subject));
    const cachedSessionQuestions = Array.isArray(authorizedSessionQuestions)
      ? authorizedSessionQuestions.filter(
          (question) => String(question?.Subject || "").trim() === subject,
        )
      : [];
    const hasAuthorizedSessionQuestions = cachedSessionQuestions.length > 0;

    if (isDeckHidden(subject)) {
      showToast("This deck is hidden and not available.", "warning");
      return false;
    }

    if (isDeckLocked(subject) && !pass && !hasAuthorizedSessionQuestions) {
      pendingDeckSubject = subject;
      pendingDeckAction = "resume-review";
      openDeckPasswordModal(subject, "resume-review");
      return false;
    }

    let validQuestions = [];
    if (
      preferCachedQuestions &&
      !pendingDeckPayloadRefreshes.has(String(subject || "").trim())
    ) {
      const cachedQuestions = (state.db || []).filter(
        (question) => String(question?.Subject || "").trim() === subject,
      );
      const summaryEntry = (state.categorySummary || []).find(
        (category) => category?.Subject === subject,
      );
      const expectedQuestionCount = Number(summaryEntry?.QuestionCount || 0);
      if (
        cachedQuestions.length > 0 &&
        (!expectedQuestionCount ||
          cachedQuestions.length >= expectedQuestionCount)
      ) {
        validQuestions = cachedQuestions;
      }
    }

    if (validQuestions.length === 0 && hasAuthorizedSessionQuestions) {
      validQuestions = cachedSessionQuestions;
    }

    if (validQuestions.length === 0 && !hasAuthorizedSessionQuestions) {
      validQuestions = await fetchDeckQuestions(subject, pass, loader);
    }

    if (validQuestions.length === 0) {
      if (isDeckLocked(subject) && !hasAuthorizedSessionQuestions) {
        pendingDeckSubject = subject;
        pendingDeckAction = "resume-review";
        openDeckPasswordModal(subject, "resume-review");
        if (loader) loader.classList.add("hidden");
        return false;
      }
      showToast(
        `Could not refresh "${subject}". Please try again in a moment.`,
        "warning",
        5000,
      );
      if (loader) loader.classList.add("hidden");
      return false;
    }

    if (typeof globalScope.navigate === "function") {
      const navigated = await globalScope.navigate("deck-review");
      if (!navigated) return false;
    }

    if (loader) loader.classList.add("hidden");
    state.prefs.lastActivity = {
      mode: "review",
      subject,
      updatedAt: new Date().toISOString(),
    };
    saveState();
    renderDeckReview(subject, validQuestions);
    globalScope.updateSessionNavigationUrl?.(subject, "study");
    return true;
  }

  function toggleFavoriteDeck(subjectId) {
    subjectId = decodeHandlerValue(subjectId);
    if (!subjectId) return;

    if (!Array.isArray(state.prefs.favoriteDecks)) {
      state.prefs.favoriteDecks = [];
    }

    const existing = state.prefs.favoriteDecks.filter(Boolean);
    const isFavorite = existing.includes(subjectId);

    state.prefs.favoriteDecks = isFavorite
      ? existing.filter((deck) => deck !== subjectId)
      : [...existing, subjectId];

    saveState();
    invalidateCategoryProgressRenderSignature();
    renderCategoryProgress();
    showToast(isFavorite ? "Removed from Favorites." : "Added to Favorites.");
  }

  function togglePinDeck(subjectId) {
    subjectId = decodeHandlerValue(subjectId);
    if (!subjectId) return;

    if (!Array.isArray(state.prefs.pinnedDecks)) {
      state.prefs.pinnedDecks = [];
    }

    const existing = state.prefs.pinnedDecks.filter(Boolean);
    const isPinned = existing.includes(subjectId);

    state.prefs.pinnedDecks = isPinned
      ? existing.filter((deck) => deck !== subjectId)
      : [...existing, subjectId];

    saveState();
    invalidateCategoryProgressRenderSignature();
    renderCategoryProgress();
    showToast(isPinned ? "Removed from Pins." : "Pinned to top.");
  }

  function toggleArchivedDeckVisibility() {
    const archiveScopePath = (state.currentPath || []).join("::");
    const expandedPaths = Array.isArray(state.prefs.expandedArchivedPaths)
      ? state.prefs.expandedArchivedPaths
      : [];
    const isExpanded = expandedPaths.includes(archiveScopePath);
    state.prefs.expandedArchivedPaths = isExpanded
      ? expandedPaths.filter((path) => path !== archiveScopePath)
      : [...expandedPaths, archiveScopePath];
    saveState();
    invalidateCategoryProgressRenderSignature();
    renderCategoryProgress();
  }

  async function toggleArchiveDeck(subjectId) {
    subjectId = decodeHandlerValue(subjectId);
    if (!state.prefs.archivedDecks) {
      state.prefs.archivedDecks = [];
    }

    const index = state.prefs.archivedDecks.indexOf(subjectId);

    if (index > -1) {
      state.prefs.archivedDecks.splice(index, 1);
      showToast("Removed from Archive.");
    } else {
      if (
        !(await requestConfirmation(
          `Are you sure you want to archive "${subjectId}"?`,
          "Archive Deck",
        ))
      ) {
        return;
      }
      state.prefs.archivedDecks.push(subjectId);
      showToast("Added to Archive.");
    }

    saveState();
    invalidateCategoryProgressRenderSignature();

    // Refresh the dashboard to instantly hide/show the deck based on the current filter
    renderCategoryProgress();
  }

  function submitPracticeAnswer(selected, correct) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.submitPracticeAnswer !== "function"
    ) {
      throw new Error("SessionCore is required before submitting an answer.");
    }
    return SessionCore.submitPracticeAnswer(selected, correct);
  }

  function showExplanation(q) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.showExplanation !== "function"
    ) {
      throw new Error("SessionCore is required before showing an explanation.");
    }
    return SessionCore.showExplanation(q);
  }

  function nextQuestion() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.nextQuestion !== "function"
    ) {
      throw new Error("SessionCore is required before navigating questions.");
    }
    return SessionCore.nextQuestion();
  }

  function prevQuestion() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.prevQuestion !== "function"
    ) {
      throw new Error("SessionCore is required before navigating questions.");
    }
    return SessionCore.prevQuestion();
  }

  function getDefaultSrsEntry(qId) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.getDefaultSrsEntry !== "function"
    ) {
      throw new Error("SessionCore is required before creating SRS entries.");
    }
    return SessionCore.getDefaultSrsEntry(qId);
  }

  function updateSrsForQuestion(q, isCorrect) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.updateSrsForQuestion !== "function"
    ) {
      throw new Error("SessionCore is required before updating SRS data.");
    }
    return SessionCore.updateSrsForQuestion(q, isCorrect);
  }

  function computeSrsInterval(step, ease) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.computeSrsInterval !== "function"
    ) {
      throw new Error(
        "SessionCore is required before computing SRS intervals.",
      );
    }
    return SessionCore.computeSrsInterval(step, ease);
  }

  function trackStats(q, isCorrect) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.trackStats !== "function"
    ) {
      throw new Error("SessionCore is required before tracking statistics.");
    }
    return SessionCore.trackStats(q, isCorrect);
  }

  async function endSession(silent = false) {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.endSession !== "function"
    ) {
      throw new Error("SessionCore is required before ending a session.");
    }

    if (!silent && state.session.active) {
      const confirmed = await globalScope.requestConfirmation?.(
        "Are you sure you want to exit this quiz? Your progress will be saved.",
        "Exit Quiz",
      );
      if (!confirmed) return false;
    }

    SessionCore.endSession(true);
    if (!silent && typeof globalScope.navigate === "function") {
      await globalScope.navigate("dashboard");
    }
    return true;
  }

  function getAnalyticsCore() {
    if (typeof globalThis !== "undefined" && globalThis.Analytics) {
      return globalThis.Analytics;
    }
    if (typeof Analytics !== "undefined") {
      return Analytics;
    }
    return null;
  }

  function renderCharts() {
    const analytics = getAnalyticsCore();
    if (!analytics || typeof analytics.renderCharts !== "function") {
      return null;
    }
    return analytics.renderCharts();
  }

  function toggleTheme() {
    const analytics = getAnalyticsCore();
    if (analytics && typeof analytics.toggleTheme === "function") {
      return analytics.toggleTheme();
    }

    const prefs = state.prefs || {};
    prefs.darkMode = !Boolean(prefs.darkMode);

    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.classList.toggle("dark", prefs.darkMode);
    }

    return prefs.darkMode;
  }

  function updateThemeButton() {
    const analytics = getAnalyticsCore();
    if (analytics && typeof analytics.updateThemeButton === "function") {
      return analytics.updateThemeButton();
    }

    const button =
      typeof document !== "undefined"
        ? document.getElementById("btn-theme-toggle")
        : null;
    if (!button) return null;

    const darkMode = Boolean(state.prefs?.darkMode !== false);
    button.innerHTML = darkMode
      ? '<i class="fa-solid fa-sun transition-transform transform hover:rotate-180 duration-500"></i>'
      : '<i class="fa-solid fa-moon transition-transform transform hover:rotate-12 duration-300"></i>';
    button.setAttribute(
      "aria-label",
      darkMode ? "Switch to light mode" : "Switch to dark mode",
    );
    button.setAttribute(
      "title",
      darkMode ? "Switch to light mode" : "Switch to dark mode",
    );
    return button;
  }

  async function resetProgress() {
    if (
      await requestConfirmation(
        "Are you sure? This deletes mistakes, all statistics, and your current saved session.",
        "Reset All Progress",
      )
    ) {
      const previousStats = state.stats;
      const previousSession = state.session;
      const previousProgress = state.prefs.studyProgress;
      const previousToggles = state.prefs.qToggles;
      const previousLastActivity = state.prefs.lastActivity;
      const previousSavedSession = getStoredItem("saved_session");
      const pausedAutoNext = SessionCore.pauseAutoNext();
      stopVisualTimer();

      state.stats = {
        totalAnswered: 0,
        correct: 0,
        mistakes: [],
        subjectAccuracy: {},
        completedQs: [],
        srsMap: {},
      };
      state.session = {
        active: false,
        questions: [],
        currentIndex: 0,
        userAnswers: {},
        autoNextTimeout: null,
        revealedCloze: false,
      };

      state.prefs.studyProgress = {};
      state.prefs.qToggles = {};
      state.prefs.lastActivity = null;

      try {
        if (!clearSessionProgress()) {
          throw new Error("Unable to remove the saved session.");
        }
        if (!(await saveState())) {
          throw new Error("Unable to save the reset progress.");
        }
      } catch (error) {
        state.stats = previousStats;
        state.session = previousSession;
        state.prefs.studyProgress = previousProgress;
        state.prefs.qToggles = previousToggles;
        state.prefs.lastActivity = previousLastActivity;
        try {
          if (
            previousSavedSession !== null &&
            (typeof setStoredItem !== "function" ||
              !setStoredItem("saved_session", previousSavedSession))
          ) {
            throw new Error("Unable to restore the previous saved session.");
          }
          if (!(await saveState())) {
            throw new Error("Unable to restore the previous saved progress.");
          }
        } catch (restoreError) {
          appLogger.error("Unable to restore progress after reset failed.", {
            resetError: error,
            restoreError,
          });
        }
        if (pausedAutoNext && !SessionCore.resumeAutoNext(pausedAutoNext)) {
          appLogger.warn("Unable to resume the active session auto-advance.");
        }
        appLogger.error("Unable to reset progress.", error);
        updateDashboard();
        showToast(
          "Progress could not be fully reset. Your previous progress was restored where possible.",
          "error",
        );
        return;
      }

      updateDashboard();
      checkSavedSession();
      showToast("Progress Reset.", "success");

      const statsView = document.getElementById("view-stats");
      const statsChart = document.getElementById("chart-accuracy");
      if (statsView && statsView.classList.contains("active") && statsChart) {
        renderCharts();
      }
    }
  }

  async function clearDatabase() {
    if (
      clearDatabaseInProgress ||
      clearAppDataInProgress ||
      appDataClearInProgress
    ) {
      return;
    }
    clearDatabaseInProgress = true;
    try {
      const confirmed = await requestConfirmation(
        "WARNING: Are you sure you want to clear the locally saved database? You will need an active internet connection to sync the questions again. The app will reload to apply changes.",
        "Clear Local Database",
      );
      if (!confirmed || clearAppDataInProgress || appDataClearInProgress)
        return;
      await Promise.allSettled([...inFlightDeckMutations]);
      appDataClearInProgress = true;
      appDataClearGeneration += 1;
      try {
        await Promise.allSettled([...inFlightDeckDatabaseWrites]);
        await safeIdbDel("mrh_db");
        state.db = [];
        rebuildQuestionIndex();
        pendingDeckPayloadRefreshes.clear();
        state.prefs.pendingDeckPayloadRefreshes = [];
        if (!clearSessionProgress()) {
          throw new Error("Unable to remove the saved session.");
        }
        state.prefs.lastActivity = null;
        if (!(await saveState())) {
          throw new Error("Unable to save the cleared database state.");
        }
        window.location.reload();
      } catch (error) {
        appDataClearInProgress = false;
        appDataClearGeneration += 1;
        appLogger.error("Unable to clear the local database.", error);
        showToast(
          "The local database could not be fully cleared. Please try again.",
          "error",
        );
      }
    } catch (error) {
      appLogger.error("Unable to confirm local database clearing.", error);
      showToast(
        "The local database could not be cleared. Please try again.",
        "error",
      );
    } finally {
      clearDatabaseInProgress = false;
    }
  }

  async function clearAppData() {
    if (
      clearAppDataInProgress ||
      clearDatabaseInProgress ||
      appDataClearInProgress
    ) {
      return;
    }
    clearAppDataInProgress = true;

    try {
      if (
        !(await requestConfirmation(
          "This permanently deletes this app's locally saved decks, progress, preferences, saved sessions, and cached files. The app shell will be downloaded again after reload. Continue?",
          "Clear App Data",
        ))
      ) {
        return;
      }

      if (
        !(await requestConfirmation(
          "Final confirmation: only data owned by this app will be erased, including cached downloaded files. The app will cache its current offline shell again after reload; other same-origin website data will be left untouched.",
          "Confirm Permanent Deletion",
        ))
      ) {
        return;
      }

      if (clearDatabaseInProgress || appDataClearInProgress) return;
      if (typeof rootScope.AppState?.stopStatePersistence !== "function") {
        throw new Error("App state persistence control is unavailable.");
      }
      await Promise.allSettled([...inFlightDeckMutations]);
      await rootScope.AppState.stopStatePersistence();
      appDataClearInProgress = true;
      appDataClearGeneration += 1;
      await Promise.allSettled([...inFlightDeckDatabaseWrites]);

      if (typeof caches !== "undefined") {
        if (
          typeof caches.keys !== "function" ||
          typeof caches.delete !== "function"
        ) {
          throw new Error("App cache storage is unavailable.");
        }
        const appCacheNames = (await caches.keys()).filter((name) =>
          name.startsWith("mrh-cache-"),
        );
        const cacheResults = await Promise.all(
          appCacheNames.map((name) => caches.delete(name)),
        );
        if (cacheResults.some((deleted) => !deleted)) {
          throw new Error("Unable to remove one or more app cache entries.");
        }
      }

      await safeIdbDel("mrh_db");
      pendingDeckPayloadRefreshes.clear();

      if (state.session) state.session.active = false;
      rootScope.SessionCore?.cleanup?.();

      if (
        typeof StorageUtils === "undefined" ||
        typeof StorageUtils.clearCurrentNamespace !== "function"
      ) {
        throw new Error("App storage cleanup is unavailable.");
      }
      StorageUtils.clearCurrentNamespace({ includeLegacy: true });

      state.db = [];
      state.categorySummary = [];
      state.accessMetadata = {};
      state.stats = {
        totalAnswered: 0,
        correct: 0,
        mistakes: [],
        subjectAccuracy: {},
        completedQs: [],
        srsMap: {},
      };
      state.session = {
        active: false,
        questions: [],
        currentIndex: 0,
        userAnswers: {},
        autoNextTimeout: null,
        revealedCloze: false,
      };
      state.prefs.lastActivity = null;
      rebuildQuestionIndex();
      window.location.reload();
    } catch (error) {
      appDataClearInProgress = false;
      rootScope.AppState?.resumeStatePersistence?.();
      appLogger.error("Unable to clear app data.", error);
      showToast(
        "Some app data could not be cleared. Please try again.",
        "error",
      );
    } finally {
      clearAppDataInProgress = false;
    }
  }

  document.addEventListener(
    "keydown",
    (e) => {
      const settingsModal = document.getElementById("session-settings-modal");

      const isSettingsModalOpen =
        settingsModal && settingsModal.getAttribute("aria-hidden") !== "true";

      if (!state.session.active || isSettingsModalOpen) return;

      const key = e.key.toUpperCase();
      const isAnswered = state.session.userAnswers[state.session.currentIndex];

      if (!isAnswered) {
        if (["1", "A"].includes(key))
          document.querySelector('.choice-btn[data-choice="A"]')?.click();
        if (["2", "B"].includes(key))
          document.querySelector('.choice-btn[data-choice="B"]')?.click();
        if (["3", "C"].includes(key))
          document.querySelector('.choice-btn[data-choice="C"]')?.click();
        if (["4", "D"].includes(key))
          document.querySelector('.choice-btn[data-choice="D"]')?.click();
        if (["5", "E"].includes(key))
          document.querySelector('.choice-btn[data-choice="E"]')?.click();
        if (e.code === "Space") {
          e.preventDefault();
          revealAnswer();
        }
      } else {
        if (e.code === "Space" || e.code === "ArrowRight") {
          e.preventDefault();
          nextQuestion();
        }
        if (e.code === "ArrowLeft") {
          e.preventDefault();
          prevQuestion();
        }
      }
    },
    { signal: uiEventController.signal },
  );

  window.addEventListener(
    "resize",
    () => {
      if (state.session.active && state.prefs.quizNavigationPosition === "auto")
        applyNavigationPosition();
    },
    { signal: uiEventController.signal },
  );

  function saveSessionProgress() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.saveSessionProgress !== "function"
    ) {
      throw new Error(
        "SessionCore is required before saving session progress.",
      );
    }
    return SessionCore.saveSessionProgress();
  }

  function checkSavedSession() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.checkSavedSession !== "function"
    ) {
      throw new Error(
        "SessionCore is required before checking saved sessions.",
      );
    }
    return SessionCore.checkSavedSession();
  }

  let pendingResumeSession = null;

  function hasSessionRestoreProgress(sessionRoute) {
    const subject = String(sessionRoute?.subject || "").trim();
    if (!subject) return false;

    if (sessionRoute.mode === "study") {
      const progress = state.prefs?.studyProgress?.[subject];
      return (
        Number(progress?.index) > 0 ||
        Number(progress?.page) > 1 ||
        Number(progress?.scrollY) > 0
      );
    }

    if (sessionRoute.mode !== "quiz") return false;

    const storedSession = getStoredItem("saved_session");
    if (!storedSession) return false;

    let savedSession;
    try {
      savedSession =
        typeof storedSession === "string"
          ? JSON.parse(storedSession)
          : storedSession;
    } catch (error) {
      appLogger.error(
        "Unable to check saved quiz progress for refresh.",
        error,
      );
      return false;
    }

    const belongsToDeck =
      savedSession?.questions?.some(
        (question) => String(question?.Subject || "").trim() === subject,
      ) === true;
    if (
      savedSession?.active !== true ||
      !belongsToDeck ||
      !Array.isArray(savedSession.questions)
    ) {
      return false;
    }

    const hasRecordedAnswers = (answers) =>
      answers &&
      typeof answers === "object" &&
      Object.values(answers).some(
        (answer) => answer !== null && answer !== undefined && answer !== "",
      );

    return (
      Number(savedSession.currentIndex) > 0 ||
      hasRecordedAnswers(savedSession.userAnswers) ||
      hasRecordedAnswers(savedSession.identificationRatings)
    );
  }

  async function resumeSession(password = null, options = {}) {
    const resumeFeatureEnabled = false;
    if (!resumeFeatureEnabled && options.allowResume !== true) {
      return false;
    }

    if (
      typeof window !== "undefined" &&
      window.__MRH_BOOTSTRAP__?.status !== "ready" &&
      !__mrhAppReady
    ) {
      throw new Error("App bootstrap not complete yet.");
    }

    const activity = state.prefs.lastActivity;
    const saved = getStoredItem("saved_session");
    if (!saved && activity?.mode === "review" && activity.subject) {
      currentAppMode = "review";
      syncPreferenceControls();
      if (
        (isDeckHidden(activity.subject) || isDeckLocked(activity.subject)) &&
        !password
      ) {
        pendingDeckSubject = activity.subject;
        pendingDeckAction = "resume-review";
        openDeckPasswordModal(activity.subject, "resume-review");
        return;
      }
      await reviewDeck(activity.subject, password);
      return;
    }

    if (!saved) return;

    const savedSession = pendingResumeSession || JSON.parse(saved);
    const currentQuestion = savedSession.questions?.[savedSession.currentIndex];
    const currentSubject = currentQuestion?.Subject;
    const authorizedReviewQuestions = Array.isArray(
      options.authorizedReviewQuestions,
    )
      ? options.authorizedReviewQuestions.filter(
          (question) =>
            String(question?.Subject || "").trim() ===
            String(currentSubject || "").trim(),
        )
      : [];
    const hasAuthorizedReviewSession = authorizedReviewQuestions.length > 0;

    if (
      (isDeckHidden(currentSubject) || isDeckLocked(currentSubject)) &&
      !password &&
      !hasAuthorizedReviewSession
    ) {
      pendingResumeSession = savedSession;
      pendingDeckSubject = currentSubject;
      pendingDeckAction = "resume";
      openDeckPasswordModal(currentSubject, "resume");
      return;
    }

    if (
      currentSubject &&
      (password ||
        (isDeckLocked(currentSubject) && !hasAuthorizedReviewSession))
    ) {
      await fetchDeckQuestions(currentSubject, password);
    }

    pendingResumeSession = null;
    state.session = savedSession;

    // Build one ID lookup instead of scanning the full database for every
    // question in the saved session. This changes resume from O(session * DB)
    // to O(session + DB).
    const dbQuestionsById = new Map(
      (state.db || [])
        .filter((dbQ) => dbQ?.ID)
        .map((dbQ) => [String(dbQ.ID), dbQ]),
    );

    state.session.questions = state.session.questions.map((savedQ, index) => {
      let searchId = savedQ.ID;
      if (searchId && !searchId.toString().includes("::")) {
        let cleanId = searchId.toString().replace(/^[a-zA-Z]+[-\s]?/, "");
        searchId = `${savedQ.Subject}::${cleanId}`;
      }

      const freshQ =
        dbQuestionsById.get(String(searchId || "")) ||
        dbQuestionsById.get(String(savedQ.ID || ""));

      if (freshQ) {
        savedQ.Question = freshQ.Question;
        savedQ.Explanation = freshQ.Explanation;

        const realCorrectText = freshQ[`Choice${freshQ.Answer}`];

        const matchingChoice = ["A", "B", "C", "D", "E"].find(
          (letter) => savedQ[`Choice${letter}`] === realCorrectText,
        );

        if (matchingChoice) {
          savedQ.Answer = matchingChoice;
        } else {
          const freshShuffled = prepareSessionPool([freshQ])[0];
          for (const letter of ["A", "B", "C", "D", "E"]) {
            savedQ[`Choice${letter}`] = freshShuffled[`Choice${letter}`];
          }
          savedQ.Answer = freshShuffled.Answer;

          if (state.session.userAnswers[index]) {
            // FIXED: Replaced 'delete' with setting to null
            // to prevent array/object indexing bugs
            state.session.userAnswers[index] = null;
          }
        }
      } else {
        appLogger.warn(
          `Question ${searchId || savedQ.ID} not found in DB. Falling back to saved session data.`,
        );
      }
      return savedQ;
    });

    await navigate("practice");
    document.getElementById("session-setup").classList.add("hidden");
    document.getElementById("session-active").classList.remove("hidden");

    renderQuestion();
    await markQuizActivity(currentSubject);
    globalScope.updateSessionNavigationUrl?.(currentSubject, "quiz");
    return true;
  }

  function clearSessionProgress() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.clearSessionProgress !== "function"
    ) {
      throw new Error(
        "SessionCore is required before clearing session progress.",
      );
    }
    return SessionCore.clearSessionProgress();
  }

  function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  function showMCQOptions() {
    document.getElementById("active-recall-mask").classList.add("hidden");
    document.getElementById("q-choices").classList.remove("hidden");
  }

  function revealAnswer() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.revealAnswer !== "function"
    ) {
      throw new Error("SessionCore is required before revealing an answer.");
    }
    return SessionCore.revealAnswer();
  }

  function startVisualTimer() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.startVisualTimer !== "function"
    ) {
      throw new Error(
        "SessionCore is required before starting the visual timer.",
      );
    }
    return SessionCore.startVisualTimer();
  }

  function stopVisualTimer() {
    if (
      typeof SessionCore === "undefined" ||
      typeof SessionCore.stopVisualTimer !== "function"
    ) {
      throw new Error(
        "SessionCore is required before stopping the visual timer.",
      );
    }
    return SessionCore.stopVisualTimer();
  }

  function getCurrentReviewSubject() {
    return DeckReviewCore?.getCurrentReviewSubject?.() || "";
  }

  function showToast(message, type = "success", duration = 3000) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    const colors =
      type === "error"
        ? "bg-red-500 text-white"
        : type === "warning"
          ? "bg-yellow-500 text-white"
          : type === "info"
            ? "bg-blue-500 text-white"
            : "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900";
    const icon =
      type === "error"
        ? "fa-circle-exclamation"
        : type === "warning"
          ? "fa-triangle-exclamation"
          : type === "info"
            ? "fa-circle-info"
            : "fa-circle-check";

    toast.className = `toast-enter ${colors} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 font-medium text-sm`;
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHTML(message)}`;

    container.appendChild(toast);
    lifecycle.setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateX(100%)";
      toast.style.transition = "all 0.3s ease";
      lifecycle.setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  function setActiveDeckSessionPreference(mode, key, value, subject) {
    if (rootScope.setDeckSessionSetting?.(mode, key, value, subject) === true) {
      return true;
    }
    showToast("Open a deck session before changing this setting.", "warning");
    return false;
  }

  function toggleActiveRecall() {
    const isChecked = document.getElementById("toggle-active-recall").checked;
    const value = Boolean(isChecked);
    if (!setActiveDeckSessionPreference("quiz", "activeRecall", value)) return;
    saveState();
    syncPreferenceControls();

    if (state.session.active) {
      renderQuestion();
    }
  }

  let activeHubSubject = "";

  function openModeSelect(subject) {
    activeHubSubject = subject;
    document.getElementById("mode-select-deck-title").innerText = subject;
    navigate("mode-select");
  }

  function proceedToReview() {
    reviewDeck(activeHubSubject);
  }

  let pendingPracticeReviewSwitch = null;

  function restorePracticeAfterReviewFailure(showWarning = true) {
    if (!pendingPracticeReviewSwitch) return false;
    const suspension = pendingPracticeReviewSwitch;
    pendingPracticeReviewSwitch = null;
    const resumed = SessionCore.resumeSuspendedSession(suspension);
    if (resumed) {
      const question =
        suspension.session.questions[suspension.session.currentIndex];
      state.prefs.lastActivity = {
        mode: "quiz",
        subject: question?.Subject || null,
        updatedAt: new Date().toISOString(),
      };
      saveState();
      if (showWarning) {
        showToast(
          "Review could not be opened. Your quiz has been resumed.",
          "warning",
        );
      }
    }
    return resumed;
  }

  async function switchPracticeToReview() {
    const session = state.session;
    if (!session?.active || !Array.isArray(session.questions)) return false;

    const subject = session.questions[session.currentIndex]?.Subject || "";
    if (!subject) {
      showToast("Unable to determine the current quiz deck.", "error");
      return false;
    }

    const suspension = SessionCore.suspendSessionForModeSwitch();
    if (!suspension) {
      showToast(
        "Your quiz progress could not be saved, so Review was not opened.",
        "error",
      );
      return false;
    }

    pendingPracticeReviewSwitch = suspension;
    const confirmed = await requestConfirmation(
      "Session saved. You can resume the quiz later. Continue to study this deck?",
      "Switch to Study Mode",
    );
    if (!confirmed) {
      restorePracticeAfterReviewFailure(false);
      return false;
    }

    let opened;
    try {
      opened = await reviewDeck(
        subject,
        null,
        true,
        suspension.session.questions,
      );
    } catch (error) {
      appLogger.error("Unable to switch from quiz to review.", error);
      restorePracticeAfterReviewFailure();
      return false;
    }
    if (opened) {
      pendingPracticeReviewSwitch = null;
      currentAppMode = "review";
      syncPreferenceControls();
      return true;
    }

    const passwordModal = document.getElementById("deck-password-modal");
    if (passwordModal?.getAttribute("aria-hidden") !== "false") {
      restorePracticeAfterReviewFailure();
    }
    return false;
  }

  async function continuePracticeReviewSwitch(subject, password) {
    let opened;
    try {
      opened = await reviewDeck(subject, password);
    } catch (error) {
      appLogger.error("Unable to switch from quiz to review.", error);
      restorePracticeAfterReviewFailure();
      return false;
    }
    if (opened) {
      pendingPracticeReviewSwitch = null;
      currentAppMode = "review";
      syncPreferenceControls();
      return true;
    }

    const passwordModal = document.getElementById("deck-password-modal");
    if (passwordModal?.getAttribute("aria-hidden") !== "false") {
      restorePracticeAfterReviewFailure();
    }
    return false;
  }

  async function markQuizActivity(subject) {
    currentAppMode = "quiz";
    state.prefs.lastActivity = {
      ...(state.prefs.lastActivity || {}),
      mode: "quiz",
      subject: subject || null,
      updatedAt: new Date().toISOString(),
    };
    syncPreferenceControls();
    return saveState("prefs");
  }

  async function startReviewDeckQuiz(subject) {
    const cachedQuestions =
      DeckReviewCore?.getCurrentReviewSubject?.() === subject
        ? DeckReviewCore.getCurrentReviewQuestions()
        : [];
    const questions = Array.isArray(cachedQuestions)
      ? cachedQuestions.filter(
          (question) => String(question?.Subject || "").trim() === subject,
        )
      : [];
    const customFilter =
      rootScope.getDeckSessionSetting?.("quiz", "qTypeOverride", subject) ===
      "mcq"
        ? (question) =>
            typeof question.ChoiceA === "string" &&
            question.ChoiceA.trim() !== "" &&
            typeof question.ChoiceB === "string" &&
            question.ChoiceB.trim() !== ""
        : null;
    const eligibleQuestions = customFilter
      ? questions.filter(customFilter)
      : questions;
    const completed = new Set(state.stats.completedQs || []);
    let pool = eligibleQuestions.filter(
      (question) => !completed.has(question.ID),
    );

    if (pool.length === 0) {
      showToast(
        `No unanswered questions are available in "${subject}". Reset progress to start over.`,
        "info",
      );
      return false;
    }

    if (
      rootScope.getDeckSessionSetting?.("quiz", "srsEnabled", subject) ??
      state.prefs.srsEnabled
    ) {
      const now = Date.now();
      const duePool = pool.filter((question) => {
        const srs = state.stats.srsMap?.[question.ID];
        return !srs || Number(srs.due || 0) <= now;
      });
      if (duePool.length > 0) pool = duePool;
    }

    let started;
    try {
      started = await startCustomSession(pool);
    } catch (error) {
      appLogger.error("Unable to start a quiz from Review Mode.", error);
      showToast(
        "We're having a temporary issue with our servers or services, so this quiz couldn't start. Please check your internet connection and try again later.",
        "error",
        8000,
      );
      return false;
    }
    if (!started) return false;
    await markQuizActivity(subject);
    return true;
  }

  async function switchReviewToPractice() {
    const subject = getCurrentReviewSubject();
    if (!subject) {
      showToast("Unable to determine the current study deck.", "error");
      return false;
    }
    if (state.session?.active) {
      showToast(
        "A quiz session is already active. Finish or pause it before starting another quiz.",
        "warning",
      );
      return false;
    }

    const savedSessionData = getStoredItem("saved_session");
    let savedSession = null;
    if (savedSessionData) {
      try {
        savedSession = JSON.parse(savedSessionData);
      } catch (error) {
        appLogger.error("Unable to read the saved quiz session.", error);
        showToast(
          "Your saved quiz progress could not be read. Return to the Main Menu to recover it before starting another quiz.",
          "error",
          8000,
        );
        return false;
      }
    }

    const savedSubject = String(
      savedSession?.questions?.[savedSession.currentIndex]?.Subject || "",
    ).trim();
    const hasSavedQuiz =
      savedSession?.active === true &&
      Array.isArray(savedSession.questions) &&
      savedSession.questions.length > 0 &&
      Number.isInteger(savedSession.currentIndex) &&
      savedSession.currentIndex >= 0 &&
      savedSession.currentIndex < savedSession.questions.length;

    if (savedSessionData && !hasSavedQuiz) {
      showToast(
        "Your saved quiz progress could not be verified. Return to the Main Menu to recover it before starting another quiz.",
        "error",
        8000,
      );
      return false;
    }

    const persistReviewProgress = async () => {
      const progress = state.prefs.studyProgress?.[subject];
      const main = document.querySelector("main");
      if (progress && Number.isFinite(main?.scrollTop)) {
        progress.scrollY = main.scrollTop;
        progress.updatedAt = Date.now();
      }
      try {
        if ((await saveState("prefs")) !== false) return true;
        appLogger.error(
          "Unable to save study progress before switching modes.",
        );
      } catch (error) {
        appLogger.error(
          "Unable to save study progress before switching modes.",
          error,
        );
      }
      showToast(
        "Your study progress could not be saved. Please try again before switching modes.",
        "error",
      );
      return false;
    };

    if (hasSavedQuiz && savedSubject === subject) {
      const confirmed = await requestConfirmation(
        "Study progress is saved. You can return to it later. Continue to quiz this deck?",
        "Switch to Quiz Mode",
      );
      if (!confirmed) return false;

      if (!(await persistReviewProgress())) return false;
      const authorizedReviewQuestions =
        DeckReviewCore?.getCurrentReviewSubject?.() === subject
          ? DeckReviewCore.getCurrentReviewQuestions()
          : [];
      await resumeSession(null, {
        allowResume: true,
        authorizedReviewQuestions,
      });
      return Boolean(state.session?.active);
    }

    if (hasSavedQuiz) {
      const confirmed = await requestConfirmation(
        `Study progress is saved. You can return to it later. Start a new quiz for "${subject}"? This will replace your saved quiz progress for "${savedSubject || "another deck"}".`,
        "Switch to Quiz Mode",
      );
      if (!confirmed) return false;
    } else {
      const confirmed = await requestConfirmation(
        "Study progress is saved. You can return to it later. Start a quiz for this deck?",
        "Switch to Quiz Mode",
      );
      if (!confirmed) return false;
    }

    if (!(await persistReviewProgress())) return false;
    const started = await startReviewDeckQuiz(subject);
    if (!started) return false;
    return true;
  }

  function cancelDeckPasswordRequest() {
    if (pendingPracticeReviewSwitch) {
      restorePracticeAfterReviewFailure(false);
    }
    closeDeckPasswordModal();
  }

  function proceedToQuiz() {
    if (activeHubSubject) {
      fetchAndStartCategory(activeHubSubject, "continue");
    }
  }

  let currentAppMode = "quiz";

  function toggleAppMode() {
    const toggleElement = document.getElementById("globalModeToggle");
    const modeLabel = document.getElementById("modeLabel");

    if (!toggleElement) return;

    currentAppMode = toggleElement.checked ? "review" : "quiz";
    state.prefs.lastActivity = {
      ...(state.prefs.lastActivity || {}),
      mode: currentAppMode,
      updatedAt: new Date().toISOString(),
    };

    if (modeLabel) {
      modeLabel.innerText = currentAppMode === "review" ? "Study" : "Quiz";
      saveState();
    }

    renderCategoryProgress();
  }

  function changeDatabaseUpdateMode(mode) {
    const normalizedMode = ["idle", "immediate"].includes(mode)
      ? mode
      : state.prefs.databaseUpdateMode || "idle";

    state.prefs.databaseUpdateMode = normalizedMode;
    saveState();

    const modeControl = document.getElementById("database-update-mode");
    if (modeControl && modeControl.value !== normalizedMode) {
      modeControl.value = normalizedMode;
    }

    if (pendingSummaryData && !state.session.active) {
      applySummaryData(pendingSummaryData);
      pendingSummaryData = null;
      updateSyncStatus(
        '<i class="fa-solid fa-check mr-1"></i> Database update applied immediately.',
        "success",
      );
    }
  }

  let pendingDeckSubject = null;
  let pendingDeckAction = null;
  let deckInteractionLocked = false;
  let activeDeckInteractionKey = null;
  let activeDeckInteractionSubject = null;
  let deckEntryInteractionSnapshots = null;

  function updateRecentDecks(subj) {
    if (!subj) return;
    if (!state.prefs.recentDecks) state.prefs.recentDecks = [];
    const recentDecks = state.prefs.recentDecks || [];
    const filtered = recentDecks.filter((d) => d !== subj);
    filtered.unshift(subj);
    state.prefs.recentDecks = filtered.slice(0, 10);
  }

  function getPathSegments(value) {
    return String(value || "")
      .split("::")
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  function getRecentPathRelationDepth(subjectA, subjectB) {
    const left = getPathSegments(subjectA);
    const right = getPathSegments(subjectB);

    if (left.length === 0 || right.length === 0) return 0;

    const leftKey = left.join("::");
    const rightKey = right.join("::");
    if (leftKey === rightKey) return left.length;

    if (left.length <= right.length) {
      const ancestor = right.slice(0, left.length).join("::");
      if (ancestor === leftKey) return left.length;
    }

    if (right.length <= left.length) {
      const ancestor = left.slice(0, right.length).join("::");
      if (ancestor === rightKey) return right.length;
    }

    return 0;
  }

  function isRecentlyViewedPath(subject) {
    const activity = String(subject || "").trim();
    const recentDecks = Array.isArray(state.prefs?.recentDecks)
      ? state.prefs.recentDecks
      : [];
    const latest = String(recentDecks[0] || "").trim();
    if (!activity || !latest) return false;

    return getRecentPathRelationDepth(activity, latest) > 0;
  }

  function getRecentPathDepth(subject) {
    const activity = String(subject || "").trim();
    const recentDecks = Array.isArray(state.prefs?.recentDecks)
      ? state.prefs.recentDecks
      : [];
    const latest = String(recentDecks[0] || "").trim();
    if (!activity || !latest) return 0;

    return getRecentPathRelationDepth(activity, latest);
  }

  function setTreeDeckLoading(subject, isLoading) {
    const normalizedSubject = String(subject || "").trim();
    if (!normalizedSubject || typeof document === "undefined") return;

    document.querySelectorAll("[data-tree-key]").forEach((row) => {
      if (String(row.dataset.treeKey || "").trim() !== normalizedSubject) {
        return;
      }
      row.classList.toggle("deck-tree-row-busy", isLoading);
      row.setAttribute("aria-busy", String(isLoading));
    });
  }

  function setOtherDeckInteractionsLocked(subject, isLocked) {
    const normalizedSubject = String(subject || "").trim();
    if (!normalizedSubject || typeof document === "undefined") return;

    document
      .querySelectorAll("[data-deck-key], [data-tree-key], [data-folder-key]")
      .forEach((element) => {
        const key =
          element.dataset.deckKey ||
          element.dataset.treeKey ||
          element.dataset.folderKey ||
          "";
        const shouldBlock = isLocked && key !== normalizedSubject;

        if (shouldBlock) {
          if (!element.hasAttribute("data-deck-lock-previous-aria-disabled")) {
            element.setAttribute(
              "data-deck-lock-previous-aria-disabled",
              element.getAttribute("aria-disabled") ?? "__unset__",
            );
          }
          element.classList.add("deck-interaction-blocked");
          element.setAttribute("aria-disabled", "true");
          return;
        }

        element.classList.remove("deck-interaction-blocked");
        const previousAriaDisabled = element.getAttribute(
          "data-deck-lock-previous-aria-disabled",
        );
        if (previousAriaDisabled !== null) {
          if (previousAriaDisabled === "__unset__") {
            element.removeAttribute("aria-disabled");
          } else {
            element.setAttribute("aria-disabled", previousAriaDisabled);
          }
          element.removeAttribute("data-deck-lock-previous-aria-disabled");
        }
      });
  }

  function setDeckEntryInteractionsLocked(isLocked) {
    if (typeof document === "undefined") return;

    if (isLocked) {
      if (deckEntryInteractionSnapshots) return;
      deckEntryInteractionSnapshots = Array.from(
        document.querySelectorAll("body"),
      ).map((element) => ({
        element,
        wasInert: element.hasAttribute("inert"),
        previousAriaBusy: element.getAttribute("aria-busy"),
      }));
      deckEntryInteractionSnapshots.forEach(({ element }) => {
        element.setAttribute("inert", "");
        element.setAttribute("aria-busy", "true");
      });
      return;
    }

    if (!deckEntryInteractionSnapshots) return;
    deckEntryInteractionSnapshots.forEach(
      ({ element, wasInert, previousAriaBusy }) => {
        if (!wasInert) element.removeAttribute("inert");
        if (previousAriaBusy === null) {
          element.removeAttribute("aria-busy");
        } else {
          element.setAttribute("aria-busy", previousAriaBusy);
        }
      },
    );
    deckEntryInteractionSnapshots = null;
  }

  let deckPasswordTransitionSnapshots = null;
  let deckPasswordControlSnapshots = null;
  let deckPasswordPreviousAriaBusy = null;

  function setDeckPasswordTransitionLoading(
    isLoading,
    statusText = "Loading...",
  ) {
    const modal = document.getElementById("deck-password-modal");
    if (!modal) return;

    const status = document.getElementById("deck-password-loading-status");
    const statusLabel = status?.querySelector("span");
    if (statusLabel) statusLabel.textContent = statusText;
    if (status) status.hidden = !isLoading || !statusText;

    if (isLoading) {
      if (!deckPasswordTransitionSnapshots) {
        deckPasswordPreviousAriaBusy = modal.getAttribute("aria-busy");
        modal.setAttribute("aria-busy", "true");
        deckPasswordTransitionSnapshots = [];
        let branch = modal;
        while (branch?.parentElement) {
          const parent = branch.parentElement;
          Array.from(parent.children).forEach((sibling) => {
            if (sibling === branch) return;
            deckPasswordTransitionSnapshots.push({
              element: sibling,
              wasInert: sibling.hasAttribute("inert"),
              previousAriaBusy: sibling.getAttribute("aria-busy"),
            });
            sibling.setAttribute("inert", "");
            sibling.setAttribute("aria-busy", "true");
          });
          if (parent === document.body) break;
          branch = parent;
        }

        deckPasswordControlSnapshots = Array.from(
          modal.querySelectorAll("input, button"),
        )
          .filter(
            (control) =>
              control.id !== "btn-submit-deck-password" && !control.disabled,
          )
          .map((control) => {
            control.disabled = true;
            return control;
          });
      }
      return;
    }

    if (deckPasswordControlSnapshots) {
      deckPasswordControlSnapshots.forEach((control) => {
        control.disabled = false;
      });
      deckPasswordControlSnapshots = null;
    }
    if (deckPasswordTransitionSnapshots) {
      deckPasswordTransitionSnapshots.forEach(
        ({ element, wasInert, previousAriaBusy }) => {
          if (!wasInert) element.removeAttribute("inert");
          if (previousAriaBusy === null) {
            element.removeAttribute("aria-busy");
          } else {
            element.setAttribute("aria-busy", previousAriaBusy);
          }
        },
      );
      deckPasswordTransitionSnapshots = null;
    }
    if (deckPasswordPreviousAriaBusy === null) {
      modal.removeAttribute("aria-busy");
    } else {
      modal.setAttribute("aria-busy", deckPasswordPreviousAriaBusy);
    }
    deckPasswordPreviousAriaBusy = null;
  }

  async function handleDeckClick(subj, action = "continue") {
    subj = decodeHandlerValue(subj);
    if (!subj) return;

    const nextKey = `${String(subj).trim()}|${String(action || "continue")}`;
    if (deckInteractionLocked) {
      if (activeDeckInteractionKey === nextKey) {
        return;
      }
      return;
    }

    deckInteractionLocked = true;
    activeDeckInteractionKey = nextKey;
    activeDeckInteractionSubject = String(subj).trim();
    setDeckEntryInteractionsLocked(true);
    setOtherDeckInteractionsLocked(activeDeckInteractionSubject, true);
    setTreeDeckLoading(subj, true);

    const finishDeckInteraction = () => {
      if (activeDeckInteractionKey === nextKey) {
        deckInteractionLocked = false;
        activeDeckInteractionKey = null;
        activeDeckInteractionSubject = null;
        setDeckEntryInteractionsLocked(false);
        setOtherDeckInteractionsLocked(subj, false);
        setTreeDeckLoading(subj, false);
      }
    };

    try {
      // If deck was locally deleted, clear it from deleted list so we fetch fresh
      if ((state.prefs.localDownloadDeletedDecks || []).includes(subj)) {
        clearLocalDownloadDeleted(subj);
        saveState();
      }

      const readiness = getDeckDataReadinessState();
      if (!isInitialSyncComplete || readiness.isBlocked) {
        updateSyncStatus(
          '<i class="fa-solid fa-xmark mr-1"></i> Decks are temporarily unavailable while the initial database sync completes.',
          "warning",
        );
        return;
      }

      updateRecentDecks(subj);
      saveState();

      const deckInfo = state.categorySummary.find((c) => c.Subject === subj);
      if (isDeckHidden(subj) || (deckInfo && deckInfo.Hidden)) {
        showToast("This deck is hidden and not available.", "warning");
        return;
      }
      if (isDeckLocked(subj) || (deckInfo && deckInfo.Locked)) {
        pendingDeckSubject = subj;
        pendingDeckAction = action;
        openDeckPasswordModal(subj, action);
        return;
      }

      const startPromise =
        currentAppMode === "review"
          ? reviewDeck(subj, null)
          : fetchAndStartCategory(subj, action, null);
      await Promise.resolve(startPromise);
    } catch (error) {
      appLogger.error("Unable to start the selected deck.", error);
      showToast(
        "We're having a temporary issue with our servers or services, so this deck couldn't start. Please check your internet connection and try again later.",
        "error",
        8000,
      );
    } finally {
      finishDeckInteraction();
    }
  }

  function toggleShuffleChoices(source) {
    source =
      source ||
      document.getElementById("toggle-shuffle-choices") ||
      document.getElementById("toggle-modal-shuffle-choices");
    const isChecked = source ? source.checked : true;
    if (!setActiveDeckSessionPreference("quiz", "shuffleChoices", isChecked))
      return;
    saveState();
    syncPreferenceControls();

    if (state.session.active) {
      const remainingQuestions = state.session.questions.slice(
        state.session.currentIndex,
      );
      const subject =
        state.session.questions?.[state.session.currentIndex]?.Subject || "";
      const reprepared = prepareSessionPool(remainingQuestions, subject);
      state.session.questions.splice(
        state.session.currentIndex,
        reprepared.length,
        ...reprepared,
      );
      renderQuestion();
    }
  }

  function toggleShuffleQuestions(source) {
    const element =
      source || document.getElementById("toggle-shuffle-questions");
    const isChecked = element ? element.checked : true;
    if (!setActiveDeckSessionPreference("quiz", "shuffleQuestions", isChecked))
      return;
    saveState();
    syncPreferenceControls();
  }

  const folderPasswordButton = document.getElementById(
    "btn-submit-folder-password",
  );
  if (folderPasswordButton) {
    folderPasswordButton.addEventListener(
      "click",
      async () => {
        const input = document.getElementById("folder-password-input");
        const pass = input?.value || "";
        const btn = folderPasswordButton;

        if (!pass) {
          setFormError("folder-password-input", "Please enter a password.");
          input?.focus();
          return;
        }

        setFormError("folder-password-input", "");

        await runWithBusyButton(btn, "Verifying...", async () => {
          try {
            if (
              typeof AppNetwork === "undefined" ||
              typeof AppNetwork.verifyFolderAccess !== "function"
            ) {
              throw new Error("Backend network API is unavailable.");
            }

            await AppNetwork.verifyFolderAccess(
              String(pendingLockedFolderPath || "").trim(),
              String(pass),
              { timeoutMs: 15000 },
            );

            const folderPath =
              pendingLockedFolderPath || pendingLockedFolderName || "";
            setFolderUnlocked(folderPath, true);
            closeFolderPasswordModal();
            if (!state.currentPath) state.currentPath = [];
            if (
              pendingLockedFolderName &&
              !state.currentPath.includes(pendingLockedFolderName)
            ) {
              state.currentPath.push(pendingLockedFolderName);
            }
            renderCategoryProgress();
          } catch (error) {
            appLogger.error("Verification failed", error);
            setFormError(
              "folder-password-input",
              "Network error while verifying the folder password.",
            );
            showToast(
              "Network error while verifying the folder password.",
              "error",
            );
          }
        });
      },
      { signal: uiEventController.signal },
    );
  }

  const btnSubmitDeckPassword = document.getElementById(
    "btn-submit-deck-password",
  );

  if (btnSubmitDeckPassword) {
    btnSubmitDeckPassword.addEventListener(
      "click",
      async () => {
        const input = document.getElementById("deck-password-input");
        const pass = input?.value || "";

        if (!pass) {
          setFormError("deck-password-input", "Please enter a password.");
          input?.focus();
          return;
        }

        setFormError("deck-password-input", "");

        await runWithBusyButton(
          btnSubmitDeckPassword,
          pendingPracticeReviewSwitch || pendingDeckAction === "resume-review"
            ? "Switching..."
            : "Loading...",
          async () => {
            setDeckPasswordTransitionLoading(true, "");
            try {
              if (pendingDeckAction === "resume") {
                await resumeSession(pass, { allowResume: true });
              } else if (pendingDeckAction === "resume-review") {
                if (pendingPracticeReviewSwitch) {
                  await continuePracticeReviewSwitch(pendingDeckSubject, pass);
                } else {
                  await reviewDeck(pendingDeckSubject, pass);
                }
              } else if (currentAppMode === "review") {
                await reviewDeck(pendingDeckSubject, pass);
              } else {
                await fetchAndStartCategory(
                  pendingDeckSubject,
                  pendingDeckAction,
                  pass,
                );
              }
              if (input?.value === pass) closeDeckPasswordModal();
            } catch (error) {
              appLogger.error(
                "Unable to continue after password verification.",
                error,
              );
              if (
                /incorrect password/i.test(String(error?.message || "")) ||
                String(error?.code || "").toUpperCase() === "PASSWORD_REQUIRED"
              ) {
                setFormError("deck-password-input", "Incorrect password.");
                input?.focus();
                return;
              }
              showToast(
                "The requested mode could not be opened. Please try again.",
                "error",
              );
            } finally {
              setDeckPasswordTransitionLoading(false);
            }
          },
        );
      },
      { signal: uiEventController.signal },
    );
  }

  function togglePasswordVisibility(inputId, btnElement) {
    const input = document.getElementById(inputId);
    const icon = btnElement.querySelector("i");

    if (input.type === "password") {
      input.type = "text";
      icon.classList.replace("fa-eye", "fa-eye-slash");
      btnElement.setAttribute("aria-label", "Hide password");
      btnElement.setAttribute("title", "Hide password");
    } else {
      input.type = "password";
      icon.classList.replace("fa-eye-slash", "fa-eye");
      btnElement.setAttribute("aria-label", "Show password");
      btnElement.setAttribute("title", "Show password");
    }
  }

  function formatQuestionText(text, options = {}) {
    return TextUtils.formatQuestionText(text, options);
  }

  function revealClozeAnswer(trigger) {
    if (!trigger) return;
    const mask = trigger.querySelector(".cloze-mask");
    const hiddenAnswer = trigger.querySelector(".cloze-answer");
    if (!hiddenAnswer) return;

    const nextVisible = !trigger.classList.contains("cloze-visible");
    trigger.classList.toggle("cloze-visible", nextVisible);
    if (mask) {
      mask.classList.toggle("hidden", nextVisible);
    }
    if (hiddenAnswer) {
      hiddenAnswer.classList.toggle("hidden", !nextVisible);
    }
  }

  if (!state.prefs.studyLayout) state.prefs.studyLayout = "scroll";
  if (!state.prefs.studyPageSize) state.prefs.studyPageSize = 10;
  if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
  if (!state.prefs.qToggles) state.prefs.qToggles = {};

  function changeStudyLayout(layout) {
    if (
      typeof DeckReviewCore === "undefined" ||
      typeof DeckReviewCore.changeStudyLayout !== "function"
    ) {
      throw new Error("DeckReview is required before changing study layout.");
    }
    return DeckReviewCore.changeStudyLayout(layout);
  }

  if (!state.prefs.studyFilterMode) state.prefs.studyFilterMode = "all";

  function changeStudyPageSize(size) {
    if (
      typeof DeckReviewCore === "undefined" ||
      typeof DeckReviewCore.changeStudyPageSize !== "function"
    ) {
      throw new Error(
        "DeckReview is required before changing study page size.",
      );
    }
    return DeckReviewCore.changeStudyPageSize(size);
  }

  function changeStudyPage(delta) {
    if (
      typeof DeckReviewCore === "undefined" ||
      typeof DeckReviewCore.changeStudyPage !== "function"
    ) {
      throw new Error("DeckReview is required before changing study page.");
    }
    return DeckReviewCore.changeStudyPage(delta);
  }

  function jumpToStudyPage(pageNumber) {
    if (
      typeof DeckReviewCore === "undefined" ||
      typeof DeckReviewCore.jumpToStudyPage !== "function"
    ) {
      throw new Error("DeckReview is required before jumping to a study page.");
    }
    return DeckReviewCore.jumpToStudyPage(pageNumber);
  }

  function changeStudyIndex(delta) {
    if (
      typeof DeckReviewCore === "undefined" ||
      typeof DeckReviewCore.changeStudyIndex !== "function"
    ) {
      throw new Error("DeckReview is required before changing study index.");
    }
    return DeckReviewCore.changeStudyIndex(delta);
  }

  function toggleSpecificChoices(qId) {
    qId = decodeHandlerValue(qId);
    if (!state.prefs.qToggles) state.prefs.qToggles = {};
    let currentState = state.prefs.qToggles[qId];
    if (currentState === undefined) {
      currentState =
        rootScope.getDeckSessionSetting?.("study", "showWrongChoices") !==
        false;
    }

    state.prefs.qToggles[qId] = !currentState;
    saveState();
    DeckReviewCore.updateQuestionChoices(qId);
  }

  function toggleQuestionFavorite(qId) {
    qId = decodeHandlerValue(qId || "");
    if (!qId) return;
    if (!Array.isArray(state.prefs.favoriteQuestions)) {
      state.prefs.favoriteQuestions = [];
    }

    const isFavorite = state.prefs.favoriteQuestions.includes(qId);
    if (isFavorite) {
      state.prefs.favoriteQuestions = state.prefs.favoriteQuestions.filter(
        (value) => value !== qId,
      );
      showToast("Removed from Favorites.");
    } else {
      state.prefs.favoriteQuestions = [
        qId,
        ...state.prefs.favoriteQuestions,
      ].slice(0, 250);
      showToast("Added to Favorites.");
    }

    saveState();

    // Only re-render review mode if we're actually in review mode
    if (
      document.getElementById("view-deck-review")?.classList.contains("active")
    ) {
      reRenderDeckReview();
    }
  }

  function toggleCurrentQuestionFavorite() {
    if (!state.session.active) return;

    const q = state.session.questions[state.session.currentIndex];
    if (!q) return;

    toggleQuestionFavorite(q.ID);
  }

  function toggleStudyFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        appLogger.warn(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }

  if (!state.prefs.qTypeOverride) state.prefs.qTypeOverride = "auto";

  function getQuestionTypeMode(q) {
    const qTypeOverride =
      rootScope.getDeckSessionSetting?.("quiz", "qTypeOverride", q?.Subject) ||
      state.prefs.qTypeOverride;
    const isForcedIdent = qTypeOverride === "ident";
    const isForcedMCQ = qTypeOverride === "mcq";

    let isPureIdent;
    let validChoicesCount = 0;

    if (isForcedIdent) {
      isPureIdent = true;
    } else if (isForcedMCQ) {
      isPureIdent = false;
    } else if (q && q.QuestionType) {
      // Use pre-computed type from backend
      isPureIdent = q.QuestionType === "ID";
    } else {
      // Fallback: calculate from choices once.
      for (const ch of ["A", "B", "C", "D", "E"]) {
        const choiceText = q?.[`Choice${ch}`];
        if (
          choiceText &&
          String(choiceText).trim() !== "" &&
          String(choiceText).toLowerCase() !== "undefined"
        ) {
          validChoicesCount += 1;
        }
      }
      isPureIdent = validChoicesCount <= 1;
    }

    return { isIdent: isPureIdent, validChoicesCount };
  }

  function getQuestionTypeDisplayName(mode) {
    const normalizedMode = String(mode || "auto").toLowerCase();
    const displayNames = {
      auto: "Auto (Mixed)",
      ident: "Identification",
      mcq: "Multiple Choices",
    };
    return displayNames[normalizedMode] || "Auto (Mixed)";
  }

  async function changeQuestionTypeMode(mode) {
    const normalizedMode = String(mode || "auto").toLowerCase();
    const subject = state.session?.active
      ? state.session.questions?.[state.session.currentIndex]?.Subject
      : "";
    const currentOverride =
      rootScope.getDeckSessionSetting?.("quiz", "qTypeOverride", subject) ||
      state.prefs.qTypeOverride;
    if (currentOverride === normalizedMode) return;

    const displayName = getQuestionTypeDisplayName(normalizedMode);
    const userConfirmed = await requestConfirmation(
      {
        before: "Are you sure you want to switch to ",
        emphasis: displayName,
        after: " mode?",
      },
      "Change Question Type",
    );

    if (!userConfirmed) {
      const questionTypeSelect = document.getElementById(
        "toggle-question-type",
      );
      if (questionTypeSelect) {
        questionTypeSelect.value = currentOverride || "auto";
      }
      return;
    }

    if (
      !setActiveDeckSessionPreference(
        "quiz",
        "qTypeOverride",
        normalizedMode,
        subject,
      )
    ) {
      return;
    }

    if (normalizedMode === "ident") {
      showToast(
        "Identification mode enabled. Choices are hidden for MCQs.",
        "warning",
      );
    } else if (normalizedMode === "mcq") {
      showToast(
        "Multiple Choices mode enabled. Choices may be undefined when no alternatives exist.",
        "warning",
      );
    } else {
      showToast("Auto (Mixed) mode enabled.", "info");
    }

    saveState();
    if (state.session.active) renderQuestion();
  }

  let lastScrollTop = 0;
  let isTicking = false;
  let latestReviewScrollY = 0;
  let latestReviewSubject = null;

  function flushReviewScrollProgress() {
    const reviewSubject = latestReviewSubject;
    if (!reviewSubject) return;

    lifecycle.clearTimeout(window.scrollSaveTimeout);
    latestReviewSubject = null;
    if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
    if (!state.prefs.studyProgress[reviewSubject]) {
      state.prefs.studyProgress[reviewSubject] = {
        page: 1,
        index: 0,
        scrollY: 0,
      };
    }
    state.prefs.studyProgress[reviewSubject].scrollY = latestReviewScrollY;
    state.prefs.studyProgress[reviewSubject].updatedAt = Date.now();
    void saveState("prefs");
  }

  // CRITICAL FIX: Cache invalidation management
  function isValidBroadcastMessage(data, type) {
    return (
      data &&
      typeof data === "object" &&
      !Array.isArray(data) &&
      data.protocol === BROADCAST_PROTOCOL &&
      data.type === type
    );
  }

  async function refreshFromBackendPayloadBroadcast() {
    if (isLeaderTab || !AppNetwork?.getSyncStatus) return;
    try {
      const status = await AppNetwork.getSyncStatus({
        timeoutMs: 20000,
        maxRetries: 0,
      });
      if (
        status?.status !== "ok" ||
        status.isColdStart === true ||
        Number(status.payloadSchemaVersion) !==
          Number(appConfig.backendPayloadSchemaVersion ?? 2)
      ) {
        appLogger.warn(
          "[CACHE] Ignoring an update notification with unavailable or incompatible backend data.",
          status,
        );
        return;
      }
      await syncDatabase(true, true, String(status.syncTimestamp || "").trim());
    } catch (error) {
      appLogger.warn(
        "[CACHE] Unable to synchronize the notified backend payload update.",
        error,
      );
    }
  }

  function setupCacheInvalidationListener() {
    if (typeof BroadcastChannel === "undefined") return;

    try {
      cacheInvalidationChannel = new BroadcastChannel("mrh_cache_invalidation");
      cacheInvalidationChannel.onmessage = (event) => {
        if (isValidBroadcastMessage(event?.data, "cache_invalidated")) {
          appLogger.info("[CACHE] Invalidation signal received");
          // Force refresh database when the cache version changes
          handleCacheInvalidation();
        } else if (
          isValidBroadcastMessage(event?.data, "backend_payload_changed")
        ) {
          refreshFromBackendPayloadBroadcast();
        }
      };
    } catch (e) {
      appLogger.error("[CACHE] Failed to setup invalidation listener:", e);
    }
  }

  function triggerSilentSummaryRefresh(reason = "cache invalidation") {
    appLogger.info(`[CACHE] ${reason} - syncing silently in background`);
    return syncDatabase(false, true);
  }

  function handleCacheInvalidation() {
    triggerSilentSummaryRefresh("Handling cache invalidation");
  }

  // ============================================
  // OPTIMIZATION: Toast Notification System
  // ============================================
  function showToastNotification(message, type = "info", duration = 3500) {
    showToast(message, type, duration);
  }

  // ============================================
  // OPTIMIZATION: In-Memory State Re-fetch
  // ============================================
  async function reloadAppStateInMemory() {
    try {
      appLogger.info("[STATE] Fetching latest app state in-memory...");
      await triggerSilentSummaryRefresh("Refreshing app state in memory");

      appLogger.info("[STATE] In-memory state refresh complete");
      return true;
    } catch (error) {
      appLogger.error("[STATE] Failed to refresh state:", error);
      showToastNotification(
        "Unable to load latest content. Please refresh the page.",
        "warning",
        4000,
      );
      return false;
    }
  }

  // ============================================
  // OPTIMIZATION: Leader Election Pattern
  // ============================================
  let leaderCoordinator = null;

  function setupLeaderElection() {
    if (typeof SyncCore === "undefined" || !SyncCore.createLeaderCoordinator) {
      isLeaderTab = true;
      return;
    }

    leaderCoordinator?.cleanup();
    leaderCoordinator = SyncCore.createLeaderCoordinator({
      lifecycle,
      logger: appLogger,
      protocol: BROADCAST_PROTOCOL,
      tabId:
        typeof window !== "undefined"
          ? (window.mrh_tabId ||= `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`)
          : undefined,
      heartbeatIntervalMs: appConfig.leaderHeartbeatIntervalMs ?? 10 * 1000,
      onLeaderChange: (isLeader) => {
        isLeaderTab = isLeader;
        if (isLeader && typeof scheduleNextPolling === "function") {
          scheduleNextPolling();
        }
      },
    });
    leaderCoordinator.start();
  }

  let appResourcesCleanedUp = false;

  function cleanupAppResources(event) {
    if (appResourcesCleanedUp) return;

    flushReviewScrollProgress();

    if (typeof SessionCore?.saveSessionProgress === "function") {
      SessionCore.saveSessionProgress(true);
    }

    if (event?.persisted) {
      syncScheduler.handleVisibility(true);
      return;
    }

    appResourcesCleanedUp = true;
    if (typeof AppState?.stopStatePersistence === "function") {
      void AppState.stopStatePersistence();
    }

    lifecycle.cleanup();

    __mrhPollLoopToken += 1;
    lifecycle.clearTimeout(__mrhInitializationTimer);
    lifecycle.clearTimeout(syncRetryTimer);
    lifecycle.clearInterval(syncCountdownTimer);
    lifecycle.clearTimeout(syncStatusHideTimer);
    syncScheduler.cancel();
    leaderCoordinator?.cleanup();
    leaderCoordinator = null;

    if (cacheInvalidationChannel) {
      cacheInvalidationChannel.close();
      cacheInvalidationChannel = null;
    }

    cancelAppAnimationFrames();
    uiEventController.abort();

    if (syncAbortController) {
      syncAbortController.abort();
      syncAbortController = null;
    }

    lifecycle.clearTimeout(window.cacheInvalidationTimeout);
    lifecycle.clearTimeout(window.scrollSaveTimeout);
    syncController?.cleanup?.();
    syncController = null;
    if (typeof AppNetwork?.destroy === "function") AppNetwork.destroy();
  }

  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", cleanupAppResources, {
      signal: uiEventController.signal,
    });
    window.addEventListener(
      "pageshow",
      (event) => {
        if (!event.persisted) return;
        appResourcesCleanedUp = false;
        syncScheduler.handleVisibility(false);
      },
      { signal: uiEventController.signal },
    );
  }

  function calculateBackoffDelay(retryCount) {
    // Exponential: 2^retryCount seconds
    // Jitter: add random 0-50% to avoid thundering herd
    const baseDelay = Math.pow(2, Math.min(retryCount, 5)) * 1000; // Cap at 32 seconds
    const jitter = Math.random() * baseDelay * 0.5;
    return baseDelay + jitter;
  }

  // ============================================
  // OPTIMIZATION: Enhanced Visibility Change Handler
  // ============================================
  function setupVisibilityChangeHandler() {
    if (typeof document === "undefined") return;

    document.addEventListener(
      "visibilitychange",
      () => {
        if (!document.hidden) {
          appLogger.info(
            "[VISIBILITY] Tab became visible, checking sync status",
          );
          syncScheduler.handleVisibility(false);
        } else {
          appLogger.info("[VISIBILITY] Tab hidden, will pause polling");
          syncScheduler.handleVisibility(true);
          flushReviewScrollProgress();
        }
      },
      { signal: uiEventController.signal },
    );

    window.addEventListener(
      "online",
      () => {
        if (!document.hidden && isLeaderTab) {
          appLogger.info(
            "[SYNC] Connectivity restored; resuming background sync",
          );
          syncScheduler.handleVisibility(false);
        }
      },
      { signal: uiEventController.signal },
    );
  }

  // ============================================
  // OPTIMIZATION: Smarter Polling Scheduler with Jitter
  // ============================================
  function scheduleNextPolling() {
    if (!isLeaderTab) {
      syncScheduler.cancel();
      return;
    }

    syncScheduler.scheduleForLeader();
  }

  function startCacheVersionChecking() {
    setupLeaderElection();
    setupVisibilityChangeHandler();
    scheduleNextPolling();
  }

  function forcePageRefresh() {
    appLogger.info("[CACHE] Cache invalidated - triggering background sync");
    clearTimeout(window.cacheInvalidationTimeout);
    window.cacheInvalidationTimeout = lifecycle.setTimeout(() => {
      triggerSilentSummaryRefresh("Forcing quiet cache refresh");
    }, 100);
  }

  async function initializeApp() {
    if (window.__MRH_BOOTSTRAP__?.status === "ready") {
      return true;
    }

    if (__mrhAppInitializationPromise) {
      return __mrhAppInitializationPromise;
    }

    if (__mrhAppInitialized) {
      return true;
    }

    if (!hasRequiredAppRuntime()) {
      appLogger.warn(
        "Application initialization deferred until required runtime dependencies are available.",
      );
      scheduleDeferredInitialization();
      return false;
    }

    __mrhAppInitializationPromise = (async () => {
      __mrhAppInitialized = true;

      const bindUi = () => {
        const mainEl = document.querySelector("main");
        const headerEl = document.querySelector("header");
        if (headerEl)
          headerEl.classList.add("transition-transform", "duration-300");

        if (mainEl && headerEl) {
          mainEl.addEventListener(
            "scroll",
            (e) => {
              if (!isTicking) {
                scheduleAppAnimationFrame(() => {
                  const currentScroll = e.target.scrollTop;

                  if (currentScroll > lastScrollTop && currentScroll > 50) {
                    headerEl.classList.add("-translate-y-full");
                  } else {
                    headerEl.classList.remove("-translate-y-full");
                  }
                  lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;

                  if (
                    typeof globalThis.scheduleVirtualReviewRender === "function"
                  ) {
                    globalThis.scheduleVirtualReviewRender();
                  }

                  const reviewSubject = getCurrentReviewSubject();
                  if (
                    document
                      .getElementById("view-deck-review")
                      .classList.contains("active") &&
                    reviewSubject
                  ) {
                    globalThis.updateStudyProgressIndicator?.();
                    latestReviewScrollY = currentScroll;
                    latestReviewSubject = reviewSubject;
                    clearTimeout(window.scrollSaveTimeout);
                    window.scrollSaveTimeout = lifecycle.setTimeout(() => {
                      if (!state.prefs.studyProgress)
                        state.prefs.studyProgress = {};
                      if (!state.prefs.studyProgress[reviewSubject]) {
                        state.prefs.studyProgress[reviewSubject] = {
                          page: 1,
                          index: 0,
                          scrollY: 0,
                          updatedAt: Date.now(),
                        };
                      }
                      state.prefs.studyProgress[reviewSubject].scrollY =
                        latestReviewScrollY;
                      state.prefs.studyProgress[reviewSubject].updatedAt =
                        Date.now();
                      if (latestReviewSubject === reviewSubject) {
                        latestReviewSubject = null;
                      }
                      saveState("prefs");
                    }, 1000);
                  }

                  isTicking = false;
                });

                isTicking = true;
              }
            },
            { signal: uiEventController.signal },
          );
        }
      };

      const applyThemeFromPrefs = () => {
        const enableDark = state.prefs?.darkMode !== false;
        document.documentElement.classList.toggle("dark", enableDark);
        document.documentElement.style.colorScheme = enableDark
          ? "dark"
          : "light";
      };

      const renderSkeleton = () => {
        const htmlRoot = document.documentElement;
        if (htmlRoot) {
          htmlRoot.setAttribute("data-app-ready", "false");
        }

        const status = document.getElementById("connection-status");
        if (status) {
          status.classList.remove("hidden");
        }
      };

      try {
        if (typeof window !== "undefined") {
          window.__MRH_BOOTSTRAP__ = window.__MRH_BOOTSTRAP__ || {
            status: "idle",
            ready: null,
            error: null,
          };
          window.__MRH_BOOTSTRAP__.status = "loading";
        }

        try {
          removeCachedResourcePortalListings();
        } catch (error) {
          appLogger.error(
            "Unable to clear obsolete resource listing data.",
            error,
          );
        }

        await loadState();
        if (Array.isArray(state.prefs?.pendingDeckPayloadRefreshes)) {
          state.prefs.pendingDeckPayloadRefreshes.forEach((subject) => {
            const normalizedSubject = String(subject || "").trim();
            if (normalizedSubject) {
              pendingDeckPayloadRefreshes.add(normalizedSubject);
            }
          });
        }

        const toggleElement = document.getElementById("globalModeToggle");
        if (toggleElement) {
          currentAppMode = toggleElement.checked ? "review" : "quiz";
        }

        bindUi();
        applyThemeFromPrefs();
        renderSkeleton();
        installReviewerSignOutStorageListener();
        void restoreReviewerSession();

        __mrhAppReady = true;
        if (typeof window !== "undefined") {
          window.__mrhAppReady = true;
          window.__MRH_BOOTSTRAP__.status = "ready";
          window.__MRH_BOOTSTRAP__.error = null;
          document.documentElement.setAttribute("data-app-ready", "true");
        }

        const sessionRoute = globalScope.getSessionNavigationFromUrl?.();
        if (sessionRoute) {
          const hasProgress = hasSessionRestoreProgress(sessionRoute);
          const sessionDeckName =
            String(sessionRoute.subject || "")
              .split("::")
              .filter(Boolean)
              .at(-1) || "this deck";
          const shouldRestore = hasProgress
            ? await requestConfirmation(
                {
                  before: `A ${sessionRoute.mode === "study" ? "Study" : "Quiz"} session for `,
                  emphasis: sessionDeckName,
                  after:
                    " was interrupted by the page refresh. Do you want to restore it?",
                },
                "Restore Session",
              )
            : false;
          let restored = false;
          let restoreFailedWithError = false;
          if (shouldRestore) {
            try {
              if (sessionRoute.mode === "study" && sessionRoute.subject) {
                currentAppMode = "review";
                syncPreferenceControls();
                restored = await reviewDeck(sessionRoute.subject, null, true);
              } else if (sessionRoute.mode === "quiz") {
                restored = await resumeSession(null, { allowResume: true });
              }
            } catch (error) {
              restoreFailedWithError = true;
              appLogger.error(
                "Unable to restore the session from its URL.",
                error,
              );
              showToast(
                "This session could not be restored. Return to the deck and start a new session.",
                "warning",
                8000,
              );
            }
          }

          const passwordPending =
            shouldRestore &&
            ((sessionRoute.mode === "quiz" && pendingDeckAction === "resume") ||
              (sessionRoute.mode === "study" &&
                pendingDeckAction === "resume-review"));
          if (!restored && !passwordPending) {
            globalScope.updateNavigationUrl?.(state.currentPath || [], {
              replace: true,
            });
            if (sessionRoute.mode === "quiz" && !restoreFailedWithError) {
              showToast(
                "This quiz session could not be restored. Return to the deck and start a new session.",
                "warning",
                8000,
              );
            }
          }
        }

        invalidateCategoryProgressRenderSignature();
        renderCategoryProgress();
        setupCacheInvalidationListener();
        startCacheVersionChecking();
        initDetailsExclusivity();

        scheduleStartupSync();

        lifecycle.setTimeout(() => {
          applyTitleMode();
          updateTitleModeButton();
        }, 100);

        return true;
      } catch (error) {
        __mrhAppReady = false;
        __mrhAppInitialized = false;
        if (typeof window !== "undefined") {
          window.__mrhAppReady = false;
          window.__MRH_BOOTSTRAP__.status = "failed";
          window.__MRH_BOOTSTRAP__.error = error;
        }
        appLogger.error("Application data initialization failed:", error);
        if (
          typeof window !== "undefined" &&
          typeof window.showBootstrapError === "function"
        ) {
          window.showBootstrapError(error);
        }
        return false;
      }
    })();

    try {
      return await __mrhAppInitializationPromise;
    } finally {
      __mrhAppInitializationPromise = null;
    }
  }

  let resourcePortalCurrentFolderId = "";
  let resourcePortalRequestGeneration = 0;
  let resourcePortalPreviewGeneration = 0;
  let resourcePortalItemCount = 0;
  let resourcePortalStatusMessage = "";
  let resourcePortalPreviewObjectUrl = "";
  let resourceDashboardData = null;
  let resourceDashboardActiveTab = "PROFILE";
  let resourceDashboardLoadingPromise = null;
  let reviewerAuthConfig = null;
  let reviewerAuthConfigPromise = null;
  let reviewerSignInButtonResizeHandler = null;
  let reviewerSignInButtonResizeObserver = null;
  let reviewerAuthCheckPending = false;
  let reviewerSessionId = "";
  let reviewerAuthorizedEmail = "";
  let reviewerAccountStatus = "";
  let reviewerPendingEnrollmentSessionId = "";
  let reviewerDashboardLoadedForEmail = "";
  let reviewerAuthGeneration = 0;
  let reviewerProfilePictureUrl = "";
  let reviewerProfileEditing = false;
  let reviewerDashboardRequestGeneration = 0;
  let reviewerDashboardRequestPromise = null;
  let reviewerStatusPollTimer = null;
  let reviewerStatusPollInFlight = false;
  let reviewerVerificationInFlightToken = "";
  let reviewerVerificationRetryToken = "";
  let reviewerVerificationRetryAvailable = false;
  let reviewerSessionRestorePromise = null;
  let reviewerSessionRestorePending = false;
  let reviewerReauthenticationPromptAttempted = false;
  let reviewerSignOutStorageListenerInstalled = false;
  const REVIEWER_STATUS_POLL_INTERVAL_MS = 5000;
  const REVIEWER_EXPLICIT_SIGNOUT_KEY = "mrh_reviewer_explicit_signout_v1";
  const REVIEWER_EXPLICIT_SIGNOUT_COOKIE = "mrh_reviewer_explicit_signout_v1";
  const REVIEWER_SESSION_STORAGE_KEY = "mrh_reviewer_session_v1";
  const REVIEWER_PROFILE_CACHE_KEY = "mrh_reviewer_profile_v1";
  const REVIEWER_PROFILE_CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  const RESOURCE_DASHBOARD_CACHE_KEY = "resource_dashboard_cache_v1";
  const RESOURCE_DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 30000;
  let resourceDashboardAutoRefreshTimer = null;
  let resourceDashboardAutoRefreshEventsInstalled = false;
  let resourceDashboardLastRefreshAt = 0;
  let resourceDashboardSelectedYear = "3";
  let resourceDashboardSelectedSemester = "2";
  let resourceDashboardSelectedCategory = "all";

  function isDefinitivelyInvalidReviewerCredential(error) {
    return [
      "UNAUTHORIZED",
      "SESSION_EXPIRED",
      "SESSION_INVALID",
      "SESSION_REVOKED",
    ].includes(error?.code);
  }

  function getStoredReviewerSessionId() {
    try {
      const sessionId = String(
        globalScope.localStorage.getItem(REVIEWER_SESSION_STORAGE_KEY) || "",
      ).trim();
      return /^[a-f0-9]{96}$/.test(sessionId) ? sessionId : "";
    } catch (error) {
      (globalScope.DebugUtils || console).error(
        "Unable to read the saved reviewer session.",
        error,
      );
      return "";
    }
  }

  function saveReviewerSessionId(sessionId) {
    if (!/^[a-f0-9]{96}$/.test(String(sessionId || "")))
      throw new Error(
        "The reviewer sign-in service returned an invalid session.",
      );
    globalScope.localStorage.setItem(REVIEWER_SESSION_STORAGE_KEY, sessionId);
  }

  function clearStoredReviewerSession() {
    try {
      globalScope.localStorage.removeItem(REVIEWER_SESSION_STORAGE_KEY);
      return true;
    } catch (error) {
      (globalScope.DebugUtils || console).error(
        "Unable to clear the saved reviewer session.",
        error,
      );
      return false;
    }
  }

  function getReviewerProfilePictureUrl(value) {
    const picture = typeof value === "string" ? value.trim() : "";
    return /^https:\/\/lh[3-6]\.googleusercontent\.com\//.test(picture)
      ? picture
      : "";
  }

  function getStoredReviewerProfile() {
    if (
      hasExplicitReviewerSignOut() ||
      !(reviewerSessionId || getStoredReviewerSessionId())
    )
      return null;
    try {
      const cached = JSON.parse(
        globalScope.localStorage.getItem(REVIEWER_PROFILE_CACHE_KEY) || "null",
      );
      const email = String(cached?.email || "").trim();
      const age = Date.now() - Number(cached?.cachedAt || 0);
      if (
        !email ||
        !Number.isFinite(age) ||
        age < 0 ||
        age > REVIEWER_PROFILE_CACHE_MAX_AGE_MS
      ) {
        clearStoredReviewerProfile();
        return null;
      }
      return {
        email,
        firstName: String(cached.firstName || "").slice(0, 100),
        middleInitial: String(cached.middleInitial || "").slice(0, 10),
        lastName: String(cached.lastName || "").slice(0, 100),
        picture: getReviewerProfilePictureUrl(cached.picture),
        accountStatus: ["TRUE", "FALSE", "DENIED", "NOT_FOUND"].includes(
          cached.accountStatus,
        )
          ? cached.accountStatus
          : "",
      };
    } catch {
      return null;
    }
  }

  function cacheReviewerProfile(response) {
    const email = String(response?.email || "").trim();
    if (!email) return false;
    try {
      globalScope.localStorage.setItem(
        REVIEWER_PROFILE_CACHE_KEY,
        JSON.stringify({
          email,
          firstName: String(response.firstName || "").slice(0, 100),
          middleInitial: String(response.middleInitial || "").slice(0, 10),
          lastName: String(response.lastName || "").slice(0, 100),
          picture: getReviewerProfilePictureUrl(response.picture),
          accountStatus: ["TRUE", "FALSE", "DENIED", "NOT_FOUND"].includes(
            response.accountStatus,
          )
            ? response.accountStatus
            : "",
          cachedAt: Date.now(),
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function clearStoredReviewerProfile() {
    try {
      globalScope.localStorage.removeItem(REVIEWER_PROFILE_CACHE_KEY);
    } catch {
      // Cached profile details are optional when browser storage is unavailable.
    }
  }

  function promptReviewerReauthentication() {
    const identityApi = globalScope.google?.accounts?.id;
    if (
      reviewerReauthenticationPromptAttempted ||
      hasExplicitReviewerSignOut() ||
      typeof identityApi?.prompt !== "function"
    )
      return false;
    reviewerReauthenticationPromptAttempted = true;
    const authGeneration = reviewerAuthGeneration;
    try {
      identityApi.prompt((notification) => {
        if (authGeneration !== reviewerAuthGeneration) return;
        const promptFinished =
          notification?.isNotDisplayed?.() ||
          notification?.isSkippedMoment?.() ||
          notification?.isDismissedMoment?.();
        if (!promptFinished) return;
        const authStatus = document.getElementById(
          "resource-reviewer-auth-status",
        );
        if (authStatus)
          authStatus.textContent =
            "Google sign-in is required. Use the Google sign-in button to continue.";
      });
      return true;
    } catch (error) {
      (globalScope.DebugUtils || console).error(
        "Unable to prompt for Google reauthentication.",
        error,
      );
      return false;
    }
  }

  function handleReviewerSignOutStorageChange(event) {
    if (event?.key === REVIEWER_SESSION_STORAGE_KEY) {
      if (!event.newValue) {
        if (
          reviewerSessionId ||
          reviewerPendingEnrollmentSessionId ||
          reviewerSessionRestorePending
        )
          signOutReviewer(false);
        return;
      }
      if (
        /^[a-f0-9]{96}$/.test(event.newValue) &&
        event.newValue !== reviewerSessionId
      ) {
        signOutReviewer(false, true);
        void restoreReviewerSession(event.newValue);
      }
      return;
    }
    if (
      event?.key !== REVIEWER_EXPLICIT_SIGNOUT_KEY ||
      event.newValue !== "true" ||
      (!reviewerSessionId &&
        !reviewerPendingEnrollmentSessionId &&
        !reviewerVerificationRetryToken)
    )
      return;
    signOutReviewer(false);
    setReviewerAuthStatus("Use Google to sign in and request access.");
  }

  function installReviewerSignOutStorageListener() {
    if (
      reviewerSignOutStorageListenerInstalled ||
      typeof globalScope.addEventListener !== "function"
    )
      return;
    globalScope.addEventListener("storage", handleReviewerSignOutStorageChange);
    reviewerSignOutStorageListenerInstalled = true;
  }

  function hasExplicitReviewerSignOut() {
    const signOutCookie = String(globalScope.document?.cookie || "")
      .split("; ")
      .find((entry) =>
        entry.startsWith(`${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=`),
      );
    if (signOutCookie === `${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=true`)
      return true;
    try {
      if (
        globalScope.localStorage.getItem(REVIEWER_EXPLICIT_SIGNOUT_KEY) ===
        "true"
      )
        return true;
    } catch (error) {
      // The first-party cookie remains available when local storage is blocked.
    }
    return false;
  }

  function setExplicitReviewerSignOut(signedOut) {
    let persisted = false;
    try {
      if (signedOut)
        globalScope.localStorage.setItem(REVIEWER_EXPLICIT_SIGNOUT_KEY, "true");
      else globalScope.localStorage.removeItem(REVIEWER_EXPLICIT_SIGNOUT_KEY);
      persisted = true;
    } catch (error) {
      // Fall back to the same-origin cookie when local storage is blocked.
    }
    try {
      if (globalScope.document) {
        globalScope.document.cookie = signedOut
          ? `${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=true; Max-Age=315360000; Path=/; SameSite=Strict; Secure`
          : `${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=false; Max-Age=315360000; Path=/; SameSite=Strict; Secure`;
        const cookieValue = String(globalScope.document.cookie || "")
          .split("; ")
          .find((entry) =>
            entry.startsWith(`${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=`),
          );
        persisted =
          (signedOut
            ? cookieValue === `${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=true`
            : cookieValue === `${REVIEWER_EXPLICIT_SIGNOUT_COOKIE}=false`) ||
          persisted;
      }
    } catch (error) {
      // Local storage may still preserve the explicit sign-out preference.
    }
    if (!persisted)
      throw new Error(
        "The sign-out preference could not be saved. Enable site storage and try again.",
      );
  }

  function clearLegacyBrowserId() {
    try {
      globalScope.localStorage.removeItem("mrh_device_identity_v1");
    } catch (error) {
      (globalScope.DebugUtils || console).warn(
        "Unable to remove a saved legacy browser identifier.",
        error,
      );
    }
    try {
      if (globalScope.document) {
        globalScope.document.cookie =
          "mrh_device_identity_v1=; Max-Age=0; Path=/; SameSite=Strict; Secure";
      }
    } catch (error) {
      (globalScope.DebugUtils || console).warn(
        "Unable to remove a legacy browser identifier cookie.",
        error,
      );
    }
  }

  clearLegacyBrowserId();

  function createResourceEventId() {
    const cryptoApi = globalScope.crypto || globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function")
      return cryptoApi.randomUUID();
    if (!cryptoApi?.getRandomValues)
      throw new Error("Secure event ID generation is unavailable.");
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  function setResourceDashboardStatus(message, busy = false, stacked = false) {
    const status = document.getElementById("resource-portal-status");
    if (!status) return;
    status.textContent = message;
    status.hidden = !message;
    status.classList?.toggle(
      "resource-dashboard-status-stacked",
      Boolean(message && busy && stacked),
    );
    if (busy) status.setAttribute("aria-busy", "true");
    else status.removeAttribute("aria-busy");
  }

  function setReviewerAuthStatus(message, busy = false) {
    const status = document.getElementById("resource-reviewer-auth-status");
    if (!status) return;
    status.textContent = message;
    if (busy) status.setAttribute("aria-busy", "true");
    else status.removeAttribute("aria-busy");
  }

  function setReviewerNavigationBusy() {
    const button = document.getElementById("resource-dashboard-reviewers-nav");
    button?.removeAttribute("aria-busy");
  }

  function setReviewerDashboardFiltersDisabled(disabled) {
    document
      .querySelectorAll(
        ".resource-dashboard-filters [data-filter-value], .resource-dashboard-filters [data-category]",
      )
      .forEach((button) => {
        if (disabled) {
          if (!("reviewerLoadingDisabled" in button.dataset))
            button.dataset.reviewerLoadingDisabled = String(button.disabled);
          button.disabled = true;
        } else if ("reviewerLoadingDisabled" in button.dataset) {
          button.disabled = button.dataset.reviewerLoadingDisabled === "true";
          delete button.dataset.reviewerLoadingDisabled;
        }
        button.setAttribute("aria-disabled", String(button.disabled));
      });
  }

  function showReviewerDashboardLoading(clearRows = false) {
    const yearControl = document.getElementById(
      "resource-dashboard-filter-year",
    );
    const semesterControl = document.getElementById(
      "resource-dashboard-filter-semester",
    );
    const filters = document
      .getElementById("resource-dashboard-filter-year")
      ?.closest(".resource-dashboard-filters");
    const categoryFilter = document.getElementById(
      "resource-dashboard-category-filter",
    );
    if (filters) filters.hidden = false;
    if (categoryFilter) categoryFilter.hidden = false;
    const addLoadingOptions = (control, values, selectedValue) => {
      if (!control || control.querySelector("button")) return;
      control.replaceChildren(
        ...values.map((value) => {
          const button = createResourceDashboardElement(
            "button",
            value === selectedValue ? "is-active" : "",
            value === "all" ? "All" : value,
          );
          button.type = "button";
          button.dataset.filterValue = value;
          button.disabled = true;
          button.setAttribute("aria-disabled", "true");
          button.setAttribute("aria-pressed", String(value === selectedValue));
          return button;
        }),
      );
    };
    addLoadingOptions(yearControl, ["all", "1", "2", "3"], "3");
    addLoadingOptions(semesterControl, ["all", "1", "2"], "2");
    setReviewerDashboardFiltersDisabled(true);
    if (clearRows) {
      document
        .getElementById("resource-dashboard-table-head")
        ?.replaceChildren();
      document
        .getElementById("resource-dashboard-table-body")
        ?.replaceChildren();
    }
    setResourceDashboardStatus("Loading", true, true);
  }

  function openResourceDashboardTab(tabName = "DEFAULT") {
    if (tabName === "DEFAULT") {
      const hasReviewerSession =
        !hasExplicitReviewerSignOut() &&
        Boolean(reviewerSessionId || getStoredReviewerSessionId());
      tabName = hasReviewerSession ? "REVIEWERS" : "PROFILE";
      if (hasReviewerSession) {
        const cachedProfile = getStoredReviewerProfile();
        if (cachedProfile) {
          populateReviewerProfile(cachedProfile);
          reviewerAccountStatus = cachedProfile.accountStatus;
          if (reviewerAccountStatus)
            setReviewerAccessEnabled(reviewerAccountStatus === "TRUE");
          const signInButton = document.getElementById(
            "resource-reviewer-signin-button",
          );
          const authStatus = document.getElementById(
            "resource-reviewer-auth-status",
          );
          if (signInButton) signInButton.hidden = true;
          if (authStatus) authStatus.textContent = "";
        }
      }
    }
    if (!["MODULES", "REVIEWERS", "SYLLABUS", "PROFILE"].includes(tabName))
      return false;
    if (
      tabName === "REVIEWERS" &&
      ["FALSE", "DENIED", "NOT_FOUND"].includes(reviewerAccountStatus)
    )
      tabName = "PROFILE";

    resourceDashboardActiveTab = tabName;
    const modulesNav = document.getElementById(
      "resource-dashboard-modules-nav",
    );
    const reviewersNav = document.getElementById(
      "resource-dashboard-reviewers-nav",
    );
    const syllabusNav = document.getElementById(
      "resource-dashboard-syllabus-nav",
    );
    const profileNav = document.getElementById(
      "resource-dashboard-profile-nav",
    );
    [
      [modulesNav, tabName === "MODULES"],
      [reviewersNav, tabName === "REVIEWERS"],
      [syllabusNav, tabName === "SYLLABUS"],
      [profileNav, tabName === "PROFILE"],
    ].forEach(([button, isActive]) => {
      if (!button) return;
      button.classList.toggle("is-active", isActive);
      if (isActive) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });

    const dashboardContent = document.getElementById(
      "resource-dashboard-content",
    );
    const profileScreen = document.getElementById("resource-dashboard-profile");
    const lockedPanel = document.getElementById(
      "resource-reviewers-locked-panel",
    );
    const updateNote = document.querySelector(
      ".resource-dashboard-update-note",
    );
    if (dashboardContent) dashboardContent.hidden = tabName === "PROFILE";
    if (profileScreen) profileScreen.hidden = tabName !== "PROFILE";
    if (lockedPanel) lockedPanel.hidden = tabName !== "REVIEWERS";
    if (updateNote)
      updateNote.hidden = tabName === "REVIEWERS" && !reviewerSessionId;
    if (tabName === "PROFILE") {
      void initializeReviewerAuth();
      return true;
    }
    if (tabName === "REVIEWERS") {
      if (!reviewerSessionId) {
        if (
          reviewerSessionRestorePending ||
          (!hasExplicitReviewerSignOut() && getStoredReviewerSessionId())
        ) {
          if (lockedPanel) lockedPanel.hidden = true;
          showReviewerDashboardLoading(true);
          void restoreReviewerSession();
          return true;
        }
        if (lockedPanel) lockedPanel.hidden = false;
        document
          .getElementById("resource-dashboard-table-head")
          ?.replaceChildren();
        document
          .getElementById("resource-dashboard-table-body")
          ?.replaceChildren();
        const filters = document
          .getElementById("resource-dashboard-filter-year")
          ?.closest(".resource-dashboard-filters");
        if (filters) filters.hidden = true;
        setReviewerNavigationBusy(false);
        setResourceDashboardStatus("");
        return true;
      }
      if (lockedPanel) lockedPanel.hidden = true;
      if (
        reviewerDashboardLoadedForEmail?.toLowerCase() ===
          reviewerAuthorizedEmail.toLowerCase() &&
        resourceDashboardData?.REVIEWERS
      ) {
        setReviewerNavigationBusy(false);
        renderResourceDashboardTab();
        void loadReviewerDashboard({ refresh: true });
        return true;
      }
      if (reviewerDashboardRequestPromise) {
        showReviewerDashboardLoading();
        return true;
      }
      return loadReviewerDashboard();
    }

    if (resourceDashboardData) {
      renderResourceDashboardTab();
      if (reviewerSessionId && tabName === "MODULES")
        void logModuleDashboardAccess();
      return true;
    }
    return loadResourceDashboard();
  }

  function isResourceDashboardLink(value) {
    try {
      const url = new URL(String(value || ""));
      return (
        url.protocol === "https:" &&
        ["drive.google.com", "docs.google.com"].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }

  function getResourceDashboardColumnHeading(column) {
    return String(column).trim().toLowerCase() === "course syllabus"
      ? "SYLLABUS"
      : String(column);
  }

  function getResourceDashboardFileId(value) {
    try {
      const url = new URL(String(value || ""));
      if (
        url.protocol !== "https:" ||
        !["drive.google.com", "docs.google.com"].includes(url.hostname)
      )
        return "";
      const pathMatch =
        /\/(?:folders|(?:file|document|spreadsheets|presentation|forms)\/d)\/([^/]+)/.exec(
          url.pathname,
        );
      const fileId = String(url.searchParams.get("id") || pathMatch?.[1] || "");
      return /^[A-Za-z0-9_-]{10,200}$/.test(fileId) ? fileId : "";
    } catch {
      return "";
    }
  }

  async function logResourceFileClick(resourceArea, fileName, fileId) {
    try {
      const payload = {
        type: "log_resource_file_click",
        eventId: createResourceEventId(),
        resourceArea,
        fileName,
        fileId,
      };
      if (reviewerSessionId) payload.sessionId = reviewerSessionId;
      await globalScope.AppNetwork.callBackend(payload, {
        timeoutMs: 15000,
        maxRetries: 0,
      });
      return true;
    } catch (error) {
      if (isDefinitivelyInvalidReviewerCredential(error))
        signOutReviewer(false);
      (globalScope.DebugUtils || console).error(
        "Unable to record resource file click.",
        error,
      );
      return false;
    }
  }

  function renderResourceDashboardTab() {
    const tab = resourceDashboardData?.[resourceDashboardActiveTab];
    const status = document.getElementById("resource-portal-status");
    const tableHead = document.getElementById("resource-dashboard-table-head");
    const tableBody = document.getElementById("resource-dashboard-table-body");
    if (!status || !tableHead || !tableBody) return false;
    const lockedPanel = document.getElementById(
      "resource-reviewers-locked-panel",
    );
    const updateNote = document.querySelector(
      ".resource-dashboard-update-note",
    );
    if (resourceDashboardActiveTab === "REVIEWERS" && !reviewerSessionId) {
      if (reviewerSessionRestorePending) {
        if (lockedPanel) lockedPanel.hidden = true;
        if (updateNote) updateNote.hidden = true;
        showReviewerDashboardLoading(true);
        return true;
      }
      if (lockedPanel) lockedPanel.hidden = false;
      if (updateNote) updateNote.hidden = true;
      const filters = document
        .getElementById("resource-dashboard-filter-year")
        ?.closest(".resource-dashboard-filters");
      if (filters) filters.hidden = true;
      tableHead.replaceChildren();
      tableBody.replaceChildren();
      setResourceDashboardStatus("");
      return true;
    }
    if (
      resourceDashboardActiveTab === "REVIEWERS" &&
      reviewerSessionId &&
      reviewerDashboardLoadedForEmail?.toLowerCase() !==
        reviewerAuthorizedEmail.toLowerCase()
    ) {
      if (lockedPanel) lockedPanel.hidden = true;
      showReviewerDashboardLoading(true);
      return true;
    }
    if (!tab) return false;
    setReviewerDashboardFiltersDisabled(false);
    if (lockedPanel) lockedPanel.hidden = true;
    if (updateNote)
      updateNote.hidden =
        resourceDashboardActiveTab === "REVIEWERS" && !reviewerSessionId;

    const yearFilterControl = document.getElementById(
      "resource-dashboard-filter-year",
    );
    const semesterFilterControl = document.getElementById(
      "resource-dashboard-filter-semester",
    );
    const categoryFilterContainer = document.getElementById(
      "resource-dashboard-category-filter",
    );
    const categoryFilterControl = document.getElementById(
      "resource-dashboard-filter-category",
    );
    const filterContainer = yearFilterControl?.closest(
      ".resource-dashboard-filters",
    );
    const yearColumnIndex = tab.columns.findIndex(
      (column) => String(column).trim().toLocaleLowerCase() === "year",
    );
    const semesterColumnIndex = tab.columns.findIndex(
      (column) => String(column).trim().toLocaleLowerCase() === "semester",
    );
    const phaseColumnIndexes = tab.columns.reduce((indexes, column, index) => {
      const phase = String(column).trim().toUpperCase();
      if (["PRELIMS", "MIDTERMS", "FINALS"].includes(phase))
        indexes[phase] = index;
      return indexes;
    }, {});
    const resourceColumnIndices =
      Object.keys(phaseColumnIndexes).length > 0
        ? Object.values(phaseColumnIndexes)
        : tab.columns
            .map((column, index) => ({
              index,
              name: String(column).trim().toLocaleLowerCase(),
            }))
            .filter(
              ({ name }) => !["year", "semester", "course"].includes(name),
            )
            .map(({ index }) => index);
    const hasCellValue = (values, rowIndex, columnIndex) => {
      const displayValue = String(values[columnIndex] ?? "").trim();
      const linkUrl = String(
        tab.links?.[rowIndex]?.[columnIndex] || displayValue,
      );
      return displayValue !== "" || isResourceDashboardLink(linkUrl);
    };
    const nonEmptyRows = tab.rows
      .map((values, rowIndex) => ({ values, rowIndex }))
      .filter(({ values, rowIndex }) =>
        resourceColumnIndices.some((columnIndex) =>
          hasCellValue(values, rowIndex, columnIndex),
        ),
      );
    const hasCategoryFilter = ["MODULES", "REVIEWERS"].includes(
      resourceDashboardActiveTab,
    );
    const availableCategories = new Set(
      Object.entries(phaseColumnIndexes)
        .filter(([, columnIndex]) =>
          nonEmptyRows.some(({ values, rowIndex }) =>
            hasCellValue(values, rowIndex, columnIndex),
          ),
        )
        .map(([category]) => category),
    );
    const showCategoryFilter =
      hasCategoryFilter || resourceDashboardActiveTab === "SYLLABUS";
    if (
      resourceDashboardSelectedCategory !== "all" &&
      !availableCategories.has(resourceDashboardSelectedCategory)
    )
      resourceDashboardSelectedCategory = "all";
    if (categoryFilterContainer)
      categoryFilterContainer.hidden = !showCategoryFilter;
    if (categoryFilterControl)
      categoryFilterControl
        .querySelectorAll("[data-category]")
        .forEach((button) => {
          const categoryAvailable =
            button.dataset.category === "all" ||
            availableCategories.has(button.dataset.category);
          button.disabled = !hasCategoryFilter || !categoryAvailable;
          if (button.dataset.reviewerLoadingDisabled !== undefined)
            button.dataset.reviewerLoadingDisabled = String(button.disabled);
          button.setAttribute("aria-disabled", String(button.disabled));
          const selected =
            button.dataset.category === resourceDashboardSelectedCategory;
          button.setAttribute("aria-pressed", String(selected));
          button.classList.toggle("is-active", selected);
        });
    const termValues = new Set();
    if (yearColumnIndex >= 0) {
      nonEmptyRows.forEach(({ values }) => {
        const yearValue = String(values[yearColumnIndex] || "").trim();
        const combinedTerm = /^(\d+)\s*[./-]\s*(\d+)$/.exec(yearValue);
        const year = combinedTerm ? combinedTerm[1] : yearValue;
        const semester = combinedTerm
          ? combinedTerm[2]
          : semesterColumnIndex >= 0
            ? String(values[semesterColumnIndex] || "").trim()
            : "";
        if (year && semester) termValues.add(`${year}.${semester}`);
      });
    }
    const hasTermFilter = yearColumnIndex >= 0;
    const yearFilterContainer = yearFilterControl?.closest(
      ".resource-dashboard-control",
    );
    const semesterFilterContainer = semesterFilterControl?.closest(
      ".resource-dashboard-control",
    );
    if (yearFilterContainer)
      yearFilterContainer.hidden = !hasTermFilter && !showCategoryFilter;
    if (semesterFilterContainer)
      semesterFilterContainer.hidden = !hasTermFilter && !showCategoryFilter;
    if (filterContainer)
      filterContainer.hidden = !showCategoryFilter && !hasTermFilter;
    const populateTermOptions = (
      control,
      values,
      selectedValue,
      fallbackValue,
      includeAll = false,
      disabled = false,
      fixedValues = [],
    ) => {
      if (!control) return selectedValue;
      const sortedValues = [...new Set([...fixedValues, ...values])].sort(
        (left, right) =>
          left.localeCompare(right, undefined, { numeric: true }),
      );
      const validSelection =
        selectedValue === "all" && includeAll
          ? selectedValue
          : values.has(selectedValue)
            ? selectedValue
            : values.has(fallbackValue)
              ? fallbackValue
              : includeAll
                ? "all"
                : [...values][0] || "";
      const options = sortedValues.map((value) => ({
        value,
        label: value,
      }));
      if (includeAll) options.unshift({ value: "all", label: "All" });
      const buttons = options.map(({ value, label }) => {
        const button = createResourceDashboardElement(
          "button",
          value === validSelection ? "is-active" : "",
          label,
        );
        button.type = "button";
        button.dataset.filterValue = value;
        button.setAttribute("aria-pressed", String(value === validSelection));
        button.disabled = disabled || (value !== "all" && !values.has(value));
        return button;
      });
      control.replaceChildren(...buttons);
      return validSelection;
    };
    const years = new Set([...termValues].map((term) => term.split(".")[0]));
    const orderedTerms = [...termValues].sort((left, right) => {
      const [leftYear, leftSemester] = left.split(".").map(Number);
      const [rightYear, rightSemester] = right.split(".").map(Number);
      return leftYear - rightYear || leftSemester - rightSemester;
    });
    const preferredTerm = "3.2";
    const [preferredYear, preferredSemester] = preferredTerm
      .split(".")
      .map(Number);
    const availablePreviousTerms = orderedTerms.filter((term) => {
      const [year, semester] = term.split(".").map(Number);
      return (
        year < preferredYear ||
        (year === preferredYear && semester <= preferredSemester)
      );
    });
    const nextAvailableTerm = orderedTerms.find((term) => {
      const [year, semester] = term.split(".").map(Number);
      return (
        year > preferredYear ||
        (year === preferredYear && semester > preferredSemester)
      );
    });
    const defaultTerm =
      (termValues.has(preferredTerm) ? preferredTerm : "") ||
      nextAvailableTerm ||
      availablePreviousTerms[availablePreviousTerms.length - 1] ||
      orderedTerms[0] ||
      "";
    const defaultYear = defaultTerm.split(".")[0] || "3";
    if (
      !termValues.has(preferredTerm) &&
      resourceDashboardSelectedYear === preferredYear.toString() &&
      resourceDashboardSelectedSemester === preferredSemester.toString() &&
      defaultTerm
    ) {
      resourceDashboardSelectedYear = defaultYear;
      resourceDashboardSelectedSemester = defaultTerm.split(".")[1];
    }
    resourceDashboardSelectedYear = populateTermOptions(
      yearFilterControl,
      years,
      resourceDashboardSelectedYear,
      defaultYear,
      true,
      false,
      ["1", "2", "3"],
    );
    const allYearLevelsSelected = resourceDashboardSelectedYear === "all";
    if (allYearLevelsSelected) {
      resourceDashboardSelectedSemester = "all";
      populateTermOptions(
        semesterFilterControl,
        new Set(),
        "all",
        "all",
        true,
        true,
        ["1", "2"],
      );
    } else {
      const semesters = new Set(
        [...termValues]
          .filter(
            (term) => term.split(".")[0] === resourceDashboardSelectedYear,
          )
          .map((term) => term.split(".")[1]),
      );
      const orderedSemesters = [...semesters].sort(
        (left, right) => Number(left) - Number(right),
      );
      const previousSemesters = orderedSemesters.filter(
        (semester) => Number(semester) <= preferredSemester,
      );
      const fallbackSemester =
        previousSemesters[previousSemesters.length - 1] ||
        orderedSemesters[0] ||
        "all";
      resourceDashboardSelectedSemester = populateTermOptions(
        semesterFilterControl,
        semesters,
        resourceDashboardSelectedSemester,
        fallbackSemester,
        true,
        false,
        ["1", "2"],
      );
    }

    const selectedPhaseColumnIndex =
      !hasCategoryFilter || resourceDashboardSelectedCategory === "all"
        ? -1
        : phaseColumnIndexes[resourceDashboardSelectedCategory];
    const visibleRows = nonEmptyRows.filter(({ values, rowIndex }) => {
      if (hasCategoryFilter && resourceDashboardSelectedCategory !== "all") {
        if (selectedPhaseColumnIndex === undefined) return false;
        const phaseValue = String(
          values[selectedPhaseColumnIndex] ?? "",
        ).trim();
        const phaseLink = String(
          tab.links?.[rowIndex]?.[selectedPhaseColumnIndex] || phaseValue,
        );
        if (!phaseValue && !isResourceDashboardLink(phaseLink)) return false;
      }
      if (!hasTermFilter || resourceDashboardSelectedYear === "all")
        return true;
      const yearValue = String(values[yearColumnIndex] || "").trim();
      const combinedTerm = /^(\d+)\s*[./-]\s*(\d+)$/.exec(yearValue);
      const year = combinedTerm ? combinedTerm[1] : yearValue;
      const semester = combinedTerm
        ? combinedTerm[2]
        : semesterColumnIndex >= 0
          ? String(values[semesterColumnIndex] || "").trim()
          : "";
      return (
        year === resourceDashboardSelectedYear &&
        (resourceDashboardSelectedSemester === "all" ||
          semester === resourceDashboardSelectedSemester)
      );
    });
    const populatedColumnIndices = tab.columns
      .map((_, columnIndex) => columnIndex)
      .filter((columnIndex) =>
        visibleRows.some(({ values, rowIndex }) =>
          hasCellValue(values, rowIndex, columnIndex),
        ),
      );
    const categoryColumnIndices =
      hasCategoryFilter && resourceDashboardSelectedCategory !== "all"
        ? populatedColumnIndices.filter(
            (columnIndex) =>
              !Object.values(phaseColumnIndexes).includes(columnIndex) ||
              columnIndex === selectedPhaseColumnIndex,
          )
        : populatedColumnIndices;
    const visibleColumnIndices = categoryColumnIndices.filter(
      (columnIndex) => columnIndex !== yearColumnIndex,
    );

    tableHead.replaceChildren();
    tableBody.replaceChildren();
    const headerRow = document.createElement("tr");
    visibleColumnIndices.forEach((columnIndex) => {
      const column = tab.columns[columnIndex];
      const header = document.createElement("th");
      const columnName = String(column).trim().toLowerCase();
      if (columnName === "course" || columnName === "year") {
        header.classList.add(`resource-dashboard-column-${columnName}`);
      }
      header.textContent = getResourceDashboardColumnHeading(column);
      headerRow.appendChild(header);
    });
    if (populatedColumnIndices.length) tableHead.appendChild(headerRow);

    visibleRows.forEach(({ values, rowIndex }) => {
      const row = document.createElement("tr");
      visibleColumnIndices.forEach((index) => {
        const column = tab.columns[index];
        const cell = document.createElement("td");
        const columnName = String(column).trim().toLowerCase();
        if (columnName === "course" || columnName === "year") {
          cell.classList.add(`resource-dashboard-column-${columnName}`);
        }
        const value = String(values[index] || "");
        const linkUrl = String(tab.links?.[rowIndex]?.[index] || value);
        if (isResourceDashboardLink(linkUrl)) {
          cell.classList.add("resource-dashboard-link-cell");
          const fileTitle = String(
            tab.linkTitles?.[rowIndex]?.[index] || "",
          ).trim();
          const titleInParentheses = /\(([^()]*)\)/.exec(fileTitle);
          const resourceTitle = String(
            titleInParentheses ? titleInParentheses[1] : fileTitle,
          ).trim();
          const isModuleFolderFallback =
            resourceDashboardActiveTab === "MODULES" &&
            (!titleInParentheses || !resourceTitle);
          const isSyllabus = columnName.includes("syllabus");
          const isPdfResource =
            !isModuleFolderFallback &&
            (isSyllabus || /\.pdf\b/i.test(fileTitle));
          const linkLabel = isSyllabus
            ? "PDF"
            : isModuleFolderFallback
              ? "Folder"
              : resourceTitle.replace(/\.pdf$/i, "") || "Open resource";
          const icon = createResourceDashboardElement(
            "i",
            `fa-solid ${
              isPdfResource ? "fa-file-pdf" : "fa-folder"
            } resource-dashboard-link-icon`,
          );
          icon.setAttribute("aria-hidden", "true");
          const link = createResourceDashboardElement(
            "a",
            "resource-dashboard-link-button",
          );
          link.href = linkUrl;
          link.append(
            icon,
            createResourceDashboardElement(
              "span",
              "resource-dashboard-link-label",
              linkLabel,
            ),
          );
          if (resourceTitle) link.title = isSyllabus ? "PDF" : resourceTitle;
          const resourceArea =
            resourceDashboardActiveTab === "MODULES"
              ? "MODULES"
              : resourceDashboardActiveTab;
          const fileId = getResourceDashboardFileId(linkUrl);
          if (fileId) {
            const fileName =
              resourceTitle ||
              fileTitle ||
              (isResourceDashboardLink(value) ? "" : value) ||
              linkLabel;
            link.addEventListener("click", () => {
              void logResourceFileClick(resourceArea, fileName, fileId);
            });
          }
          cell.appendChild(link);
        } else {
          cell.textContent = value;
          if (
            columnName === "course" &&
            [
              "GENERAL KNOWLEDGE",
              "BSMT COMPETENCIES",
              "REVIEW NOTES FOR DECK OFFICERS (BOOK)",
            ].includes(value.trim().toLocaleUpperCase())
          ) {
            const popularIcon = createResourceDashboardElement(
              "i",
              "fa-solid fa-fire resource-dashboard-popular-icon",
            );
            popularIcon.title = "Popular";
            popularIcon.setAttribute("role", "img");
            popularIcon.setAttribute("aria-label", "Popular");
            cell.append(" ", popularIcon);
          }
        }
        row.appendChild(cell);
      });
      tableBody.appendChild(row);
    });

    const selectedYearName = {
      1: "First",
      2: "Second",
      3: "Third",
    }[resourceDashboardSelectedYear];
    const selectedTerm =
      resourceDashboardSelectedYear === "all"
        ? "All Year Levels"
        : resourceDashboardSelectedSemester === "all"
          ? selectedYearName
            ? `${selectedYearName} Year`
            : `Year Level ${resourceDashboardSelectedYear} (all semesters)`
          : `Year Level ${resourceDashboardSelectedYear}.${resourceDashboardSelectedSemester}`;
    if (resourceDashboardActiveTab === "REVIEWERS" && !visibleRows.length) {
      status.textContent = nonEmptyRows.length
        ? "No reviewer resources match the selected filters."
        : "No reviewer resources are currently available.";
    } else {
      status.textContent = hasTermFilter
        ? `Showing ${visibleRows.length} of ${nonEmptyRows.length} rows for ${selectedTerm}.${
            tab.truncated ? " (first 2,000 loaded)" : ""
          }`
        : `${nonEmptyRows.length} ${
            nonEmptyRows.length === 1 ? "row" : "rows"
          }${tab.truncated ? " (showing the first 2,000)" : ""}`;
    }
    status.removeAttribute("aria-busy");
    status.classList?.remove("resource-dashboard-status-stacked");
    return true;
  }

  function createResourceDashboardElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function isResourceDashboardVisible() {
    const view = document.getElementById("view-resources");
    return (
      document.visibilityState !== "hidden" &&
      Boolean(view?.classList.contains("active"))
    );
  }

  function refreshResourceDashboardIfNeeded() {
    if (!isResourceDashboardVisible()) return false;
    if (
      Date.now() - resourceDashboardLastRefreshAt <
      RESOURCE_DASHBOARD_AUTO_REFRESH_INTERVAL_MS
    )
      return false;
    resourceDashboardLastRefreshAt = Date.now();
    void loadResourceDashboard({ silent: true });
    return true;
  }

  function initializeResourceDashboardAutoRefresh() {
    if (resourceDashboardAutoRefreshTimer === null)
      resourceDashboardAutoRefreshTimer = globalScope.setInterval(
        refreshResourceDashboardIfNeeded,
        RESOURCE_DASHBOARD_AUTO_REFRESH_INTERVAL_MS,
      );
    if (resourceDashboardAutoRefreshEventsInstalled) return;
    document.addEventListener(
      "visibilitychange",
      refreshResourceDashboardIfNeeded,
    );
    globalScope.addEventListener("pageshow", refreshResourceDashboardIfNeeded);
    globalScope.addEventListener("focus", refreshResourceDashboardIfNeeded);
    resourceDashboardAutoRefreshEventsInstalled = true;
  }

  function initializeResourceDashboardControls() {
    initializeResourceDashboardAutoRefresh();
    const yearFilterControl = document.getElementById(
      "resource-dashboard-filter-year",
    );
    const semesterFilterControl = document.getElementById(
      "resource-dashboard-filter-semester",
    );
    const categoryFilterControl = document.getElementById(
      "resource-dashboard-filter-category",
    );
    if (yearFilterControl && !yearFilterControl.dataset.initialized) {
      yearFilterControl.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-filter-value]");
        if (!button || button.disabled || !yearFilterControl.contains(button))
          return;
        resourceDashboardSelectedYear = button.dataset.filterValue;
        if (resourceDashboardSelectedYear === "all")
          resourceDashboardSelectedSemester = "all";
        if (resourceDashboardData) renderResourceDashboardTab();
      });
      yearFilterControl.dataset.initialized = "true";
    }
    if (semesterFilterControl && !semesterFilterControl.dataset.initialized) {
      semesterFilterControl.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-filter-value]");
        if (
          !button ||
          button.disabled ||
          !semesterFilterControl.contains(button)
        )
          return;
        resourceDashboardSelectedSemester = button.dataset.filterValue;
        if (resourceDashboardData) renderResourceDashboardTab();
      });
      semesterFilterControl.dataset.initialized = "true";
    }
    if (categoryFilterControl && !categoryFilterControl.dataset.initialized) {
      categoryFilterControl
        .querySelectorAll("[data-category]")
        .forEach((button) => {
          button.addEventListener("click", () => {
            resourceDashboardSelectedCategory = button.dataset.category;
            if (resourceDashboardData) renderResourceDashboardTab();
          });
        });
      categoryFilterControl.dataset.initialized = "true";
    }
    const signoutButton = document.getElementById("resource-reviewer-signout");
    if (signoutButton && !signoutButton.dataset.initialized) {
      signoutButton.addEventListener("click", signOutReviewer);
      signoutButton.dataset.initialized = "true";
    }
    const cancelEditButton = document.getElementById(
      "resource-reviewer-cancel-edit",
    );
    if (cancelEditButton && !cancelEditButton.dataset.initialized) {
      cancelEditButton.addEventListener("click", closeReviewerProfileEditor);
      cancelEditButton.dataset.initialized = "true";
    }
  }

  function capitalizeReviewerName(value) {
    return String(value || "").toLocaleUpperCase();
  }

  function normalizeReviewerIdentityText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]/gu, "");
  }

  function reviewerEmailMatchesName(email, firstName, middleInitial, lastName) {
    const localPart = normalizeReviewerIdentityText(
      String(email || "").split("@")[0],
    );
    const nameParts = [firstName, middleInitial, lastName]
      .map(normalizeReviewerIdentityText)
      .filter((part) => part.length >= 3);
    if (nameParts.some((part) => localPart.includes(part))) return true;
    const initials = [firstName, middleInitial, lastName]
      .map(normalizeReviewerIdentityText)
      .filter(Boolean)
      .map((part) => part[0])
      .join("");
    return initials.length >= 2 && localPart.includes(initials);
  }

  function normalizeReviewerNameInput(input) {
    const selectionStart = input.selectionStart;
    const selectionEnd = input.selectionEnd;
    const normalized = capitalizeReviewerName(input.value);
    if (normalized === input.value) return;
    input.value = normalized;
    if (typeof selectionStart === "number" && typeof selectionEnd === "number")
      input.setSelectionRange(selectionStart, selectionEnd);
  }

  function normalizeReviewerMiddleInitialInput(input, event) {
    const normalized = input.value.toLocaleUpperCase().replace(/[^A-Z.]/g, "");
    const letters = normalized.replace(/\./g, "");
    input.value =
      letters.length === 1 && !event?.inputType?.startsWith("delete")
        ? `${letters}.`
        : normalized;
  }

  function initializeReviewerEnrollmentInputs() {
    [
      document.getElementById("resource-reviewer-last-name"),
      document.getElementById("resource-reviewer-first-name"),
    ].forEach((input) => {
      if (!input || input.dataset.nameCapitalizationInitialized) return;
      input.addEventListener("input", () => normalizeReviewerNameInput(input));
      input.dataset.nameCapitalizationInitialized = "true";
    });
    const middleInitialInput = document.getElementById(
      "resource-reviewer-middle-initial",
    );
    if (
      middleInitialInput &&
      !middleInitialInput.dataset.middleInitialInitialized
    ) {
      middleInitialInput.addEventListener("input", (event) =>
        normalizeReviewerMiddleInitialInput(middleInitialInput, event),
      );
      middleInitialInput.dataset.middleInitialInitialized = "true";
    }
  }

  function openReviewerProfileEditor() {
    const form = document.getElementById("resource-reviewer-enrollment-form");
    const cancelButton = document.getElementById(
      "resource-reviewer-cancel-edit",
    );
    const submitButton = form?.querySelector('button[type="submit"]');
    if (!form) return;
    reviewerProfileEditing = true;
    form.hidden = false;
    const profileDetails = document.getElementById(
      "resource-profile-account-details",
    );
    if (profileDetails) profileDetails.hidden = true;
    if (cancelButton) cancelButton.hidden = false;
    if (submitButton) submitButton.textContent = "Save changes for approval";
    document.getElementById("resource-reviewer-first-name")?.focus();
  }

  function closeReviewerProfileEditor() {
    const form = document.getElementById("resource-reviewer-enrollment-form");
    const cancelButton = document.getElementById(
      "resource-reviewer-cancel-edit",
    );
    const submitButton = form?.querySelector('button[type="submit"]');
    if (!form) return;
    reviewerProfileEditing = false;
    form.hidden = true;
    const profileDetails = document.getElementById(
      "resource-profile-account-details",
    );
    if (profileDetails) profileDetails.hidden = false;
    if (cancelButton) cancelButton.hidden = true;
    if (submitButton)
      submitButton.textContent = "Submit for administrator review";
    form.querySelectorAll("input").forEach((input) => {
      input.value = input.dataset.savedValue || "";
    });
  }

  async function initializeReviewerAuth() {
    initializeReviewerEnrollmentInputs();
    if (reviewerAuthConfigPromise) return reviewerAuthConfigPromise;
    installReviewerSignOutStorageListener();
    if (
      !reviewerSessionId &&
      !reviewerSessionRestorePending &&
      !hasExplicitReviewerSignOut() &&
      getStoredReviewerSessionId()
    )
      void restoreReviewerSession();
    reviewerAuthCheckPending =
      !hasExplicitReviewerSignOut() && !getStoredReviewerSessionId();
    reviewerAuthConfigPromise = (async () => {
      const authStatus = document.getElementById(
        "resource-reviewer-auth-status",
      );
      if (reviewerAuthCheckPending) setReviewerNavigationBusy(true);
      const signInButton = document.getElementById(
        "resource-reviewer-signin-button",
      );
      const retryButton = document.getElementById(
        "resource-reviewer-retry-verification",
      );
      if (retryButton && !retryButton.dataset.initialized) {
        retryButton.addEventListener("click", () => {
          if (reviewerVerificationInFlightToken) return;
          if (reviewerVerificationRetryToken) {
            void completeReviewerSignIn(reviewerVerificationRetryToken);
            return;
          }
          void restoreReviewerSession();
        });
        retryButton.dataset.initialized = "true";
      }
      const enrollmentForm = document.getElementById(
        "resource-reviewer-enrollment-form",
      );
      if (enrollmentForm && !enrollmentForm.dataset.initialized) {
        enrollmentForm.addEventListener("submit", requestReviewerEnrollment);
        enrollmentForm.dataset.initialized = "true";
      }
      const reviewersNav = document.getElementById(
        "resource-dashboard-reviewers-nav",
      );
      try {
        const response = await globalScope.AppNetwork.callBackend(
          { type: "get_reviewer_auth_config" },
          { timeoutMs: 15000, maxRetries: 0 },
        );
        if (
          response?.status !== "success" ||
          typeof response.enabled !== "boolean" ||
          typeof response.clientId !== "string"
        ) {
          throw new Error(
            "The reviewer sign-in service returned invalid configuration.",
          );
        }
        reviewerAuthConfig = response;
        if (!reviewerAuthConfig.enabled) {
          reviewerAuthCheckPending = false;
          setReviewerNavigationBusy(false);
          if (authStatus)
            authStatus.textContent =
              "Reviewer sign-in is not configured. Contact the site administrator.";
          authStatus?.removeAttribute("aria-busy");
          if (resourceDashboardActiveTab === "REVIEWERS")
            setResourceDashboardStatus(
              "Reviewer sign-in is not configured. Contact the site administrator.",
            );
          return false;
        }
        if (!reviewerAuthConfig.clientId) {
          throw new Error("The reviewer sign-in client ID is missing.");
        }

        if (!globalScope.google?.accounts?.id) {
          await new Promise((resolve, reject) => {
            const script = document.createElement("script");
            script.src = "https://accounts.google.com/gsi/client?hl=en";
            script.async = true;
            script.defer = true;
            script.onload = resolve;
            script.onerror = () =>
              reject(new Error("Unable to load Google sign-in."));
            document.head.appendChild(script);
          });
        }
        if (!globalScope.google?.accounts?.id)
          throw new Error("Google sign-in did not initialize.");

        globalScope.google.accounts.id.initialize({
          client_id: reviewerAuthConfig.clientId,
          callback: (credentialResponse) => {
            const credential =
              typeof credentialResponse?.credential === "string"
                ? credentialResponse.credential.trim()
                : "";
            reviewerAuthCheckPending = false;
            setReviewerNavigationBusy(false);
            if (!credential) {
              void completeReviewerSignIn("");
              return;
            }
            try {
              setExplicitReviewerSignOut(false);
            } catch (error) {
              (globalScope.DebugUtils || console).error(
                "Unable to clear the explicit reviewer sign-out preference.",
                error,
              );
            }
            void completeReviewerSignIn(credential);
          },
          auto_select: !hasExplicitReviewerSignOut(),
          button_auto_select: !hasExplicitReviewerSignOut(),
          cancel_on_tap_outside: true,
          use_fedcm_for_prompt: true,
          use_fedcm_for_button: true,
          itp_support: true,
        });
        if (signInButton) {
          let renderedButtonLayout = "";
          const renderResponsiveSignInButton = () => {
            const width = Math.max(
              120,
              Math.min(280, Math.floor(signInButton.clientWidth || 280)),
            );
            const buttonText = width < 187 ? "signin" : "signin_with";
            const layout = `${width}:${buttonText}`;
            if (layout === renderedButtonLayout) return;
            signInButton.replaceChildren();
            globalScope.google.accounts.id.renderButton(signInButton, {
              type: "standard",
              theme: "filled_blue",
              size: "large",
              text: buttonText,
              shape: "rectangular",
              logo_alignment: "left",
              width,
              locale: "en",
            });
            renderedButtonLayout = layout;
          };
          renderResponsiveSignInButton();
          if (reviewerSignInButtonResizeHandler)
            globalScope.removeEventListener(
              "resize",
              reviewerSignInButtonResizeHandler,
            );
          reviewerSignInButtonResizeHandler = renderResponsiveSignInButton;
          globalScope.addEventListener(
            "resize",
            reviewerSignInButtonResizeHandler,
          );
          if (typeof globalScope.ResizeObserver === "function") {
            reviewerSignInButtonResizeObserver?.disconnect();
            reviewerSignInButtonResizeObserver = new globalScope.ResizeObserver(
              renderResponsiveSignInButton,
            );
            reviewerSignInButtonResizeObserver.observe(signInButton);
          }
        }
        if (
          !reviewerSessionRestorePending &&
          !reviewerSessionId &&
          !reviewerPendingEnrollmentSessionId
        )
          setReviewerAuthStatus(
            "Use Google to sign in and request access.",
          );
        reviewerAuthCheckPending =
          !hasExplicitReviewerSignOut() && !getStoredReviewerSessionId();
        if (reviewerAuthCheckPending) {
          authStatus?.removeAttribute("aria-busy");
          setReviewerNavigationBusy(true);
          globalScope.google.accounts.id.prompt((notification) => {
            const promptFinished =
              notification?.isNotDisplayed?.() ||
              notification?.isSkippedMoment?.() ||
              notification?.isDismissedMoment?.();
            if (!promptFinished) return;
            reviewerAuthCheckPending = false;
            setReviewerNavigationBusy(
              Boolean(
                reviewerPendingEnrollmentSessionId ||
                reviewerSessionId ||
                reviewerSessionRestorePending,
              ),
            );
            authStatus?.removeAttribute("aria-busy");
            if (
              !reviewerSessionId &&
              !reviewerPendingEnrollmentSessionId &&
              resourceDashboardActiveTab === "PROFILE"
            )
              setReviewerAuthStatus(
                "Use Google to sign in and request access.",
              );
            if (
              !reviewerSessionId &&
              !reviewerPendingEnrollmentSessionId &&
              resourceDashboardActiveTab === "REVIEWERS"
            )
              setResourceDashboardStatus("");
          });
        } else {
          setReviewerNavigationBusy(
            Boolean(reviewerSessionRestorePending || reviewerSessionId),
          );
          if (!reviewerSessionRestorePending)
            authStatus?.removeAttribute("aria-busy");
        }
        return true;
      } catch (error) {
        reviewerAuthCheckPending = false;
        setReviewerNavigationBusy(false);
        reviewerAuthConfigPromise = null;
        authStatus?.removeAttribute("aria-busy");
        if (authStatus)
          authStatus.textContent = `Google sign-in is unavailable: ${String(
            error?.message || error,
          )}`;
        (globalScope.DebugUtils || console).error(
          "Unable to initialize reviewer sign-in.",
          error,
        );
        if (resourceDashboardActiveTab === "REVIEWERS")
          renderResourceDashboardTab();
        return false;
      }
    })();
    return reviewerAuthConfigPromise;
  }

  function stopReviewerStatusPolling() {
    if (reviewerStatusPollTimer !== null) {
      globalScope.clearTimeout(reviewerStatusPollTimer);
      reviewerStatusPollTimer = null;
    }
  }

  async function restoreReviewerSession(requestedSessionId = "") {
    if (reviewerSessionRestorePromise) return reviewerSessionRestorePromise;
    if (hasExplicitReviewerSignOut()) return false;
    const sessionId = requestedSessionId || getStoredReviewerSessionId();
    if (!sessionId) return false;
    if (reviewerSessionId === sessionId) return true;

    installReviewerSignOutStorageListener();
    const authGeneration = reviewerAuthGeneration;
    reviewerSessionRestorePending = true;
    reviewerAuthCheckPending = false;
    setReviewerNavigationBusy(true);
    const signInButton = document.getElementById(
      "resource-reviewer-signin-button",
    );
    if (signInButton) signInButton.hidden = true;
    const authStatus = document.getElementById("resource-reviewer-auth-status");
    authStatus?.removeAttribute("aria-busy");
    if (resourceDashboardActiveTab === "REVIEWERS")
      showReviewerDashboardLoading(true);

    const restorePromise = (async () => {
      try {
        const response = await globalScope.AppNetwork.callBackend(
          { type: "restore_reviewer_session", sessionId },
          { timeoutMs: 15000, maxRetries: 0 },
        );
        if (authGeneration !== reviewerAuthGeneration) return false;
        applyReviewerAccountStatus(response, sessionId);
        scheduleReviewerStatusPolling(sessionId);
        if (
          response.accountStatus === "TRUE" &&
          resourceDashboardActiveTab === "REVIEWERS"
        )
          void loadReviewerDashboard();
        return true;
      } catch (error) {
        if (authGeneration !== reviewerAuthGeneration) return false;
        if (isDefinitivelyInvalidReviewerCredential(error)) {
          signOutReviewer(false);
          if (authStatus)
            authStatus.textContent =
              "Your saved reviewer session expired or was revoked. Sign in with Google again.";
          if (resourceDashboardActiveTab !== "PROFILE")
            openResourceDashboardTab("PROFILE");
        } else {
          const signInButton = document.getElementById(
            "resource-reviewer-signin-button",
          );
          if (signInButton) signInButton.hidden = false;
          if (authStatus)
            authStatus.textContent =
              "Unable to verify your saved reviewer session right now. It has been kept; retry when online.";
          const retryButton = document.getElementById(
            "resource-reviewer-retry-verification",
          );
          if (retryButton) retryButton.hidden = false;
          if (resourceDashboardActiveTab === "REVIEWERS")
            setReviewerDashboardFiltersDisabled(false);
          (globalScope.DebugUtils || console).error(
            "Unable to restore the saved reviewer session.",
            error,
          );
        }
        return false;
      } finally {
        if (authGeneration === reviewerAuthGeneration) {
          reviewerSessionRestorePending = false;
          setReviewerNavigationBusy(
            Boolean(reviewerSessionId || reviewerPendingEnrollmentSessionId),
          );
          authStatus?.removeAttribute("aria-busy");
          if (
            !reviewerSessionId &&
            resourceDashboardActiveTab === "REVIEWERS"
          )
            renderResourceDashboardTab();
        }
      }
    })();
    reviewerSessionRestorePromise = restorePromise;
    try {
      return await restorePromise;
    } finally {
      if (reviewerSessionRestorePromise === restorePromise)
        reviewerSessionRestorePromise = null;
    }
  }

  function setReviewerAccessEnabled(enabled) {
    const reviewersNav = document.getElementById(
      "resource-dashboard-reviewers-nav",
    );
    if (reviewersNav) {
      reviewersNav.disabled = !enabled;
      if (enabled) reviewersNav.removeAttribute("aria-disabled");
      else reviewersNav.setAttribute("aria-disabled", "true");
      reviewersNav.title = enabled
        ? "Open reviewer resources"
        : reviewerAccountStatus === "DENIED"
          ? "Reviewer access denied"
          : reviewerAccountStatus === "FALSE"
            ? "Reviewer access pending"
            : "Reviewer access not granted";
    }
  }

  function clearReviewerResourceRows() {
    reviewerDashboardRequestGeneration += 1;
    reviewerDashboardRequestPromise = null;
    reviewerDashboardLoadedForEmail = "";
    setReviewerNavigationBusy(false);
    if (resourceDashboardData) {
      resourceDashboardData.REVIEWERS = {
        columns: [],
        rows: [],
        links: [],
        linkTitles: [],
        linkTypes: [],
        truncated: false,
      };
    }
    if (resourceDashboardActiveTab === "REVIEWERS") {
      document
        .getElementById("resource-dashboard-table-head")
        ?.replaceChildren();
      document
        .getElementById("resource-dashboard-table-body")
        ?.replaceChildren();
      setResourceDashboardStatus("");
    }
  }

  function populateReviewerProfile(response) {
    const email = String(response.email || "");
    const profileDetails = document.getElementById(
      "resource-profile-account-details",
    );
    const profileName = document.getElementById("resource-profile-name");
    const profileEmail = document.getElementById("resource-profile-email");
    const profilePicture = document.getElementById("resource-profile-picture");
    const profilePictureFallback = document.getElementById(
      "resource-profile-avatar-fallback",
    );
    const headerProfilePicture = document.getElementById(
      "resource-dashboard-profile-picture",
    );
    const headerProfileIcon = document.querySelector(
      "#resource-dashboard-profile-nav > i",
    );
    const displayName = [
      response.firstName,
      response.middleInitial,
      response.lastName,
    ]
      .filter(Boolean)
      .join(" ");
    if (profileName) profileName.textContent = displayName || email;
    if (profileEmail) profileEmail.textContent = email;
    if (profileDetails)
      profileDetails.hidden =
        reviewerProfileEditing || response.accountStatus === "NOT_FOUND";
    renderReviewerProfileAccessStatus(response.accountStatus);
    const pictureUrl = getReviewerProfilePictureUrl(response.picture);
    reviewerProfilePictureUrl = pictureUrl;
    [profilePicture, headerProfilePicture].forEach((image) => {
      if (!image) return;
      image.onerror = () => {
        image.hidden = true;
        image.removeAttribute("src");
        if (image === profilePicture && profilePictureFallback)
          profilePictureFallback.hidden = false;
        if (image === headerProfilePicture && headerProfileIcon)
          headerProfileIcon.hidden = false;
      };
      image.hidden = !pictureUrl;
      if (pictureUrl) image.src = pictureUrl;
      else image.removeAttribute("src");
    });
    if (profilePictureFallback)
      profilePictureFallback.hidden = Boolean(pictureUrl);
    if (headerProfileIcon) headerProfileIcon.hidden = Boolean(pictureUrl);
  }

  function renderReviewerProfileAccessStatus(accountStatus) {
    const status = document.getElementById("resource-profile-access-status");
    if (!status) return;
    const statusPresentation = {
      TRUE: {
        label: "ACCESS GRANTED",
        className: "is-granted",
        icon: "fa-check",
      },
      FALSE: {
        label: "ACCESS PENDING",
        className: "is-pending",
        icon: "fa-triangle-exclamation",
      },
      DENIED: {
        label: "ACCESS DENIED",
        className: "is-denied",
        icon: "fa-xmark",
      },
    }[accountStatus];
    status.className =
      `resource-profile-access-status ${statusPresentation?.className || ""}`.trim();
    status.replaceChildren();
    if (!statusPresentation) {
      status.hidden = true;
      return;
    }
    const icon = document.createElement("i");
    icon.className = `fa-solid ${statusPresentation.icon}`;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = statusPresentation.label;
    status.append(icon, label);
    status.hidden = false;
  }

  function applyReviewerAccountStatus(
    response,
    sessionId,
    preserveProfileEditor = false,
  ) {
    if (
      response?.status !== "success" ||
      typeof response.email !== "string" ||
      !response.email.trim() ||
      !["TRUE", "FALSE", "DENIED", "NOT_FOUND"].includes(response.accountStatus)
    ) {
      throw new Error(
        "The reviewer approval service returned invalid account status.",
      );
    }
    const accountStatus = response.accountStatus;
    reviewerAccountStatus = accountStatus;
    cacheReviewerProfile(response);
    const authStatus = document.getElementById("resource-reviewer-auth-status");
    authStatus?.removeAttribute("aria-busy");
    const form = document.getElementById("resource-reviewer-enrollment-form");
    const profileDetails = document.getElementById(
      "resource-profile-account-details",
    );
    const formButton = form?.querySelector('button[type="submit"]');
    const cancelEditButton = document.getElementById(
      "resource-reviewer-cancel-edit",
    );
    const signInButton = document.getElementById(
      "resource-reviewer-signin-button",
    );
    const retryButton = document.getElementById(
      "resource-reviewer-retry-verification",
    );
    const signoutButton = document.getElementById("resource-reviewer-signout");
    const inputs = {
      lastName: document.getElementById("resource-reviewer-last-name"),
      firstName: document.getElementById("resource-reviewer-first-name"),
      middleInitial: document.getElementById(
        "resource-reviewer-middle-initial",
      ),
    };
    const keepProfileEditorOpen =
      preserveProfileEditor && reviewerProfileEditing;
    const preserveEnrollmentDraft =
      keepProfileEditorOpen ||
      (form &&
        !form.hidden &&
        Object.values(inputs).some(
          (input) =>
            input &&
            input.dataset.savedValue !== undefined &&
            input.value !== input.dataset.savedValue,
        ));
    reviewerAuthorizedEmail = response.email;
    if (!reviewerVerificationRetryToken)
      reviewerVerificationRetryAvailable = false;
    reviewerReauthenticationPromptAttempted = false;
    if (retryButton && !reviewerVerificationRetryToken)
      retryButton.hidden = true;
    reviewerProfilePictureUrl = getReviewerProfilePictureUrl(response.picture);
    if (accountStatus === "TRUE") {
      reviewerSessionId = sessionId;
      reviewerPendingEnrollmentSessionId = "";
    } else {
      reviewerSessionId = "";
      reviewerPendingEnrollmentSessionId = sessionId;
      clearReviewerResourceRows();
    }
    populateReviewerProfile(response);
    setReviewerAccessEnabled(accountStatus === "TRUE");
    if (signInButton) signInButton.hidden = true;
    if (signoutButton) signoutButton.hidden = false;
    if (keepProfileEditorOpen) {
      if (form) form.hidden = false;
      if (profileDetails) profileDetails.hidden = true;
      if (cancelEditButton) cancelEditButton.hidden = false;
      if (formButton) formButton.textContent = "Save changes for approval";
    } else {
      reviewerProfileEditing = false;
      if (profileDetails) profileDetails.hidden = accountStatus === "NOT_FOUND";
      if (form)
        form.hidden = !(
          accountStatus === "NOT_FOUND" || accountStatus === "DENIED"
        );
      if (cancelEditButton) cancelEditButton.hidden = true;
      if (formButton)
        formButton.textContent =
          accountStatus === "DENIED"
            ? "Correct details and submit"
            : response.profileUpdated
              ? "Save changes for approval"
              : "Submit for administrator review";
      if (!preserveEnrollmentDraft) {
        if (accountStatus === "NOT_FOUND") {
          Object.values(inputs).forEach((input) => {
            if (input) input.value = "";
          });
        } else {
          if (inputs.lastName) inputs.lastName.value = response.lastName || "";
          if (inputs.firstName)
            inputs.firstName.value = response.firstName || "";
          if (inputs.middleInitial)
            inputs.middleInitial.value = response.middleInitial || "";
        }
        Object.values(inputs).forEach((input) => {
          if (input) input.dataset.savedValue = input.value;
        });
      }
    }
    if (authStatus) authStatus.textContent = "";
    if (accountStatus !== "TRUE" && resourceDashboardActiveTab === "REVIEWERS")
      openResourceDashboardTab("PROFILE");
    return accountStatus === "TRUE";
  }

  function scheduleReviewerStatusPolling(sessionId) {
    stopReviewerStatusPolling();
    if (!sessionId) return;
    const authGeneration = reviewerAuthGeneration;
    reviewerStatusPollTimer = globalScope.setTimeout(async () => {
      reviewerStatusPollTimer = null;
      if (
        authGeneration !== reviewerAuthGeneration ||
        (sessionId !== reviewerPendingEnrollmentSessionId &&
          sessionId !== reviewerSessionId)
      )
        return;
      if (reviewerStatusPollInFlight) {
        scheduleReviewerStatusPolling(sessionId);
        return;
      }
      reviewerStatusPollInFlight = true;
      try {
        let response = await globalScope.AppNetwork.callBackend(
          { type: "get_reviewer_account_status", sessionId },
          { timeoutMs: 15000, maxRetries: 0 },
        );
        if (
          authGeneration !== reviewerAuthGeneration ||
          (sessionId !== reviewerPendingEnrollmentSessionId &&
            sessionId !== reviewerSessionId)
        )
          return;
        applyReviewerAccountStatus(response, sessionId, true);
      } catch (error) {
        if (authGeneration !== reviewerAuthGeneration) return;
        const authStatus = document.getElementById(
          "resource-reviewer-auth-status",
        );
        if (isDefinitivelyInvalidReviewerCredential(error)) {
          const retryCredential = reviewerVerificationRetryToken
            ? reviewerVerificationRetryToken
            : "";
          signOutReviewer(false);
          if (authStatus)
            authStatus.textContent = retryCredential
              ? "Your saved reviewer session expired. Retry verification of your new Google sign-in."
              : "Your reviewer session expired. Sign in with Google again to check reviewer approval.";
          if (retryCredential) {
            reviewerVerificationRetryToken = retryCredential;
            reviewerVerificationRetryAvailable = true;
            const retryButton = document.getElementById(
              "resource-reviewer-retry-verification",
            );
            if (retryButton) retryButton.hidden = false;
          } else {
            promptReviewerReauthentication();
          }
          return;
        }
        (globalScope.DebugUtils || console).error(
          "Unable to refresh reviewer account approval status.",
          error,
        );
      } finally {
        reviewerStatusPollInFlight = false;
        if (
          authGeneration === reviewerAuthGeneration &&
          (sessionId === reviewerPendingEnrollmentSessionId ||
            sessionId === reviewerSessionId)
        )
          scheduleReviewerStatusPolling(sessionId);
      }
    }, REVIEWER_STATUS_POLL_INTERVAL_MS);
  }

  async function completeReviewerSignIn(idToken) {
    const authStatus = document.getElementById("resource-reviewer-auth-status");
    if (!idToken) {
      setReviewerNavigationBusy(false);
      setReviewerAuthStatus("Use Google to sign in and request access.");
      return false;
    }
    if (reviewerVerificationInFlightToken === idToken) return false;
    const previousSessionId =
      reviewerSessionId || reviewerPendingEnrollmentSessionId;
    const authGeneration = ++reviewerAuthGeneration;
    reviewerAuthCheckPending = false;
    stopReviewerStatusPolling();
    reviewerVerificationRetryAvailable = false;
    reviewerVerificationRetryToken = idToken;
    reviewerVerificationInFlightToken = idToken;
    setReviewerNavigationBusy(true);
    setReviewerAuthStatus("Signing in...", true);
    const retryButton = document.getElementById(
      "resource-reviewer-retry-verification",
    );
    if (retryButton) {
      retryButton.hidden = true;
      retryButton.disabled = true;
    }
    try {
      const response = await globalScope.AppNetwork.callBackend(
        {
          type: "verify_reviewer_access",
          idToken,
          eventId: createResourceEventId(),
        },
        { timeoutMs: 30000, maxRetries: 0 },
      );
      if (
        authGeneration !== reviewerAuthGeneration ||
        reviewerVerificationInFlightToken !== idToken
      )
        return false;
      reviewerVerificationInFlightToken = "";
      if (retryButton) retryButton.disabled = false;
      const sessionId = String(response?.sessionId || "");
      if (!/^[a-f0-9]{96}$/.test(sessionId))
        throw new Error(
          "The reviewer sign-in service did not return a valid application session.",
        );
      saveReviewerSessionId(sessionId);
      if (reviewerVerificationRetryToken === idToken)
        reviewerVerificationRetryToken = "";
      const approved = applyReviewerAccountStatus(response, sessionId);
      scheduleReviewerStatusPolling(sessionId);
      if (approved) {
        if (resourceDashboardActiveTab === "REVIEWERS")
          await loadReviewerDashboard();
        else await openResourceDashboardTab("REVIEWERS");
      }
      return approved;
    } catch (error) {
      if (authGeneration !== reviewerAuthGeneration) return false;
      if (isDefinitivelyInvalidReviewerCredential(error)) {
        reviewerVerificationInFlightToken = "";
        if (previousSessionId) {
          reviewerVerificationRetryToken = "";
          reviewerVerificationRetryAvailable = false;
          if (retryButton) retryButton.hidden = true;
          if (authStatus)
            authStatus.textContent =
              "The new Google sign-in could not be verified. Your existing sign-in remains active.";
          scheduleReviewerStatusPolling(previousSessionId);
        } else {
          signOutReviewer(false);
          setReviewerAuthStatus(
            "Google sign-in expired or is no longer valid. Sign in with Google again.",
          );
          promptReviewerReauthentication();
        }
      } else {
        reviewerVerificationInFlightToken = "";
        reviewerVerificationRetryToken = idToken;
        reviewerVerificationRetryAvailable = true;
        setReviewerNavigationBusy(false);
        if (retryButton) {
          retryButton.hidden = false;
          retryButton.disabled = false;
        }
        setReviewerAuthStatus(
          "Google sign-in could not be verified right now. " +
            (previousSessionId ? "Your existing sign-in is retained; " : "") +
            "retry verification or use Google sign-in again.",
        );
        if (previousSessionId) scheduleReviewerStatusPolling(previousSessionId);
      }
      if (authGeneration === reviewerAuthGeneration)
        authStatus?.removeAttribute("aria-busy");
      (globalScope.DebugUtils || console).error(
        "Unable to verify reviewer account approval.",
        error,
      );
      return false;
    } finally {
      if (
        authGeneration === reviewerAuthGeneration &&
        reviewerVerificationInFlightToken === idToken
      ) {
        reviewerVerificationInFlightToken = "";
        if (retryButton) retryButton.disabled = false;
      }
      if (authGeneration === reviewerAuthGeneration)
        authStatus?.removeAttribute("aria-busy");
    }
  }

  async function requestReviewerEnrollment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const authStatus = document.getElementById("resource-reviewer-auth-status");
    const submitButton = form.querySelector('button[type="submit"]');
    const enrollmentSessionId =
      reviewerPendingEnrollmentSessionId || reviewerSessionId;
    if (!enrollmentSessionId) {
      if (authStatus)
        authStatus.textContent =
          "Sign in with Google before submitting your profile.";
      return false;
    }
    const lastNameInput = document.getElementById(
      "resource-reviewer-last-name",
    );
    const firstNameInput = document.getElementById(
      "resource-reviewer-first-name",
    );
    const middleInitialInput = document.getElementById(
      "resource-reviewer-middle-initial",
    );
    if (lastNameInput)
      lastNameInput.value = capitalizeReviewerName(lastNameInput.value).trim();
    if (firstNameInput)
      firstNameInput.value = capitalizeReviewerName(
        firstNameInput.value,
      ).trim();
    if (middleInitialInput)
      normalizeReviewerMiddleInitialInput(middleInitialInput);
    const lastName = String(lastNameInput?.value || "").trim();
    const firstName = String(firstNameInput?.value || "").trim();
    const middleInitial = String(middleInitialInput?.value || "").trim();
    if (!lastName || !firstName || !/^[A-Z]\.$/.test(middleInitial)) {
      if (authStatus)
        authStatus.textContent =
          !lastName || !firstName
            ? "Enter your last name and first name."
            : "Middle Initial must be exactly one letter followed by a period.";
      if (!lastName) lastNameInput?.focus();
      else if (!firstName) firstNameInput?.focus();
      else middleInitialInput?.focus();
      return false;
    }
    if (
      !reviewerEmailMatchesName(
        reviewerAuthorizedEmail,
        firstName,
        middleInitial,
        lastName,
      )
    ) {
      if (authStatus)
        authStatus.textContent =
          "The signed-in Google email does not appear to match this name. Use an email containing part of your first or last name, or matching initials.";
      return false;
    }
    const confirmed = await requestConfirmation(
      "False information will strictly not be entertained and will be ignored and deleted. Confirm that the name entered here is accurate and matches your verified Google account and email before submitting.",
      "Confirm Your Name",
    );
    if (!confirmed) return false;
    const authGeneration = ++reviewerAuthGeneration;
    stopReviewerStatusPolling();
    if (submitButton) submitButton.disabled = true;
    if (authStatus) {
      authStatus.textContent =
        "Submitting your profile for administrator review...";
      authStatus.setAttribute("aria-busy", "true");
    }
    try {
      const response = await globalScope.AppNetwork.callBackend(
        {
          type: "request_reviewer_enrollment",
          sessionId: enrollmentSessionId,
          eventId: createResourceEventId(),
          lastName,
          firstName,
          middleInitial,
        },
        { timeoutMs: 30000, maxRetries: 0 },
      );
      if (
        authGeneration !== reviewerAuthGeneration ||
        (enrollmentSessionId !== reviewerPendingEnrollmentSessionId &&
          enrollmentSessionId !== reviewerSessionId)
      )
        return false;
      if (
        response?.status !== "success" ||
        !["FALSE", "TRUE"].includes(response.accountStatus)
      )
        throw new Error(
          response?.message || "The profile request was not saved as pending.",
        );
      applyReviewerAccountStatus(
        {
          ...response,
          picture: reviewerProfilePictureUrl,
          profileUpdated:
            reviewerProfileEditing && response.accountStatus === "FALSE",
        },
        enrollmentSessionId,
      );
      scheduleReviewerStatusPolling(enrollmentSessionId);
      return true;
    } catch (error) {
      if (authGeneration !== reviewerAuthGeneration) return false;
      if (isDefinitivelyInvalidReviewerCredential(error)) {
        signOutReviewer(false);
        if (authStatus)
          authStatus.textContent =
            "Your reviewer session expired or was revoked. Sign in with Google again.";
        return false;
      }
      if (authStatus)
        authStatus.textContent =
          "Unable to submit account details: " +
          String(error?.message || error);
      (globalScope.DebugUtils || console).error(
        "Unable to submit reviewer account details.",
        error,
      );
      return false;
    } finally {
      if (submitButton) submitButton.disabled = false;
      authStatus?.removeAttribute("aria-busy");
      if (
        authGeneration === reviewerAuthGeneration &&
        (enrollmentSessionId === reviewerPendingEnrollmentSessionId ||
          enrollmentSessionId === reviewerSessionId)
      )
        scheduleReviewerStatusPolling(enrollmentSessionId);
    }
  }

  async function logModuleDashboardAccess() {
    if (!reviewerSessionId) return false;
    try {
      await globalScope.AppNetwork.callBackend(
        {
          type: "log_module_access",
          sessionId: reviewerSessionId,
          eventId: createResourceEventId(),
        },
        { timeoutMs: 15000, maxRetries: 0 },
      );
      return true;
    } catch (error) {
      if (isDefinitivelyInvalidReviewerCredential(error))
        signOutReviewer(false);
      const status = document.getElementById("resource-reviewer-auth-status");
      if (status)
        status.textContent = `Unable to record module access: ${String(
          error?.message || error,
        )}`;
      (globalScope.DebugUtils || console).error(
        "Unable to record module dashboard access.",
        error,
      );
      return false;
    }
  }

  function signOutReviewer(explicit = true, preserveStoredSession = false) {
    const sessionId =
      reviewerSessionId ||
      reviewerPendingEnrollmentSessionId ||
      (explicit ? getStoredReviewerSessionId() : "");
    if (explicit && sessionId) {
      void globalScope.AppNetwork.callBackend(
        { type: "sign_out_reviewer", sessionId },
        { timeoutMs: 15000, maxRetries: 0 },
      ).catch((error) => {
        const status = document.getElementById("resource-reviewer-auth-status");
        if (status)
          status.textContent =
            "The server could not revoke this session. Try signing out again while online.";
        (globalScope.DebugUtils || console).error(
          "Unable to revoke the reviewer session.",
          error,
        );
      });
    }
    reviewerAuthGeneration += 1;
    reviewerAuthCheckPending = false;
    reviewerSessionRestorePending = false;
    reviewerSessionRestorePromise = null;
    reviewerVerificationInFlightToken = "";
    reviewerVerificationRetryToken = "";
    reviewerVerificationRetryAvailable = false;
    if (explicit) reviewerReauthenticationPromptAttempted = false;
    if (explicit) {
      try {
        setExplicitReviewerSignOut(true);
      } catch (error) {
        (globalScope.DebugUtils || console).error(
          "Unable to save the explicit reviewer sign-out preference.",
          error,
        );
      }
    }
    reviewerSessionId = "";
    reviewerPendingEnrollmentSessionId = "";
    if (!preserveStoredSession) clearStoredReviewerSession();
    reviewerAuthorizedEmail = "";
    reviewerAccountStatus = "";
    reviewerDashboardLoadedForEmail = "";
    reviewerProfilePictureUrl = "";
    clearStoredReviewerProfile();
    setReviewerNavigationBusy(false);
    stopReviewerStatusPolling();
    reviewerDashboardRequestGeneration += 1;
    if (resourceDashboardData) {
      resourceDashboardData.REVIEWERS = {
        columns: [],
        rows: [],
        links: [],
        linkTitles: [],
        linkTypes: [],
        truncated: false,
      };
    }
    const reviewersNav = document.getElementById(
      "resource-dashboard-reviewers-nav",
    );
    if (reviewersNav) {
      reviewersNav.disabled = false;
      reviewersNav.removeAttribute("aria-disabled");
      reviewersNav.title = "Reviewer resources";
    }
    const signInButton = document.getElementById(
      "resource-reviewer-signin-button",
    );
    const signoutButton = document.getElementById("resource-reviewer-signout");
    const retryButton = document.getElementById(
      "resource-reviewer-retry-verification",
    );
    if (signInButton) signInButton.hidden = false;
    if (signoutButton) signoutButton.hidden = true;
    if (retryButton) {
      retryButton.hidden = true;
      retryButton.disabled = false;
    }
    const enrollmentForm = document.getElementById(
      "resource-reviewer-enrollment-form",
    );
    if (enrollmentForm) enrollmentForm.hidden = true;
    const profileDetails = document.getElementById(
      "resource-profile-account-details",
    );
    if (profileDetails) profileDetails.hidden = true;
    const profilePicture = document.getElementById("resource-profile-picture");
    const profilePictureFallback = document.getElementById(
      "resource-profile-avatar-fallback",
    );
    if (profilePicture) {
      profilePicture.hidden = true;
      profilePicture.removeAttribute("src");
    }
    if (profilePictureFallback) profilePictureFallback.hidden = false;
    const headerProfilePicture = document.getElementById(
      "resource-dashboard-profile-picture",
    );
    const headerProfileIcon = document.querySelector(
      "#resource-dashboard-profile-nav > i",
    );
    if (headerProfilePicture) {
      headerProfilePicture.hidden = true;
      headerProfilePicture.removeAttribute("src");
    }
    if (headerProfileIcon) headerProfileIcon.hidden = false;
    setReviewerAuthStatus("Use Google to sign in and request access.");
    document
      .getElementById("resource-portal-status")
      ?.removeAttribute("aria-busy");
    document
      .getElementById("resource-portal-status")
      ?.classList?.remove("resource-dashboard-status-stacked");
    if (resourceDashboardActiveTab === "REVIEWERS") {
      resourceDashboardActiveTab = "MODULES";
      renderResourceDashboardTab();
    }
    if (explicit) globalScope.google?.accounts?.id?.disableAutoSelect?.();
    return true;
  }

  async function loadReviewerDashboard({ refresh = false } = {}) {
    if (!reviewerSessionId) {
      if (
        reviewerPendingEnrollmentSessionId ||
        reviewerVerificationInFlightToken ||
        reviewerAuthCheckPending ||
        reviewerSessionRestorePending
      ) {
        showReviewerDashboardLoading();
        return true;
      }
      return false;
    }
    if (
      !refresh &&
      reviewerDashboardLoadedForEmail?.toLowerCase() ===
        reviewerAuthorizedEmail.toLowerCase() &&
      resourceDashboardData?.REVIEWERS
    ) {
      setReviewerNavigationBusy(false);
      renderResourceDashboardTab();
      return true;
    }
    if (reviewerDashboardRequestPromise) return true;
    const requestGeneration = ++reviewerDashboardRequestGeneration;
    const requestSessionId = reviewerSessionId;
    setReviewerNavigationBusy(true);
    const status = document.getElementById("resource-portal-status");
    const tableHead = document.getElementById("resource-dashboard-table-head");
    const tableBody = document.getElementById("resource-dashboard-table-body");
    if (!status || !tableHead || !tableBody) {
      setReviewerNavigationBusy(false);
      return false;
    }
    const hasExistingReviewerRows =
      reviewerDashboardLoadedForEmail?.toLowerCase() ===
        reviewerAuthorizedEmail.toLowerCase() &&
      Array.isArray(resourceDashboardData?.REVIEWERS?.columns) &&
      Array.isArray(resourceDashboardData?.REVIEWERS?.rows);
    const silentRefresh = refresh && hasExistingReviewerRows;
    if (resourceDashboardActiveTab === "REVIEWERS") {
      if (!silentRefresh)
        showReviewerDashboardLoading(!hasExistingReviewerRows);
    }
    let backendRequest = null;
    try {
      backendRequest = globalScope.AppNetwork.callBackend(
        {
          type: "get_reviewer_dashboard",
          sessionId: requestSessionId,
          eventId: createResourceEventId(),
        },
        { timeoutMs: 30000, maxRetries: 0 },
      );
      reviewerDashboardRequestPromise = backendRequest;
      const response = await backendRequest;
      if (
        requestGeneration !== reviewerDashboardRequestGeneration ||
        requestSessionId !== reviewerSessionId
      )
        return false;
      if (
        response?.status !== "success" ||
        typeof response.email !== "string" ||
        response.email.toLowerCase() !==
          reviewerAuthorizedEmail.toLowerCase() ||
        !Array.isArray(response.tab?.columns) ||
        !Array.isArray(response.tab?.rows) ||
        !response.tab.rows.every(Array.isArray)
      ) {
        throw new Error(
          response?.message ||
            "The reviewer dashboard returned invalid or unauthorized data.",
        );
      }
      resourceDashboardData = {
        ...(resourceDashboardData || {}),
        REVIEWERS: response.tab,
      };
      reviewerDashboardLoadedForEmail = reviewerAuthorizedEmail;
      renderResourceDashboardTab();
      return true;
    } catch (error) {
      if (
        requestGeneration !== reviewerDashboardRequestGeneration ||
        requestSessionId !== reviewerSessionId
      )
        return false;
      if (
        [
          "UNAUTHORIZED",
          "FORBIDDEN",
          "SESSION_EXPIRED",
          "SESSION_INVALID",
          "SESSION_REVOKED",
        ].includes(error?.code)
      ) {
        signOutReviewer(false);
        setResourceDashboardStatus(
          error.code === "UNAUTHORIZED" ||
            error.code === "SESSION_EXPIRED" ||
            error.code === "SESSION_INVALID" ||
            error.code === "SESSION_REVOKED"
            ? "Your reviewer session expired or was revoked. Sign in with Google again to view reviewer resources."
            : "This account is no longer authorized for reviewer resources.",
        );
        if (
          error.code === "UNAUTHORIZED" ||
          error.code === "SESSION_EXPIRED" ||
          error.code === "SESSION_INVALID" ||
          error.code === "SESSION_REVOKED"
        )
          promptReviewerReauthentication();
      } else {
        if (!hasExistingReviewerRows) {
          reviewerDashboardLoadedForEmail = "";
        }
        if (
          resourceDashboardActiveTab === "REVIEWERS" &&
          !hasExistingReviewerRows
        ) {
          tableHead.replaceChildren();
          tableBody.replaceChildren();
          setResourceDashboardStatus(
            `Unable to load reviewer resources: ${String(
              error?.message || error,
            )}`,
          );
        }
      }
      (globalScope.DebugUtils || console).error(
        "Unable to load reviewer resources.",
        error,
      );
      return false;
    } finally {
      if (reviewerDashboardRequestPromise === backendRequest)
        reviewerDashboardRequestPromise = null;
      if (requestGeneration === reviewerDashboardRequestGeneration)
        setReviewerNavigationBusy(false);
      if (
        requestGeneration === reviewerDashboardRequestGeneration &&
        resourceDashboardActiveTab === "REVIEWERS"
      ) {
        setReviewerDashboardFiltersDisabled(false);
        status.removeAttribute("aria-busy");
        status.classList?.remove("resource-dashboard-status-stacked");
      }
    }
  }

  function normalizeResourceDashboardTabs(tabs) {
    const isValidTab = (tab) =>
      Array.isArray(tab?.columns) &&
      Array.isArray(tab?.rows) &&
      tab.rows.every(Array.isArray);
    if (!isValidTab(tabs?.MODULES)) {
      throw new Error(
        "The dashboard service returned invalid data: missing or malformed MODULES tab.",
      );
    }

    const normalized = { ...tabs };
    const reviewerTab = isValidTab(tabs.REVIEWERS) ? tabs.REVIEWERS : null;
    const syllabusColumnIndex = reviewerTab
      ? reviewerTab.columns.findIndex((column) =>
          ["syllabus", "course syllabus"].includes(
            String(column || "")
              .trim()
              .toLowerCase(),
          ),
        )
      : -1;
    if (!isValidTab(normalized.SYLLABUS)) {
      if (!reviewerTab) {
        throw new Error(
          "The dashboard service returned invalid data: missing or malformed SYLLABUS tab.",
        );
      }
      const yearColumnIndex = reviewerTab.columns.findIndex(
        (column) =>
          String(column || "")
            .trim()
            .toLowerCase() === "year",
      );
      const courseColumnIndex = reviewerTab.columns.findIndex(
        (column) =>
          String(column || "")
            .trim()
            .toLowerCase() === "course",
      );
      if (syllabusColumnIndex >= 0) {
        const syllabusRowIndexes = reviewerTab.rows
          .map((row, index) =>
            String(row[syllabusColumnIndex] || "").trim() ? index : -1,
          )
          .filter((index) => index >= 0);
        const selectRows = (rows, indexes, columns) =>
          indexes
            .filter((index) => Array.isArray(rows[index]))
            .map((index) =>
              columns.map((columnIndex) => rows[index][columnIndex] || ""),
            );
        normalized.SYLLABUS = {
          columns: ["Year", "Course", "COURSE SYLLABUS"],
          rows: selectRows(reviewerTab.rows, syllabusRowIndexes, [
            yearColumnIndex,
            courseColumnIndex,
            syllabusColumnIndex,
          ]),
          links: selectRows(reviewerTab.links || [], syllabusRowIndexes, [
            yearColumnIndex,
            courseColumnIndex,
            syllabusColumnIndex,
          ]),
          linkTitles: selectRows(
            reviewerTab.linkTitles || [],
            syllabusRowIndexes,
            [yearColumnIndex, courseColumnIndex, syllabusColumnIndex],
          ),
          linkTypes: selectRows(
            reviewerTab.linkTypes || [],
            syllabusRowIndexes,
            [yearColumnIndex, courseColumnIndex, syllabusColumnIndex],
          ),
          truncated: Boolean(reviewerTab.truncated),
        };
      } else {
        normalized.SYLLABUS = {
          columns: ["Year", "Course", "COURSE SYLLABUS"],
          rows: [],
          links: [],
          linkTitles: [],
          linkTypes: [],
          truncated: false,
        };
      }
    }
    normalized.REVIEWERS = {
      columns: [],
      rows: [],
      links: [],
      linkTitles: [],
      linkTypes: [],
      truncated: false,
    };
    return normalized;
  }

  function retainAuthorizedReviewerDashboardTab(tabs) {
    const reviewerTab = resourceDashboardData?.REVIEWERS;
    const hasValidReviewerTab =
      Array.isArray(reviewerTab?.columns) &&
      Array.isArray(reviewerTab?.rows) &&
      reviewerTab.rows.every(Array.isArray);
    const isCurrentAuthorizedReviewerTab =
      reviewerSessionId &&
      reviewerDashboardLoadedForEmail &&
      reviewerAuthorizedEmail &&
      reviewerDashboardLoadedForEmail.toLowerCase() ===
        reviewerAuthorizedEmail.toLowerCase() &&
      hasValidReviewerTab;
    if (isCurrentAuthorizedReviewerTab)
      return { ...tabs, REVIEWERS: reviewerTab };
    if (reviewerDashboardLoadedForEmail) reviewerDashboardLoadedForEmail = "";
    return tabs;
  }

  async function loadResourceDashboard({ silent = false } = {}) {
    const status = document.getElementById("resource-portal-status");
    const tableHead = document.getElementById("resource-dashboard-table-head");
    const tableBody = document.getElementById("resource-dashboard-table-body");
    if (!status || !tableHead || !tableBody) return false;
    if (resourceDashboardLoadingPromise) return resourceDashboardLoadingPromise;
    resourceDashboardLastRefreshAt = Date.now();

    initializeResourceDashboardControls();
    void initializeReviewerAuth();
    const storage = globalScope.StorageUtils;
    const appVersion = String(globalScope.__MRH_APP__?.version || "").trim();
    const keepReviewerStatus = resourceDashboardActiveTab === "REVIEWERS";
    let cachedDashboard = null;
    if (typeof storage?.getStoredJSON === "function") {
      const stored = storage.getStoredJSON(RESOURCE_DASHBOARD_CACHE_KEY, null);
      const hasValidCachedTab = (tab) =>
        Array.isArray(tab?.columns) &&
        Array.isArray(tab?.rows) &&
        tab.rows.every(Array.isArray);
      if (
        hasValidCachedTab(stored?.tabs?.MODULES) &&
        (hasValidCachedTab(stored?.tabs?.SYLLABUS) ||
          hasValidCachedTab(stored?.tabs?.REVIEWERS))
      ) {
        const sanitizedTabs = normalizeResourceDashboardTabs(stored.tabs);
        if (JSON.stringify(stored.tabs) !== JSON.stringify(sanitizedTabs)) {
          const saved =
            typeof storage.setStoredJSON === "function" &&
            storage.setStoredJSON(RESOURCE_DASHBOARD_CACHE_KEY, {
              ...stored,
              tabs: sanitizedTabs,
            });
          if (!saved) {
            const removed =
              typeof storage.removeStoredItem === "function" &&
              storage.removeStoredItem(RESOURCE_DASHBOARD_CACHE_KEY);
            if (!removed) {
              (globalScope.DebugUtils || console).error(
                "Unable to remove reviewer data from the cached dashboard.",
                new Error(
                  "The browser dashboard cache could not be sanitized.",
                ),
              );
            }
          }
        }
        if (
          stored.appVersion === appVersion &&
          typeof stored.version === "string"
        ) {
          cachedDashboard = { ...stored, tabs: sanitizedTabs };
          resourceDashboardData =
            retainAuthorizedReviewerDashboardTab(sanitizedTabs);
          renderResourceDashboardTab();
        }
      }
    }
    if (!silent && !keepReviewerStatus) {
      status.textContent = cachedDashboard
        ? "Checking for dashboard updates…"
        : "Loading dashboard…";
      status.setAttribute("aria-busy", "true");
    }
    if (!cachedDashboard && !silent && !keepReviewerStatus) {
      resourceDashboardData = null;
      tableHead.replaceChildren();
      tableBody.replaceChildren();
    }
    resourceDashboardLoadingPromise = (async () => {
      try {
        let response = await globalScope.AppNetwork.callBackend(
          {
            type: "get_resource_dashboard",
            eventId: createResourceEventId(),
            ...(reviewerSessionId ? { sessionId: reviewerSessionId } : {}),
            ...(cachedDashboard ? { version: cachedDashboard.version } : {}),
          },
          { timeoutMs: 30000, maxRetries: 0 },
        );
        if (response?.notModified === true && cachedDashboard) {
          if (response.version !== cachedDashboard.version) {
            throw new Error(
              "The dashboard cache version did not match the backend.",
            );
          }
          renderResourceDashboardTab();
          if (reviewerSessionId && resourceDashboardActiveTab === "REVIEWERS")
            return loadReviewerDashboard({ refresh: true });
          return true;
        }
        if (response?.notModified === true) {
          response = await globalScope.AppNetwork.callBackend(
            {
              type: "get_resource_dashboard",
              eventId: createResourceEventId(),
              ...(reviewerSessionId ? { sessionId: reviewerSessionId } : {}),
            },
            { timeoutMs: 30000, maxRetries: 0 },
          );
        }
        if (response?.status !== "success") {
          throw new Error(
            response?.message || "The dashboard service returned invalid data.",
          );
        }
        const normalizedTabs = normalizeResourceDashboardTabs(response.tabs);
        resourceDashboardData =
          retainAuthorizedReviewerDashboardTab(normalizedTabs);
        if (typeof storage?.setStoredJSON === "function" && appVersion) {
          const saved = storage.setStoredJSON(RESOURCE_DASHBOARD_CACHE_KEY, {
            appVersion: appVersion,
            version:
              typeof response.version === "string" ? response.version : "",
            tabs: normalizedTabs,
          });
          if (!saved) {
            (globalScope.DebugUtils || console).warn(
              "Resource Dashboard data could not be saved to browser storage.",
            );
          }
        }
        renderResourceDashboardTab();
        if (reviewerSessionId && resourceDashboardActiveTab === "REVIEWERS")
          return loadReviewerDashboard({ refresh: true });
        return true;
      } catch (error) {
        if (!silent && !keepReviewerStatus)
          status.textContent = `Unable to load dashboard: ${String(
            error?.message || error,
          )}`;
        (globalScope.DebugUtils || console).error(
          "Unable to load the Resource Dashboard.",
          error,
        );
        return false;
      } finally {
        if (!silent && !keepReviewerStatus) status.removeAttribute("aria-busy");
        resourceDashboardLoadingPromise = null;
      }
    })();
    return resourceDashboardLoadingPromise;
  }

  function removeCachedResourcePortalListings() {
    const storage = globalScope.StorageUtils;
    if (typeof storage?.removeSessionStoredItemsByPrefix !== "function") {
      throw new Error("Resource listing cleanup is unavailable.");
    }
    storage.removeSessionStoredItemsByPrefix("resource_portal_listing_");
  }

  function renderResourcePortalListing(response) {
    renderResourcePortalBreadcrumbs(response.breadcrumbs);
    renderResourcePortalItems(response.items);
    resourcePortalCurrentFolderId = String(response.folder?.id || "");
    resourcePortalItemCount = response.items.length;
    const count = response.items.length;
    resourcePortalStatusMessage = response.truncated
      ? `Showing the first ${count} items. This folder has more items than can be displayed at once.`
      : count === 0
        ? "This folder is empty."
        : `${count} ${count === 1 ? "item" : "items"}`;
    const search = document.getElementById("resource-portal-search");
    filterResourcePortalItems(search?.value || "");
  }

  function openResourcePortalRoot() {
    resourcePortalCurrentFolderId = "";
    const browser = document.querySelector(".resource-portal-browser");
    const accessScreen = document.getElementById(
      "resource-portal-access-screen",
    );
    const libraryNav = document.getElementById("resource-portal-library-nav");
    const accessNav = document.getElementById("resource-portal-access-nav");
    if (browser) browser.hidden = false;
    if (accessScreen) accessScreen.hidden = true;
    if (libraryNav) {
      libraryNav.classList.add("is-active");
      libraryNav.setAttribute("aria-current", "page");
    }
    if (accessNav) {
      accessNav.classList.remove("is-active");
      accessNav.removeAttribute("aria-current");
    }
    const search = document.getElementById("resource-portal-search");
    if (search) search.value = "";
    closeResourcePreview();
    return loadResourcePortalFolder("");
  }

  function openResourcePortalAccess() {
    const browser = document.querySelector(".resource-portal-browser");
    const accessScreen = document.getElementById(
      "resource-portal-access-screen",
    );
    const libraryNav = document.getElementById("resource-portal-library-nav");
    const accessNav = document.getElementById("resource-portal-access-nav");
    if (!browser || !accessScreen) return false;

    closeResourcePreview();
    browser.hidden = true;
    accessScreen.hidden = false;
    if (libraryNav) {
      libraryNav.classList.remove("is-active");
      libraryNav.removeAttribute("aria-current");
    }
    if (accessNav) {
      accessNav.classList.add("is-active");
      accessNav.setAttribute("aria-current", "page");
    }
    return true;
  }

  function filterResourcePortalItems(query) {
    const list = document.getElementById("resource-portal-items");
    const status = document.getElementById("resource-portal-status");
    if (!list || !status) return 0;

    const normalizedQuery = String(query || "")
      .trim()
      .toLocaleLowerCase();
    let visibleCount = 0;
    list.querySelectorAll(".resource-portal-row").forEach((row) => {
      const matches =
        !normalizedQuery || row.dataset.search.includes(normalizedQuery);
      row.hidden = !matches;
      if (matches) visibleCount += 1;
    });

    if (normalizedQuery) {
      status.textContent = visibleCount
        ? `${visibleCount} of ${resourcePortalItemCount} items`
        : "No matching files or folders.";
    } else {
      status.textContent = resourcePortalStatusMessage;
    }
    return visibleCount;
  }

  function createResourcePortalElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function renderResourcePortalBreadcrumbs(breadcrumbs) {
    const navigation = document.getElementById("resource-portal-breadcrumbs");
    if (!navigation) return;

    navigation.replaceChildren();
    breadcrumbs.forEach((crumb, index) => {
      if (index > 0) {
        navigation.appendChild(
          createResourcePortalElement("span", "text-gray-400", "/"),
        );
      }

      const isCurrent = index === breadcrumbs.length - 1;
      if (isCurrent) {
        const current = createResourcePortalElement(
          "span",
          "truncate font-semibold text-gray-800 dark:text-gray-100",
          crumb.name,
        );
        current.setAttribute("aria-current", "location");
        navigation.appendChild(current);
        return;
      }

      const button = createResourcePortalElement(
        "button",
        "truncate text-brand-700 hover:underline dark:text-brand-300",
        crumb.name,
      );
      button.type = "button";
      button.addEventListener("click", () => {
        void loadResourcePortalFolder(crumb.id);
      });
      navigation.appendChild(button);
    });
  }

  function renderResourcePortalItems(items) {
    const list = document.getElementById("resource-portal-items");
    if (!list) return;

    list.replaceChildren();
    items.forEach((item) => {
      const row = createResourcePortalElement("li", "resource-portal-row");
      row.dataset.search = String(item.name || "").toLocaleLowerCase();
      const icon = createResourcePortalElement(
        "i",
        item.type === "folder"
          ? "fa-solid fa-folder"
          : "fa-solid fa-file-lines",
      );
      icon.setAttribute("aria-hidden", "true");
      const nameCell = createResourcePortalElement(
        "div",
        "resource-portal-name-cell",
      );
      icon.classList.add(
        item.type === "folder"
          ? "resource-portal-folder-icon"
          : "resource-portal-file-icon",
      );
      nameCell.appendChild(icon);

      if (item.type === "folder") {
        const button = createResourcePortalElement(
          "button",
          "resource-portal-item-name",
          item.name,
        );
        button.type = "button";
        button.addEventListener("click", () => {
          void loadResourcePortalFolder(item.id);
        });
        nameCell.appendChild(button);
      } else {
        const previewButton = createResourcePortalElement(
          "button",
          "resource-portal-item-name",
          item.name,
        );
        previewButton.type = "button";
        previewButton.addEventListener("click", () => {
          void previewResourceFile(item.id, item.name);
        });

        nameCell.appendChild(previewButton);
      }

      row.appendChild(nameCell);
      const mimeType = String(item.mimeType || "");
      const fileType =
        item.type === "folder"
          ? "Folder"
          : mimeType === "application/pdf"
            ? "PDF"
            : mimeType === "application/vnd.google-apps.document"
              ? "Google Doc"
              : mimeType === "application/vnd.google-apps.spreadsheet"
                ? "Google Sheet"
                : mimeType === "application/vnd.google-apps.presentation"
                  ? "Google Slides"
                  : String(item.name || "").includes(".")
                    ? String(item.name)
                        .split(".")
                        .pop()
                        .slice(0, 8)
                        .toUpperCase()
                    : "File";
      row.appendChild(
        createResourcePortalElement(
          "span",
          "resource-portal-item-type",
          fileType,
        ),
      );
      let modifiedDate = "—";
      if (item.modifiedTime) {
        const date = new Date(item.modifiedTime);
        if (!Number.isNaN(date.getTime())) {
          modifiedDate = new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
            timeZone: "Asia/Manila",
          }).format(date);
        }
      }
      row.appendChild(
        createResourcePortalElement(
          "time",
          "resource-portal-item-modified",
          modifiedDate,
        ),
      );
      if (item.modifiedTime && modifiedDate !== "—") {
        row.lastChild.dateTime = new Date(item.modifiedTime).toISOString();
      }
      list.appendChild(row);
    });
  }

  async function previewResourceFile(fileId, fileName) {
    const preview = document.getElementById("resource-portal-preview");
    const title = document.getElementById("resource-portal-preview-title");
    const frame = document.getElementById("resource-portal-preview-frame");
    const status = document.getElementById("resource-portal-preview-status");
    if (!preview || !title || !frame) return false;

    preview.classList.remove("is-expanded");
    const expandButton = document.getElementById(
      "resource-portal-preview-expand",
    );
    if (expandButton) {
      expandButton.setAttribute("aria-pressed", "false");
      expandButton.setAttribute("aria-label", "Expand online viewer");
      expandButton.title = "Expand viewer";
      expandButton
        .querySelector("i")
        ?.classList.replace(
          "fa-compress",
          "fa-up-right-and-down-left-from-center",
        );
    }
    const previewGeneration = ++resourcePortalPreviewGeneration;
    if (resourcePortalPreviewObjectUrl) {
      URL.revokeObjectURL(resourcePortalPreviewObjectUrl);
      resourcePortalPreviewObjectUrl = "";
    }
    frame.removeAttribute("src");
    frame.hidden = true;
    title.textContent = String(fileName || "File preview");
    frame.title = `Preview of ${title.textContent}`;
    preview.hidden = false;
    preview.scrollIntoView?.({ behavior: "smooth", block: "nearest" });

    if (status) {
      status.textContent = "Loading online preview…";
      status.hidden = false;
    }
    try {
      const response = await globalScope.AppNetwork.callBackend(
        { type: "get_resource_preview", fileId },
        { timeoutMs: 60000, maxRetries: 0 },
      );
      if (previewGeneration !== resourcePortalPreviewGeneration) return false;
      if (
        response?.status !== "success" ||
        typeof response.data !== "string" ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(response.data)
      ) {
        throw new Error(
          response?.message ||
            "The preview service returned invalid file data.",
        );
      }

      const binary = atob(response.data);
      const bytes = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const responseMimeType = String(response.mimeType || "").toLowerCase();
      const isSafeInlineType =
        responseMimeType === "application/pdf" ||
        responseMimeType === "text/plain" ||
        responseMimeType === "application/json" ||
        /^image\/(?:avif|gif|jpeg|png|webp)$/.test(responseMimeType);
      const previewMimeType =
        responseMimeType === "application/json"
          ? "text/plain"
          : isSafeInlineType
            ? responseMimeType
            : "application/octet-stream";
      if (!isSafeInlineType) {
        if (status) {
          status.textContent =
            "Online preview is not available for this file type.";
          status.hidden = false;
        }
        return false;
      }
      const previewBlob = new Blob([bytes], { type: previewMimeType });
      resourcePortalPreviewObjectUrl = URL.createObjectURL(previewBlob);
      frame.src =
        previewMimeType === "application/pdf"
          ? `${resourcePortalPreviewObjectUrl}#toolbar=0&navpanes=0&scrollbar=0`
          : resourcePortalPreviewObjectUrl;
      frame.hidden = false;
      if (status) {
        status.textContent = "";
        status.hidden = true;
      }
      return true;
    } catch (error) {
      if (previewGeneration !== resourcePortalPreviewGeneration) return false;
      if (status) {
        status.textContent = `Unable to load file preview: ${String(
          error?.message || error,
        )}`;
        status.hidden = false;
      }
      (globalScope.DebugUtils || console).error(
        "Unable to preview resource file.",
        error,
      );
      return false;
    }
  }

  function toggleResourceViewer() {
    const preview = document.getElementById("resource-portal-preview");
    const expandButton = document.getElementById(
      "resource-portal-preview-expand",
    );
    if (!preview || preview.hidden || !expandButton) return false;

    const isExpanded = preview.classList.toggle("is-expanded");
    expandButton.setAttribute("aria-pressed", String(isExpanded));
    expandButton.setAttribute(
      "aria-label",
      isExpanded ? "Exit expanded viewer" : "Expand online viewer",
    );
    expandButton.title = isExpanded ? "Exit expanded viewer" : "Expand viewer";
    const icon = expandButton.querySelector("i");
    if (icon) {
      icon.classList.toggle("fa-compress", isExpanded);
      icon.classList.toggle(
        "fa-up-right-and-down-left-from-center",
        !isExpanded,
      );
    }
    if (isExpanded) {
      preview.setAttribute("role", "dialog");
      preview.setAttribute("aria-modal", "true");
    } else {
      preview.setAttribute("role", "region");
      preview.removeAttribute("aria-modal");
    }
    return isExpanded;
  }

  function closeResourcePreview() {
    resourcePortalPreviewGeneration += 1;
    const preview = document.getElementById("resource-portal-preview");
    const frame = document.getElementById("resource-portal-preview-frame");
    const status = document.getElementById("resource-portal-preview-status");
    if (frame) frame.removeAttribute("src");
    if (resourcePortalPreviewObjectUrl) {
      URL.revokeObjectURL(resourcePortalPreviewObjectUrl);
      resourcePortalPreviewObjectUrl = "";
    }
    if (status) {
      status.textContent = "";
      status.hidden = true;
    }
    if (preview) {
      preview.classList.remove("is-expanded");
      preview.setAttribute("role", "region");
      preview.removeAttribute("aria-modal");
      preview.hidden = true;
    }
    const expandButton = document.getElementById(
      "resource-portal-preview-expand",
    );
    if (expandButton) {
      expandButton.setAttribute("aria-pressed", "false");
      expandButton.setAttribute("aria-label", "Expand online viewer");
      expandButton.title = "Expand viewer";
      const icon = expandButton.querySelector("i");
      if (icon) {
        icon.classList.remove("fa-compress");
        icon.classList.add("fa-up-right-and-down-left-from-center");
      }
    }
  }

  async function loadResourcePortalFolder(folderId) {
    const status = document.getElementById("resource-portal-status");
    const list = document.getElementById("resource-portal-items");
    if (!status || !list) return false;

    try {
      removeCachedResourcePortalListings();
    } catch (error) {
      status.textContent =
        "Unable to securely refresh resources. Reload the page and try again.";
      (globalScope.DebugUtils || console).error(
        "Unable to clear stale resource listings.",
        error,
      );
      return false;
    }

    const requestGeneration = ++resourcePortalRequestGeneration;
    const requestedFolderId = String(
      folderId || resourcePortalCurrentFolderId || "",
    );
    resourcePortalStatusMessage = "Loading shared resources…";
    status.textContent = resourcePortalStatusMessage;
    list.replaceChildren();
    status.setAttribute("aria-busy", "true");

    try {
      const response = await globalScope.AppNetwork.callBackend(
        {
          type: "list_public_resources",
          folderId: requestedFolderId,
        },
        { timeoutMs: 30000, maxRetries: 0 },
      );
      if (requestGeneration !== resourcePortalRequestGeneration) return false;
      if (
        response?.status !== "success" ||
        !Array.isArray(response.items) ||
        !Array.isArray(response.breadcrumbs)
      ) {
        throw new Error("The resource service returned an invalid response.");
      }

      renderResourcePortalListing(response);
      return true;
    } catch (error) {
      if (requestGeneration !== resourcePortalRequestGeneration) return false;
      list.replaceChildren();
      resourcePortalItemCount = 0;
      resourcePortalStatusMessage = `Unable to load shared resources: ${String(
        error?.message || error,
      )}`;
      status.textContent = resourcePortalStatusMessage;
      (globalScope.DebugUtils || console).error(
        "Unable to load Resource Portal contents.",
        error,
      );
      return false;
    } finally {
      if (requestGeneration === resourcePortalRequestGeneration) {
        status.removeAttribute("aria-busy");
      }
    }
  }

  const compatibilityExports = {
    applyNavigationPosition,
    applySummaryData,
    applyTitleMode,
    buildAccessMetadataMap,
    calculateBackoffDelay,
    changeDatabaseUpdateMode,
    changeDeckNameMode,
    changeDeckSort,
    changeDeckSource,
    changeNavigationPosition,
    changeQuestionTypeMode,
    changeQuizFilter,
    changeStudyIndex,
    changeStudyLayout,
    changeStudyPage,
    changeStudyPageSize,
    checkSavedSession,
    checkSyncStatusLightweight,
    cleanupAppResources,
    clearAppData,
    clearDatabase,
    clearLocalDownloadDeleted,
    clearSessionProgress,
    closeAllDropdownMenus,
    computeSrsInterval,
    createDebugSnapshot,
    cycleNavigationModeButton,
    cycleScrollNavigationPosition,
    deleteSubjectData,
    emitDebugState,
    endSession,
    ensureAppReady,
    ensureUnlockedFolderState,
    enterFolder,
    fetchAccessMetadata,
    fetchAndStartCategory,
    fetchDeckQuestions,
    fetchDeckQuestionsFromNetwork,
    forcePageRefresh,
    formatCacheAge,
    formatQuestionText,
    getAccessMetadataSignature,
    getAnalyticsCore,
    getCategoryProgressRenderSignature,
    invalidateCategoryProgressRenderSignature,
    getCollectionSignature,
    getCurrentReviewSubject,
    getDeckDataFreshnessBannerHtml,
    getDeckDataFreshnessState,
    getDeckDataReadinessState,
    getDeckFetchKey,
    getDeckLoaderId,
    getDeckNavigationOverride,
    getDefaultSrsEntry,
    getNavigationContextSubject,
    getPathSegments,
    getQuestionTypeMode,
    getQuizNavigationPosition,
    getRecentPathDepth,
    getRecentPathRelationDepth,
    getScrollNavigationButtonLabel,
    getShortSubjectLabel,
    getStudyNavigationPosition,
    getSubjectListSignature,
    getSubjectProgressStats,
    getSummarySignature,
    getSummarySyncDecision,
    getSyncStatusVisualState,
    getVisibleCategorySummary,
    goToPath,
    handleCacheInvalidation,
    handleDeckClick,
    hasRequiredAppRuntime,
    hideConnectionStatusAfterDelay,
    initDetailsExclusivity,
    initializeApp,
    isDeckHidden,
    isDeckLocked,
    isDeckPasswordProtected,
    isFolderUnlocked,
    isRecentlyViewedPath,
    jumpToStudyPage,
    loadState,
    openResourceDashboardTab,
    loadResourceDashboard,
    markLocalDownloadDeleted,
    nextQuestion,
    normalizeAccessFlag,
    normalizeQuestionRecord,
    normalizeSummaryData,
    openModeSelect,
    optimizedBackgroundSync,
    persistDeckCacheTimestamp,
    persistSyncStatusTimestamp,
    populateFilters,
    prevQuestion,
    proceedToQuiz,
    proceedToReview,
    readStoredDeckCacheTimestamp,
    readStoredSyncStatusTimestamp,
    reloadAppStateInMemory,
    renderCategoryProgress,
    renderCategoryProgressNow,
    refreshPendingDeckPayloads,
    dismissTreeViewReadabilityNotice,
    dismissDeckNotFound,
    toggleTreeNode,
    renderCharts,
    resetCategory,
    resetProgress,
    resolveSubjectAccess,
    resumeSession,
    revealAnswer,
    revealClozeAnswer,
    reviewDeck,
    runWithActionLock,
    runWithBusyButton,
    safeIdbDel,
    safeIdbSet,
    sanitizeDeletedDeckReferences,
    saveSessionProgress,
    saveState,
    switchPracticeToReview,
    switchReviewToPractice,
    cancelDeckPasswordRequest,
    scheduleDeferredInitialization,
    scheduleNextPolling,
    scheduleSinglePollLoop,
    scheduleStartupSync,
    scheduleSyncPoll,
    scheduleSyncRetry,
    setDeckNavigationOverride,
    setDeckSortDirection,
    setFolderUnlocked,
    setFormError,
    setGlobalLoadingState,
    setInlineError,
    setStudyNavigationPosition,
    setTitleMode,
    setupCacheInvalidationListener,
    setupLeaderElection,
    setupVisibilityChangeHandler,
    showColdStartNotification,
    showExplanation,
    showMCQOptions,
    showToast,
    showToastNotification,
    shuffleArray,
    startCacheVersionChecking,
    startCustomSession,
    startVisualTimer,
    stopVisualTimer,
    stripAccessMetadataFromSummary,
    submitPracticeAnswer,
    syncDatabase,
    syncPreferenceControls,
    toggleActiveRecall,
    toggleAppMode,
    toggleArchiveDeck,
    toggleArchivedDeckVisibility,
    toggleCurrentQuestionFavorite,
    toggleDeckSortDirection,
    toggleFavoriteDeck,
    togglePinDeck,
    toggleLayout,
    toggleMainNavigationPosition,
    toggleNavigationPosition,
    togglePasswordVisibility,
    toggleQuestionFavorite,
    toggleShuffleChoices,
    toggleShuffleQuestions,
    toggleSpecificChoices,
    toggleStudyFullscreen,
    toggleTheme,
    toggleTitleMode,
    trackStats,
    triggerSilentSummaryRefresh,
    updateRecentDecks,
    updateSrsForQuestion,
    updateSyncStatus,
    updateThemeButton,
    updateTitleModeButton,
  };

  Object.assign(globalScope, compatibilityExports);
  Object.defineProperties(globalScope, {
    currentAppMode: {
      configurable: true,
      get: () => currentAppMode,
      set: (value) => {
        currentAppMode = value;
      },
    },
    pendingSummaryData: {
      configurable: true,
      get: () => pendingSummaryData,
      set: (value) => {
        pendingSummaryData = value;
      },
    },
    pendingDeckSubject: {
      configurable: true,
      get: () => pendingDeckSubject,
      set: (value) => {
        pendingDeckSubject = value;
      },
    },
    pendingDeckAction: {
      configurable: true,
      get: () => pendingDeckAction,
      set: (value) => {
        pendingDeckAction = value;
      },
    },
  });

  const AppCore = Object.freeze({ ...compatibilityExports });
  globalThis.AppCore = AppCore;
  globalScope.AppCore = AppCore;
  globalScope.initializeApp = initializeApp;
})(typeof window !== "undefined" ? window : globalThis);
