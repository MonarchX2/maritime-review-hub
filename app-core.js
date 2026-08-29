const DB_URL =
  "https://script.google.com/macros/s/AKfycby4j5hbEWyfqonO9HYKgywo4OAt1NBwerEWWZwLWb1ODbsQGUd-YMMO-H9wX3_C-tBw/exec";

const SYNC_INTERVAL_MS = 60 * 1000;
const SYNC_RETRY_INTERVAL_MS = 3 * 1000;
const QUIZ_NAVIGATION_BREAKPOINT = 768;
const STALE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
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
let syncInFlightPromise = null;
let backgroundSyncPromise = null;
const deckFetchInFlight = new Map();
const lastDeckRefreshAtBySubject = {};
const SYNC_STATUS_STORAGE_KEY = "mrh_last_sync_status_timestamp";
const SYNC_REQUEST_TIMEOUT_MS = 60000;
let __mrhAppInitialized = false;
let __mrhAppReady = false;
let __mrhInitializationTimer = null;
let __mrhPollLoopToken = 0;

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

  __mrhInitializationTimer = setTimeout(() => {
    __mrhInitializationTimer = null;
    if (
      typeof window !== "undefined" &&
      typeof window.initializeApp === "function"
    ) {
      window.initializeApp();
    }
  }, 50);

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
    console.warn("Unable to persist sync status timestamp.", e);
  }
}

// OPTIMIZATION: Leader election pattern - only one tab polls
let isLeaderTab = false;
let leaderHeartbeatTimer = null;
let leaderElectionChannel = null;

