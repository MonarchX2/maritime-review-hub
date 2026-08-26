const DB_URL =
  "https://script.google.com/macros/s/AKfycby4j5hbEWyfqonO9HYKgywo4OAt1NBwerEWWZwLWb1ODbsQGUd-YMMO-H9wX3_C-tBw/exec";

const SYNC_INTERVAL_MS = 15 * 1000;
const QUIZ_NAVIGATION_BREAKPOINT = 768;

let chartInstance = null;
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
let localCacheVersion = "";
let remoteCacheVersion = "";
let isInitialSyncComplete = false; // Track if the first sync from startup has completed
let lastSyncAt = 0;
let syncInFlightPromise = null;
let backgroundSyncPromise = null;
const deckFetchInFlight = new Map();
const lastDeckRefreshAtBySubject = {};
const SYNC_STATUS_STORAGE_KEY = "mrh_last_sync_status_timestamp";
const CACHE_VERSION_STORAGE_KEY = "mrh_cache_version";
const NAVIGATION_PATH_STORAGE_KEY = "mrh_navigation_path"; // Persist user's navigation position
const SYNC_REQUEST_TIMEOUT_MS = 60000;
let __mrhAppInitialized = false;
let __mrhPollLoopToken = 0;

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

function readStoredCacheVersion() {
  return String(getStoredItem?.(CACHE_VERSION_STORAGE_KEY, "") || "").trim();
}

function persistLocalCacheVersion(version) {
  const nextVersion = String(version ?? "").trim();
  localCacheVersion = nextVersion;
  try {
    setStoredItem?.(CACHE_VERSION_STORAGE_KEY, nextVersion);
  } catch (e) {
    console.warn("Unable to persist cache version locally.", e);
  }
}

function persistNavigationPath(pathArray) {
  try {
    const normalized = Array.isArray(pathArray)
      ? pathArray
          .filter((part) => typeof part === "string" && part.trim())
          .map((part) => String(part).trim())
      : [];
    const pathStr = JSON.stringify(normalized);
    setStoredItem?.(NAVIGATION_PATH_STORAGE_KEY, pathStr);
    if (state && typeof state === "object") {
      state.currentPath = normalized;
    }
  } catch (e) {
    console.warn("Unable to persist navigation path.", e);
  }
}

function readStoredNavigationPath() {
  try {
    const stored = getStoredItem?.(NAVIGATION_PATH_STORAGE_KEY, "") || "";
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((part) => typeof part === "string" && part.trim())
      .map((part) => String(part).trim());
  } catch (e) {
    console.warn("Unable to read navigation path from storage.", e);
    return [];
  }
}

function restoreNavigationPathFromStorage() {
  const savedPath = readStoredNavigationPath();
  if (Array.isArray(savedPath) && savedPath.length > 0) {
    state.currentPath = savedPath;
    return savedPath;
  }
  state.currentPath = [];
  return [];
}

// OPTIMIZATION: Leader election pattern - only one tab polls
let isLeaderTab = false;
let leaderHeartbeatTimer = null;
let leaderElectionChannel = null;
let cacheVersionCheckTimer = null;

// OPTIMIZATION: ETag/Hash headers for 304 responses
let lastCacheVersionHash = null;

// OPTIMIZATION: Exponential backoff retry tracking
let failureRetryCount = 0;
let maxRetryAttempts = 5;

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

function firstAvailableValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return value;
  }
  return "";
}

function normalizeQuestionRecord(question, subjectOverride = null) {
  if (!question || typeof question !== "object") return {};

  const source = { ...question };
  const normalized = {
    Subject: firstAvailableValue(subjectOverride, source.Subject, source.s),
    ID: firstAvailableValue(source.ID, source.i),
    Question: firstAvailableValue(source.Question, source.q),
    ChoiceA: firstAvailableValue(source.ChoiceA, source.c?.[0]),
    ChoiceB: firstAvailableValue(source.ChoiceB, source.c?.[1]),
    ChoiceC: firstAvailableValue(source.ChoiceC, source.c?.[2]),
    ChoiceD: firstAvailableValue(source.ChoiceD, source.c?.[3]),
    Answer: firstAvailableValue(source.Answer, source.a),
    Explanation: firstAvailableValue(source.Explanation, source.e),
    ImageURL: firstAvailableValue(source.ImageURL, source.u),
    Tags: firstAvailableValue(source.Tags, source.t),
  };

  if (typeof normalized.Answer === "number") {
    normalized.Answer = ["A", "B", "C", "D"][normalized.Answer] || "";
  }

  if (normalized.Answer) {
    normalized.Answer = String(normalized.Answer).trim().toUpperCase();
  }

  return normalized;
}

function escapeHTML(value) {
  return TextUtils.escapeHTML(value);
}

function renderMathExpression(rawExpression, displayMode) {
  return TextUtils.renderMathExpression(rawExpression, displayMode);
}

function encodeHandlerValue(value) {
  return TextUtils.encodeHandlerValue(value);
}

function decodeHandlerValue(value) {
  return TextUtils.decodeHandlerValue(value);
}

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

async function hydrateDbFromIdb() {
  if (typeof idbKeyval === "undefined") {
    console.warn("idbKeyval library not loaded.");
    return;
  }

  try {
    const savedDb = await idbKeyval.get("mrh_db");
    if (!savedDb || !Array.isArray(savedDb)) return;

    const normalizedDb = savedDb.map((q) => {
      const normalized = normalizeQuestionRecord(q);
      if (normalized.ID && !normalized.ID.toString().includes("::")) {
        let cleanId = normalized.ID.toString().replace(/^[a-zA-Z]+[-\s]?/, "");
        normalized.ID = `${normalized.Subject}::${cleanId}`;
      }
      return normalized;
    });

    state.db = normalizedDb;
    rebuildQuestionIndex();

    if (typeof renderCategoryProgress === "function") {
      renderCategoryProgress();
    }
    if (typeof updateDashboard === "function") {
      updateDashboard();
    }
  } catch (err) {
    console.error("Error loading DB from IndexedDB", err);
  }
}

function hydrateDbFromIdbInBackground() {
  if (typeof idbKeyval === "undefined") return;
  setTimeout(() => {
    hydrateDbFromIdb().catch((err) => {
      console.error("Background IndexedDB hydration failed", err);
    });
  }, 150);
}

async function loadState() {
  if (
    typeof AppState !== "undefined" &&
    typeof AppState.loadState === "function"
  ) {
    return AppState.loadState();
  }

  emitDebugState("load_state:start");
  migrateLegacyStorageKeys();
  localCacheVersion = readStoredCacheVersion();
  lastSyncStatusTimestamp = readStoredSyncStatusTimestamp();
  const savedStats = getStoredItem("stats");
  const savedPrefs = getStoredItem("prefs");
  const savedSummary =
    getStoredItem("summary") || getAnyNamespaceStoredItem("summary");

  hydrateDbFromIdbInBackground();

  if (savedSummary) {
    try {
      state.categorySummary = stripAccessMetadataFromSummary(
        JSON.parse(savedSummary),
      );
    } catch (e) {
      console.error("Summary corrupted, resetting.", e);
      state.categorySummary = [];
    }
  }

  ensureQuestionIndex();

  if (savedStats) {
    try {
      state.stats = JSON.parse(savedStats);
    } catch (e) {
      console.error("Stats corrupted, resetting to default.", e);
      state.stats = {
        totalAnswered: 0,
        correct: 0,
        mistakes: [],
        subjectAccuracy: {},
      };
    }
  }

  if (savedPrefs) {
    try {
      const prefs = JSON.parse(savedPrefs);
      state.prefs = {
        ...state.prefs,
        ...prefs,
      };
      state.prefs.favoriteDecks = Array.isArray(state.prefs.favoriteDecks)
        ? state.prefs.favoriteDecks
        : [];
      state.prefs.recentDecks = Array.isArray(state.prefs.recentDecks)
        ? state.prefs.recentDecks
        : [];
      const canonicalDeckNameMode = ["wrap", "clip"].includes(
        state.prefs.deckNameMode,
      )
        ? state.prefs.deckNameMode
        : ["wrap", "clip"].includes(state.prefs.titleMode)
          ? state.prefs.titleMode
          : "wrap";
      state.prefs.deckNameMode = canonicalDeckNameMode;
      state.prefs.titleMode = canonicalDeckNameMode;
      if (!Object.prototype.hasOwnProperty.call(prefs, "activeRecall")) {
        state.prefs.activeRecall = false;
      }
      if (!Object.prototype.hasOwnProperty.call(prefs, "quizNavigationMode")) {
        state.prefs.quizNavigationMode = "manual";
      }
      if (
        !Object.prototype.hasOwnProperty.call(prefs, "quizNavigationPosition")
      ) {
        state.prefs.quizNavigationPosition = "top";
      }
    } catch (e) {
      console.error("Invalid preferences.", e);
    }
  }

  if (!["top", "bottom", "auto"].includes(state.prefs.quizNavigationPosition))
    state.prefs.quizNavigationPosition = "top";
  if (!["top", "bottom"].includes(state.prefs.reviewNavigationPosition))
    state.prefs.reviewNavigationPosition = "top";
  if (state.prefs.lastActivity?.mode) {
    currentAppMode = state.prefs.lastActivity.mode;
  }

  if (!state.stats.subjectAccuracy) state.stats.subjectAccuracy = {};
  sanitizeDeletedDeckReferences();
  if (!["idle", "immediate"].includes(state.prefs.databaseUpdateMode))
    state.prefs.databaseUpdateMode = "idle";
  if (state.prefs?.darkMode) document.documentElement.classList.add("dark");

  const dbSizeEl = document.getElementById("db-size-display");
  if (dbSizeEl) {
    dbSizeEl.innerText = state.db ? state.db.length : 0;
  }

  // FEATURE: Restore user's navigation position from previous visit
  restoreNavigationPathFromStorage();

  populateFilters();
  updateDashboard();
  updateThemeButton();
  syncPreferenceControls();
  emitDebugState("load_state:complete", {
    dbCount: state.db.length,
    summaryCount: state.categorySummary.length,
  });
}

async function saveState() {
  if (
    typeof AppState !== "undefined" &&
    typeof AppState.saveState === "function"
  ) {
    return AppState.saveState();
  }

  try {
    emitDebugState("save_state:begin", {
      dbCount: state.db.length,
      summaryCount: state.categorySummary.length,
    });
    setStoredJSON("stats", state.stats);
    setStoredJSON("prefs", state.prefs);
    setStoredJSON(
      "summary",
      stripAccessMetadataFromSummary(state.categorySummary || []),
    );
    persistNavigationPath(state.currentPath || []);
  } catch (e) {
    console.error(e);
  }

  syncPreferenceControls();
  updateDashboard();
  emitDebugState("save_state:complete", {
    dbCount: state.db.length,
    summaryCount: state.categorySummary.length,
  });
}

function updateShuffleWarning() {
  const warning = document.getElementById("shuffle-warning");
  if (!warning) return;

  const shouldShowWarning =
    state.prefs.shuffleChoices === false ||
    state.prefs.shuffleQuestions === false;

  warning.classList.toggle("hidden", !shouldShowWarning);
  warning.setAttribute("aria-hidden", String(!shouldShowWarning));
}