const debugLogger =
  typeof DebugUtils !== "undefined" && DebugUtils.createDebugLogger
    ? DebugUtils.createDebugLogger("mrh-app")
    : {
        snapshot: (label, details = {}) => ({ label, ...details }),
        emit: () => undefined,
      };

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

  const previousHtml = button.innerHTML;
  const previousDisabled = button.disabled;
  button.dataset.originalHtml = previousHtml;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i> ${loadingText}`;

  try {
    return await action();
  } finally {
    button.disabled = previousDisabled;
    button.removeAttribute("aria-busy");
    button.innerHTML = previousHtml;
  }
}

function setInlineError(element, message) {
  if (!element) return;
  element.textContent = message || "";
  element.classList.toggle("hidden", !message);
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

async function saveState() {
  if (
    typeof AppState !== "undefined" &&
    typeof AppState.saveState === "function"
  ) {
    return AppState.saveState();
  }
  throw new Error("AppState is required before saving application state.");
}

function syncPreferenceControls() {
  if (
    typeof AppState !== "undefined" &&
    typeof AppState.syncPreferenceControls === "function"
  ) {
    return AppState.syncPreferenceControls();
  }
  throw new Error(
    "AppState is required before synchronizing preference controls.",
  );
}

async function safeIdbSet(key, value) {
  if (typeof idbKeyval !== "undefined") {
    await idbKeyval.set(
      key.includes(":") || key.startsWith("mrh_") ? key : getStorageKey(key),
      value,
    );
  }
}

async function safeIdbDel(key) {
  if (typeof idbKeyval !== "undefined") {
    await idbKeyval.del(
      key.includes(":") || key.startsWith("mrh_") ? key : getStorageKey(key),
    );
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
      panelClass: "bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-300",
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
  if (detailEl) detailEl.textContent = detail || "Preparing the latest data...";
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
    element.innerHTML = message;
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
      clearTimeout(syncStatusHideTimer);
      connectionStatus.classList.remove("hidden", "opacity-0", "scale-95");
      connectionStatus.innerHTML = message;
      connectionStatus.className = `fixed bottom-5 left-1/2 z-[60] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg px-4 py-2 text-center text-xs font-medium shadow-lg transition-all duration-500 ${visualState.panelClass}`;
    } else {
      clearTimeout(syncStatusHideTimer);
      connectionStatus.classList.add("opacity-0", "scale-95");
      setTimeout(() => {
        if (connectionStatus) {
          connectionStatus.classList.add("hidden");
          connectionStatus.classList.remove("opacity-0", "scale-95");
        }
      }, 250);
    }
  }
}

function hideConnectionStatusAfterDelay(delay = 3000) {
  clearTimeout(syncStatusHideTimer);
  syncStatusHideTimer = setTimeout(() => {
    const element = document.getElementById("connection-status");
    if (!element) return;
    element.classList.add("opacity-0", "scale-95");
    setTimeout(() => element.classList.add("hidden"), 500);
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
    console.warn("Unable to persist deck cache timestamp.", error);
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
    return `
      <div class="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300">
        <i class="fa-solid fa-circle-check"></i>
        <span>Live data • Updated ${formatCacheAge(freshness.cacheAgeMs)}</span>
      </div>
    `;
  }

  if (freshness.isColdStart) {
    return `
      <div class="mb-4 flex items-center gap-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-medium text-yellow-700 dark:border-yellow-900/60 dark:bg-yellow-900/20 dark:text-yellow-300">
        <i class="fa-solid fa-hourglass-half"></i>
        <span>Waiting for fresh deck data. The app is reconnecting and may be temporarily empty.</span>
      </div>
    `;
  }

  if (freshness.isEmpty) {
    return `
      <div class="mb-4 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>No deck data is available yet. Please wait for the database to reconnect.</span>
      </div>
    `;
  }

  return `
    <div class="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300">
      <i class="fa-solid fa-database"></i>
      <span>Using cached deck data • Last synced ${formatCacheAge(freshness.cacheAgeMs)}. This list may be stale.</span>
    </div>
  `;
}

async function optimizedBackgroundSync() {
  if (backgroundSyncPromise) return backgroundSyncPromise;

  backgroundSyncPromise = (async () => {
    if (!isLeaderTab) {
      syncScheduler.cancel();
      return;
    }

    try {
      const syncStatus = await checkSyncStatusLightweight();

      if (
        !syncStatus ||
        typeof syncStatus !== "object" ||
        syncStatus.status !== "ok"
      ) {
        if (state.categorySummary.length > 0) {
          syncConnected = false;
          updateSyncStatus(
            '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.',
            "warning",
            false,
          );
          return;
        }

        console.log(
          "[SYNC] Lightweight status check failed; falling back to summary sync",
        );
        await syncDatabase(true, true);
        return;
      }

      if (syncStatus.isColdStart === true) {
        isColdStart = true;
        if (state.categorySummary.length === 0) showColdStartNotification();
        scheduleSyncRetry(state.categorySummary.length === 0);
        return;
      }

      const storedTimestamp = readStoredSyncStatusTimestamp();
      const nextTimestamp = String(syncStatus.syncTimestamp || "").trim();

      if (storedTimestamp && storedTimestamp === nextTimestamp) {
        syncConnected = true;
        isColdStart = false;
        return;
      }

      if (nextTimestamp) {
        persistSyncStatusTimestamp(nextTimestamp);
      }
      await syncDatabase(true, true);
    } catch (err) {
      console.error("[SYNC] Simplified background sync error:", err);
      if (state.categorySummary.length > 0) {
        syncConnected = false;
        updateSyncStatus(
          '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.',
          "warning",
          false,
        );
        return;
      }
      await syncDatabase(true, true);
    } finally {
      backgroundSyncPromise = null;
    }
  })();

  return backgroundSyncPromise;
}

function scheduleSyncPoll() {
  syncScheduler.schedule();
}

const syncScheduler = {
  schedule() {
    if (!isLeaderTab) {
      this.cancel();
      return;
    }

    const activeToken = ++__mrhPollLoopToken;
    this.cancel();
    syncPollTimer = setTimeout(() => {
      if (activeToken !== __mrhPollLoopToken) return;
      if (typeof document !== "undefined" && document.hidden) return;
      optimizedBackgroundSync().finally(() => {
        if (activeToken === __mrhPollLoopToken && isLeaderTab) {
          this.schedule();
        }
      });
    }, SYNC_INTERVAL_MS);
  },
  cancel() {
    clearTimeout(syncPollTimer);
    syncPollTimer = null;
  },
  scheduleForLeader() {
    this.cancel();
    if (isLeaderTab) this.schedule();
  },
  handleVisibility(isHidden) {
    this.cancel();
    if (isHidden) return;

    optimizedBackgroundSync().finally(() => {
      if (isLeaderTab && typeof document !== "undefined" && !document.hidden) {
        this.schedule();
      }
    });
  },
};

function scheduleSinglePollLoop() {
  if (!isLeaderTab) {
    return;
  }

  scheduleSyncPoll();
}

function stripAccessMetadataFromSummary(summaryData) {
  // Backend response already only includes: Subject, QuestionCount, Locked
  // This function ensures no Password/Hidden fields are in stored data
  if (!Array.isArray(summaryData)) return summaryData;
  return summaryData.map((deck) => {
    if (!deck || typeof deck !== "object") return deck;
    const { Subject, QuestionCount, Locked } = deck;
    return { Subject, QuestionCount, Locked };
  });
}

function normalizeAccessFlag(value, fallback = false) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;

  const normalized = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "n", "off"].includes(normalized)) return false;

  return Boolean(value);
}

function ensureUnlockedFolderState() {
  const rootState =
    typeof globalThis !== "undefined" &&
    globalThis.state &&
    typeof globalThis.state === "object"
      ? globalThis.state
      : typeof state !== "undefined" && state && typeof state === "object"
        ? state
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

  const directEntry = accessMap[subjectName] || {};
  const summaryEntry =
    (Array.isArray(summaryEntries) &&
      summaryEntries.find(
        (item) => String(item?.Subject || "") === subjectName,
      )) ||
    {};

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
  return summaryData
    .map((deck) =>
      [
        deck?.Subject,
        deck?.QuestionCount,
        deck?.Locked,
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

function applySummaryData(summaryData, knownChanged = null) {
  // CRITICAL FIX: Don't double-filter - backend already filters hidden decks
  // Only use the data as-is from the backend response
  const changed =
    knownChanged === null
      ? getSummarySignature(state.categorySummary || []) !==
        getSummarySignature(summaryData || [])
      : Boolean(knownChanged);

  state.categorySummary = summaryData || [];
  syncConnected = true;
  persistDeckCacheTimestamp(Date.now());
  // FEATURE: Mark initial sync as complete after first successful sync
  if (!isInitialSyncComplete) {
    isInitialSyncComplete = true;
  }
  saveState();
  populateFilters();
  renderCategoryProgress();
  return changed;
}

function scheduleSyncRetry(showOverlay = true) {
  clearTimeout(syncRetryTimer);
  clearInterval(syncCountdownTimer);
  const retryCount = Math.max(0, Number(syncAttempt || 1) - 1);
  const delay = Math.min(
    60000,
    Math.max(SYNC_RETRY_INTERVAL_MS, calculateBackoffDelay(retryCount)),
  );
  const retryAt = Date.now() + delay;
  const wasConnected = syncConnected;
  const effectiveShowOverlay = showOverlay && !state.session?.active;
  syncConnected = false;
  if (wasConnected) renderCategoryProgress();
  const renderCountdown = () => {
    const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    updateSyncStatus(
      `<i class="fa-solid fa-xmark mr-1"></i> Database unavailable. Trying to reconnect (attempt ${syncAttempt}) in ${seconds}s...`,
      "warning",
      effectiveShowOverlay,
    );
    if (seconds === 0) clearInterval(syncCountdownTimer);
  };
  renderCountdown();
  syncCountdownTimer = setInterval(renderCountdown, 1000);
  syncRetryTimer = setTimeout(
    () => syncDatabase(true, !effectiveShowOverlay),
    delay,
  );
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
  if (iconEl) {
    iconEl.className =
      "text-3xl fa-solid fa-exclamation-triangle text-yellow-300";
  }

  overlay.classList.remove("hidden");
  overlay.setAttribute("aria-hidden", "false");
}

// ============================================
// LIGHTWEIGHT SYNC STATUS CHECK
// ============================================
async function checkSyncStatusLightweight() {
  // Lightweight version check instead of full MRH_Summary.json.
  // Keep it on the same timeout and network path as the rest of the app so the
  // background polling remains predictable and non-overlapping.
  try {
    if (
      typeof AppNetwork !== "undefined" &&
      typeof AppNetwork.getSyncStatus === "function"
    ) {
      return await AppNetwork.getSyncStatus({ timeoutMs: 20000 });
    }
    throw new Error("AppNetwork sync status API is unavailable.");
  } catch (err) {
    console.log("[SYNC] Lightweight status check failed:", err);
    return null;
  }
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

async function syncDatabaseImplementation(
  isRetry = false,
  isBackgroundCheck = false,
) {
  if (syncInFlightPromise) {
    return syncInFlightPromise;
  }

  syncInFlightPromise = (async () => {
    clearTimeout(syncRetryTimer);
    clearInterval(syncCountdownTimer);
    clearTimeout(syncPollTimer);
    if (syncAbortController) {
      syncAbortController.abort();
    }

    const silentSync = isBackgroundCheck || Boolean(state.session?.active);
    if (!isRetry) syncAttempt = 0;
    syncAttempt++;
    syncAbortController = new AbortController();
    const requestController = syncAbortController;
    let requestTimedOut = false;
    const timeoutId = setTimeout(() => {
      requestTimedOut = true;
      requestController.abort();
    }, SYNC_REQUEST_TIMEOUT_MS);

    if (!(isBackgroundCheck && state.categorySummary.length > 0)) {
      updateSyncStatus(
        `<i class="fa-solid fa-spinner fa-spin mr-1"></i> ${isRetry ? "Checking for database updates" : "Connecting to database"}...`,
        "info",
        !isBackgroundCheck,
      );
    }

    try {
      if (
        typeof AppNetwork === "undefined" ||
        typeof AppNetwork.getDeckSummary !== "function"
      ) {
        throw new Error("AppNetwork summary API is unavailable.");
      }
      const summaryData = await AppNetwork.getDeckSummary({
        timeoutMs: SYNC_REQUEST_TIMEOUT_MS,
        signal: requestController.signal,
      });

      if (
        summaryData &&
        !Array.isArray(summaryData) &&
        summaryData.isColdStart === true
      ) {
        clearTimeout(timeoutId);
        console.warn("[COLD START] Detected! Backend is rebuilding cache...");
        isColdStart = true;
        if (state.categorySummary.length === 0) showColdStartNotification();
        scheduleSyncRetry(
          !isBackgroundCheck && state.categorySummary.length === 0,
        );
        return false;
      }

      if (Array.isArray(summaryData)) {
        clearTimeout(timeoutId);
        lastSyncAt = Date.now();
        const wasConnected = syncConnected;
        syncAttempt = 0;
        syncConnected = true;
        isColdStart = false;
        sanitizeDeletedDeckReferences();

        const syncDecision = getSummarySyncDecision(summaryData, wasConnected);

        if (syncDecision.shouldApply) {
          pendingSummaryData = null;
          applySummaryData(summaryData, syncDecision.changed);
          state.accessMetadata = buildAccessMetadataMap(summaryData);
        } else if (!syncDecision.canApplyNow) {
          if (syncDecision.shouldQueue) pendingSummaryData = summaryData;
          if (!wasConnected) renderCategoryProgress();
        }

        updateSyncStatus(
          `<i class="fa-solid fa-check mr-1"></i> Connected. ${syncDecision.changed && !syncDecision.canApplyNow ? "Update waiting until your session ends." : `Checked ${summaryData.length} subjects.`}`,
          "success",
          !silentSync && !initialSyncSuccessShown,
        );
        setGlobalLoadingState(false);
        if (!silentSync && !initialSyncSuccessShown) {
          initialSyncSuccessShown = true;
          hideConnectionStatusAfterDelay();
        }
        scheduleSyncPoll();
        return true;
      }

      clearTimeout(timeoutId);
      if (isBackgroundCheck && state.categorySummary.length > 0) {
        console.log(
          "[SYNC] Background check failed but cached data available. Continuing silently.",
        );
        updateSyncStatus(
          `<i class="fa-solid fa-exclamation-triangle mr-1"></i> Using locally cached deck list. Background sync temporarily unavailable.`,
          "warning",
          false,
        );
        syncConnected = false;
        scheduleSyncPoll();
        return false;
      }

      scheduleSyncRetry(!silentSync);
      if (state.categorySummary.length && syncConnected)
        renderCategoryProgress();
      return false;
    } catch (err) {
      clearTimeout(timeoutId);
      if (requestController !== syncAbortController) return false;

      if (err?.name === "AbortError" || err?.name === "TimeoutError") {
        if (requestTimedOut || err?.name === "TimeoutError") {
          console.warn(
            `[SYNC] Database response exceeded ${SYNC_REQUEST_TIMEOUT_MS / 1000}s; retrying automatically.`,
          );
        }
        scheduleSyncRetry(!silentSync);
        return false;
      }

      console.error("[SYNC] Error:", err);

      if (isBackgroundCheck && state.categorySummary.length > 0) {
        console.log(
          "[SYNC] Background check threw error but cached data available. Continuing silently.",
        );
        syncConnected = false;
        updateSyncStatus(
          `<i class="fa-solid fa-exclamation-triangle mr-1"></i> Database unavailable. Using cached deck list.`,
          "warning",
          false,
        );
        scheduleSyncPoll();
        return false;
      }

      scheduleSyncRetry(!silentSync);
      setGlobalLoadingState(
        !silentSync,
        "Database reconnecting",
        "The app is retrying the connection automatically. This may take a moment.",
        "warning",
      );

      const catList = document.getElementById("category-list");
      if (catList && state.categorySummary.length === 0) {
        if (typeof renderCategoryProgress === "function") {
          renderCategoryProgress();
        } else {
          catList.innerHTML = "";
        }
      }
      return false;
    } finally {
      if (requestController === syncAbortController) {
        syncAbortController = null;
      }
      syncInFlightPromise = null;
    }
  })();

  return syncInFlightPromise;
}

async function syncDatabase(isRetry = false, isBackgroundCheck = false) {
  const bootstrapStatus =
    typeof window !== "undefined" ? window.__MRH_BOOTSTRAP__?.status : null;

  if (bootstrapStatus === "failed") {
    throw new Error("App bootstrap failed; database sync is unavailable.");
  }

  if (bootstrapStatus !== "ready" && !__mrhAppReady) {
    console.debug(
      "Skipping syncDatabase until app bootstrap has reached ready state.",
    );
    return false;
  }

  return syncDatabaseImplementation(isRetry, isBackgroundCheck);
}

let filterModelSource = null;
let filterModel = { subjects: [], tags: [] };

function populateFilters() {
  if (
    typeof window !== "undefined" &&
    window.__MRH_BOOTSTRAP__?.status !== "ready" &&
    !__mrhAppReady
  ) {
    return;
  }

  if (filterModelSource !== state.db) {
    const subjectIndex = ensureQuestionIndex();
    const subjects = [...subjectIndex.bySubject.keys()];
    const tagSet = new Set();

    (state.db || []).forEach((q) => {
      if (!q || !q.Tags) return;
      q.Tags.split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => tagSet.add(tag));
    });

    filterModelSource = state.db;
    filterModel = { subjects, tags: [...tagSet] };
  }

  const { subjects, tags } = filterModel;

  // Update old select element if it exists (for backward compatibility)
  const select = document.getElementById("filter-subject");
  if (select) {
    let html = '<option value="ALL">All Subjects (Randomized)</option>';
    if (subjects.length > 0) {
      html += '<optgroup label="Subjects">';
      html += subjects
        .map(
          (s) =>
            `<option value="SUBJ:${escapeHTML(s)}">${escapeHTML(s)}</option>`,
        )
        .join("");
      html += "</optgroup>";
    }
    if (tags.length > 0) {
      html += '<optgroup label="Tags">';
      html += tags
        .map(
          (t) =>
            `<option value="TAG:${escapeHTML(t)}">${escapeHTML(t)}</option>`,
        )
        .join("");
      html += "</optgroup>";
    }

    select.innerHTML = html;
  }

  // Populate new dropdown filter menu
  const filterListContainer = document.getElementById("quiz-filter-list");
  if (filterListContainer) {
    let html = "";

    // Add subjects
    if (subjects.length > 0) {
      html +=
        '<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Subjects</div>';
      html += subjects
        .map(
          (s) =>
            `<button type="button" data-filter-value="SUBJ:${escapeHTML(s)}" onclick="changeQuizFilter('SUBJ:${escapeHTML(s)}')" class="quiz-filter-option">${escapeHTML(s)} <i class="fa-solid fa-check filter-check"></i></button>`,
        )
        .join("");
    }

    // Add tags
    if (tags.length > 0) {
      if (subjects.length > 0) {
        html +=
          '<div class="my-1 border-t border-gray-200 dark:border-gray-700"></div>';
      }
      html +=
        '<div class="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">Tags</div>';
      html += tags
        .map(
          (t) =>
            `<button type="button" data-filter-value="TAG:${escapeHTML(t)}" onclick="changeQuizFilter('TAG:${escapeHTML(t)}')" class="quiz-filter-option">${escapeHTML(t)} <i class="fa-solid fa-check filter-check"></i></button>`,
        )
        .join("");
    }

    filterListContainer.innerHTML = html;
  }
}

function changeQuizFilter(filterValue) {
  // Update the display text
  const displayEl = document.getElementById("filter-subject-display");
  const trigger = document.getElementById("quiz-filter-trigger");

  if (filterValue === "ALL") {
    if (displayEl) displayEl.textContent = "All Subjects";
  } else if (filterValue.startsWith("SUBJ:")) {
    const subj = filterValue.substring(5);
    if (displayEl) displayEl.textContent = subj;
  } else if (filterValue.startsWith("TAG:")) {
    const tag = filterValue.substring(4);
    if (displayEl) displayEl.textContent = `Tag: ${tag}`;
  }

  // Update check marks
  document.querySelectorAll(".quiz-filter-option").forEach((btn) => {
    const btnValue = btn.getAttribute("data-filter-value");
    const checkIcon = btn.querySelector(".filter-check");
    if (btnValue === filterValue) {
      if (checkIcon) checkIcon.style.opacity = "1";
    } else {
      if (checkIcon) checkIcon.style.opacity = "0";
    }
  });

  // Update check mark for All Subjects button
  const allSubjectsBtn = document.querySelector("[data-filter-value='ALL']");
  if (allSubjectsBtn) {
    const checkIcon = allSubjectsBtn.querySelector(".filter-check");
    if (filterValue === "ALL") {
      if (checkIcon) checkIcon.style.opacity = "1";
    } else {
      if (checkIcon) checkIcon.style.opacity = "0";
    }
  }

  // Store the value for initSession to use
  let hiddenSelect = document.getElementById("filter-subject");
  if (!hiddenSelect) {
    // Create a hidden select element if it doesn't exist
    hiddenSelect = document.createElement("select");
    hiddenSelect.id = "filter-subject";
    hiddenSelect.style.display = "none";
    document.body.appendChild(hiddenSelect);
  }
  hiddenSelect.value = filterValue;

  // Close the dropdown
  const menu = document.getElementById("quiz-filter-menu");
  if (menu) menu.open = false;
}

function getShortSubjectLabel(subject, fallback = "General") {
  const raw = String(subject ?? "").trim();
  if (!raw) return fallback;

  const parts = raw
    .split("::")
    .map((part) => part.trim())
    .filter(Boolean);

  return parts.length >= 2 ? parts.slice(-2).join(" :: ") : raw;
}

function enterFolder(folderName, isLockedFolder) {
  return DeckNavCore.enterFolder(folderName, isLockedFolder);
}

function goToPath(index) {
  return DeckNavCore.goToPath(index);
}

function getSubjectProgressStats(
  subject,
  subjectIdsBySubject,
  completedSet,
  mistakesSet,
) {
  const subjectIds = subjectIdsBySubject?.get(subject) || [];
  const totalQuestionsInDb = subjectIds.length;
  const completedCount = subjectIds.reduce((count, id) => {
    return count + (completedSet?.has(id) ? 1 : 0);
  }, 0);
  const mistakesCount = subjectIds.reduce((count, id) => {
    return count + (mistakesSet?.has(id) ? 1 : 0);
  }, 0);
  const progressPercent =
    totalQuestionsInDb > 0
      ? Math.min(100, Math.round((completedCount / totalQuestionsInDb) * 100))
      : 0;
  const isCompleted =
    totalQuestionsInDb > 0 && completedCount >= totalQuestionsInDb;

  return {
    completedCount,
    mistakesCount,
    totalQuestionsInDb,
    progressPercent,
    isCompleted,
  };
}

function getDeckLoaderId(subject) {
  const normalized = String(subject || "").replace(/[^a-zA-Z0-9_-]+/g, "_");
  return `loading-${normalized || "deck"}`;
}

function getVisibleCategorySummary() {
  if (
    typeof DeckNavCore !== "undefined" &&
    typeof DeckNavCore.getVisibleCategorySummary === "function"
  ) {
    return DeckNavCore.getVisibleCategorySummary();
  }
  // CRITICAL: Backend already filters ALL hidden decks in filterSummaryDataByAccess()
  // Frontend must NEVER filter again - return categorySummary as-is
  return state.categorySummary || [];
}

function closeAllDropdownMenus(exceptElement = null) {
  return ModalCore.closeAllDropdownMenus(exceptElement);
}

function initDetailsExclusivity() {
  return ModalCore.initDetailsExclusivity();
}

let categoryProgressRenderScheduled = false;
let categoryProgressRenderInFlight = false;
let categoryProgressRenderQueued = false;
let categoryProgressLastRenderSignature = "";
let categoryTreeCache = null;

function getCollectionSignature(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value ?? "")).join("\u001f")
    : "";
}

function getLocalDeckSignature() {
  const localSubjects = Array.isArray(state.db)
    ? state.db.map((question) => question?.Subject).filter(Boolean)
    : [];
  return getCollectionSignature([...new Set(localSubjects)].sort());
}

function getAccessMetadataSignature() {
  const accessMetadata = state.accessMetadata || {};
  return Object.keys(accessMetadata)
    .sort()
    .map((subject) => {
      const access = accessMetadata[subject] || {};
      return [
        subject,
        access.Hidden,
        access.Locked,
        access.Password ? "protected" : "",
      ]
        .map((value) => String(value ?? ""))
        .join("\u001f");
    })
    .join("\u001e");
}

function getCategoryProgressRenderSignature() {
  return [
    getSummarySignature(state.categorySummary || []),
    getLocalDeckSignature(),
    getCollectionSignature(state.currentPath),
    state.prefs.layoutMode,
    state.prefs.deckSourceFilter,
    state.prefs.deckSortBy,
    state.prefs.deckSortDirection,
    state.prefs.deckNameMode,
    currentAppMode,
    getCollectionSignature(state.stats?.completedQs),
    getCollectionSignature(state.stats?.mistakes),
    getCollectionSignature(state.prefs.favoriteDecks),
    getCollectionSignature(state.prefs.archivedDecks),
    getAccessMetadataSignature(),
    isInitialSyncComplete,
  ].join("\u001e");
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
    requestAnimationFrame(render);
  } else {
    setTimeout(render, 0);
  }
}

function renderCategoryProgressNow() {
  if (!document.body) {
    if (!categoryProgressRenderScheduled) {
      categoryProgressRenderScheduled = true;
      requestAnimationFrame(() => {
        categoryProgressRenderScheduled = false;
        if (document.body && typeof renderCategoryProgress === "function") {
          renderCategoryProgress();
        }
      });
    }
    return;
  }

  const dashboardView = document.getElementById("view-dashboard");
  if (dashboardView && !dashboardView.classList.contains("active")) {
    categoryProgressRenderQueued = false;
    return;
  }

  const renderSignature = getCategoryProgressRenderSignature();
  if (renderSignature === categoryProgressLastRenderSignature) {
    categoryProgressRenderQueued = false;
    return;
  }

  if (categoryProgressRenderInFlight) {
    if (!categoryProgressRenderScheduled) {
      categoryProgressRenderScheduled = true;
      requestAnimationFrame(() => {
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
    // Initialize deck source filter if not set
    if (!state.prefs.deckSourceFilter) {
      state.prefs.deckSourceFilter = "all";
    }

    const sourceLabel = document.getElementById("deck-source-label");
    if (sourceLabel) {
      const sourceLabels = {
        all: "All Decks",
        favorites: "Favorites",
        downloaded: "Downloaded",
        cloud: "Cloud Only",
        archived: "Archived",
      };
      sourceLabel.innerText =
        sourceLabels[state.prefs.deckSourceFilter] || "All Decks";
    }

    document.querySelectorAll(".deck-source-option").forEach((btn) => {
      const check = btn.querySelector(".source-check");
      if (btn.dataset.sourceValue === state.prefs.deckSourceFilter) {
        check.style.opacity = "1";
      } else {
        check.style.opacity = "0";
      }
    });

    const selectedSortBy = state.prefs.deckSortBy || "letters";
    const selectedSortDirection =
      state.prefs.deckSortDirection === "desc" ? "desc" : "asc";
    document
      .querySelectorAll(".deck-sort-option[data-sort-value]")
      .forEach((btn) => {
        const check = btn.querySelector(".sort-check");
        if (check)
          check.style.opacity =
            btn.dataset.sortValue === selectedSortBy ? "1" : "0";
      });
    document
      .querySelectorAll(".deck-sort-option[data-sort-direction]")
      .forEach((btn) => {
        const check = btn.querySelector(".sort-direction-check");
        if (check) {
          check.style.opacity =
            btn.dataset.sortDirection === selectedSortDirection ? "1" : "0";
        }
      });

    const container = document.getElementById("category-list");
    const isGrid = state.prefs.layoutMode === "grid";
    const layoutIcon = document.getElementById("layout-icon");
    if (layoutIcon) {
      layoutIcon.className = isGrid
        ? "fa-solid fa-list text-brand-500"
        : "fa-solid fa-table-cells text-brand-500";
    }
    const completedSet = new Set(state.stats?.completedQs || []);
    const mistakesSet = new Set(state.stats?.mistakes || []);
    const subjectIdsBySubject = ensureQuestionIndex().bySubject;
    const downloadedSubjects = new Set(
      (state.db || []).map((question) => question?.Subject).filter(Boolean),
    );

    const visibleSummary = getVisibleCategorySummary();

    const visibleSummarySignature = getSummarySignature(visibleSummary);
    let tree;
    if (
      categoryTreeCache &&
      categoryTreeCache.summarySignature === visibleSummarySignature
    ) {
      tree = categoryTreeCache.tree;
    } else {
      tree = {};
      if (visibleSummary && visibleSummary.length > 0) {
        visibleSummary.forEach((cat) => {
          const parts = cat.Subject.split("::");
          let currentLevel = tree;

          parts.forEach((part, index) => {
            part = part.trim();
            if (!currentLevel[part]) {
              currentLevel[part] = { _children: {}, _data: null };
            }
            if (index === parts.length - 1) {
              currentLevel[part]._data = cat;
            }
            currentLevel = currentLevel[part]._children;
          });
        });
      }
      categoryTreeCache = { summarySignature: visibleSummarySignature, tree };
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

    if (!pathValid) {
      state.currentPath = [];
      currentNode = tree;
    }

    const folderStatsCache = new WeakMap();
    function getFolderStats(node) {
      if (folderStatsCache.has(node)) return folderStatsCache.get(node);

      let total = 0;
      if (node._data) total += node._data.QuestionCount || 0;
      for (let k in node._children) {
        total += getFolderStats(node._children[k]);
      }
      folderStatsCache.set(node, total);
      return total;
    }

    const freshnessBannerHtml = getDeckDataFreshnessBannerHtml();

    let html = `
      <div class="flex flex-nowrap items-center gap-2 mb-6 text-sm font-medium text-gray-600 dark:text-gray-400 overflow-x-auto pb-2 bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
        <button onclick="goToPath(-1)" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex items-center gap-2 flex-shrink-0">
          <i class="fa-solid fa-folder-open text-brand-500"></i> HOME
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

    const layoutClass = isGrid
      ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6"
      : "flex flex-col space-y-4";

    html += `<div class="${layoutClass}">`;
    const sortBy = state.prefs.deckSortBy || "letters";
    const sortDirection = state.prefs.deckSortDirection === "desc" ? -1 : 1;
    const keys = Object.keys(currentNode).sort((left, right) => {
      const leftNode = currentNode[left];
      const rightNode = currentNode[right];
      const leftIsFolder =
        Object.keys(leftNode._children || {}).length > 0 ||
        leftNode._data?.IsFolder;
      const rightIsFolder =
        Object.keys(rightNode._children || {}).length > 0 ||
        rightNode._data?.IsFolder;
      if (leftIsFolder !== rightIsFolder) return leftIsFolder ? -1 : 1;
      if (sortBy === "questions") {
        const leftCount = getFolderStats(leftNode);
        const rightCount = getFolderStats(rightNode);
        return (
          (leftCount - rightCount) * sortDirection ||
          TextUtils.naturalSortStrings(left, right) * sortDirection
        );
      }
      return TextUtils.naturalSortStrings(left, right) * sortDirection;
    });

    const sourceFilter = state.prefs.deckSourceFilter || "all";
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
        (favoriteMatchCache.get(node) || cachedMatches).set(folderKey, matches);
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
      const archivedDecks = state.prefs?.archivedDecks || [];
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
      if (isArchived) return false;

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

      const childKeys = Object.keys(node._children || {});
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

    if (visibleKeys.length === 0) {
      html += `<div class="col-span-full text-center py-10 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">No decks match your filter.</div>`;
    }

    function generateCardHTML(cat, displayName, delay = 0) {
      const subj = cat.Subject;
      const safeSubj = escapeHTML(subj);
      const encodedSubj = encodeHandlerValue(subj);
      const safeName = escapeHTML(displayName);
      const loaderId = getDeckLoaderId(subj);
      const deckNameMode =
        state.prefs.deckNameMode === "clip" ? "truncate" : "whitespace-normal";
      const totalQuestionsInDb = cat.QuestionCount;
      const databaseUnavailable = !isInitialSyncComplete;
      const freshness = getDeckDataFreshnessState();
      const staleBadgeHtml =
        freshness.isStale && !databaseUnavailable
          ? `<span class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300"><i class="fa-solid fa-clock-rotate-left"></i> Cached</span>`
          : "";

      const isRoot = !state.currentPath || state.currentPath.length === 0;
      const isArchived = (state.prefs?.archivedDecks || []).includes(subj);
      const archiveIconColor = isArchived
        ? "text-amber-500 hover:text-amber-600"
        : "text-gray-400 hover:text-brand-500";

      let archiveBtnHTML = "";
      if (isRoot) {
        archiveBtnHTML = `
          <button onclick="event.stopPropagation(); toggleArchiveDeck('${encodedSubj}')" 
            class="transition-all transform hover:scale-110 active:scale-90 ${archiveIconColor} p-1" 
            title="${isArchived ? "Unarchive Deck" : "Archive Deck"}">
            <i class="fa-solid fa-box-archive"></i>
          </button>
        `;
      }

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
      const completedCount = progressStats.completedCount;
      const mistakesCount = progressStats.mistakesCount;
      const progressPercent = progressStats.progressPercent;
      const isCompleted = progressStats.isCompleted;
      const cardClasses = isCompleted
        ? "bg-green-50 dark:bg-green-900/30 border-green-300"
        : "bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700";
      const availabilityClasses = databaseUnavailable
        ? "opacity-40 cursor-not-allowed pointer-events-none"
        : "";
      const isDownloaded = downloadedSubjects.has(subj);
      const statusBadge = isDownloaded
        ? `<span class="bg-green-100 text-green-800 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-green-900/40 dark:text-green-400 shadow-sm transition-colors"><i class="fa-solid fa-hard-drive mr-1"></i></span>`
        : `<span class="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-gray-700 dark:text-gray-400 shadow-sm transition-colors"><i class="fa-solid fa-cloud mr-1"></i></span>`;
      const isReview = currentAppMode === "review";
      const primaryActionText = isReview
        ? "Review Deck"
        : completedCount === 0
          ? "Start Quiz"
          : "Continue Quiz";
      const primaryActionIcon = isReview ? "fa-eye" : "fa-play";
      const primaryActionColor = isReview
        ? "bg-purple-600 hover:bg-purple-700"
        : "bg-brand-600 hover:bg-brand-700";
      const themeColorText = isReview
        ? "text-purple-600 dark:text-purple-400"
        : "text-brand-600 dark:text-brand-400";
      const themeColorBg = isReview ? "bg-purple-500" : "bg-brand-500";
      const themeShadowHover = isReview
        ? "hover:shadow-purple-500/10"
        : "hover:shadow-brand-500/10";
      const loaderColor = isReview ? "text-purple-500" : "text-brand-500";
      const isDeckInteractionBusy = deckInteractionLocked;
      const isLocked = isDeckLocked(subj) || Boolean(cat?.Locked);
      const lockIcon = isLocked
        ? `<i class="fa-solid fa-lock text-red-500 ml-2" title="Password Protected"></i>`
        : "";

      let statsHTML = "";
      let progressBarHTML = "";
      let countBadgeHTML = "";
      let resetBtnHTML = "";

      if (!isReview) {
        countBadgeHTML = `
          <div class="flex items-center gap-1.5 flex-shrink-0 pt-1">
            ${databaseUnavailable ? "" : archiveBtnHTML}
            ${databaseUnavailable || !isDownloaded ? "" : `<button onclick="event.stopPropagation(); deleteSubjectData('${encodedSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300 p-1" title="Delete Downloaded Data"><i class="fa-solid fa-trash-can"></i></button>`}
            <span class="text-sm font-black ${themeColorText} transition-colors">${completedCount} / ${totalQuestionsInDb}</span>
          </div>`;
        progressBarHTML = `
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
            <div class="${themeColorBg} h-full rounded-full transition-all duration-700 ease-out" style="width: ${progressPercent}%"></div>
          </div>`;

        if (!databaseUnavailable && (completedCount > 0 || mistakesCount > 0)) {
          resetBtnHTML = `
            <button onclick="resetCategory('${encodedSubj}')" class="w-10 sm:w-12 shrink-0 bg-red-50 text-red-600 dark:bg-red-900/20 py-2 px-1 rounded-lg font-bold hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-90 transition-all duration-300 text-xs sm:text-sm border border-red-100 dark:border-red-800 flex items-center justify-center" title="Reset Progress">
              <i class="fa-solid fa-rotate-left"></i>
            </button>`;
        }
      } else {
        countBadgeHTML = `
          <div class="flex items-center gap-1.5 flex-shrink-0 pt-1">
            ${databaseUnavailable ? "" : archiveBtnHTML}
            ${databaseUnavailable || !isDownloaded ? "" : `<button onclick="event.stopPropagation(); deleteSubjectData('${encodedSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300 p-1" title="Delete Downloaded Data"><i class="fa-solid fa-trash-can"></i></button>`}
            <span class="text-sm font-black ${themeColorText} transition-colors">${totalQuestionsInDb} cards</span>
          </div>`;
      }

      return `
        <div onclick="handleDeckClick('${encodedSubj}')" class="${isDeckInteractionBusy ? "pointer-events-none opacity-60 cursor-wait" : "cursor-pointer"} animate-card-in ${cardClasses} ${availabilityClasses} p-5 rounded-xl shadow-sm hover:shadow-lg hover:-translate-y-1 ${themeShadowHover} active:scale-[0.99] border transition-all duration-400 relative w-full h-full flex flex-col" style="animation-delay: ${delay}s;" title="${databaseUnavailable ? "Waiting for database connection" : ""}" aria-busy="${isDeckInteractionBusy}">
          ${
            databaseUnavailable
              ? `<div class="absolute inset-0 bg-gray-500/30 dark:bg-gray-900/60 backdrop-blur-sm z-10 rounded-xl flex flex-col items-center justify-center transition-opacity">
                  <i class="fa-solid fa-lock text-4xl text-gray-600 dark:text-gray-400 mb-2"></i>
                  <span class="text-sm font-bold text-gray-700 dark:text-gray-300 text-center px-2">Syncing Database...</span>
                </div>`
              : ""
          }
          <div id="${loaderId}" class="hidden absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10 rounded-xl flex-col items-center justify-center transition-opacity">
            <i class="fa-solid fa-spinner fa-spin text-3xl ${loaderColor} mb-2"></i>
            <span class="text-sm font-bold text-gray-700 dark:text-gray-200">Fetching Latest...</span>
          </div>

          <div class="flex items-start justify-between mb-4 gap-2">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-1 min-w-0">
                <h3 class="font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center transition-colors min-w-0">
                  <i class="fa-regular fa-file-lines text-gray-400 mr-2 text-sm flex-shrink-0"></i>
                  <span class="${deckNameMode} break-words">${safeName}</span> ${lockIcon}
                </h3>
                <div class="flex-shrink-0 flex items-center gap-1.5">${statusBadge}${staleBadgeHtml}</div>
              </div>
              ${statsHTML}
            </div>
            ${countBadgeHTML}
          </div>

          ${progressBarHTML}

          <div class="flex gap-2 mt-auto w-full" onclick="event.stopPropagation()">
            <button onclick="handleDeckClick('${encodedSubj}')" class="flex-1 ${primaryActionColor} text-white py-2 px-2 rounded-lg font-bold active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="${primaryActionText}">
              <i class="fa-solid ${primaryActionIcon} mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i>
              <span class="truncate">${primaryActionText}</span>
            </button>

            ${
              !isReview && mistakesCount > 0
                ? `
                  <button onclick="handleDeckClick('${encodedSubj}', 'mistakes')" class="flex-1 bg-yellow-500 text-white py-2 px-2 rounded-lg font-bold hover:bg-yellow-600 active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="Review Mistakes">
                    <i class="fa-solid fa-triangle-exclamation mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i>
                    <span class="truncate">Review (${mistakesCount})</span>
                  </button>
                `
                : ""
            }

            ${resetBtnHTML}
          </div>
        </div>
      `;
    }

    visibleKeys.forEach((key, index) => {
      const item = currentNode[key];
      const hasChildren = Object.keys(item._children).length > 0;
      const hasData = item._data !== null;

      const isExplicitFolder = hasData && item._data.IsFolder === true;
      const delay = index * 0.05;

      if (hasChildren || isExplicitFolder) {
        const totalCards = getFolderStats(item);
        const folderClass = isGrid ? "h-full min-h-[140px]" : "h-auto";

        const isReview = currentAppMode === "review";
        const folderColorClass = isReview
          ? "bg-purple-500 dark:bg-purple-700 group-hover:bg-purple-600 dark:group-hover:bg-purple-600"
          : "bg-brand-500 dark:bg-brand-700 group-hover:bg-brand-600 dark:group-hover:bg-brand-600";
        const folderTextHover = isReview
          ? "group-hover:text-purple-600 dark:group-hover:text-purple-400"
          : "group-hover:text-brand-600 dark:group-hover:text-brand-400";

        const folderSubject =
          (state.currentPath || []).concat(key).join("::") || key;
        const isLocked =
          isDeckLocked(folderSubject) || Boolean(item?._data?.Locked);
        const lockIcon = isLocked
          ? `<i class="fa-solid fa-lock text-red-500 ml-2" title="Password Protected Folder"></i>`
          : "";

        const isRoot = !state.currentPath || state.currentPath.length === 0;
        let archiveBtnHtml = "";
        let favoriteBtnHtml = "";

        if (isRoot) {
          const isArchived = (state.prefs?.archivedDecks || []).includes(key);
          const isFavorite = (state.prefs?.favoriteDecks || []).includes(key);
          const archiveIconColor = isArchived
            ? "text-amber-500 hover:text-amber-600"
            : "text-gray-400 hover:text-brand-500";
          const favoriteIconColor = isFavorite
            ? "text-yellow-500 hover:text-yellow-600"
            : "text-gray-400 hover:text-brand-500";
          archiveBtnHtml = `
            <button onclick="event.stopPropagation(); toggleArchiveDeck('${encodeHandlerValue(key)}')"
              class="transition-all transform hover:scale-110 active:scale-90 ${archiveIconColor} p-1 z-10"
              title="${isArchived ? "Unarchive Folder" : "Archive Folder"}">
              <i class="fa-solid fa-box-archive text-lg"></i>
            </button>
          `;
          favoriteBtnHtml = `
            <button onclick="event.stopPropagation(); toggleFavoriteDeck('${encodeHandlerValue(key)}')"
              class="transition-all transform hover:scale-110 active:scale-90 ${favoriteIconColor} p-1 z-10"
              title="${isFavorite ? "Remove from Favorites" : "Add to Favorites"}">
              <i class="fa-solid fa-star text-lg"></i>
            </button>
          `;
        }

        html += `
          <div onclick="enterFolder('${escapeHTML(key)}', ${isLocked})" class="cursor-pointer group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col ${folderClass} transform hover:-translate-y-1 relative" style="animation-delay: ${delay}s;">
            <div class="h-12 ${folderColorClass} transition-colors relative">
              <div class="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors"></div>
            </div>
            <div class="p-4 flex-1 flex flex-col justify-between">
              <div class="flex justify-between items-start w-full gap-2">
                <h3 class="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide ${folderTextHover} transition-colors text-lg flex items-center min-w-0">
                  <span class="${state.prefs.deckNameMode === "clip" ? "truncate" : "whitespace-normal break-words"}">${escapeHTML(key)}</span> ${lockIcon}
                </h3>
                <div class="flex items-center gap-1.5">
                  ${favoriteBtnHtml}
                  ${archiveBtnHtml}
                </div>
              </div>
              <div class="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mt-2">
                <span>${totalCards} cards</span>
              </div>
            </div>
          </div>`;
      } else if (hasData && !isExplicitFolder) {
        html += generateCardHTML(item._data, key, delay);
      }
    });

    html += `</div>`;
    if (container) {
      container.className = "transition-all duration-500";
      container.innerHTML = html;
    }

    categoryProgressLastRenderSignature = renderSignature;

    applyTitleMode();
  } finally {
    categoryProgressRenderInFlight = false;
  }
}

async function fetchAndStartCategory(subject, mode, pass = null) {
  return DeckNavCore.fetchAndStartCategory(subject, mode, pass);
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
    // Clear any pending sync timers - deletion is a local operation
    clearTimeout(syncRetryTimer);
    clearInterval(syncCountdownTimer);

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
    await safeIdbSet("mrh_db", state.db);
    const deckSourceFilter = document.getElementById("deck-source-filter");
    if (deckSourceFilter && deckSourceFilter.value === "downloaded") {
      renderCategoryProgress();
    }
    if (typeof renderCategoryProgress === "function") {
      renderCategoryProgress();
    }

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
          let keptBeforeCurrent = 0;

          let newIdx = 0;
          for (let i = 0; i < sessionObj.questions.length; i++) {
            if (sessionObj.questions[i].Subject !== subject) {
              newQuestions.push(sessionObj.questions[i]);

              if (sessionObj.userAnswers && sessionObj.userAnswers[i]) {
                newUserAnswers[newIdx] = sessionObj.userAnswers[i];
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
        console.error("Error parsing saved session during deletion.", e);
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
  }
}

async function fetchDeckQuestions(
  subject,
  pass = null,
  loaderElement = null,
  customFilter = null,
) {
  const subjectKey = String(subject || "").trim();
  let cachedQuestions = getQuestionsForSubject(subject);
  if (typeof customFilter === "function") {
    cachedQuestions = cachedQuestions.filter(customFilter);
  }

  if (cachedQuestions.length > 0 && !pass) {
    const lastRefresh = Number(lastDeckRefreshAtBySubject[subjectKey] || 0);
    const staleAfterMs = 10 * 60 * 1000;
    const shouldRefreshStaleDeck =
      Date.now() - lastRefresh > staleAfterMs &&
      (syncConnected || state.categorySummary.length > 0) &&
      !deckFetchInFlight.has(subjectKey);

    if (shouldRefreshStaleDeck) {
      const refreshPromise = fetchDeckQuestionsFromNetwork(
        subject,
        pass,
        customFilter,
        loaderElement,
      );
      refreshPromise.catch(() => getQuestionsForSubject(subject));
    } else {
      if (loaderElement) {
        loaderElement.classList.add("hidden");
        loaderElement.classList.remove("flex");
      }
    }

    return cachedQuestions;
  }

  return await fetchDeckQuestionsFromNetwork(
    subject,
    pass,
    customFilter,
    loaderElement,
  );
}

async function fetchDeckQuestionsFromNetwork(
  subject,
  pass,
  customFilter,
  loaderElement = null,
) {
  const subjectKey = `${String(subject || "").trim()}::${String(pass || "")}::${typeof customFilter === "function" ? "mcq" : "all"}`;
  if (deckFetchInFlight.has(subjectKey)) {
    return deckFetchInFlight.get(subjectKey);
  }

  const request = (async () => {
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

      let newQuestions = response;
      if (newQuestions && newQuestions.error) {
        const errorText = String(newQuestions.error || "").toLowerCase();
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

      let validQuestions = newQuestions
        .map((q) => normalizeQuestionRecord(q, subject))
        .filter((q) => q.Question && q.Question.trim() !== "");
      if (typeof customFilter === "function")
        validQuestions = validQuestions.filter(customFilter);

      validQuestions = validQuestions.map((q) => {
        let cleanId = q.ID
          ? q.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, "")
          : Math.random().toString(36).substr(2, 6);
        q.ID = `${q.Subject}::${cleanId}`;
        return q;
      });

      if (validQuestions.length === 0) {
        const cachedForSubject = getQuestionsForSubject(subject);
        if (cachedForSubject.length > 0) {
          return cachedForSubject;
        }
      }

      const otherQuestions = state.db.filter((q) => q.Subject !== subject);
      state.db = [...otherQuestions, ...validQuestions];
      lastDeckRefreshAtBySubject[String(subject || "").trim()] = Date.now();
      clearLocalDownloadDeleted(subject);
      rebuildQuestionIndex();
      await safeIdbSet("mrh_db", state.db);
      if (typeof renderCategoryProgress === "function") {
        renderCategoryProgress();
      }

      return validQuestions;
    } catch (err) {
      const cachedQuestions = getQuestionsForSubject(subject);
      const message =
        err && err.message
          ? err.message
          : "Unable to load deck data from the backend.";
      console.warn("Network fetch failed.", err);
      if (cachedQuestions.length > 0) {
        showToast(
          `Unable to load "${subject}" from the database. Showing the cached version instead.`,
          "error",
        );
        return cachedQuestions;
      }
      showToast(
        `Unable to load "${subject}" from the database. ${message}`,
        "error",
      );
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
    deckFetchInFlight.delete(subjectKey);
  }
}

async function reviewDeck(subject, pass = null) {
  const loader = document.getElementById(getDeckLoaderId(subject));

  if (isDeckHidden(subject)) {
    showToast("This deck is hidden and not available.", "warning");
    return;
  }

  if (isDeckLocked(subject) && !pass) {
    pendingDeckSubject = subject;
    pendingDeckAction = "resume-review";
    openDeckPasswordModal(subject, "resume-review");
    return;
  }

  // Check local cache first if no password is provided
  let validQuestions = [];
  if (!pass) {
    validQuestions = getQuestionsForSubject(subject);
  }

  // Fetch if cache is empty or password is required
  if (validQuestions.length === 0 || pass) {
    validQuestions = await fetchDeckQuestions(subject, pass, loader);
  }

  if (validQuestions.length === 0) {
    if (isDeckLocked(subject)) {
      pendingDeckSubject = subject;
      pendingDeckAction = "resume-review";
      openDeckPasswordModal(subject, "resume-review");
      if (loader) loader.classList.add("hidden");
      return;
    }
    showToast(
      `Cannot review deck. You are offline and "${subject}" has not been downloaded yet.`,
      "warning",
      5000,
    );
    if (loader) loader.classList.add("hidden");
    return;
  }

  if (loader) loader.classList.add("hidden");
  state.prefs.lastActivity = {
    mode: "review",
    subject,
    updatedAt: new Date().toISOString(),
  };
  saveState();
  renderDeckReview(subject, validQuestions);
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
  renderCategoryProgress();
  showToast(isFavorite ? "Removed from Favorites." : "Added to Favorites.");
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
    throw new Error("SessionCore is required before computing SRS intervals.");
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

function endSession(silent = false) {
  if (
    typeof SessionCore === "undefined" ||
    typeof SessionCore.endSession !== "function"
  ) {
    throw new Error("SessionCore is required before ending a session.");
  }
  return SessionCore.endSession(silent);
}

function renderCharts() {
  return Analytics.renderCharts();
}

function toggleTheme() {
  return Analytics.toggleTheme();
}

function updateThemeButton() {
  return Analytics.updateThemeButton();
}

async function resetProgress() {
  if (
    await requestConfirmation(
      "Are you sure? This deletes mistakes, all statistics, and your current saved session.",
      "Reset All Progress",
    )
  ) {
    if (state.session?.autoNextTimeout) {
      clearTimeout(state.session.autoNextTimeout);
    }
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

    clearSessionProgress();
    await saveState();
    updateDashboard();
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
    await requestConfirmation(
      "WARNING: Are you sure you want to clear the locally saved database? You will need an active internet connection to sync the questions again. The app will reload to apply changes.",
      "Clear Local Database",
    )
  ) {
    await safeIdbDel("mrh_db");
    state.db = [];
    rebuildQuestionIndex();
    clearSessionProgress();
    state.prefs.lastActivity = null;
    await saveState();
    window.location.reload();
  }
}

let clearAppDataInProgress = false;

async function clearAppData() {
  if (clearAppDataInProgress) return;
  clearAppDataInProgress = true;

  try {
    if (
      !(await requestConfirmation(
        "This permanently deletes this app's locally saved decks, progress, preferences, saved sessions, and app cache. Continue?",
        "Clear App Data",
      ))
    ) {
      return;
    }

    if (
      !(await requestConfirmation(
        "Final confirmation: only data owned by this app will be erased. Other same-origin website data will be left untouched.",
        "Confirm Permanent Deletion",
      ))
    ) {
      return;
    }

    if (
      typeof idbKeyval !== "undefined" &&
      typeof idbKeyval.del === "function"
    ) {
      await idbKeyval.del("mrh_db");
    }

    if (
      typeof StorageUtils !== "undefined" &&
      typeof StorageUtils.clearCurrentNamespace === "function"
    ) {
      StorageUtils.clearCurrentNamespace({ includeLegacy: true });
    }

    // Intentionally do not clear every IndexedDB database, CacheStorage entry,
    // or service worker on this origin.
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
    console.error("Unable to clear app data.", error);
    showToast("Some app data could not be cleared. Please try again.", "error");
  } finally {
    clearAppDataInProgress = false;
  }
}

document.addEventListener("keydown", (e) => {
  const reportModal = document.getElementById("report-modal");
  const settingsModal = document.getElementById("session-settings-modal");

  const isReportModalOpen =
    reportModal && reportModal.getAttribute("aria-hidden") !== "true";
  const isSettingsModalOpen =
    settingsModal && settingsModal.getAttribute("aria-hidden") !== "true";

  if (!state.session.active || isReportModalOpen || isSettingsModalOpen) return;

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
});

let globallyReportedQs = new Set();

async function fetchGlobalReports() {
  try {
    const reports = await AppNetwork.getReports({ role: "user" });
    if (Array.isArray(reports))
      globallyReportedQs = new Set(reports.map((r) => r.questionId));
  } catch (e) {
    console.warn("Unable to fetch global reports", e);
  }
}

window.addEventListener("resize", () => {
  if (state.session.active && state.prefs.quizNavigationPosition === "auto")
    applyNavigationPosition();
});

function saveSessionProgress() {
  if (
    typeof SessionCore === "undefined" ||
    typeof SessionCore.saveSessionProgress !== "function"
  ) {
    throw new Error("SessionCore is required before saving session progress.");
  }
  return SessionCore.saveSessionProgress();
}

function checkSavedSession() {
  if (
    typeof SessionCore === "undefined" ||
    typeof SessionCore.checkSavedSession !== "function"
  ) {
    throw new Error("SessionCore is required before checking saved sessions.");
  }
  return SessionCore.checkSavedSession();
}

let pendingResumeSession = null;

async function resumeSession(password = null) {
  if (
    typeof window !== "undefined" &&
    window.__MRH_BOOTSTRAP__?.status !== "ready" &&
    !__mrhAppReady
  ) {
    throw new Error("App bootstrap not complete yet.");
  }

  const activity = state.prefs.lastActivity;
  if (
    activity?.mode === "review" &&
    activity.subject &&
    !pendingResumeSession
  ) {
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

  const saved = getStoredItem("saved_session");
  if (!saved) return;

  const savedSession = pendingResumeSession || JSON.parse(saved);
  const currentQuestion = savedSession.questions?.[savedSession.currentIndex];
  const currentSubject = currentQuestion?.Subject;

  if (
    (isDeckHidden(currentSubject) || isDeckLocked(currentSubject)) &&
    !password
  ) {
    pendingResumeSession = savedSession;
    pendingDeckSubject = currentSubject;
    pendingDeckAction = "resume";
    openDeckPasswordModal(currentSubject, "resume");
    return;
  }

  if (currentSubject && (password || isDeckLocked(currentSubject))) {
    await fetchDeckQuestions(currentSubject, password);
  }

  pendingResumeSession = null;
  state.session = savedSession;

  state.session.questions = state.session.questions.map((savedQ, index) => {
    let searchId = savedQ.ID;
    if (searchId && !searchId.toString().includes("::")) {
      let cleanId = searchId.toString().replace(/^[a-zA-Z]+[-\s]?/, "");
      searchId = `${savedQ.Subject}::${cleanId}`;
    }

    const freshQ = (state.db || []).find(
      (dbQ) => dbQ.ID === searchId || dbQ.ID === savedQ.ID,
    );

    if (freshQ) {
      savedQ.Question = freshQ.Question;
      savedQ.Explanation = freshQ.Explanation;

      const realCorrectText = freshQ[`Choice${freshQ.Answer}`];

      if (savedQ.ChoiceA === realCorrectText) savedQ.Answer = "A";
      else if (savedQ.ChoiceB === realCorrectText) savedQ.Answer = "B";
      else if (savedQ.ChoiceC === realCorrectText) savedQ.Answer = "C";
      else if (savedQ.ChoiceD === realCorrectText) savedQ.Answer = "D";
      else {
        const freshShuffled = prepareSessionPool([freshQ])[0];
        savedQ.ChoiceA = freshShuffled.ChoiceA;
        savedQ.ChoiceB = freshShuffled.ChoiceB;
        savedQ.ChoiceC = freshShuffled.ChoiceC;
        savedQ.ChoiceD = freshShuffled.ChoiceD;
        savedQ.Answer = freshShuffled.Answer;

        if (state.session.userAnswers[index]) {
          // FIXED: Replaced 'delete' with setting to null
          // to prevent array/object indexing bugs
          state.session.userAnswers[index] = null;
        }
      }
    } else {
      console.warn(
        `Question ${searchId || savedQ.ID} not found in DB. Falling back to saved session data.`,
      );
    }
    return savedQ;
  });

  navigate("practice");
  document.getElementById("session-setup").classList.add("hidden");
  document.getElementById("session-active").classList.remove("hidden");

  renderQuestion();
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

function toggleLayout() {
  state.prefs.layoutMode = state.prefs.layoutMode === "grid" ? "list" : "grid";
  saveState();
  renderCategoryProgress();
}

function getCurrentReviewSubject() {
  return DeckReviewCore?.getCurrentReviewSubject?.() || "";
}

function getNavigationContextSubject() {
  if (
    document.getElementById("view-deck-review")?.classList.contains("active")
  ) {
    return getCurrentReviewSubject();
  }

  if (state.session?.active) {
    return state.session.questions?.[state.session.currentIndex]?.Subject || "";
  }

  return "";
}

function getQuizNavigationPosition(subject = getNavigationContextSubject()) {
  const deckKey = String(subject || "").trim();
  const override = deckKey ? getDeckNavigationOverride(deckKey, "quiz") : null;
  if (override) {
    return ["top", "bottom"].includes(override) ? override : "top";
  }
  if (state.prefs.quizNavigationPosition !== "auto")
    return state.prefs.quizNavigationPosition;
  return window.innerWidth <= QUIZ_NAVIGATION_BREAKPOINT ? "top" : "bottom";
}

function getDeckNavigationOverride(subject, type) {
  const deckKey = String(subject || "").trim();
  if (!deckKey) return null;
  const overrides = state.prefs.deckNavigationOverrides || {};
  const deckOverrides = overrides[deckKey];
  if (!deckOverrides || !deckOverrides[type]) return null;
  return deckOverrides[type];
}

function setDeckNavigationOverride(subject, type, value) {
  const deckKey = String(subject || "").trim();
  if (!deckKey) return;
  state.prefs.deckNavigationOverrides =
    state.prefs.deckNavigationOverrides || {};
  state.prefs.deckNavigationOverrides[deckKey] =
    state.prefs.deckNavigationOverrides[deckKey] || {};
  state.prefs.deckNavigationOverrides[deckKey][type] = value;
  saveState();
}

function getStudyNavigationPosition(
  layoutType = state.prefs.studyLayout || "scroll",
  subject = getNavigationContextSubject(),
) {
  const normalizedLayout = layoutType === "single" ? "single" : "scroll";
  const overrideKey =
    normalizedLayout === "single" ? "studySingle" : "studyScroll";
  const overrideValue = getDeckNavigationOverride(subject, overrideKey);
  if (overrideValue) {
    if (normalizedLayout === "single") {
      return ["top", "bottom"].includes(overrideValue) ? overrideValue : "top";
    }
    return ["top", "bottom", "both"].includes(overrideValue)
      ? overrideValue
      : "both";
  }

  const value =
    normalizedLayout === "single"
      ? state.prefs.studySingleNavigationPosition
      : state.prefs.studyScrollNavigationPosition;

  if (normalizedLayout === "single") {
    return ["top", "bottom"].includes(value) ? value : "top";
  }

  if (!["top", "bottom", "both"].includes(value)) {
    return "both";
  }

  return value;
}

function setStudyNavigationPosition(
  layoutType,
  position,
  subject = getNavigationContextSubject(),
) {
  const normalized =
    position === "bottom" ? "bottom" : position === "both" ? "both" : "top";
  const effectiveLayout = layoutType === "single" ? "single" : "scroll";

  if (effectiveLayout === "single") {
    const nextValue = normalized === "both" ? "top" : normalized;
    if (subject) {
      setDeckNavigationOverride(subject, "studySingle", nextValue);
    } else {
      state.prefs.studySingleNavigationPosition = nextValue;
    }
  } else {
    if (subject) {
      setDeckNavigationOverride(subject, "studyScroll", normalized);
    } else {
      state.prefs.studyScrollNavigationPosition = normalized;
    }
  }

  state.prefs.reviewNavigationPosition =
    effectiveLayout === "single"
      ? subject
        ? getStudyNavigationPosition("single", subject)
        : state.prefs.studySingleNavigationPosition
      : subject
        ? getStudyNavigationPosition("scroll", subject)
        : state.prefs.studyScrollNavigationPosition;
}

function getScrollNavigationButtonLabel(position) {
  const normalized = ["top", "bottom", "both"].includes(position)
    ? position
    : "top";
  if (normalized === "both") return "TOP + BOTTOM";
  if (normalized === "bottom") return "on Bottom";
  return "on TOP";
}

function cycleNavigationModeButton(mode, button) {
  const layoutType =
    mode === "study"
      ? state.prefs.studyLayout === "single"
        ? "single"
        : "scroll"
      : mode;

  const orderByMode = {
    quiz: ["top", "bottom"],
    single: ["top", "bottom"],
    scroll: ["top", "both", "bottom"],
  };
  const order = orderByMode[layoutType] || ["top", "bottom"];

  const subject = getNavigationContextSubject() || null;

  let current = "top";
  if (layoutType === "quiz") {
    current = getQuizNavigationPosition(subject) || "top";
  } else if (layoutType === "single") {
    current = getStudyNavigationPosition("single", subject) || "top";
  } else {
    current = getStudyNavigationPosition("scroll", subject) || "top";
  }

  const next = order[(order.indexOf(current) + 1) % order.length];

  if (layoutType === "quiz") {
    if (subject) {
      setDeckNavigationOverride(subject, "quiz", next);
    } else {
      state.prefs.quizNavigationPosition = next;
      state.prefs.quizNavigationMode = "manual";
    }
  } else if (layoutType === "single") {
    setStudyNavigationPosition("single", next, subject);
  } else {
    setStudyNavigationPosition("scroll", next, subject);
  }

  saveState();
  applyNavigationPosition();
  if (
    document.getElementById("view-deck-review")?.classList.contains("active")
  ) {
    reRenderDeckReview();
  }

  if (button) {
    button.textContent = getScrollNavigationButtonLabel(next);
  }
}

function cycleScrollNavigationPosition() {
  cycleNavigationModeButton(
    "scroll",
    document.getElementById("main-navigation-scroll-button"),
  );
}

function changeDeckNameMode(mode) {
  const normalizedMode = ["clip", "wrap"].includes(mode) ? mode : "wrap";
  state.prefs.deckNameMode = normalizedMode;
  state.prefs.titleMode = normalizedMode;
  saveState();
  applyTitleMode();
  renderCategoryProgress();
}

function changeDeckSort(sortOrder) {
  state.prefs.deckSortBy = ["letters", "questions"].includes(sortOrder)
    ? sortOrder
    : "letters";

  const menu = document.getElementById("deck-sort-menu");
  if (menu) menu.open = false;

  saveState();
  renderCategoryProgress();
}

function changeDeckSource(sourceValue) {
  const validSources = ["all", "favorites", "downloaded", "cloud", "archived"];
  state.prefs.deckSourceFilter = validSources.includes(sourceValue)
    ? sourceValue
    : "all";

  const sourceLabels = {
    all: "All Decks",
    favorites: "Favorites",
    downloaded: "Downloaded",
    cloud: "Cloud Only",
    archived: "Archived",
  };

  const label = document.getElementById("deck-source-label");
  if (label) label.innerText = sourceLabels[state.prefs.deckSourceFilter];

  document.querySelectorAll(".deck-source-option").forEach((btn) => {
    const check = btn.querySelector(".source-check");
    const isSelected = btn.dataset.sourceValue === state.prefs.deckSourceFilter;
    if (check) check.style.opacity = isSelected ? "1" : "0";
  });

  const menu = document.getElementById("deck-source-menu");
  if (menu) menu.open = false;

  const select = document.getElementById("deck-source-filter");
  if (select) select.value = state.prefs.deckSourceFilter;

  saveState();
  renderCategoryProgress();
}

function toggleDeckSortDirection() {
  setDeckSortDirection(
    state.prefs.deckSortDirection === "desc" ? "asc" : "desc",
  );
}

function setDeckSortDirection(direction) {
  state.prefs.deckSortDirection = direction === "desc" ? "desc" : "asc";
  saveState();
  renderCategoryProgress();
}

function applyNavigationPosition() {
  const navigation = document.getElementById("quiz-navigation");
  const topAnchor = document.getElementById("quiz-navigation-top");
  const bottomAnchor = document.getElementById("quiz-navigation-bottom");
  if (!navigation || !topAnchor || !bottomAnchor) return;

  const savedPosition = state.session.active
    ? getQuizNavigationPosition()
    : getStudyNavigationPosition(state.prefs.studyLayout || "scroll");
  const position = ["top", "bottom", "both"].includes(savedPosition)
    ? savedPosition
    : "top";

  if (navigation.parentElement)
    navigation.parentElement.removeChild(navigation);
  const existingBottomClone = bottomAnchor.querySelector(
    ".quiz-navigation-clone",
  );
  if (existingBottomClone) existingBottomClone.remove();

  if (position === "both") {
    topAnchor.appendChild(navigation);
    const bottomClone = navigation.cloneNode(true);
    bottomClone.id = "quiz-navigation-bottom-clone";
    bottomClone.classList.add("quiz-navigation-clone");
    bottomAnchor.appendChild(bottomClone);
    topAnchor.classList.remove("hidden");
    bottomAnchor.classList.remove("hidden");
    return;
  }

  (position === "top" ? topAnchor : bottomAnchor).appendChild(navigation);
  topAnchor.classList.toggle("hidden", position !== "top");
  bottomAnchor.classList.toggle("hidden", position !== "bottom");
}

function changeNavigationPosition(position) {
  const normalized = position === "top" ? "top" : "bottom";
  if (
    document.getElementById("view-deck-review")?.classList.contains("active")
  ) {
    const layoutType =
      state.prefs.studyLayout === "single" ? "single" : "scroll";
    setStudyNavigationPosition(layoutType, normalized);
  } else {
    state.prefs.quizNavigationPosition = normalized;
    state.prefs.quizNavigationMode = "manual";
  }
  saveState();
  applyNavigationPosition();
  const select = document.getElementById("navigation-position-select");
  if (select) select.value = normalized;
}

function toggleMainNavigationPosition(mode, source) {
  const normalized = source.checked ? "bottom" : "top";
  if (mode === "quiz") {
    state.prefs.quizNavigationPosition = normalized;
    state.prefs.quizNavigationMode = "manual";
  } else {
    setStudyNavigationPosition(mode, normalized);
  }
  saveState();
  applyNavigationPosition();
  if (
    document.getElementById("view-deck-review")?.classList.contains("active")
  ) {
    reRenderDeckReview();
  }
}

function toggleNavigationPosition(source) {
  changeNavigationPosition(source.checked ? "bottom" : "top");
  if (
    document.getElementById("view-deck-review")?.classList.contains("active")
  ) {
    reRenderDeckReview();
  }
}

async function loadReports() {
  ensureAppReady();

  const pendingContainer = document.getElementById("public-pending-reports");
  const resolvedContainer = document.getElementById("public-resolved-reports");
  if (pendingContainer)
    pendingContainer.innerHTML = `<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-3xl text-brand-500"></i><p class="mt-2 text-gray-500">Fetching community reports...</p></div>`;

  try {
    const reports = await AppNetwork.getReports({ role: "user" });
    if (!Array.isArray(reports) || reports.length === 0) {
      if (pendingContainer)
        pendingContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No pending reports.</p>`;
      if (resolvedContainer)
        resolvedContainer.innerHTML = `<p class="text-center text-gray-500 py-4">No resolved reports.</p>`;
      return;
    }

    let pendingHTML = "";
    let resolvedHTML = "";
    reports.forEach((r) => {
      const isResolved = r.status === "Resolved";
      const statusBadge = isResolved
        ? `<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"><i class="fa-solid fa-check mr-1"></i> Resolved</span>`
        : `<span class="bg-yellow-100 text-yellow-700 px-2 py-1 rounded text-xs font-bold uppercase tracking-wide"><i class="fa-solid fa-clock mr-1"></i> Pending</span>`;
      const phtDate = new Date(r.timestamp).toLocaleString("en-US", {
        timeZone: "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const choices = ["A", "B", "C", "D"]
        .map((letter) => r[`option${letter}`] || r.choices?.[letter])
        .filter((choice) => choice && String(choice).trim());
      const questionType = choices.length <= 1 ? "Identification" : "MCQ";
      const choicesHTML = choices.length
        ? `<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-xs">${choices
            .map(
              (choice, index) =>
                `<div class="bg-gray-50 dark:bg-gray-900/50 p-2 rounded"><strong>${String.fromCharCode(65 + index)}:</strong> ${escapeHTML(choice)}</div>`,
            )
            .join("")}</div>`
        : `<p class="text-xs text-gray-500 mt-3">No choices recorded.</p>`;
      const reportHTML = `
                <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm animate-card-in">
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-xs font-mono text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">${escapeHTML(r.questionId)}</span>
                        ${statusBadge}
                    </div>
                    <h4 class="font-bold text-gray-800 dark:text-gray-100 mb-1">${escapeHTML(r.errorType)}</h4>
                    <div class="text-xs text-brand-600 dark:text-brand-400 font-bold uppercase">Question Type: ${questionType}</div>
                    <p class="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 italic border-l-2 border-brand-500 pl-3 my-2">"${escapeHTML(r.questionText)}"</p>
                    ${choicesHTML}
                    ${r.lesson ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-2"><strong>Lesson / Topic:</strong> ${escapeHTML(r.lesson)}</p>` : ""}
                    ${r.comments ? `<p class="text-sm text-gray-500 dark:text-gray-400 mt-2 bg-gray-50 dark:bg-gray-900/50 p-2 rounded"><i class="fa-solid fa-comment-dots mr-1"></i> ${escapeHTML(r.comments)}</p>` : ""}
                    <div class="text-xs text-gray-400 mt-3 text-right">Reported: ${phtDate}</div>
                </div>
            `;
      if (isResolved) resolvedHTML += reportHTML;
      else pendingHTML += reportHTML;
    });
    document.getElementById("public-pending-reports").innerHTML =
      pendingHTML ||
      `<p class="text-center text-gray-500 py-4">No pending reports.</p>`;
    document.getElementById("public-resolved-reports").innerHTML =
      resolvedHTML ||
      `<p class="text-center text-gray-500 py-4">No resolved reports.</p>`;
  } catch (err) {
    if (pendingContainer)
      pendingContainer.innerHTML = `<div class="text-red-500 text-center p-4">Failed to load reports. Check your connection.</div>`;
  }
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
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function toggleActiveRecall() {
  const isChecked = document.getElementById("toggle-active-recall").checked;
  state.prefs.activeRecall = Boolean(isChecked);
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

function updateRecentDecks(subj) {
  if (!subj) return;
  if (!state.prefs.recentDecks) state.prefs.recentDecks = [];
  const recentDecks = state.prefs.recentDecks || [];
  const filtered = recentDecks.filter((d) => d !== subj);
  filtered.unshift(subj);
  state.prefs.recentDecks = filtered.slice(0, 10);
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

  const finishDeckInteraction = () => {
    if (activeDeckInteractionKey === nextKey) {
      deckInteractionLocked = false;
      activeDeckInteractionKey = null;
    }
  };

  // If deck was locally deleted, clear it from deleted list so we fetch fresh
  if ((state.prefs.localDownloadDeletedDecks || []).includes(subj)) {
    clearLocalDownloadDeleted(subj);
    saveState();
  }

  const readiness = getDeckDataReadinessState();

  if (readiness.isBlocked) {
    updateSyncStatus(
      '<i class="fa-solid fa-xmark mr-1"></i> Decks are temporarily unavailable while the database reconnects.',
      "warning",
    );
    finishDeckInteraction();
    return;
  }

  if (readiness.shouldPromptForCachedData) {
    const staleWarningText =
      readiness.cacheAgeMs >= STALE_CACHE_MAX_AGE_MS
        ? `Using cached deck data from ${formatCacheAge(readiness.cacheAgeMs)}. This data may be stale or incomplete. Continue anyway?`
        : "The database is temporarily unavailable and the deck list may be out of date. Continue with cached deck data?";

    const confirmed = await requestConfirmation(
      staleWarningText,
      "Cached data warning",
    );
    if (!confirmed) {
      updateSyncStatus(
        '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Cached deck data was not used. Waiting for the live database connection.',
        "warning",
      );
      finishDeckInteraction();
      return;
    }

    updateSyncStatus(
      '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Using cached deck data. Live sync is unavailable.',
      "warning",
    );
  } else if (readiness.isUsingCachedData) {
    updateSyncStatus(
      '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Using cached deck data. Background sync unavailable.',
      "warning",
    );
  }

  updateRecentDecks(subj);
  saveState();

  const deckInfo = state.categorySummary.find((c) => c.Subject === subj);
  if (isDeckHidden(subj) || (deckInfo && deckInfo.Hidden)) {
    showToast("This deck is hidden and not available.", "warning");
    finishDeckInteraction();
    return;
  }
  if (isDeckLocked(subj) || (deckInfo && deckInfo.Locked)) {
    pendingDeckSubject = subj;
    pendingDeckAction = action;
    openDeckPasswordModal(subj, action);
    finishDeckInteraction();
    return;
  }

  const startPromise =
    currentAppMode === "review"
      ? reviewDeck(subj, null)
      : fetchAndStartCategory(subj, action, null);

  Promise.resolve(startPromise)
    .catch(() => {})
    .finally(() => {
      finishDeckInteraction();
    });
}

function toggleShuffleChoices(source) {
  source =
    source ||
    document.getElementById("toggle-shuffle-choices") ||
    document.getElementById("toggle-modal-shuffle-choices");
  const isChecked = source ? source.checked : true;
  state.prefs.shuffleChoices = isChecked;
  saveState();
  syncPreferenceControls();

  if (state.session.active) {
    const remainingQuestions = state.session.questions.slice(
      state.session.currentIndex,
    );
    const reprepared = prepareSessionPool(remainingQuestions);
    state.session.questions.splice(
      state.session.currentIndex,
      reprepared.length,
      ...reprepared,
    );
    renderQuestion();
  }
}

function toggleShuffleQuestions(source) {
  const element = source || document.getElementById("toggle-shuffle-questions");
  const isChecked = element ? element.checked : true;
  state.prefs.shuffleQuestions = isChecked;
  saveState();
  syncPreferenceControls();
}

function setTitleMode(mode) {
  if (!["clip", "wrap"].includes(mode)) return;

  const normalizedMode = mode === "clip" ? "clip" : "wrap";
  state.prefs.deckNameMode = normalizedMode;
  state.prefs.titleMode = normalizedMode;
  saveState();
  applyTitleMode();
  updateTitleModeButton();
}

function applyTitleMode() {
  const mode = state.prefs.titleMode || "wrap";
  const body = document.body;

  if (body) {
    body.classList.toggle("title-mode-wrap", mode === "wrap");
    body.classList.toggle("title-mode-clip", mode === "clip");
  }

  document
    .querySelectorAll(
      ".dashboard-header-row, .quiz-header-row, .review-header-row, .app-content-shell, main, .view-section, #view-dashboard, #view-practice, #view-deck-review",
    )
    .forEach((el) => {
      el.classList.add("min-w-0", "max-w-full");
      if (mode === "wrap") {
        el.classList.add("flex-wrap");
        el.style.maxWidth = "100%";
        el.style.minWidth = "0";
      } else {
        el.classList.remove("flex-wrap");
        el.style.maxWidth = "100%";
        el.style.minWidth = "0";
      }
    });

  const dashboardH2 = document.querySelector(".dashboard-header-row h2");
  const quizSubject = document.getElementById("q-subject");
  const reviewTitle = document.getElementById("deck-review-title");

  [dashboardH2, quizSubject, reviewTitle].forEach((elem) => {
    if (!elem) return;

    const parent = elem.parentElement;

    if (mode === "clip") {
      elem.classList.add("truncate", "overflow-hidden");
      elem.classList.remove("whitespace-normal", "break-words");
      elem.style.whiteSpace = "nowrap";
      elem.style.overflow = "hidden";
      elem.style.textOverflow = "ellipsis";
      elem.style.overflowWrap = "normal";
      elem.style.wordBreak = "normal";

      if (parent) {
        parent.classList.add("min-w-0", "overflow-hidden");
        parent.classList.remove("flex-wrap");
      }
    } else if (mode === "wrap") {
      elem.classList.remove("truncate", "overflow-hidden");
      elem.classList.add("whitespace-normal", "break-words");
      elem.style.whiteSpace = "normal";
      elem.style.overflow = "hidden";
      elem.style.textOverflow = "clip";
      elem.style.overflowWrap = "anywhere";
      elem.style.wordBreak = "break-word";

      if (parent) {
        parent.classList.add("min-w-0");
        parent.classList.add("overflow-hidden");
        parent.classList.remove("flex-wrap");
      }
    }
  });
}

function toggleTitleMode() {
  const currentMode = state.prefs.titleMode || "wrap";
  const newMode = currentMode === "wrap" ? "clip" : "wrap";
  setTitleMode(newMode);
  updateTitleModeButton();
}

function updateTitleModeButton() {
  const mode = state.prefs.titleMode || "wrap";
  const btn = document.getElementById("title-mode-toggle-btn");
  if (btn) {
    btn.textContent = mode === "clip" ? "Clip" : "Wrap";
  }
}

const folderPasswordButton = document.getElementById(
  "btn-submit-folder-password",
);
if (folderPasswordButton) {
  folderPasswordButton.addEventListener("click", async () => {
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
        console.error("Verification failed", error);
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
  });
}

const btnSubmitDeckPassword = document.getElementById(
  "btn-submit-deck-password",
);

if (btnSubmitDeckPassword) {
  btnSubmitDeckPassword.addEventListener("click", async () => {
    const input = document.getElementById("deck-password-input");
    const pass = input?.value || "";

    if (!pass) {
      setFormError("deck-password-input", "Please enter a password.");
      input?.focus();
      return;
    }

    setFormError("deck-password-input", "");

    await runWithBusyButton(btnSubmitDeckPassword, "Verifying...", async () => {
      closeDeckPasswordModal();
      if (pendingDeckAction === "resume") {
        await resumeSession(pass);
      } else if (pendingDeckAction === "resume-review") {
        await reviewDeck(pendingDeckSubject, pass);
      } else if (currentAppMode === "review") {
        reviewDeck(pendingDeckSubject, pass);
      } else {
        fetchAndStartCategory(pendingDeckSubject, pendingDeckAction, pass);
      }
    });
  });
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
    throw new Error("DeckReview is required before changing study page size.");
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
    currentState = state.prefs.showWrongChoices !== false;
  }

  state.prefs.qToggles[qId] = !currentState;
  saveState();
  reRenderDeckReview();
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
  renderQuestion();
}

function toggleStudyFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch((err) => {
      console.warn(`Error attempting to enable fullscreen: ${err.message}`);
    });
  } else {
    document.exitFullscreen();
  }
}

if (!state.prefs.qTypeOverride) state.prefs.qTypeOverride = "auto";

function getQuestionTypeMode(q) {
  let validChoicesCount = 0;
  ["A", "B", "C", "D"].forEach((ch) => {
    const choiceText = q[`Choice${ch}`];
    if (
      choiceText &&
      String(choiceText).trim() !== "" &&
      String(choiceText).toLowerCase() !== "undefined"
    ) {
      validChoicesCount++;
    }
  });

  const isForcedIdent = state.prefs.qTypeOverride === "ident";
  const isForcedMCQ = state.prefs.qTypeOverride === "mcq";

  let isPureIdent;
  if (isForcedIdent) {
    isPureIdent = true;
  } else if (isForcedMCQ) {
    isPureIdent = false;
  } else {
    isPureIdent = validChoicesCount <= 1;
  }

  return { isIdent: isPureIdent, validChoicesCount };
}

async function changeQuestionTypeMode(mode) {
  if (state.prefs.qTypeOverride === mode) return;

  const userConfirmed = await requestConfirmation(
    `Are you sure you want to switch to ${mode.toUpperCase()} mode?`,
    "Change Question Type",
  );

  if (!userConfirmed) {
    return;
  }

  if (mode === "ident") {
    showToast(
      "Strict Identification mode enabled. Choices are hidden for MCQs.",
      "warning",
    );
  } else if (mode === "mcq") {
    showToast(
      "Strict MCQ mode enabled. Choices may be undefined when no alternatives exist.",
      "warning",
    );
  }

  state.prefs.qTypeOverride = mode;
  saveState();
  if (state.session.active) renderQuestion();
}

let lastScrollTop = 0;
let isTicking = false;

// CRITICAL FIX: Cache invalidation management
function setupCacheInvalidationListener() {
  if (typeof BroadcastChannel === "undefined") return;

  try {
    cacheInvalidationChannel = new BroadcastChannel("mrh_cache_invalidation");
    cacheInvalidationChannel.onmessage = (event) => {
      if (event.data && event.data.type === "cache_invalidated") {
        console.log("[CACHE] Invalidation signal received:", event.data);
        // Force refresh database when the cache version changes
        handleCacheInvalidation();
      }
    };
  } catch (e) {
    console.error("[CACHE] Failed to setup invalidation listener:", e);
  }
}

function triggerSilentSummaryRefresh(reason = "cache invalidation") {
  console.log(`[CACHE] ${reason} - syncing silently in background`);
  syncDatabase(false, true);
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
    console.log("[STATE] Fetching latest app state in-memory...");
    await triggerSilentSummaryRefresh("Refreshing app state in memory");

    console.log("[STATE] In-memory state refresh complete");
    return true;
  } catch (error) {
    console.error("[STATE] Failed to refresh state:", error);
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
function setupLeaderElection() {
  if (typeof BroadcastChannel === "undefined") {
    // Fallback: single-tab or older browser, act as leader.
    isLeaderTab = true;
    console.log(
      "[LEADER] BroadcastChannel unavailable; this tab is the leader",
    );
    return;
  }

  try {
    if (leaderElectionChannel) {
      try {
        leaderElectionChannel.close();
      } catch (e) {}
    }

    leaderElectionChannel = new BroadcastChannel("mrh_leader_election");
    window.mrh_tabId =
      window.mrh_tabId ||
      `tab_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    const peers = new Map();
    const PEER_TTL_MS = 25000;

    const electLeader = () => {
      const now = Date.now();
      for (const [tabId, seenAt] of peers) {
        if (now - seenAt > PEER_TTL_MS) peers.delete(tabId);
      }
      const candidates = [window.mrh_tabId, ...peers.keys()].sort();
      const nextLeader = candidates[0] || window.mrh_tabId;
      const wasLeader = isLeaderTab;
      isLeaderTab = nextLeader === window.mrh_tabId;
      if (wasLeader !== isLeaderTab) {
        console.log(
          `[LEADER] ${isLeaderTab ? "Became" : "Yielded"} leadership: ${nextLeader}`,
        );
        if (isLeaderTab && typeof scheduleNextPolling === "function") {
          // Reclaiming leadership must restart sync polling.
          scheduleNextPolling();
        }
      }
    };

    leaderElectionChannel.onmessage = (event) => {
      const data = event?.data;
      if (!data || !data.type) return;

      if (data.type === "leader_heartbeat" && data.tabId) {
        if (data.tabId !== window.mrh_tabId) {
          peers.set(String(data.tabId), Date.now());
          electLeader();
        }
        return;
      }
    };

    const sendHeartbeat = () => {
      try {
        leaderElectionChannel.postMessage({
          type: "leader_heartbeat",
          tabId: window.mrh_tabId,
          timestamp: Date.now(),
        });
      } catch (e) {
        console.warn("[LEADER] Heartbeat failed:", e);
      }
      electLeader();
    };

    clearInterval(leaderHeartbeatTimer);
    leaderHeartbeatTimer = setInterval(sendHeartbeat, 10000);
    sendHeartbeat();
  } catch (e) {
    console.error("[LEADER] Failed to setup leader election:", e);
    isLeaderTab = true;
  }
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

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      console.log("[VISIBILITY] Tab became visible, checking sync status");
      syncScheduler.handleVisibility(false);
    } else {
      console.log("[VISIBILITY] Tab hidden, will pause polling");
      syncScheduler.handleVisibility(true);
    }
  });
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
  console.log("[CACHE] Cache invalidated - triggering background sync");
  clearTimeout(window.cacheInvalidationTimeout);
  window.cacheInvalidationTimeout = setTimeout(() => {
    triggerSilentSummaryRefresh("Forcing quiet cache refresh");
  }, 100);
}

async function initializeApp() {
  if (window.__MRH_BOOTSTRAP__?.status === "ready") {
    return false;
  }

  if (__mrhAppInitialized) return false;

  if (!hasRequiredAppRuntime()) {
    console.warn(
      "Application initialization deferred until required runtime dependencies are available.",
    );
    scheduleDeferredInitialization();
    return false;
  }

  __mrhAppInitialized = true;

  const bindUi = () => {
    const mainEl = document.querySelector("main");
    const headerEl = document.querySelector("header");
    if (headerEl)
      headerEl.classList.add("transition-transform", "duration-300");

    if (mainEl && headerEl) {
      mainEl.addEventListener("scroll", (e) => {
        if (!isTicking) {
          window.requestAnimationFrame(() => {
            const currentScroll = e.target.scrollTop;

            if (currentScroll > lastScrollTop && currentScroll > 50) {
              headerEl.classList.add("-translate-y-full");
            } else {
              headerEl.classList.remove("-translate-y-full");
            }
            lastScrollTop = currentScroll <= 0 ? 0 : currentScroll;

            if (typeof globalThis.scheduleVirtualReviewRender === "function") {
              globalThis.scheduleVirtualReviewRender();
            }

            const reviewSubject = getCurrentReviewSubject();
            if (
              document
                .getElementById("view-deck-review")
                .classList.contains("active") &&
              reviewSubject
            ) {
              if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
              if (!state.prefs.studyProgress[reviewSubject]) {
                state.prefs.studyProgress[reviewSubject] = {
                  page: 1,
                  index: 0,
                  scrollY: 0,
                };
              }
              state.prefs.studyProgress[reviewSubject].scrollY = currentScroll;
              clearTimeout(window.scrollSaveTimeout);
              window.scrollSaveTimeout = setTimeout(() => saveState(), 1000);
            }

            isTicking = false;
          });

          isTicking = true;
        }
      });
    }
  };

  const applyThemeFromPrefs = () => {
    const enableDark = state.prefs?.darkMode !== false;
    document.documentElement.classList.toggle("dark", enableDark);
    document.documentElement.style.colorScheme = enableDark ? "dark" : "light";
  };

  const renderSkeleton = () => {
    const htmlRoot = document.documentElement;
    if (htmlRoot) {
      htmlRoot.setAttribute("data-app-ready", "false");
    }

    const status = document.getElementById("connection-status");
    if (status) {
      status.textContent = "Loading maritime review data...";
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

    await loadState();

    const toggleElement = document.getElementById("globalModeToggle");
    if (toggleElement) {
      currentAppMode = toggleElement.checked ? "review" : "quiz";
    }

    bindUi();
    applyThemeFromPrefs();
    renderSkeleton();

    __mrhAppReady = true;
    if (typeof window !== "undefined") {
      window.__mrhAppReady = true;
      window.__MRH_BOOTSTRAP__.status = "ready";
      window.__MRH_BOOTSTRAP__.error = null;
      document.documentElement.setAttribute("data-app-ready", "true");
    }

    setupCacheInvalidationListener();
    startCacheVersionChecking();
    initDetailsExclusivity();

    fetchAccessMetadata().catch((err) => {
      console.warn("Initial access metadata fetch failed, will retry:", err);
    });

    await syncDatabase(false, false);
    fetchGlobalReports();

    setTimeout(() => {
      applyTitleMode();
      updateTitleModeButton();
    }, 100);

    return true;
  } catch (error) {
    __mrhAppReady = false;
    if (typeof window !== "undefined") {
      window.__mrhAppReady = false;
      window.__MRH_BOOTSTRAP__.status = "failed";
      window.__MRH_BOOTSTRAP__.error = error;
    }
    console.error("Application data initialization failed:", error);
    showBootstrapError(error);
    return false;
  }
}

window.initializeApp = initializeApp;