function syncPreferenceControls() {
  const values = {
    "toggle-active-recall": state.prefs.activeRecall === true,
    "toggle-shuffle-choices": state.prefs.shuffleChoices !== false,
    "toggle-modal-shuffle-choices": state.prefs.shuffleChoices !== false,
    "toggle-shuffle-questions": state.prefs.shuffleQuestions !== false,
    "toggle-hide-abcd": state.prefs.hideABCD === true,
    "toggle-quiz-hide-abcd": state.prefs.quizHideABCD === true,
    "toggle-cloze-mode": state.prefs.clozeEnabled === true,
    "toggle-main-cloze-mode": state.prefs.clozeEnabled === true,
    "toggle-srs-mode": state.prefs.srsEnabled === true,
    "toggle-main-srs-mode": state.prefs.srsEnabled === true,
    "toggle-wrong-choices": state.prefs.showWrongChoices !== false,
    "toggle-main-navigation-quiz":
      state.prefs.quizNavigationPosition === "bottom",
    "toggle-main-navigation-single":
      state.prefs.studySingleNavigationPosition === "bottom",
    "toggle-main-navigation-scroll":
      state.prefs.studyScrollNavigationPosition === "bottom",
    "toggle-session-navigation-bottom":
      state.prefs.quizNavigationPosition === "bottom",
    "toggle-review-navigation-bottom":
      getStudyNavigationPosition(state.prefs.studyLayout || "scroll") ===
      "bottom",
    globalModeToggle: state.prefs.lastActivity?.mode === "review",
  };

  Object.entries(values).forEach(([id, checked]) => {
    const control = document.getElementById(id);
    if (control) control.checked = checked;
  });

  updateShuffleWarning();

  const databaseUpdateMode = document.getElementById("database-update-mode");
  if (databaseUpdateMode)
    databaseUpdateMode.value = state.prefs.databaseUpdateMode || "idle";

  const deckNameMode = document.getElementById("deck-name-mode");
  if (deckNameMode) {
    deckNameMode.value = ["wrap", "clip"].includes(state.prefs.deckNameMode)
      ? state.prefs.deckNameMode
      : "wrap";
  }

  const modeLabel = document.getElementById("modeLabel");
  if (modeLabel)
    modeLabel.innerText = values.globalModeToggle ? "Study" : "Quiz";
  const navigationSelect = document.getElementById(
    "navigation-position-select",
  );
  if (navigationSelect) {
    navigationSelect.value = document
      .getElementById("view-deck-review")
      ?.classList.contains("active")
      ? getStudyNavigationPosition(state.prefs.studyLayout || "scroll")
      : getQuizNavigationPosition();
  }
  const sortBy = state.prefs.deckSortBy || "letters";
  const sortDirection =
    state.prefs.deckSortDirection === "desc" ? "desc" : "asc";
  const deckSortIcon = document.getElementById("deck-sort-icon");
  if (deckSortIcon) {
    deckSortIcon.className = `fa-solid fa-arrow-${sortDirection === "desc" ? "down" : "up"}`;
  }
  document
    .querySelectorAll(".deck-sort-option[data-sort-value]")
    .forEach((option) => {
      const check = option.querySelector(".sort-check");
      if (check) {
        check.style.opacity = option.dataset.sortValue === sortBy ? "1" : "0";
      }
    });
  document
    .querySelectorAll(".deck-sort-option[data-sort-direction]")
    .forEach((option) => {
      const check = option.querySelector(".sort-direction-check");
      if (check) {
        check.style.opacity =
          option.dataset.sortDirection === sortDirection ? "1" : "0";
      }
    });
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

async function updateDashboard() {
  const statTotal = document.getElementById("stat-total");
  if (statTotal) statTotal.innerText = state.stats.totalAnswered;

  const statCorrect = document.getElementById("stat-correct");
  if (statCorrect) statCorrect.innerText = state.stats.correct;

  const dbSize = document.getElementById("db-size-display");
  if (dbSize) dbSize.innerText = state.db.length;

  if (typeof checkSavedSession === "function") checkSavedSession();
  if (typeof renderCategoryProgress === "function") renderCategoryProgress();
}

async function navigate(viewId) {
  if (
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.navigate === "function"
  ) {
    return DeckNav.navigate(viewId);
  }
  if (
    state.session.active &&
    viewId !== "practice" &&
    !(await requestConfirmation(
      "You have an active session. Do you want to pause and return? Your progress will be saved.",
      "Pause Session",
    ))
  )
    return;

  if (state.session.active && viewId !== "practice") {
    saveSessionProgress();
    state.session.active = false;
    saveState();
  }

  updateDashboard();

  const viewElement = document.getElementById(`view-${viewId}`);
  if (!viewElement) {
    console.warn(`Navigation target not found: ${viewId}`);
    return;
  }

  document
    .querySelectorAll(".view-section")
    .forEach((el) => el.classList.remove("active"));
  viewElement.classList.add("active");

  if (viewId === "stats" && document.getElementById("chart-accuracy")) {
    renderCharts();
  }
}

function getSyncStatusVisualState(tone = "info") {
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.getSyncStatusVisualState === "function"
  ) {
    return AppSync.getSyncStatusVisualState(tone);
  }

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
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.setGlobalLoadingState === "function"
  ) {
    return AppSync.setGlobalLoadingState(isLoading, title, detail, tone);
  }

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
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.updateSyncStatus === "function"
  ) {
    return AppSync.updateSyncStatus(message, tone, showOverlay);
  }
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

async function optimizedBackgroundSync() {
  if (backgroundSyncPromise) return backgroundSyncPromise;

  backgroundSyncPromise = (async () => {
    try {
      if (
        typeof AppSync !== "undefined" &&
        typeof AppSync.optimizedBackgroundSync === "function"
      ) {
        return AppSync.optimizedBackgroundSync();
      }

      // FIX 4: LIGHTWEIGHT BACKGROUND SYNC POLLING
      // First check sync status via lightweight endpoint
      // Only fetch full summary if timestamp changed

      if (!isLeaderTab) {
        // Only leader tab performs polling
        scheduleSyncPoll();
        return;
      }

      try {
        const syncStatus = await checkSyncStatusLightweight();

        if (
          !syncStatus ||
          typeof syncStatus !== "object" ||
          syncStatus.status !== "ok"
        ) {
          // Lightweight check failed - fall back to full sync attempt
          // But do it silently if we have cached data
          if (state.categorySummary.length > 0) {
            console.log(
              "[SYNC] Lightweight check failed, cached data available",
            );
          } else {
            console.log(
              "[SYNC] Lightweight check failed, attempting full sync",
            );
            await syncDatabase(true, true); // isRetry=true, isBackgroundCheck=true
          }
          return;
        }

        if (syncStatus.isColdStart === true) {
          isColdStart = true;
          if (state.categorySummary.length === 0) showColdStartNotification();
          scheduleSyncRetry(state.categorySummary.length === 0);
          return;
        }

        // Compare timestamp with what we last stored
        const storedTimestamp = readStoredSyncStatusTimestamp();
        const newTimestamp = String(syncStatus.syncTimestamp || "").trim();

        if (storedTimestamp !== newTimestamp) {
          // Sync timestamp changed - fetch full summary
          console.log("[SYNC] Sync timestamp changed, fetching full summary");
          persistSyncStatusTimestamp(newTimestamp);
          await syncDatabase(true, true); // isRetry=true, isBackgroundCheck=true
        } else {
          // Timestamp unchanged - database is still current
          console.log("[SYNC] Sync timestamp unchanged, skipping full fetch");
          // Mark as connected since backend is responding
          syncConnected = true;
          isColdStart = false;
        }
      } catch (err) {
        console.error("[SYNC] Optimized background sync error:", err);
        // On error, attempt full sync but with cached data fallback
        await syncDatabase(true, true);
      }
    } finally {
      backgroundSyncPromise = null;
    }
  })();

  return backgroundSyncPromise;
}

function scheduleSyncPoll() {
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.scheduleSyncPoll === "function"
  ) {
    return AppSync.scheduleSyncPoll();
  }

  if (cacheVersionCheckTimer !== null) {
    clearInterval(cacheVersionCheckTimer);
    cacheVersionCheckTimer = null;
  }

  const activeToken = ++__mrhPollLoopToken;
  clearTimeout(syncPollTimer);
  syncPollTimer = setTimeout(() => {
    if (activeToken !== __mrhPollLoopToken) return;
    optimizedBackgroundSync().finally(() => {
      if (activeToken === __mrhPollLoopToken) scheduleSyncPoll();
    });
  }, SYNC_INTERVAL_MS);
}

function scheduleSinglePollLoop() {
  if (!isLeaderTab) {
    if (cacheVersionCheckTimer !== null) {
      clearInterval(cacheVersionCheckTimer);
      cacheVersionCheckTimer = null;
    }
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

function applySummaryData(summaryData) {
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.applySummaryData === "function"
  ) {
    return AppSync.applySummaryData(summaryData);
  }

  // CRITICAL FIX: Don't double-filter - backend already filters hidden decks
  // Only use the data as-is from the backend response
  const previousSummary = JSON.stringify(state.categorySummary || []);
  const nextSummary = JSON.stringify(summaryData || []);
  const changed = previousSummary !== nextSummary;

  state.categorySummary = summaryData || [];
  syncConnected = true;
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
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.scheduleSyncRetry === "function"
  ) {
    return AppSync.scheduleSyncRetry(showOverlay);
  }

  clearTimeout(syncRetryTimer);
  clearInterval(syncCountdownTimer);
  const delay = SYNC_INTERVAL_MS;
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
      return await AppNetwork.getSyncStatus({ timeoutMs: 7000 });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(DB_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ type: "get_sync_status" }),
        redirect: "follow",
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) return null;
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.log("[SYNC] Lightweight status check failed:", err);
    return null;
  }
}

// ============================================
// ENHANCED SYNC DATABASE WITH ALL FIXES
// ============================================
async function syncDatabase(isRetry = false, isBackgroundCheck = false) {
  if (
    typeof AppSync !== "undefined" &&
    typeof AppSync.syncDatabase === "function"
  ) {
    return AppSync.syncDatabase(isRetry, isBackgroundCheck);
  }

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

    const url = `${DB_URL}?_t=${Date.now()}`;

    if (!(isBackgroundCheck && state.categorySummary.length > 0)) {
      updateSyncStatus(
        `<i class="fa-solid fa-spinner fa-spin mr-1"></i> ${isRetry ? "Checking for database updates" : "Connecting to database"}...`,
        "info",
        !isBackgroundCheck,
      );
    }

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

        const changed =
          JSON.stringify(state.categorySummary || []) !==
          JSON.stringify(summaryData);
        const canApplyNow =
          state.prefs.databaseUpdateMode === "immediate" ||
          !state.session.active;

        if (canApplyNow && (changed || !wasConnected)) {
          pendingSummaryData = null;
          applySummaryData(summaryData);
          state.accessMetadata = buildAccessMetadataMap(summaryData);
        } else if (!canApplyNow) {
          if (changed) pendingSummaryData = summaryData;
          if (!wasConnected) renderCategoryProgress();
        }

        updateSyncStatus(
          `<i class="fa-solid fa-check mr-1"></i> Connected. ${changed && !canApplyNow ? "Update waiting until your session ends." : `Checked ${summaryData.length} subjects.`}`,
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

      if (err?.name === "AbortError") {
        if (requestTimedOut) {
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

function populateFilters() {
  // Update old select element if it exists (for backward compatibility)
  const select = document.getElementById("filter-subject");
  if (select) {
    const subjectIndex = ensureQuestionIndex();
    const subjects = [...subjectIndex.bySubject.keys()];

    let tags = new Set();
    (state.db || []).forEach((q) => {
      if (q && q.Tags) {
        q.Tags.split(",")
          .map((t) => t.trim())
          .forEach((t) => tags.add(t));
      }
    });
    tags = [...tags];

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
    const subjectIndex = ensureQuestionIndex();
    const subjects = [...subjectIndex.bySubject.keys()];

    let tags = new Set();
    (state.db || []).forEach((q) => {
      if (q && q.Tags) {
        q.Tags.split(",")
          .map((t) => t.trim())
          .forEach((t) => tags.add(t));
      }
    });
    tags = [...tags];

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

function prepareSessionPool(pool) {
  let randomizedPool = [...pool];
  if (state.prefs.shuffleQuestions !== false) {
    randomizedPool = shuffleArray(randomizedPool);
  }
  randomizedPool.sort((a, b) => {
    const aIsMistake = state.stats.mistakes.includes(a.ID);
    const bIsMistake = state.stats.mistakes.includes(b.ID);
    if (aIsMistake && !bIsMistake) return Math.random() > 0.3 ? -1 : 1;
    if (!aIsMistake && bIsMistake) return Math.random() > 0.3 ? 1 : -1;
    return 0;
  });

  return randomizedPool.map((originalQ) => {
    let q = { ...originalQ };
    let validChoices = [];
    const rawChoices = [q.ChoiceA, q.ChoiceB, q.ChoiceC, q.ChoiceD];
    rawChoices.forEach((c) => {
      if (
        c !== undefined &&
        c !== null &&
        String(c).trim() !== "" &&
        String(c).trim().toLowerCase() !== "undefined"
      ) {
        validChoices.push(String(c).trim());
      }
    });

    let originalAns = String(q.Answer || "")
      .trim()
      .toUpperCase();
    let correctText = "";

    if (["A", "B", "C", "D"].includes(originalAns)) {
      correctText = String(originalQ[`Choice${originalAns}`] || "")
        .trim()
        .toLowerCase();
    } else {
      correctText = String(q.Answer || "")
        .trim()
        .toLowerCase();
    }

    if (validChoices.length > 0) {
      if (state.prefs.shuffleChoices !== false) {
        validChoices = shuffleArray(validChoices);
      }

      q.ChoiceA = validChoices[0] || "";
      q.ChoiceB = validChoices[1] || "";
      q.ChoiceC = validChoices[2] || "";
      q.ChoiceD = validChoices[3] || "";

      if (q.ChoiceA.trim().toLowerCase() === correctText) q.Answer = "A";
      else if (q.ChoiceB.trim().toLowerCase() === correctText) q.Answer = "B";
      else if (q.ChoiceC.trim().toLowerCase() === correctText) q.Answer = "C";
      else if (q.ChoiceD.trim().toLowerCase() === correctText) q.Answer = "D";
      else if (validChoices.length === 1) q.Answer = "A";
      else q.Answer = "A";
    }
    return q;
  });
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

function initSession() {
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.initSession === "function"
  ) {
    return SessionCore.initSession();
  }

  let filterVal = document.getElementById("filter-subject")?.value || "ALL";
  let pool = [];

  if (filterVal === "MISTAKES") {
    pool = state.db.filter((q) => state.stats.mistakes.includes(q.ID));
  } else if (filterVal.startsWith("SUBJ:")) {
    const subj = filterVal.replace("SUBJ:", "");
    pool = getQuestionsForSubject(subj);
  } else if (filterVal.startsWith("TAG:")) {
    const tag = filterVal.replace("TAG:", "");
    pool = state.db.filter((q) => q.Tags && q.Tags.includes(tag));
  } else {
    pool = state.db;
  }

  if (pool.length === 0) {
    alert("No questions found for this filter.");
    return;
  }
  pool = prepareSessionPool(pool);

  clearTimeout(state.session.autoNextTimeout);

  if (typeof stopVisualTimer === "function") {
    stopVisualTimer();
  }

  state.session = {
    active: true,
    questions: pool,
    currentIndex: 0,
    userAnswers: {},
    mode: "quiz",
    revealedCloze: false,
  };

  document.getElementById("session-setup").classList.add("hidden");
  document.getElementById("session-active").classList.remove("hidden");

  renderQuestion();
  saveSessionProgress();
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

function renderQuestion() {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.renderQuestion === "function"
  ) {
    return QuizRendering.renderQuestion();
  }
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.renderQuestion === "function"
  ) {
    return SessionCore.renderQuestion();
  }

  stopVisualTimer();
  applyNavigationPosition();
  const q = state.session.questions[state.session.currentIndex];
  const userAnswer = state.session.userAnswers[state.session.currentIndex];

  const currentCard = state.session.currentIndex + 1;
  const totalCards = state.session.questions.length;
  document.getElementById("session-progress-text").innerText =
    `${currentCard} / ${totalCards}`;
  document.getElementById("session-progress").style.width =
    `${((state.session.currentIndex + 1) / totalCards) * 100}%`;

  const fullSubject = q.Subject || "General";
  document.getElementById("q-subject").innerText = getShortSubjectLabel(
    fullSubject,
    "General",
  );

  let displayId = q.ID ?? `Q-${state.session.currentIndex + 1}`;
  if (displayId.includes("::")) {
    const match = displayId.match(/::.*?\b(\d+)\s*$/);
    displayId = match ? match[1] : displayId.split("::").pop();
  }
  document.getElementById("q-id").innerText = "Question " + displayId;
  const clozeEnabled = state.prefs.clozeEnabled !== false;
  const shouldRevealCloze =
    Boolean(userAnswer) || Boolean(state.session.revealedCloze);
  document.getElementById("q-text").innerHTML = formatQuestionText(q.Question, {
    revealCloze: shouldRevealCloze && clozeEnabled,
    clozeEnabled,
  });

  const imgEl = document.getElementById("q-image");
  if (
    imgEl &&
    q.ImageURL &&
    String(q.ImageURL).trim() !== "" &&
    typeof isSafeImageURL === "function" &&
    isSafeImageURL(q.ImageURL)
  ) {
    imgEl.onload = () => imgEl.classList.remove("hidden");
    imgEl.onerror = () => {
      imgEl.removeAttribute("src");
      imgEl.classList.add("hidden");
    };
    imgEl.referrerPolicy = "no-referrer";
    imgEl.loading = "lazy";
    imgEl.decoding = "async";
    imgEl.src = q.ImageURL;
    imgEl.alt = q.Question
      ? `Reference for: ${q.Question.substring(0, 50)}...`
      : "Question reference image";
    imgEl.classList.remove("hidden");
  } else if (imgEl) {
    imgEl.onload = null;
    imgEl.onerror = null;
    imgEl.removeAttribute("src");
    imgEl.classList.add("hidden");
  }

  const { isIdent: isPureIdent } = getQuestionTypeMode(q);
  const isForcedMCQ = state.prefs.qTypeOverride === "mcq";
  const hideABCD = state.prefs.quizHideABCD === true || isPureIdent;

  const choices = ["A", "B", "C", "D"];
  choices.forEach((ch) => {
    const choiceText = q[`Choice${ch}`];
    const btn = document.querySelector(`.choice-btn[data-choice="${ch}"]`);
    let cleanChoice = String(choiceText ?? "").trim();

    btn.classList.remove("selected-correct", "selected-wrong", "dimmed");
    btn.onclick = null;

    if (isForcedMCQ && cleanChoice === "") {
      cleanChoice = "undefined";
    }

    if (
      !isForcedMCQ &&
      (cleanChoice === "" || cleanChoice.toLowerCase() === "undefined")
    ) {
      btn.classList.add("hidden");
    } else {
      btn.classList.remove("hidden");
      const prefixRegex = new RegExp(`^${ch}[\\.\\)\\-]\\s*`, "i");
      const displayText = cleanChoice.replace(prefixRegex, "");
      const safeDisplayText = escapeHTML(displayText);

      if (hideABCD) {
        btn.innerHTML = safeDisplayText;
      } else {
        btn.innerHTML = `<span class="choice-letter font-bold mr-2 whitespace-nowrap">${ch})</span> ${safeDisplayText}`;
      }

      if (!userAnswer) {
        btn.onclick = () => submitPracticeAnswer(ch, q.Answer);
      }
    }
  });

  const qChoicesContainer = document.getElementById("q-choices");
  const activeRecallMask = document.getElementById("active-recall-mask");
  const expBox = document.getElementById("q-explanation-box");
  const btnNext = document.getElementById("btn-next");
  const btnPrev = document.getElementById("btn-prev");
  const btnReveal = document.getElementById("btn-reveal");

  btnPrev.disabled = state.session.currentIndex <= 0;

  if (userAnswer) {
    if (activeRecallMask) activeRecallMask.classList.add("hidden");
    qChoicesContainer.classList.remove("hidden");
    showExplanation(q);

    qChoicesContainer.querySelectorAll(".choice-btn").forEach((btn) => {
      btn.onclick = null;
      const choice = btn.dataset.choice;

      if (choice === q.Answer) {
        btn.classList.add("selected-correct");
        btn.classList.remove("hidden");
      } else {
        if (isPureIdent) {
          btn.classList.add("hidden");
        } else {
          if (choice === userAnswer) {
            btn.classList.add("selected-wrong");
          } else {
            btn.classList.add("dimmed");
          }
        }
      }
    });

    btnNext.disabled = false;
    btnReveal.disabled = true;
  } else {
    expBox.classList.add("hidden");
    btnNext.disabled = false;
    btnReveal.disabled = false;

    if (isPureIdent) {
      if (activeRecallMask) activeRecallMask.classList.add("hidden");
      qChoicesContainer.classList.add("hidden");
    } else {
      const activeRecallEnabled = Boolean(state.prefs.activeRecall);
      if (activeRecallEnabled) {
        if (activeRecallMask) activeRecallMask.classList.remove("hidden");
        qChoicesContainer.classList.add("hidden");
      } else {
        if (activeRecallMask) activeRecallMask.classList.add("hidden");
        qChoicesContainer.classList.remove("hidden");
      }
    }
  }

  const favBtn = document.getElementById("btn-favorite-question");
  if (favBtn) {
    const isFavorite = Array.isArray(state.prefs.favoriteQuestions)
      ? state.prefs.favoriteQuestions.includes(q.ID)
      : false;

    favBtn.classList.toggle("text-yellow-500", isFavorite);
    favBtn.classList.toggle("text-gray-400", !isFavorite);
    favBtn.title = isFavorite ? "Remove from Favorites" : "Add to Favorites";
  }

  const activeRecallToggle = document.getElementById("toggle-active-recall");
  const shuffleChoicesToggle = document.getElementById(
    "toggle-shuffle-choices",
  );
  const hideABCDToggle = document.getElementById("toggle-quiz-hide-abcd");

  if (activeRecallToggle) {
    activeRecallToggle.disabled = isPureIdent;
    activeRecallToggle.parentElement.classList.toggle(
      "opacity-50",
      isPureIdent,
    );
    activeRecallToggle.parentElement.classList.toggle(
      "cursor-not-allowed",
      isPureIdent,
    );
    activeRecallToggle.parentElement.classList.toggle(
      "pointer-events-none",
      isPureIdent,
    );
  }

  if (shuffleChoicesToggle) {
    shuffleChoicesToggle.disabled = isPureIdent;
    shuffleChoicesToggle.parentElement.classList.toggle(
      "opacity-50",
      isPureIdent,
    );
    shuffleChoicesToggle.parentElement.classList.toggle(
      "cursor-not-allowed",
      isPureIdent,
    );
  }

  if (hideABCDToggle) {
    hideABCDToggle.disabled = isPureIdent;
    hideABCDToggle.parentElement.classList.toggle("opacity-50", isPureIdent);
    hideABCDToggle.parentElement.classList.toggle(
      "cursor-not-allowed",
      isPureIdent,
    );
    hideABCDToggle.parentElement.classList.toggle(
      "pointer-events-none",
      isPureIdent,
    );
  }

  const nextIndex = state.session.currentIndex + 1;
  const upcomingQuestions = state.session.questions.slice(
    nextIndex,
    nextIndex + 2,
  );

  upcomingQuestions.forEach((nextQ) => {
    if (nextQ && nextQ.ImageURL) {
      const imgPreload = new Image();
      imgPreload.src = nextQ.ImageURL;
    }
  });

  applyTitleMode();
}

function enterFolder(folderName, isLockedFolder) {
  if (
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.enterFolder === "function"
  ) {
    return DeckNav.enterFolder(folderName, isLockedFolder);
  }
  const fullPath =
    state.currentPath && state.currentPath.length > 0
      ? state.currentPath.join("::") + "::" + folderName
      : folderName;

  const isUnlockedByUi = isFolderUnlocked(fullPath);
  if (isLockedFolder && !isUnlockedByUi) {
    openFolderPasswordModal(fullPath, folderName);
    return;
  }

  if (!state.currentPath) state.currentPath = [];
  state.currentPath.push(folderName);
  persistNavigationPath(state.currentPath); // FEATURE: Save navigation position
  renderCategoryProgress();
}

function goToPath(index) {
  if (
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.goToPath === "function"
  ) {
    return DeckNav.goToPath(index);
  }
  if (!state.currentPath) state.currentPath = [];
  if (index === -1) {
    state.currentPath = [];
  } else {
    state.currentPath = state.currentPath.slice(0, index + 1);
  }
  persistNavigationPath(state.currentPath); // FEATURE: Save navigation position
  renderCategoryProgress();
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
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.getVisibleCategorySummary === "function"
  ) {
    return DeckNav.getVisibleCategorySummary();
  }
  // CRITICAL: Backend already filters ALL hidden decks in filterSummaryDataByAccess()
  // Frontend must NEVER filter again - return categorySummary as-is
  return state.categorySummary || [];
}

function closeAllDropdownMenus(exceptElement = null) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeAllDropdownMenus === "function"
  ) {
    return UIModal.closeAllDropdownMenus(exceptElement);
  }
  document
    .querySelectorAll("#deck-source-menu, #deck-sort-menu, #quiz-filter-menu")
    .forEach((menu) => {
      if (menu !== exceptElement) menu.open = false;
    });
}

function initDetailsExclusivity() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.initDetailsExclusivity === "function"
  ) {
    return UIModal.initDetailsExclusivity();
  }
  const detailsElements = document.querySelectorAll(
    "#deck-source-menu, #deck-sort-menu, #quiz-filter-menu",
  );

  detailsElements.forEach((details) => {
    details.addEventListener("toggle", (e) => {
      if (e.target.open) {
        detailsElements.forEach((other) => {
          if (other !== e.target && other.open) {
            other.open = false;
          }
        });
      }
    });
  });

  document.addEventListener("click", (event) => {
    const clickedInsideDetails = event.target.closest("details");
    if (!clickedInsideDetails) {
      closeAllDropdownMenus();
    }
  });
}

let categoryProgressRenderScheduled = false;
let categoryProgressRenderInFlight = false;

function renderCategoryProgress() {
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
    // Initialize dropdown exclusivity once
    if (typeof initDetailsExclusivity !== "undefined") {
      setTimeout(initDetailsExclusivity, 100);
    }

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

    const visibleSummary = getVisibleCategorySummary();

    let tree = {};
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

    if (!Array.isArray(state.currentPath)) state.currentPath = [];
    const savedPath = readStoredNavigationPath();
    if (
      savedPath.length > 0 &&
      JSON.stringify(savedPath) !== JSON.stringify(state.currentPath)
    ) {
      state.currentPath = savedPath;
    }

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
      state.currentPath = readStoredNavigationPath();
      currentNode = tree;
      if (Array.isArray(state.currentPath) && state.currentPath.length > 0) {
        let restoredNode = tree;
        let restoredValid = true;
        for (let dir of state.currentPath) {
          if (restoredNode[dir]) {
            restoredNode = restoredNode[dir]._children;
          } else {
            restoredValid = false;
            break;
          }
        }
        if (!restoredValid) {
          state.currentPath = [];
          currentNode = tree;
        } else {
          currentNode = restoredNode;
        }
      } else {
        state.currentPath = [];
        currentNode = tree;
      }
    }

    function getFolderStats(node) {
      let total = 0;
      if (node._data) total += node._data.QuestionCount || 0;
      for (let k in node._children) {
        total += getFolderStats(node._children[k]);
      }
      return total;
    }

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
      </div>`;

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

    function matchesFavoriteDeck(node, currentKey) {
      const subject = node?._data?.Subject || "";
      const folderKey = String(currentKey || "").trim();
      const childKeys = Object.keys(node?._children || {});

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
      if (matchesNode) return true;

      return childKeys.some((childKey) =>
        matchesFavoriteDeck(node._children[childKey], childKey),
      );
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
        const isDownloaded = (state.db || []).some(
          (q) => q.Subject === node._data.Subject,
        );
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
      const isDownloaded = state.db.some((q) => q.Subject === subj);
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
        <div onclick="handleDeckClick('${encodedSubj}')" class="cursor-pointer animate-card-in ${cardClasses} ${availabilityClasses} p-5 rounded-xl shadow-sm hover:shadow-lg hover:-translate-y-1 ${themeShadowHover} active:scale-[0.99] border transition-all duration-400 relative w-full h-full flex flex-col" style="animation-delay: ${delay}s;" title="${databaseUnavailable ? "Waiting for database connection" : ""}">
          ${
            databaseUnavailable
              ? `<div class="absolute inset-0 bg-gray-500/30 dark:bg-gray-900/60 backdrop-blur-sm z-10 rounded-xl flex flex-col items-center justify-center transition-opacity">
                  <i class="fa-solid fa-lock text-4xl text-gray-600 dark:text-gray-400 mb-2"></i>
                  <span class="text-sm font-bold text-gray-700 dark:text-gray-300 text-center px-2">Syncing Database...</span>
                </div>`
              : ""
          }
          <div id="${loaderId}" class="hidden absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10 rounded-xl flex flex-col items-center justify-center transition-opacity">
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
                <div class="flex-shrink-0">${statusBadge}</div>
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

    applyTitleMode();
  } finally {
    categoryProgressRenderInFlight = false;
  }
}

async function fetchAndStartCategory(subject, mode, pass = null) {
  if (
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.fetchAndStartCategory === "function"
  ) {
    return DeckNav.fetchAndStartCategory(subject, mode, pass);
  }
  const loader = document.getElementById(getDeckLoaderId(subject));
  if (isDeckHidden(subject)) {
    showToast("This deck is hidden and not available.", "warning");
    return;
  }
  if (isDeckLocked(subject)) {
    if (!pass) {
      pendingDeckSubject = subject;
      pendingDeckAction = mode;
      openDeckPasswordModal(subject, mode);
      return;
    }
  }
  // Define strict MCQ filter condition conditionally based on user preference
  const isForcedMCQ = state.prefs.qTypeOverride === "mcq";
  const customFilter = isForcedMCQ
    ? (q) =>
        q.ChoiceA &&
        q.ChoiceA.trim() !== "" &&
        q.ChoiceB &&
        q.ChoiceB.trim() !== ""
    : null;

  // Always attempt to fetch fresh data for gameplay sessions
  let validQuestions = await fetchDeckQuestions(
    subject,
    pass,
    loader,
    customFilter,
  );

  // Fallback check if offline and fetch returned empty
  if (validQuestions.length === 0) {
    if (isDeckLocked(subject)) {
      pendingDeckSubject = subject;
      pendingDeckAction = mode;
      openDeckPasswordModal(subject, mode);
      return;
    }
    alert(
      `Cannot start session. You are offline and "${subject}" has not been downloaded to your device yet.`,
    );
    return;
  }

  if (!state.stats.completedQs) state.stats.completedQs = [];
  if (!state.stats.srsMap) state.stats.srsMap = {};

  let pool = [];
  if (mode === "continue") {
    pool = validQuestions.filter(
      (q) => !state.stats.completedQs.includes(q.ID),
    );

    if (state.prefs.srsEnabled === true) {
      const now = Date.now();
      const duePool = pool.filter((q) => {
        const srs = state.stats.srsMap?.[q.ID];
        if (!srs) return true;
        return Number(srs.due || 0) <= now;
      });

      if (duePool.length > 0) {
        pool = duePool;
      } else {
        const retryQueue = pool.slice(0);
        if (retryQueue.length > 0) {
          pool = retryQueue;
        }
      }
    }

    if (pool.length === 0) {
      if (state.prefs.srsEnabled === true) {
        const queue = validQuestions.filter(
          (q) => !state.stats.completedQs.includes(q.ID),
        );
        if (queue.length > 0) {
          pool = queue;
        } else {
          alert(
            `You have answered all available questions for ${subject}! Reset the category to start over.`,
          );
          return;
        }
      } else {
        alert(
          `You have answered all available questions for ${subject}! Reset the category to start over.`,
        );
        return;
      }
    }
  } else if (mode === "mistakes") {
    pool = validQuestions.filter((q) => state.stats.mistakes.includes(q.ID));
    if (pool.length === 0) {
      alert(`No mistakes to review for ${subject}! Great job.`);
      return;
    }
  }

  startCustomSession(pool);
}

function startCustomSession(pool) {
  if (
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.startCustomSession === "function"
  ) {
    return DeckNav.startCustomSession(pool);
  }
  navigate("practice");
  document.getElementById("session-setup").classList.add("hidden");
  document.getElementById("session-active").classList.remove("hidden");

  pool = prepareSessionPool(pool);

  state.session = {
    active: true,
    questions: pool,
    currentIndex: 0,
    userAnswers: {},
    mode: "quiz",
    revealedCloze: false,
  };

  renderQuestion();
  saveSessionProgress();
}

async function resetCategory(subject) {
  if (
    typeof DeckNav !== "undefined" &&
    typeof DeckNav.resetCategory === "function"
  ) {
    return DeckNav.resetCategory(subject);
  }
  subject = decodeHandlerValue(subject);
  if (
    await requestConfirmation(
      `Are you sure you want to reset your accuracy and progress statistics for "${subject}"? This cannot be undone.`,
      "Reset Progress",
    )
  ) {
    if (state.stats.subjectAccuracy[subject]) {
      state.stats.subjectAccuracy[subject] = { total: 0, correct: 0 };
    }

    const subjectQIDs = getQuestionsForSubject(subject).map((q) => q.ID);

    if (state.stats.completedQs) {
      state.stats.completedQs = state.stats.completedQs.filter(
        (id) => !subjectQIDs.includes(id),
      );
    }

    if (state.stats.mistakes) {
      state.stats.mistakes = state.stats.mistakes.filter(
        (id) => !subjectQIDs.includes(id),
      );
    }

    if (state.stats.srsMap) {
      state.stats.srsMap = Object.fromEntries(
        Object.entries(state.stats.srsMap || {}).filter(
          ([qId]) => !subjectQIDs.includes(qId),
        ),
      );
    }

    saveState();
    renderCategoryProgress();
    if (chartInstance) renderCharts();
  }
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
      if (loaderElement) loaderElement.classList.add("hidden");
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
    if (loaderElement) loaderElement.classList.remove("hidden");

    if (isDeckLocked(subject) && !pass) {
      pendingDeckSubject = subject;
      pendingDeckAction = pendingDeckAction || "continue";
      openDeckPasswordModal(subject, pendingDeckAction || "continue");
      if (loaderElement) loaderElement.classList.add("hidden");
      return [];
    }

    try {
      const response = await (typeof AppNetwork !== "undefined" &&
      typeof AppNetwork.getDeck === "function"
        ? AppNetwork.getDeck(subject, pass || "", { timeoutMs: 15000 })
        : fetch(DB_URL, {
            method: "POST",
            headers: {
              "Content-Type": "text/plain;charset=utf-8",
              Accept: "application/json",
            },
            body: JSON.stringify({
              type: "get_deck",
              subject: String(subject || "").trim(),
              password: String(pass || ""),
            }),
            cache: "no-store",
            redirect: "follow",
            signal: AbortSignal?.timeout?.(15000),
          }).then(async (response) => {
            const text = await response.text();
            let payload;
            try {
              payload = JSON.parse(text);
            } catch (parseError) {
              throw new Error(
                `Invalid backend response while loading deck: ${text.slice(0, 200)}`,
              );
            }
            if (!response.ok) {
              throw new Error(
                payload?.message ||
                  payload?.error ||
                  `Backend HTTP ${response.status}.`,
              );
            }
            return payload;
          }));

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
      console.warn("Network fetch failed.", err);
      return getQuestionsForSubject(subject);
    } finally {
      if (loaderElement) loaderElement.classList.add("hidden");
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
    alert(
      `Cannot review deck. You are offline and "${subject}" has not been downloaded yet.`,
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

let currentReviewSubject = "";
let currentReviewQuestions = [];

function reRenderDeckReview() {
  if (
    typeof DeckReview !== "undefined" &&
    typeof DeckReview.reRenderDeckReview === "function"
  ) {
    return DeckReview.reRenderDeckReview();
  }
  renderDeckReview(currentReviewSubject, currentReviewQuestions);
}

function renderDeckReview(subject, questions) {
  if (
    typeof DeckReview !== "undefined" &&
    typeof DeckReview.renderDeckReview === "function"
  ) {
    return DeckReview.renderDeckReview(subject, questions);
  }
  currentReviewSubject = subject;
  currentReviewQuestions = questions;

  const container = document.getElementById("deck-review-list");
  document.getElementById("deck-review-title").innerText = getShortSubjectLabel(
    subject,
    "General",
  );

  const globalShowWrong = state.prefs.showWrongChoices !== false;
  const hideABCD = state.prefs.hideABCD === true;
  let layout = state.prefs.studyLayout || "scroll";
  let pageSize = state.prefs.studyPageSize || 50;
  const reviewNavigationPosition = getStudyNavigationPosition(layout);

  if (!state.prefs.studyProgress[subject]) {
    state.prefs.studyProgress[subject] = { page: 1, index: 0, scrollY: 0 };
  }
  let progress = state.prefs.studyProgress[subject];
  let currentPage = progress.page || 1;
  let currentIndex = progress.index || 0;

  const wrongToggle = document.getElementById("toggle-wrong-choices");
  if (wrongToggle) wrongToggle.checked = globalShowWrong;
  const hideABCDToggle = document.getElementById("toggle-hide-abcd");
  if (hideABCDToggle) hideABCDToggle.checked = hideABCD;

  let html = "";
  const favoriteQuestions = new Set(
    Array.isArray(state.prefs.favoriteQuestions)
      ? state.prefs.favoriteQuestions.filter(Boolean)
      : [],
  );

  const studyFilterMode = state.prefs.studyFilterMode || "all";
  const filteredQuestions =
    studyFilterMode === "favorites"
      ? questions.filter((question) => favoriteQuestions.has(question.ID))
      : questions;

  if (filteredQuestions.length === 0) {
    container.innerHTML = `
      <div class="text-center p-8 text-gray-500 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700">
        <i class="fa-solid fa-star text-yellow-500 text-2xl mb-3"></i>
        <p class="font-bold text-lg">No favorite questions in this deck.</p>
        <p class="text-sm mt-1">Switch the study filter to All to see every question.</p>
      </div>
    `;
    navigate("deck-review");
    return;
  }

  if (questions.length === 0) {
    container.innerHTML =
      html +
      `<div class="text-center p-8 text-gray-500">No questions found for this deck.</div>`;
    navigate("deck-review");
    return;
  }

  let displayQuestions = [];
  let totalPages = 1;

  displayQuestions = [...filteredQuestions].sort((a, b) => {
    const aFav = favoriteQuestions.has(a.ID) ? 1 : 0;
    const bFav = favoriteQuestions.has(b.ID) ? 1 : 0;
    if (aFav !== bFav) return bFav - aFav;
    return 0;
  });

  if (layout === "single") {
    if (currentIndex < 0) currentIndex = 0;
    if (currentIndex >= filteredQuestions.length)
      currentIndex = filteredQuestions.length - 1;
    progress.index = currentIndex;

    displayQuestions = [filteredQuestions[currentIndex]];
  } else {
    if (pageSize === "All") {
      displayQuestions = filteredQuestions;
    } else {
      totalPages = Math.ceil(filteredQuestions.length / pageSize);
      if (currentPage < 1) currentPage = 1;
      if (currentPage > totalPages) currentPage = totalPages;
      progress.page = currentPage;

      let start = (currentPage - 1) * pageSize;
      displayQuestions = filteredQuestions.slice(start, start + pageSize);
    }
  }

  const pageCount = document.getElementById("review-page-count");
  const pageSizeInput = document.getElementById("review-page-size-input");
  if (pageSizeInput) pageSizeInput.value = pageSize === "All" ? "" : pageSize;
  if (pageCount)
    pageCount.innerText = pageSize === "All" ? "1" : Math.max(1, totalPages);

  let navigationHTML = "";
  if (layout === "single") {
    navigationHTML = `
        <div class="flex justify-between items-center mb-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 sticky top-4 z-20 gap-2">
            <button onclick="changeStudyIndex(-1)" ${currentIndex === 0 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Prev</span>
            </button>
            
            <span class="text-sm font-bold text-gray-600 dark:text-gray-300 flex-1 text-center">Card ${currentIndex + 1} / ${questions.length}</span>
            
            <button onclick="changeStudyIndex(1)" ${currentIndex === questions.length - 1 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                <span class="hidden sm:inline mr-1">Next</span> <i class="fa-solid fa-arrow-right"></i>
            </button>
        </div>
    `;
  } else if (pageSize !== "All" && totalPages > 1) {
    navigationHTML = `
            <div class="flex justify-between items-center mt-6 p-4 bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 sticky bottom-4 z-10 gap-2">
                <button onclick="changeStudyPage(-1)" ${currentPage === 1 ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                    <i class="fa-solid fa-arrow-left"></i> <span class="hidden sm:inline ml-1">Prev</span>
                </button>
                <div class="flex-1 flex items-center justify-center gap-1 text-sm font-bold text-gray-600 dark:text-gray-300">
                    <span>Page</span>
                    <label class="sr-only" for="study-page-input">Go to page</label>
                    <input
                        id="study-page-input"
                        type="text"
                        inputmode="numeric"
                        pattern="[0-9]*"
                        min="1"
                        max="${totalPages}"
                        value="${currentPage}"
                        onchange="jumpToStudyPage(this.value)"
                        oninput="this.style.width = Math.max(1.8, (this.value.length || String(${currentPage}).length) + 1.2) + 'ch';"
                        class="border-0 border-b border-gray-300 dark:border-gray-600 bg-transparent px-0 py-0 text-center text-sm font-bold text-gray-800 dark:text-gray-100 outline-none focus:border-brand-500 focus:ring-0 [-moz-appearance:textfield]"
                        style="width: ${Math.max(1.8, String(currentPage).length + 1.2)}ch;"
                    />
                    <span>of ${totalPages}</span>
                </div>
                <button onclick="changeStudyPage(1)" ${currentPage === totalPages ? "disabled" : ""} class="px-4 py-2 bg-brand-500 text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-600 transition-colors">
                    <span class="hidden sm:inline mr-1">Next</span> <i class="fa-solid fa-arrow-right"></i>
                </button>
            </div>
        `;
  }

  const showTopNavigation = ["top", "both"].includes(reviewNavigationPosition);
  const showBottomNavigation = ["bottom", "both"].includes(
    reviewNavigationPosition,
  );

  if (showTopNavigation) html += navigationHTML;

  const questionIndexById = new Map(
    filteredQuestions.map((question, index) => [question.ID, index]),
  );

  displayQuestions.forEach((q, displayIndex) => {
    const originalIndex = questionIndexById.get(q.ID) ?? displayIndex;
    const isQuestionFavorite = favoriteQuestions.has(q.ID);

    let rawQuestionText = q.Question ? String(q.Question) : "";
    let cleanQuestionText = rawQuestionText.replace(/^\s*\d+\.\s*/, "");

    let ansStr = q.Answer ? String(q.Answer).trim() : "";
    const { isIdent: isPureIdent } = getQuestionTypeMode(q);
    let isMultipleChoice = !isPureIdent;

    let correctText = ansStr;
    if (isMultipleChoice) {
      correctText = q[`Choice${ansStr.toUpperCase()}`] || ansStr;
    } else {
      correctText = q.ChoiceA || ansStr;
    }
    if (!correctText || correctText.toLowerCase() === "undefined") {
      correctText = "Answer missing from database";
    }

    let showWrongForThisQ = state.prefs.qToggles?.[q.ID];
    if (showWrongForThisQ === undefined) showWrongForThisQ = globalShowWrong;

    let choicesHTML = "";
    if (isMultipleChoice && showWrongForThisQ) {
      const letters = ["A", "B", "C", "D"];
      choicesHTML = `<div class="mt-4 flex flex-col gap-2">`;
      letters.forEach((letter) => {
        let choiceText = q[`Choice${letter}`];
        let prefix = hideABCD ? "" : `${letter}. `;

        if (choiceText) {
          let isCorrect = letter === ansStr.toUpperCase();
          if (isCorrect) {
            choicesHTML += `
                            <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg">
                                <p class="text-sm font-bold text-green-700 dark:text-green-400">
                                    ${prefix}${escapeHTML(choiceText)}
                                </p>
                            </div>`;
          } else {
            choicesHTML += `
                            <div class="bg-gray-50 dark:bg-gray-800/50 border-l-4 border-gray-300 dark:border-gray-600 p-3 rounded-r-lg opacity-70">
                                <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    ${prefix}${escapeHTML(choiceText)}
                                </p>
                            </div>`;
          }
        }
      });
      choicesHTML += `</div>`;
    } else {
      let prefix = hideABCD
        ? ""
        : isMultipleChoice
          ? `${ansStr.toUpperCase()}. `
          : "";
      choicesHTML = `
                <div class="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-3 rounded-r-lg mt-4">
                    <p class="text-sm font-bold text-green-700 dark:text-green-400">
                        ${prefix}${escapeHTML(correctText)} <!-- Feature #22: Removed check icon -->
                    </p>
                </div>`;
    }

    const isProtectedDeck = isDeckPasswordProtected(q.Subject);
    let reportClass = globallyReportedQs.has(q.ID)
      ? "text-red-500 bg-red-50 dark:bg-red-900/30"
      : isProtectedDeck
        ? "text-gray-300 bg-gray-100 dark:bg-gray-700/40 cursor-not-allowed opacity-60"
        : "text-gray-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500";

    html += `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6 animate-card-in">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
                    <span class="bg-brand-50 text-brand-600 text-xs px-2 py-1 rounded font-bold dark:bg-brand-900/30 dark:text-brand-400">Question ${originalIndex + 1}</span>
                    
                    <div class="flex gap-2 items-center">
                        <!-- Feature 16: Individual Toggle Button -->
                        ${
                          isMultipleChoice
                            ? `<button onclick="toggleSpecificChoices('${encodeHandlerValue(q.ID)}')" class="text-xs font-bold px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                          ${showWrongForThisQ ? '<i class="fa-solid fa-eye-slash mr-1"></i> Hide Choices' : '<i class="fa-solid fa-eye mr-1"></i> Show Choices'}
                        </button>`
                            : ""
                        }

                        <button onclick="event.stopPropagation(); toggleQuestionFavorite('${encodeHandlerValue(q.ID)}')" class="${isQuestionFavorite ? "text-yellow-500" : "text-gray-400 hover:text-yellow-500"} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${isQuestionFavorite ? "Remove from Favorites" : "Add to Favorites"}">
                            <i class="fa-solid fa-star"></i>
                        </button>

                        ${
                          isProtectedDeck
                            ? `<button type="button" class="${reportClass} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm transition-all" title="Reporting disabled for password-protected decks" disabled>
                                <i class="fa-solid fa-triangle-exclamation"></i>
                            </button>`
                            : `<button onclick="openReportModalFromStudy('${encodeHandlerValue(q.ID)}')" class="${reportClass} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${globallyReportedQs.has(q.ID) ? "Active Community Report" : "Report Issue"}">
                                <i class="fa-solid fa-triangle-exclamation"></i>
                            </button>`
                        }
                    </div>
                </div>
                
                <p class="font-medium text-gray-800 dark:text-gray-100 mb-2 text-lg">${formatQuestionText(cleanQuestionText)}</p>
                
                ${q.ImageURL ? `<img src="${escapeHTML(q.ImageURL)}" alt="Reference" class="w-full max-w-md mx-auto rounded-lg mb-4 shadow-sm border transition-all duration-500">` : ""}                        
                ${choicesHTML}
                
                ${
                  q.Explanation && q.Explanation.trim() !== ""
                    ? `
                    <div class="mt-4 text-sm text-gray-700 dark:text-gray-300 bg-blue-50 dark:bg-gray-900/50 p-3 rounded-lg border border-blue-100 dark:border-gray-700">
                        <strong class="text-blue-800 dark:text-blue-400"><i class="fa-solid fa-lightbulb mr-1"></i> Explanation:</strong> ${escapeHTML(q.Explanation)}
                    </div>
                `
                    : ""
                }
            </div>
        `;
  });

  if (showBottomNavigation) html += navigationHTML;

  container.innerHTML = html;
  navigate("deck-review");

  setTimeout(() => {
    const scrollContainer = document.querySelector("main");
    if (scrollContainer && layout === "scroll") {
      scrollContainer.scrollTop = progress.scrollY || 0;
    }
    applyTitleMode();
  }, 100);
}

function toggleHideABCD() {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.toggleHideABCD === "function"
  ) {
    return QuizRendering.toggleHideABCD();
  }
  const isHidden = document.getElementById("toggle-hide-abcd").checked;
  state.prefs.hideABCD = isHidden;
  saveState();

  reRenderDeckReview();
}

function toggleQuizHideABCD() {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.toggleQuizHideABCD === "function"
  ) {
    return QuizRendering.toggleQuizHideABCD();
  }
  const hideToggle = document.getElementById("toggle-quiz-hide-abcd");
  if (!hideToggle || hideToggle.disabled) return;

  const isHidden = hideToggle.checked;

  if (!state.prefs) state.prefs = {};
  state.prefs.quizHideABCD = isHidden;
  saveState();

  if (document.getElementById("view-practice").classList.contains("active")) {
    renderQuestion();
  }
}

function toggleShowWrongChoices() {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.toggleShowWrongChoices === "function"
  ) {
    return QuizRendering.toggleShowWrongChoices();
  }
  const isChecked = document.getElementById("toggle-wrong-choices").checked;
  state.prefs.showWrongChoices = isChecked;
  saveState();
  reRenderDeckReview();
}

function toggleClozeMode(source) {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.toggleClozeMode === "function"
  ) {
    return QuizRendering.toggleClozeMode(source);
  }
  const element = source || document.getElementById("toggle-cloze-mode");
  state.prefs.clozeEnabled = element ? Boolean(element.checked) : false;
  saveState();

  if (state.session.active) {
    renderQuestion();
  }
}

function toggleSrsMode(source) {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.toggleSrsMode === "function"
  ) {
    return QuizRendering.toggleSrsMode(source);
  }
  const element = source || document.getElementById("toggle-srs-mode");
  state.prefs.srsEnabled = element ? Boolean(element.checked) : false;
  saveState();

  if (state.session.active) {
    const activeQuestions = state.session.questions || [];
    const current = activeQuestions[state.session.currentIndex] || null;
    if (current) {
      renderQuestion();
    }
  }
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
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.submitPracticeAnswer === "function"
  ) {
    return SessionCore.submitPracticeAnswer(selected, correct);
  }

  const q = state.session.questions[state.session.currentIndex];
  state.session.userAnswers[state.session.currentIndex] = selected;

  trackStats(q, selected === correct);
  document
    .getElementById("q-choices")
    .querySelectorAll(".choice-btn")
    .forEach((btn) => {
      btn.onclick = null;
      if (btn.dataset.choice === correct) btn.classList.add("selected-correct");
      else if (btn.dataset.choice === selected)
        btn.classList.add("selected-wrong");
      else btn.classList.add("dimmed");
    });

  showExplanation(q);

  document.getElementById("btn-next").disabled = false;
  document.getElementById("btn-reveal").disabled = true;
  document.getElementById("session-progress").style.width =
    `${((state.session.currentIndex + 1) / state.session.questions.length) * 100}%`;

  startVisualTimer();
  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  state.session.autoNextTimeout = setTimeout(() => {
    nextQuestion();
  }, 2000);
}

function showExplanation(q) {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.showExplanation === "function"
  ) {
    return QuizRendering.showExplanation(q);
  }
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.showExplanation === "function"
  ) {
    return SessionCore.showExplanation(q);
  }

  const expBox = document.getElementById("q-explanation-box");

  if (q.Explanation && q.Explanation.trim() !== "") {
    document.getElementById("q-explanation-text").innerHTML =
      formatQuestionText(q.Explanation);
    expBox.classList.remove("hidden");
  } else {
    expBox.classList.add("hidden");
  }
}

function nextQuestion() {
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.nextQuestion === "function"
  ) {
    return SessionCore.nextQuestion();
  }

  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  stopVisualTimer();

  if (state.session.currentIndex < state.session.questions.length - 1) {
    const skipped = !state.session.userAnswers[state.session.currentIndex];
    state.session.currentIndex++;
    renderQuestion();
    saveSessionProgress();
  } else {
    alert("Practice Session Complete! Great job.");
    clearSessionProgress();
    endSession(false);
  }
}

function prevQuestion() {
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.prevQuestion === "function"
  ) {
    return SessionCore.prevQuestion();
  }

  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  stopVisualTimer();

  if (state.session.currentIndex > 0) {
    state.session.currentIndex--;
    renderQuestion();
  }
  saveSessionProgress();
}

function getDefaultSrsEntry(qId) {
  return {
    qId,
    ease: 2.5,
    interval: 0,
    due: 0,
    reps: 0,
    lapses: 0,
    step: 0,
    lastScore: null,
    lastAnsweredAt: 0,
  };
}

function updateSrsForQuestion(q, isCorrect) {
  if (state.prefs.srsEnabled !== true) return;

  const qId = q?.ID || q?.Question || "";
  if (!qId) return;

  if (!state.stats.srsMap) state.stats.srsMap = {};

  const existing = state.stats.srsMap[qId] || getDefaultSrsEntry(qId);
  const next = {
    ...existing,
    qId,
    reps: Number(existing.reps || 0) + 1,
    lastAnsweredAt: Date.now(),
  };

  if (isCorrect) {
    next.lastScore = "correct";
    next.step = Math.max(1, Number(existing.step || 0) + 1);
    next.ease = Math.max(1.3, Number(existing.ease || 2.5) + 0.1);
    next.interval = computeSrsInterval(next.step, next.ease);
    next.due = Date.now() + next.interval * 24 * 60 * 60 * 1000;
  } else {
    next.lastScore = "wrong";
    next.step = 0;
    next.lapses = Number(existing.lapses || 0) + 1;
    next.ease = Math.max(1.3, Number(existing.ease || 2.5) - 0.2);
    next.interval = 1;
    next.due = Date.now() + 60 * 60 * 1000;
  }

  state.stats.srsMap[qId] = next;
}

function computeSrsInterval(step, ease) {
  if (step <= 0) return 1;
  if (step === 1) return 1;
  if (step === 2) return 2;
  if (step === 3) return 4;
  return Math.max(1, Math.round((step - 1) * (ease || 2.5) * 2));
}

function trackStats(q, isCorrect) {
  state.stats.totalAnswered++;

  const subj = q.Subject || "General";
  if (!state.stats.subjectAccuracy[subj])
    state.stats.subjectAccuracy[subj] = { total: 0, correct: 0 };
  state.stats.subjectAccuracy[subj].total++;

  if (!state.stats.completedQs) state.stats.completedQs = [];
  if (!state.stats.completedQs.includes(q.ID)) {
    state.stats.completedQs.push(q.ID);
  }

  if (isCorrect) {
    state.stats.correct++;
    state.stats.subjectAccuracy[subj].correct++;
    state.stats.mistakes = state.stats.mistakes.filter((id) => id !== q.ID);
  } else {
    if (!state.stats.mistakes.includes(q.ID)) state.stats.mistakes.push(q.ID);
  }

  updateSrsForQuestion(q, isCorrect);
  saveState();
}

function endSession(silent = false) {
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.endSession === "function"
  ) {
    return SessionCore.endSession(silent);
  }

  const isLastQuestion =
    state.session.currentIndex >= state.session.questions.length - 1;
  const isAnswered =
    state.session.userAnswers &&
    state.session.userAnswers[state.session.currentIndex];

  if (isLastQuestion && isAnswered) {
    clearSessionProgress();
  } else {
    saveSessionProgress();
  }

  state.session.active = false;
  if (pendingSummaryData) {
    applySummaryData(pendingSummaryData);
    pendingSummaryData = null;
    updateSyncStatus(
      '<i class="fa-solid fa-check mr-1"></i> Database update applied after your session.',
      "success",
    );
  }
  if (!silent) navigate("dashboard");
}

let chartRetryCount = 0;

function renderCharts() {
  if (
    typeof Analytics !== "undefined" &&
    typeof Analytics.renderCharts === "function"
  ) {
    return Analytics.renderCharts();
  }
  if (typeof Chart === "undefined") {
    console.warn("Chart.js is still loading...");
    if (chartRetryCount < 10) {
      // Retries every 500ms for up to 5 seconds
      chartRetryCount++;
      setTimeout(renderCharts, 500);
    } else {
      console.error("Chart.js failed to load entirely.");
    }
    return;
  }

  chartRetryCount = 0; // Reset counter on successful load

  const canvas = document.getElementById("chart-accuracy");
  if (!canvas) return; // Guard against running when element is missing

  if (typeof chartInstance !== "undefined" && chartInstance) {
    chartInstance.destroy();
  }

  const ctx = canvas.getContext("2d");
  const accuracyMap = state.stats?.subjectAccuracy || {};
  let labels = Object.keys(accuracyMap);
  let data = [];

  if (labels.length === 0) {
    labels = ["COLREG", "Navigation", "Meteorology"];
    data = [0, 0, 0];
  } else {
    data = labels.map((s) => {
      const d = accuracyMap[s];
      if (!d || !d.total) return 0;
      return Math.round((d.correct / d.total) * 100);
    });
  }

  chartInstance = new Chart(ctx, {
    type: "radar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Accuracy %",
          data: data,
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "rgba(59, 130, 246, 1)",
          pointBackgroundColor: "rgba(59, 130, 246, 1)",
          borderWidth: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: { r: { beginAtZero: true, max: 100, ticks: { stepSize: 20 } } },
      plugins: { legend: { display: false } },
      animation: {
        duration: 1500,
        easing: "easeOutQuart",
      },
    },
  });
}

function toggleTheme() {
  if (
    typeof Analytics !== "undefined" &&
    typeof Analytics.toggleTheme === "function"
  ) {
    return Analytics.toggleTheme();
  }
  state.prefs.darkMode = !state.prefs.darkMode;
  document.documentElement.classList.toggle("dark", state.prefs.darkMode);
  saveState();
  updateThemeButton();
}

function updateThemeButton() {
  if (
    typeof Analytics !== "undefined" &&
    typeof Analytics.updateThemeButton === "function"
  ) {
    return Analytics.updateThemeButton();
  }
  const btn = document.getElementById("btn-theme-toggle");
  if (btn) {
    btn.innerHTML = state.prefs.darkMode
      ? '<i class="fa-solid fa-sun transition-transform transform hover:rotate-180 duration-500"></i>'
      : '<i class="fa-solid fa-moon transition-transform transform hover:rotate-12 duration-300"></i>';
  }
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
    alert("Progress Reset.");

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
    alert("Some app data could not be cleared. Please try again.");
  } finally {
    clearAppDataInProgress = false;
  }
}

document.addEventListener("keydown", (e) => {
  const reportModal = document.getElementById("report-modal");
  const settingsModal = document.getElementById("session-settings-modal");

  const isReportModalOpen =
    reportModal && !reportModal.classList.contains("hidden");
  const isSettingsModalOpen =
    settingsModal && !settingsModal.classList.contains("hidden");

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
    const reports = await callBackend({ type: "get_reports", role: "user" });
    if (Array.isArray(reports))
      globallyReportedQs = new Set(reports.map((r) => r.questionId));
  } catch (e) {
    console.warn("Unable to fetch global reports", e);
  }
}

function runWindowLoadStartup() {
  if (window.__mrhWindowLoadStartupRan) {
    return;
  }
  window.__mrhWindowLoadStartupRan = true;

  (async () => {
    await loadState();

    const toggleElement = document.getElementById("globalModeToggle");
    if (toggleElement) {
      currentAppMode = toggleElement.checked ? "review" : "quiz";
    }

    if (typeof syncDatabase === "function") {
      syncDatabase(false, true);
    }
    if (typeof fetchGlobalReports === "function") {
      fetchGlobalReports();
    }
  })().catch((error) => {
    console.error("Window-load startup failed:", error);
  });
}

if (document.readyState === "complete") {
  runWindowLoadStartup();
} else {
  window.addEventListener("load", runWindowLoadStartup, { once: true });
}

window.addEventListener("resize", () => {
  if (state.session.active && state.prefs.quizNavigationPosition === "auto")
    applyNavigationPosition();
});

function saveSessionProgress() {
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.saveSessionProgress === "function"
  ) {
    return SessionCore.saveSessionProgress();
  }

  if (!state.session.active) return;

  try {
    setStoredJSON("saved_session", state.session);
    state.prefs.lastActivity = {
      mode: "quiz",
      subject:
        state.session.questions[state.session.currentIndex]?.Subject || null,
      updatedAt: new Date().toISOString(),
    };
    setStoredJSON("prefs", state.prefs);
  } catch (e) {
    console.warn("Storage quota exceeded. Could not save session progress.", e);
    showToast("Storage full. Progress won't be saved.", "error");
  }
}

function checkSavedSession() {
  if (
    typeof SessionCore !== "undefined" &&
    typeof SessionCore.checkSavedSession === "function"
  ) {
    return SessionCore.checkSavedSession();
  }

  const saved = getStoredItem("saved_session");
  const resumeContainer = document.getElementById("resume-container");
  const activity = state.prefs.lastActivity;
  const contextEl = document.getElementById("resume-context");

  if (contextEl && activity) {
    const modeLabel = activity.mode === "review" ? "Study" : "Quiz";
    contextEl.innerText = activity.subject
      ? `${modeLabel} mode: ${activity.subject}`
      : `${modeLabel} mode`;
  }

  if (
    (saved || (activity?.mode === "review" && activity.subject)) &&
    resumeContainer
  ) {
    try {
      const session = saved ? JSON.parse(saved) : null;
      if (!session) {
        resumeContainer.classList.remove("hidden");
        return;
      }
      const isLastQuestion =
        session.currentIndex >= session.questions.length - 1;
      const isAnswered =
        session.userAnswers && session.userAnswers[session.currentIndex];

      if (isLastQuestion && isAnswered) {
        removeStoredItem("saved_session");
        resumeContainer.classList.add("hidden");
        return;
      }
    } catch (e) {
      console.error("Error checking session", e);
    }

    resumeContainer.classList.remove("hidden");
  } else if (resumeContainer) {
    resumeContainer.classList.add("hidden");
  }
}

let pendingResumeSession = null;

async function resumeSession(password = null) {
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
  removeStoredItem("saved_session");
  state.prefs.lastActivity = null;
  setStoredJSON("prefs", state.prefs);
  const resumeContainer = document.getElementById("resume-container");
  if (resumeContainer) {
    resumeContainer.classList.add("hidden");
  }
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
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.revealAnswer === "function"
  ) {
    return QuizRendering.revealAnswer();
  }
  if (!state.session.active) return;

  const q = state.session.questions[state.session.currentIndex];
  state.session.userAnswers[state.session.currentIndex] = "REVEALED";
  state.session.revealedCloze = true;

  // Use the helper function here too!
  const { isIdent: isPureIdent } = getQuestionTypeMode(q);

  trackStats(q, isPureIdent);

  document.getElementById("q-choices").classList.remove("hidden");
  const activeRecallMask = document.getElementById("active-recall-mask");
  if (activeRecallMask) activeRecallMask.classList.add("hidden");

  renderQuestion();
  saveSessionProgress();
  startVisualTimer();

  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  state.session.autoNextTimeout = setTimeout(() => {
    nextQuestion();
  }, 2000);
}

function startVisualTimer() {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.startVisualTimer === "function"
  ) {
    return QuizRendering.startVisualTimer();
  }
  const container = document.getElementById("auto-next-timer-container");
  const bar = document.getElementById("auto-next-timer-bar");

  container.classList.remove("hidden");

  bar.classList.remove("animate-timer-bar");
  void bar.offsetWidth;
  bar.classList.add("animate-timer-bar");
}

function stopVisualTimer() {
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.stopVisualTimer === "function"
  ) {
    return QuizRendering.stopVisualTimer();
  }
  if (
    typeof QuizRendering !== "undefined" &&
    typeof QuizRendering.stopVisualTimer === "function"
  ) {
    return QuizRendering.stopVisualTimer();
  }
  const container = document.getElementById("auto-next-timer-container");
  const bar = document.getElementById("auto-next-timer-bar");

  container.classList.add("hidden");
  bar.classList.remove("animate-timer-bar");
}

function toggleLayout() {
  state.prefs.layoutMode = state.prefs.layoutMode === "grid" ? "list" : "grid";
  saveState();
  renderCategoryProgress();
}

function getQuizNavigationPosition(subject = currentReviewSubject) {
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
  const deckKey = String(subject || currentReviewSubject || "").trim();
  if (!deckKey) return null;
  const overrides = state.prefs.deckNavigationOverrides || {};
  const deckOverrides = overrides[deckKey];
  if (!deckOverrides || !deckOverrides[type]) return null;
  return deckOverrides[type];
}

function setDeckNavigationOverride(subject, type, value) {
  const deckKey = String(subject || currentReviewSubject || "").trim();
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
  subject = currentReviewSubject,
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
  subject = currentReviewSubject,
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

  const subject =
    currentReviewSubject ||
    state.session?.questions?.[state.session.currentIndex]?.Subject ||
    null;

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

function toggleModal(modalId, isVisible) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.toggleModal === "function"
  ) {
    return UIModal.toggleModal(modalId, isVisible);
  }

  const modal = document.getElementById(modalId);
  if (!modal) return;
  const inner = modal.querySelector("div");

  if (isVisible) {
    modal.classList.remove("hidden");
    setTimeout(() => {
      modal.classList.remove("opacity-0");
      if (inner) inner.classList.remove("scale-95", "opacity-0");
    }, 10);
  } else {
    modal.classList.add("opacity-0");
    if (inner) inner.classList.add("scale-95");
    setTimeout(() => {
      modal.classList.add("hidden");
    }, 300);
  }
}

function openAboutModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openAboutModal === "function"
  ) {
    return UIModal.openAboutModal();
  }
  toggleModal("about-modal", true);
}

function closeAboutModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeAboutModal === "function"
  ) {
    return UIModal.closeAboutModal();
  }
  toggleModal("about-modal", false);
}

let confirmResolver = null;

function requestConfirmation(message, title = "Confirm Action") {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    const modal = document.getElementById("confirm-modal");
    if (!modal) {
      resolve(window.confirm(message));
      return;
    }
    if (modal.parentElement !== document.body) document.body.appendChild(modal);
    document.getElementById("confirm-title").innerHTML =
      `<i class="fa-solid fa-circle-question text-brand-500 mr-2"></i>${escapeHTML(title)}`;
    document.getElementById("confirm-message").innerText = message;
    toggleModal("confirm-modal", true);
  });
}

function closeConfirmModal(confirmed) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeConfirmModal === "function"
  ) {
    return UIModal.closeConfirmModal(confirmed);
  }
  toggleModal("confirm-modal", false);
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    setTimeout(() => resolve(confirmed), 320);
  }
}

function openReportModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openReportModal === "function"
  ) {
    return UIModal.openReportModal();
  }
  const q = state.session?.questions?.[state.session?.currentIndex];
  if (!q) return;

  let reportedQs = [];
  try {
    reportedQs = JSON.parse(getStoredItem("reported_qs", "[]"));
  } catch (e) {
    console.warn("Reported QS array corrupted. Resetting.", e);
    setStoredItem("reported_qs", "[]");
  }

  if (reportedQs.includes(q.ID)) {
    alert(
      "You have already reported this question. Thank you for your feedback!",
    );
    return;
  }

  state.reportQuestion = q;

  const reportType = document.getElementById("report-type");
  const reportLesson = document.getElementById("report-lesson");
  const reportComments = document.getElementById("report-comments");
  if (reportType) reportType.value = "";
  if (reportLesson) reportLesson.value = "";
  if (reportComments) reportComments.value = "";

  toggleModal("report-modal", true);
}

function closeReportModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeReportModal === "function"
  ) {
    return UIModal.closeReportModal();
  }
  state.reportQuestion = null;
  toggleModal("report-modal", false);
}
function openSessionSettingsModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openSessionSettingsModal === "function"
  ) {
    return UIModal.openSessionSettingsModal();
  }
  const recallToggle = document.getElementById("toggle-active-recall");
  if (recallToggle) recallToggle.checked = state.prefs.activeRecall === true;

  const choicesToggle = document.getElementById("toggle-shuffle-choices");
  if (choicesToggle)
    choicesToggle.checked = state.prefs.shuffleChoices !== false;
  const modalChoicesToggle = document.getElementById(
    "toggle-modal-shuffle-choices",
  );
  if (modalChoicesToggle)
    modalChoicesToggle.checked = state.prefs.shuffleChoices !== false;

  const questionsToggle = document.getElementById("toggle-shuffle-questions");
  if (questionsToggle)
    questionsToggle.checked = state.prefs.shuffleQuestions !== false;

  const quizHideToggle = document.getElementById("toggle-quiz-hide-abcd");
  if (quizHideToggle)
    quizHideToggle.checked = state.prefs.quizHideABCD === true;

  const clozeToggle = document.getElementById("toggle-cloze-mode");
  if (clozeToggle) clozeToggle.checked = state.prefs.clozeEnabled !== false;

  const srsToggle = document.getElementById("toggle-srs-mode");
  if (srsToggle) srsToggle.checked = state.prefs.srsEnabled === true;

  const qTypeSelect = document.getElementById("toggle-question-type");
  if (qTypeSelect) qTypeSelect.value = state.prefs.qTypeOverride || "auto";

  const navigationSelect = document.getElementById(
    "navigation-position-select",
  );
  if (navigationSelect) navigationSelect.value = getQuizNavigationPosition();
  const navigationButton = document.getElementById(
    "toggle-session-navigation-bottom",
  );
  if (navigationButton) {
    navigationButton.textContent = getScrollNavigationButtonLabel(
      state.prefs.quizNavigationPosition || "top",
    );
  }

  toggleModal("session-settings-modal", true);
}

function closeSessionSettingsModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeSessionSettingsModal === "function"
  ) {
    return UIModal.closeSessionSettingsModal();
  }
  toggleModal("session-settings-modal", false);
}

// Open Review Settings Modal
function openReviewSettingsModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openReviewSettingsModal === "function"
  ) {
    return UIModal.openReviewSettingsModal();
  }
  const modal = document.getElementById("review-settings-modal");
  const navigationButton = document.getElementById(
    "toggle-review-navigation-bottom",
  );
  if (navigationButton) {
    navigationButton.textContent = getScrollNavigationButtonLabel(
      getStudyNavigationPosition(state.prefs.studyLayout || "scroll"),
    );
  }
  updateStudyFilterToggle();
  modal.classList.remove("hidden");
  // Small delay allows the browser to render 'block' before applying opacity for the transition
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector("div").classList.remove("scale-95");
  }, 10);
}

// Close Review Settings Modal
function closeReviewSettingsModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeReviewSettingsModal === "function"
  ) {
    return UIModal.closeReviewSettingsModal();
  }
  const modal = document.getElementById("review-settings-modal");
  modal.classList.add("opacity-0");
  modal.querySelector("div").classList.add("scale-95");
  // Wait for transition to finish before hiding element
  setTimeout(() => {
    modal.classList.add("hidden");
  }, 300);
}

// Handle layout changes directly from the modal
function handleReviewLayoutChange(layoutType) {
  const perPageContainer = document.getElementById("review-per-page-container");
  const navigationToggle = document.getElementById(
    "toggle-review-navigation-bottom",
  );

  if (layoutType === "single") {
    perPageContainer.classList.add("hidden");
  } else {
    perPageContainer.classList.remove("hidden");
  }

  if (navigationToggle) {
    navigationToggle.textContent = getScrollNavigationButtonLabel(
      getStudyNavigationPosition(layoutType),
    );
  }

  changeStudyLayout(layoutType);
}

function updateStudyFilterToggle() {
  const toggle = document.getElementById("study-filter-toggle");
  const icon = document.getElementById("study-filter-icon");
  if (!toggle || !icon) return;

  const isFavorites = (state.prefs.studyFilterMode || "all") === "favorites";
  toggle.setAttribute("aria-pressed", String(isFavorites));
  toggle.setAttribute(
    "aria-label",
    isFavorites ? "Favorites mode enabled" : "All items mode enabled",
  );
  toggle.title = isFavorites ? "Favorites only" : "All items";
  icon.className = isFavorites ? "fa-solid fa-star" : "fa-solid fa-list";

  toggle.classList.toggle("bg-yellow-100", isFavorites);
  toggle.classList.toggle("text-yellow-600", isFavorites);
  toggle.classList.toggle("dark:bg-yellow-900/30", isFavorites);
  toggle.classList.toggle("dark:text-yellow-300", isFavorites);

  toggle.classList.toggle("bg-gray-200", !isFavorites);
  toggle.classList.toggle("text-gray-700", !isFavorites);
  toggle.classList.toggle("dark:bg-gray-700", !isFavorites);
  toggle.classList.toggle("dark:text-gray-200", !isFavorites);
}

function toggleStudyFilterMode() {
  const nextMode =
    (state.prefs.studyFilterMode || "all") === "favorites"
      ? "all"
      : "favorites";
  changeStudyFilterMode(nextMode);
}

function changeStudyFilterMode(mode) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.changeStudyFilterMode === "function"
  ) {
    return UIModal.changeStudyFilterMode(mode);
  }
  const nextMode = mode === "favorites" ? "favorites" : "all";
  state.prefs.studyFilterMode = nextMode;
  saveState();
  updateStudyFilterToggle();
  if (currentReviewSubject) {
    const currentQuestions = getQuestionsForSubject(currentReviewSubject) || [];
    if (currentQuestions.length > 0) {
      renderDeckReview(currentReviewSubject, currentQuestions);
    }
  }
}

let pendingLockedFolderPath = null;
let pendingLockedFolderName = null;

function openFolderPasswordModal(fullPath, folderName) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openFolderPasswordModal === "function"
  ) {
    return UIModal.openFolderPasswordModal(fullPath, folderName);
  }
  pendingLockedFolderPath = fullPath;
  pendingLockedFolderName = folderName;

  document.getElementById("folder-password-message").innerText =
    `The folder "${folderName}" requires a password to view its contents.`;

  toggleModal("folder-password-modal", true);
}

function closeFolderPasswordModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeFolderPasswordModal === "function"
  ) {
    return UIModal.closeFolderPasswordModal();
  }
  toggleModal("folder-password-modal", false);
  const inputEl = document.getElementById("folder-password-input");
  if (inputEl) inputEl.value = "";
}

function openDeckPasswordModal(subject, action) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openDeckPasswordModal === "function"
  ) {
    return UIModal.openDeckPasswordModal(subject, action);
  }
  pendingDeckSubject = subject;
  pendingDeckAction = action;

  const messageEl = document.getElementById("deck-password-message");
  if (messageEl) {
    const shortName = subject.split("::").pop();
    messageEl.innerText = `The deck "${escapeHTML(shortName)}" requires a password.`;
  }

  toggleModal("deck-password-modal", true);
}

function closeDeckPasswordModal() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.closeDeckPasswordModal === "function"
  ) {
    return UIModal.closeDeckPasswordModal();
  }
  toggleModal("deck-password-modal", false);
  const inputEl = document.getElementById("deck-password-input");
  if (inputEl) inputEl.value = "";
}

function openReportModalFromStudy(questionId) {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.openReportModalFromStudy === "function"
  ) {
    return UIModal.openReportModalFromStudy(questionId);
  }
  questionId = decodeHandlerValue(questionId);
  const q = (state.db || []).find((item) => item.ID === questionId);
  if (!q) return;

  let reportedQs = [];
  try {
    reportedQs = JSON.parse(getStoredItem("reported_qs", "[]"));
  } catch (e) {
    console.warn("Reported QS array corrupted. Resetting.", e);
    setStoredItem("reported_qs", "[]");
  }

  if (reportedQs.includes(q.ID)) {
    alert(
      "You have already reported this question. Thank you for your feedback!",
    );
    return;
  }

  state.reportQuestion = q;

  const reportType = document.getElementById("report-type");
  const reportComments = document.getElementById("report-comments");
  if (reportType) reportType.value = "";
  if (reportComments) reportComments.value = "";

  toggleModal("report-modal", true);
}

async function submitReport() {
  if (
    typeof UIModal !== "undefined" &&
    typeof UIModal.submitReport === "function"
  ) {
    return UIModal.submitReport();
  }
  const typeEl = document.getElementById("report-type");
  const lesson = document.getElementById("report-lesson").value.trim();
  const comments = document.getElementById("report-comments").value.trim();

  if (!typeEl.value) {
    alert("Please select an Error Type.");
    return;
  }

  const btn = document.getElementById("btn-submit-report");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sending...';
  btn.disabled = true;

  const q =
    state.reportQuestion || state.session.questions[state.session.currentIndex];

  if (!q) {
    alert("Error: No question found to report.");
    btn.innerHTML = originalText;
    btn.disabled = false;
    return;
  }

  if (isDeckPasswordProtected(q.Subject)) {
    alert("Reporting is disabled for password-protected decks.");
    btn.innerHTML = originalText;
    btn.disabled = false;
    return;
  }

  try {
    const result = await callBackend({
      type: "submit_report",
      questionId: q.ID,
      subject: q.Subject,
      questionText: q.Question,
      errorType: typeEl.value,
      lesson: lesson,
      comments: comments,
      choices: { A: q.ChoiceA, B: q.ChoiceB, C: q.ChoiceC, D: q.ChoiceD },
      correctAnswer: q.Answer,
    });

    if (result.status === "success") {
      const reportedQs = JSON.parse(getStoredItem("reported_qs", "[]"));
      reportedQs.push(q.ID);
      setStoredItem("reported_qs", JSON.stringify(reportedQs));

      btn.innerHTML =
        '<i class="fa-solid fa-check mr-2"></i> Report Submitted!';
      btn.classList.remove("bg-red-500", "hover:bg-red-600");
      btn.classList.add("bg-green-500", "hover:bg-green-600");

      setTimeout(() => {
        closeReportModal();
        setTimeout(() => {
          btn.innerHTML = originalText;
          btn.disabled = false;
          btn.classList.remove("bg-green-500", "hover:bg-green-600");
          btn.classList.add("bg-red-500", "hover:bg-red-600");
        }, 500);

        if (!state.reportQuestion) {
          if (state.session.userAnswers[state.session.currentIndex]) {
            nextQuestion();
          } else {
            revealAnswer();
          }
        }

        state.reportQuestion = null;
      }, 1500);
    }
  } catch (err) {
    console.error(err);
    alert("Network error. Please try again.");
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

async function loadReports() {
  const pendingContainer = document.getElementById("public-pending-reports");
  const resolvedContainer = document.getElementById("public-resolved-reports");
  if (pendingContainer)
    pendingContainer.innerHTML = `<div class="text-center py-8"><i class="fa-solid fa-spinner fa-spin text-3xl text-brand-500"></i><p class="mt-2 text-gray-500">Fetching community reports...</p></div>`;

  try {
    const reports = await callBackend({ type: "get_reports", role: "user" });
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

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  const colors =
    type === "error"
      ? "bg-red-500 text-white"
      : "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900";
  const icon = type === "error" ? "fa-circle-exclamation" : "fa-circle-check";

  toast.className = `toast-enter ${colors} px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 font-medium text-sm`;
  toast.innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHTML(message)}`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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

function updateRecentDecks(subj) {
  if (!subj) return;
  if (!state.prefs.recentDecks) state.prefs.recentDecks = [];
  const recentDecks = state.prefs.recentDecks || [];
  const filtered = recentDecks.filter((d) => d !== subj);
  filtered.unshift(subj);
  state.prefs.recentDecks = filtered.slice(0, 10);
}

function handleDeckClick(subj, action = "continue") {
  subj = decodeHandlerValue(subj);
  if (!subj) return;

  // If deck was locally deleted, clear it from deleted list so we fetch fresh
  if ((state.prefs.localDownloadDeletedDecks || []).includes(subj)) {
    clearLocalDownloadDeleted(subj);
    saveState();
  }

  // ROBUSTNESS FIX: Allow access to cached decks even if sync is temporarily unavailable
  // Only block if we've never successfully synced AND we're in cold start
  if (!syncConnected && isColdStart && state.categorySummary.length === 0) {
    updateSyncStatus(
      '<i class="fa-solid fa-xmark mr-1"></i> Decks are temporarily unavailable while the database reconnects.',
      "warning",
    );
    return;
  }

  // Warn user but allow access if they have cached decks available
  if (!syncConnected && state.categorySummary.length > 0) {
    updateSyncStatus(
      '<i class="fa-solid fa-exclamation-triangle mr-1"></i> Using cached deck. Background sync unavailable.',
      "warning",
    );
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
  if (currentAppMode === "review") {
    reviewDeck(subj, null);
  } else {
    fetchAndStartCategory(subj, action, null);
  }
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
    const pass = document.getElementById("folder-password-input")?.value || "";
    const btn = folderPasswordButton;

    if (!pass) {
      alert("Please enter a password.");
      return;
    }

    await runWithBusyButton(btn, "Verifying...", async () => {
      try {
        const response = await fetch(DB_URL, {
          method: "POST",
          headers: {
            "Content-Type": "text/plain;charset=utf-8",
            Accept: "application/json",
          },
          body: JSON.stringify({
            type: "verify_folder_access",
            subject: String(pendingLockedFolderPath || "").trim(),
            password: String(pass),
          }),
          cache: "no-store",
          redirect: "follow",
        });
        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (parseError) {
          throw new Error(
            `Invalid backend response while verifying folder password: ${text.slice(0, 200)}`,
          );
        }
        if (result.error) {
          alert(result.error);
        } else {
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
        }
      } catch (error) {
        console.error("Verification failed", error);
        alert("Network error while verifying the folder password.");
      }
    });
  });
}

const btnSubmitDeckPassword = document.getElementById(
  "btn-submit-deck-password",
);

if (btnSubmitDeckPassword) {
  btnSubmitDeckPassword.addEventListener("click", async () => {
    const pass = document.getElementById("deck-password-input")?.value || "";

    if (!pass) {
      alert("Please enter a password.");
      return;
    }

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
  if (!text) return "";

  const revealCloze = Boolean(options.revealCloze);
  const clozeEnabled =
    options.clozeEnabled ?? state.prefs.clozeEnabled !== false;
  let formatted = escapeHTML(TextUtils.stripQuestionNumberPrefix(text));

  if (clozeEnabled) {
    const clozeRegex = /\{\{c\d+::([^{}]+)\}\}/g;
    formatted = formatted.replace(clozeRegex, (match, innerText) => {
      const safeInner = escapeHTML(String(innerText || "").trim());
      const safeInnerValue = safeInner || "••••";
      const clozeVisual = revealCloze
        ? `<span class="cloze-answer text-brand-700 dark:text-brand-300">${safeInnerValue}</span>`
        : `<span class="cloze-answer hidden">${safeInnerValue}</span>`;
      return `<span class="cloze-token inline-flex items-center">
        <button type="button" class="cloze-trigger rounded border border-dashed border-brand-500 px-2 py-0.5 text-xs font-bold bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-200 ${revealCloze ? "cloze-visible" : ""}" onclick="event.preventDefault(); event.stopPropagation(); revealClozeAnswer(this)">
          <span class="cloze-mask">${revealCloze ? safeInnerValue : "□ □ □"}</span>
          ${clozeVisual}
        </button>
      </span>`;
    });
  }

  const listRegex = /(?:\s|^)((?:\d+|[A-Za-z]|[IVXLCDMivxlcdm]{1,4})\.)\s/g;

  formatted = formatted.replace(listRegex, "<br><br>$1 ");

  if (formatted.startsWith("<br><br>")) {
    formatted = formatted.substring(8);
  }

  return formatted;
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
    typeof DeckReview !== "undefined" &&
    typeof DeckReview.changeStudyLayout === "function"
  ) {
    return DeckReview.changeStudyLayout(layout);
  }
  state.prefs.studyLayout = layout;
  saveState();
  reRenderDeckReview();
}

if (!state.prefs.studyFilterMode) state.prefs.studyFilterMode = "all";

function changeStudyPageSize(size) {
  if (
    typeof DeckReview !== "undefined" &&
    typeof DeckReview.changeStudyPageSize === "function"
  ) {
    return DeckReview.changeStudyPageSize(size);
  }
  const parsedSize = parseInt(size, 10);
  if (!Number.isFinite(parsedSize) || parsedSize < 1) return;

  // Auto-switch to Single Flashcard layout if user enters 1 in Scroll List mode
  const currentLayout = state.prefs.studyLayout || "scroll";
  if (currentLayout === "scroll" && parsedSize === 1) {
    state.prefs.studyLayout = "single";
    const layoutSelect = document.getElementById("review-layout-select");
    if (layoutSelect) layoutSelect.value = "single";
    const perPageContainer = document.getElementById(
      "review-per-page-container",
    );
    if (perPageContainer) perPageContainer.classList.add("hidden");
  }

  state.prefs.studyPageSize = parsedSize;
  let subject = currentReviewSubject;
  if (!state.prefs.studyProgress[subject])
    state.prefs.studyProgress[subject] = { page: 1, index: 0, scrollY: 0 };
  state.prefs.studyProgress[subject].page = 1;
  saveState();
  reRenderDeckReview();
}

function changeStudyPage(delta) {
  if (
    typeof DeckReview !== "undefined" &&
    typeof DeckReview.changeStudyPage === "function"
  ) {
    return DeckReview.changeStudyPage(delta);
  }
  let subject = currentReviewSubject;
  state.prefs.studyProgress[subject].page += delta;
  saveState();
  reRenderDeckReview();
  const scrollContainer = document.querySelector("main");
  if (scrollContainer) scrollContainer.scrollTop = 0;
}

function jumpToStudyPage(pageNumber) {
  if (
    typeof DeckReview !== "undefined" &&
    typeof DeckReview.jumpToStudyPage === "function"
  ) {
    return DeckReview.jumpToStudyPage(pageNumber);
  }
  const subject = currentReviewSubject;
  if (!subject || !state.prefs.studyProgress[subject]) return;

  const parsed = Number.parseInt(pageNumber, 10);
  if (!Number.isFinite(parsed)) return;

  const favoriteSet = new Set(
    Array.isArray(state.prefs.favoriteQuestions)
      ? state.prefs.favoriteQuestions.filter(Boolean)
      : [],
  );
  const studyFilterMode = state.prefs.studyFilterMode || "all";
  const visibleQuestions =
    studyFilterMode === "favorites"
      ? (currentReviewQuestions || []).filter((q) => favoriteSet.has(q.ID))
      : currentReviewQuestions || [];

  const totalPages = Math.max(
    1,
    Math.ceil(visibleQuestions.length / (state.prefs.studyPageSize || 50)),
  );

  const safePage = Math.min(Math.max(parsed, 1), totalPages);

  state.prefs.studyProgress[subject].page = safePage;
  saveState();
  reRenderDeckReview();
  const scrollContainer = document.querySelector("main");
  if (scrollContainer) scrollContainer.scrollTop = 0;
}

function changeStudyIndex(delta) {
  let subject = currentReviewSubject;
  state.prefs.studyProgress[subject].index += delta;
  saveState();
  reRenderDeckReview();
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
    alert(
      "Warning: Strict Identification mode enabled. You are hiding choices for MCQs. (This is an experimental feature)",
    );
  } else if (mode === "mcq") {
    alert(
      "Warning: Strict MCQ mode enabled. Choices WILL return undefined if there are no other choices present in the database. (This is an experimental feature)",
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
  if (typeof document === "undefined") return;

  const toastContainer =
    document.getElementById("app-toast-container") || createToastContainer();
  if (!toastContainer) return;

  const toast = document.createElement("div");
  const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  toast.id = toastId;

  const bgClass =
    {
      info: "bg-blue-500",
      success: "bg-green-500",
      warning: "bg-yellow-500",
      error: "bg-red-500",
    }[type] || "bg-blue-500";

  toast.className = `fixed bottom-4 right-4 ${bgClass} text-white px-4 py-3 rounded-lg shadow-lg animate-fade-in transition-all duration-300 z-50 max-w-sm text-sm font-medium`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  if (typeof document === "undefined") return null;
  const container = document.createElement("div");
  container.id = "app-toast-container";
  container.className = "fixed bottom-0 right-0 z-50 pointer-events-none";
  document.body.appendChild(container);
  return container;
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
        if (!isLeaderTab && cacheVersionCheckTimer !== null) {
          clearInterval(cacheVersionCheckTimer);
          cacheVersionCheckTimer = null;
        } else if (isLeaderTab && typeof scheduleNextPolling === "function") {
          // Reclaiming leadership must restart cache-version polling.
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

      if (data.type === "cache_version_updated" && data.newVersion != null) {
        const newVersion = String(data.newVersion).trim();
        const currentVersion = String(localCacheVersion || "").trim();
        if (newVersion && newVersion !== currentVersion) {
          persistLocalCacheVersion(newVersion);
          reloadAppStateInMemory().catch((error) => {
            console.warn("[CACHE] Cross-tab state refresh failed:", error);
          });
        }
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

// ============================================
// OPTIMIZATION: Exponential Backoff with Jitter
// ============================================
function calculateBackoffDelay(retryCount) {
  // Exponential: 2^retryCount seconds
  // Jitter: add random 0-50% to avoid thundering herd
  const baseDelay = Math.pow(2, Math.min(retryCount, 5)) * 1000; // Cap at 32 seconds
  const jitter = Math.random() * baseDelay * 0.5;
  return baseDelay + jitter;
}

async function fetchWithExponentialBackoff(url, options = {}, maxRetries = 3) {
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.ok || response.status === 304) {
        failureRetryCount = 0; // Reset on success
        return response;
      }

      // Rate limited or server error?
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`Server error: ${response.status}`);
      }

      return response;
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = calculateBackoffDelay(attempt);
        console.log(
          `[BACKOFF] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError || new Error("Max retries exceeded");
}

// ============================================
// OPTIMIZATION: Jittered Polling Interval
// ============================================
function getJitteredPollingInterval() {
  // Poll frequently enough to feel realtime while still staggering clients.
  const jitter = (Math.random() - 0.5) * 6000; // ±3 seconds
  return Math.max(8000, Math.min(18000, 12000 + jitter));
}

// ============================================
// OPTIMIZATION: Enhanced Cache Version Check with ETag
// ============================================
async function checkCacheVersionWithETag() {
  if (syncInFlightPromise || syncPollTimer) return;

  if (!isLeaderTab) return;

  // Pause polling when tab is hidden
  if (typeof document !== "undefined" && document.hidden) {
    console.log("[CACHE] Tab hidden, skipping version check");
    return;
  }

  try {
    const response = await fetchWithExponentialBackoff(
      DB_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          Accept: "application/json",
        },
        body: JSON.stringify({ type: "get_cache_version" }),
      },
      2,
    );

    if (!response.ok) return;

    const data = await response.json();

    if (data && data.version !== undefined && data.version !== null) {
      // Backend v8 returns an opaque string version token; compare exact tokens.
      remoteCacheVersion = String(data.version).trim();

      const storedLocalCacheVersion = readStoredCacheVersion();
      if (!String(localCacheVersion || "").trim() && storedLocalCacheVersion) {
        localCacheVersion = storedLocalCacheVersion;
      }

      const localVersionToken = String(localCacheVersion || "").trim();
      const versionChanged =
        Boolean(localVersionToken) && remoteCacheVersion !== localVersionToken;

      if (versionChanged) {
        console.log(
          `[CACHE] Version changed: ${localVersionToken} -> ${remoteCacheVersion}`,
        );

        if (isLeaderTab && typeof leaderElectionChannel !== "undefined") {
          try {
            leaderElectionChannel.postMessage({
              type: "cache_version_updated",
              newVersion: remoteCacheVersion,
            });
          } catch (e) {
            console.log("[CACHE] Could not broadcast version update");
          }
        }

        // In-memory state re-fetch (no page reload!).
        await reloadAppStateInMemory();
      }

      persistLocalCacheVersion(remoteCacheVersion);
      failureRetryCount = 0;
    }
  } catch (e) {
    failureRetryCount++;
    console.error("[CACHE] Version check failed:", e);

    if (failureRetryCount > maxRetryAttempts) {
      console.warn(
        "[CACHE] Max retry attempts exceeded, giving up temporarily",
      );
      failureRetryCount = 0;
    }
  }
}

// ============================================
// OPTIMIZATION: Enhanced Visibility Change Handler
// ============================================
function setupVisibilityChangeHandler() {
  if (typeof document === "undefined") return;

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      console.log("[VISIBILITY] Tab became visible, checking cache version");
      // Immediately check cache when tab becomes visible
      checkCacheVersionWithETag();

      // Reset polling to random interval
      scheduleNextPolling();
    } else {
      console.log("[VISIBILITY] Tab hidden, will pause polling");
    }
  });
}

// ============================================
// OPTIMIZATION: Smarter Polling Scheduler with Jitter
// ============================================
function scheduleNextPolling() {
  if (syncPollTimer) {
    clearTimeout(syncPollTimer);
    syncPollTimer = null;
  }

  if (cacheVersionCheckTimer !== null) {
    clearInterval(cacheVersionCheckTimer);
    cacheVersionCheckTimer = null;
  }

  if (!isLeaderTab) {
    console.log("[POLLING] Not leader, skipping poll schedule");
    return;
  }

  console.log(
    "[POLLING] Using single sync scheduler for visibility-aware polling",
  );
  scheduleSyncPoll();
}

function startCacheVersionChecking() {
  // Setup leader election first
  setupLeaderElection();

  // Setup visibility handler
  setupVisibilityChangeHandler();

  // Use the single app sync scheduler; keep only one poll loop alive.
  scheduleNextPolling();
}

function forcePageRefresh() {
  console.log("[CACHE] Cache invalidated - triggering background sync");
  clearTimeout(window.cacheInvalidationTimeout);
  window.cacheInvalidationTimeout = setTimeout(() => {
    triggerSilentSummaryRefresh("Forcing quiet cache refresh");
  }, 100);
}

function initializeApp() {
  if (__mrhAppInitialized) return false;
  __mrhAppInitialized = true;

  // CRITICAL FIX: Setup cache invalidation listener and version checking
  setupCacheInvalidationListener();
  startCacheVersionChecking();
  initDetailsExclusivity();

  // CRITICAL: Fetch access metadata early to avoid filtering issues
  fetchAccessMetadata().catch((err) => {
    console.warn("Initial access metadata fetch failed, will retry:", err);
  });

  const mainEl = document.querySelector("main");
  const headerEl = document.querySelector("header");
  if (headerEl) headerEl.classList.add("transition-transform", "duration-300");

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

          if (
            document
              .getElementById("view-deck-review")
              .classList.contains("active") &&
            currentReviewSubject
          ) {
            if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
            if (!state.prefs.studyProgress[currentReviewSubject]) {
              state.prefs.studyProgress[currentReviewSubject] = {
                page: 1,
                index: 0,
                scrollY: 0,
              };
            }
            state.prefs.studyProgress[currentReviewSubject].scrollY =
              currentScroll;
            clearTimeout(window.scrollSaveTimeout);
            window.scrollSaveTimeout = setTimeout(() => saveState(), 1000);
          }

          isTicking = false;
        });

        isTicking = true;
      }
    });
  }

  // Apply title display mode preference
  setTimeout(() => {
    applyTitleMode();
    updateTitleModeButton();
  }, 100);
  return true;
}

window.initializeApp = initializeApp;

if (document.readyState === "loading") {
  window.addEventListener("DOMContentLoaded", initializeApp, { once: true });
} else {
  initializeApp();
}
