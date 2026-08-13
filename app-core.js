const DB_URL =
  "https://script.google.com/macros/s/AKfycbx4HFy5LmX_CFZMTOdl809OrnsgxzQvpzHDOhrMK3yk7fNZb7Gp2pImwBCS_I1Gx-D20g/exec";

const SYNC_INTERVAL_MS = 5 * 60 * 1000;
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
let lastSyncAt = 0;
let progressSyncTimer = null;
let progressSyncInFlight = false;
let suppressProgressSync = false;
let progressServerUpdatedAt = "";
let authChannel = null;
let authStateVersion = 0;
let pendingProgressRequestKey = null;
let pendingOfflineSyncTimer = null;
let discoverySearchDebounceTimer = null;
let discoveryUiBound = false;
let discoveryActiveIndex = -1;

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

function generateUserId() {
  if (window.crypto && window.crypto.randomUUID) {
    return "user_" + crypto.randomUUID();
  }

  if (window.crypto && window.crypto.getRandomValues) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return (
      "user_" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
    );
  }
  return "user_" + Math.random().toString(36).substring(2, 15);
}

if (!state?.prefs?.userId) {
  state.prefs.userId = generateUserId();
  try {
    localStorage.setItem("mrh_user_id", state.prefs.userId);
  } catch (e) {}
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

function formatQuestionText(text, options = {}) {
  return TextUtils.formatQuestionText(text, options);
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

  // Remove deleted decks from favorites and recent lists
  // (but keep them in categorySummary so they remain visible with 0 questions)
  state.prefs.favoriteDecks = (state.prefs.favoriteDecks || []).filter(
    (item) => !deletedSet.has(String(item || "").trim()),
  );
  state.prefs.recentDecks = (state.prefs.recentDecks || []).filter(
    (item) => !deletedSet.has(String(item || "").trim()),
  );
}

function getDiscoveryViewModel() {
  const builder =
    window.DiscoveryUtils &&
    typeof window.DiscoveryUtils.buildDiscoveryViewModel === "function"
      ? window.DiscoveryUtils.buildDiscoveryViewModel
      : null;

  if (!builder) {
    return {
      favoriteDecks: [],
      recentDecks: [],
      searchQuery: "",
      visibleDecks: [],
      hasQuickAccess: false,
    };
  }

  return builder(state, getVisibleCategorySummary() || []);
}

function bindDiscoveryUi() {
  if (discoveryUiBound) return;

  document.addEventListener("click", (event) => {
    const panel = document.getElementById("header-search-panel");
    const toggle = document.getElementById("header-discovery-toggle");
    if (!panel || panel.classList.contains("hidden")) return;
    if (panel.contains(event.target) || toggle?.contains(event.target)) return;
    closeDiscoverySearchPanel();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeDiscoverySearchPanel();
      return;
    }

    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter"
    ) {
      handleDiscoveryKeyboard(event);
    }
  });

  discoveryUiBound = true;
}

function toggleFavoriteDeck(subject) {
  const safeSubject = decodeHandlerValue(subject || "");
  if (!safeSubject) return;
  if ((state.prefs?.deletedDecks || []).includes(safeSubject)) return;

  if (!Array.isArray(state.prefs.favoriteDecks)) {
    state.prefs.favoriteDecks = [];
  }

  const wasFavorite = state.prefs.favoriteDecks.includes(safeSubject);
  if (wasFavorite) {
    state.prefs.favoriteDecks = state.prefs.favoriteDecks.filter(
      (value) => value !== safeSubject,
    );
    showToast("Removed from Favorites.");
  } else {
    state.prefs.favoriteDecks = [
      safeSubject,
      ...state.prefs.favoriteDecks,
    ].slice(0, 8);
    showToast("Added to Favorites.");
  }

  saveState();
  renderCategoryProgress();
}

function updateRecentDecks(subject) {
  const safeSubject = decodeHandlerValue(subject || "");
  if (!safeSubject) return;
  if ((state.prefs?.deletedDecks || []).includes(safeSubject)) return;

  const adder =
    window.DiscoveryUtils &&
    typeof window.DiscoveryUtils.addDiscoveryEntry === "function"
      ? window.DiscoveryUtils.addDiscoveryEntry
      : null;

  state.prefs.recentDecks = adder
    ? adder(state.prefs.recentDecks, safeSubject, 8)
    : [safeSubject];
}

function getDiscoveryQueryText() {
  const builder =
    window.DiscoveryUtils &&
    typeof window.DiscoveryUtils.normalizeQueryText === "function"
      ? window.DiscoveryUtils.normalizeQueryText
      : null;

  const rawQuery = String(state.prefs.discoverySearch || "").trim();
  return builder ? builder(rawQuery) : rawQuery;
}

async function ensureDiscoveryLoaded() {
  if (window.DiscoveryUtils) return;
  if (typeof window.loadFeatureScript === "function") {
    await window.loadFeatureScript("discovery.js");
  }
}

async function ensureAdminLoaded() {
  if (window.adminState && typeof loadAdminSubjects === "function") return;
  if (typeof window.loadFeatureScript === "function") {
    await window.loadFeatureScript("admin.js");
  }
}

function updateDiscoveryPanel() {
  const panel = document.getElementById("header-search-panel");
  const resultsContainer = document.getElementById("header-search-results");
  const input = document.getElementById("header-discovery-input");
  const toggle = document.getElementById("header-discovery-toggle");

  if (!panel || !resultsContainer) return;

  if (input) input.value = state.prefs.discoverySearch || "";
  if (toggle) {
    toggle.setAttribute(
      "aria-expanded",
      panel.classList.contains("hidden") ? "false" : "true",
    );
  }

  const query = getDiscoveryQueryText();
  const viewModel = getDiscoveryViewModel();
  const favoriteDecks = Array.isArray(viewModel.favoriteDecks)
    ? viewModel.favoriteDecks
    : [];
  const recentDecks = Array.isArray(viewModel.recentDecks)
    ? viewModel.recentDecks
    : [];

  const deletedSet = new Set(
    (state.prefs?.deletedDecks || [])
      .map((entry) => String(entry || "").trim())
      .filter(Boolean),
  );

  const dedupedQuickAccess = [];
  [...favoriteDecks, ...recentDecks].forEach((subject) => {
    const normalized = String(subject || "").trim();
    if (!normalized || deletedSet.has(normalized)) return;
    if (dedupedQuickAccess.includes(normalized)) return;
    dedupedQuickAccess.push(normalized);
  });

  const suggestions = query
    ? (viewModel.visibleDecks || []).slice(0, 6)
    : dedupedQuickAccess.slice(0, 6);

  if (suggestions.length === 0) {
    resultsContainer.innerHTML = `
      <div class="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        ${query ? `No decks found for “${escapeHTML(state.prefs.discoverySearch || "")}”.` : "Search decks or open one to build shortcuts."}
      </div>
    `;
    discoveryActiveIndex = -1;
    return;
  }

  if (discoveryActiveIndex < 0 || discoveryActiveIndex >= suggestions.length) {
    discoveryActiveIndex = 0;
  }

  resultsContainer.innerHTML = `
    <div class="flex flex-col gap-1.5">
      ${suggestions
        .map((entry, index) => {
          const subject =
            typeof entry === "string" ? entry : entry.Subject || "";
          const safeSubject = String(subject || "").trim();
          if (!safeSubject) return "";

          const isActive = index === discoveryActiveIndex;
          const activeClass = isActive
            ? "bg-brand-50 border-brand-500 dark:bg-brand-900/30 dark:border-brand-500"
            : "";

          return `
            <div class="search-result-item flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm text-gray-700 dark:text-gray-200 ${activeClass}" data-discovery-index="${index}">
              <button
                type="button"
                data-discovery-select="${index}"
                onclick="handleDeckClick('${encodeHandlerValue(safeSubject)}')"
                class="flex-1 min-w-0 text-left truncate"
                title="${escapeHTML(safeSubject)}"
              >
                <i class="fa-solid fa-file-lines mr-2 text-gray-400"></i>
                <span class="truncate">${escapeHTML(safeSubject)}</span>
              </button>
              <button
                type="button"
                onclick="event.stopPropagation(); toggleFavoriteDeck('${encodeHandlerValue(safeSubject)}')"
                class="shrink-0 rounded-full p-1.5 text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/30"
                title="Toggle favorite"
              >
                <i class="fa-solid fa-star"></i>
              </button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

async function toggleDiscoverySearchPanel() {
  const panel = document.getElementById("header-search-panel");
  const input = document.getElementById("header-discovery-input");
  if (!panel) return;

  const shouldOpen = panel.classList.contains("hidden");
  panel.classList.toggle("hidden", !shouldOpen);
  if (shouldOpen) {
    bindDiscoveryUi();
    await ensureDiscoveryLoaded();
    updateDiscoveryPanel();
    window.setTimeout(() => input?.focus(), 50);
  }
}

function closeDiscoverySearchPanel() {
  const panel = document.getElementById("header-search-panel");
  if (!panel) return;
  panel.classList.add("hidden");
  const toggle = document.getElementById("header-discovery-toggle");
  if (toggle) toggle.setAttribute("aria-expanded", "false");
}

function activateDiscoverySelection() {
  const panel = document.getElementById("header-search-panel");
  const resultsContainer = document.getElementById("header-search-results");
  if (!panel || !resultsContainer || panel.classList.contains("hidden")) {
    return;
  }

  const rows = Array.from(
    resultsContainer?.querySelectorAll("[data-discovery-index]") || [],
  );

  if (rows.length === 0) return;

  const safeIndex = Math.max(
    0,
    Math.min(discoveryActiveIndex, rows.length - 1),
  );
  const activeRow = rows[safeIndex] || rows[0];
  const button = activeRow?.querySelector("[data-discovery-select]");
  if (button) {
    button.click();
  }
}

function moveDiscoverySelection(delta) {
  const resultsContainer = document.getElementById("header-search-results");
  const rows = Array.from(
    resultsContainer?.querySelectorAll("[data-discovery-index]") || [],
  );

  if (rows.length === 0) return;

  const nextIndex = Math.max(
    0,
    Math.min(rows.length - 1, discoveryActiveIndex + delta),
  );

  discoveryActiveIndex = nextIndex;
  updateDiscoveryPanel();
}

function handleDiscoverySearchInput(event) {
  const nextValue = event?.target?.value || "";
  clearTimeout(discoverySearchDebounceTimer);
  state.prefs.discoverySearch = nextValue;
  discoveryActiveIndex = -1;

  discoverySearchDebounceTimer = window.setTimeout(() => {
    saveState();
    renderCategoryProgress();
    updateDiscoveryPanel();
  }, 120);
}

function clearDiscoverySearch() {
  state.prefs.discoverySearch = "";
  discoveryActiveIndex = -1;
  clearTimeout(discoverySearchDebounceTimer);
  saveState();
  renderCategoryProgress();
  updateDiscoveryPanel();
  const input = document.getElementById("header-discovery-input");
  if (input) input.focus();
}

function handleDiscoveryKeyboard(event) {
  const input = document.getElementById("header-discovery-input");
  if (event.target !== input) return;

  if (event.key === "ArrowDown") {
    event.preventDefault();
    const rows = Array.from(
      document
        .getElementById("header-search-results")
        ?.querySelectorAll("[data-discovery-index]") || [],
    );

    if (rows.length === 0) return;

    discoveryActiveIndex = Math.min(
      Math.max(discoveryActiveIndex + 1, 0),
      rows.length - 1,
    );
    updateDiscoveryPanel();
    return;
  }

  if (event.key === "ArrowUp") {
    event.preventDefault();
    const rows = Array.from(
      document
        .getElementById("header-search-results")
        ?.querySelectorAll("[data-discovery-index]") || [],
    );

    if (rows.length === 0) return;

    discoveryActiveIndex = Math.max(
      Math.min(discoveryActiveIndex - 1, rows.length - 1),
      0,
    );
    updateDiscoveryPanel();
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    activateDiscoverySelection();
  }
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

async function loadState() {
  emitDebugState("load_state:start");
  migrateLegacyStorageKeys();
  const savedStats = getStoredItem("stats");
  const savedPrefs = getStoredItem("prefs");
  const savedSummary =
    getStoredItem("summary") || getAnyNamespaceStoredItem("summary");

  try {
    if (typeof idbKeyval !== "undefined") {
      const savedDb = await idbKeyval.get("mrh_db");
      if (savedDb) {
        state.db = savedDb.map((q) => {
          const normalized = normalizeQuestionRecord(q);
          if (normalized.ID && !normalized.ID.toString().includes("::")) {
            let cleanId = normalized.ID.toString().replace(
              /^[a-zA-Z]+[-\s]?/,
              "",
            );
            normalized.ID = `${normalized.Subject}::${cleanId}`;
          }
          return normalized;
        });
        rebuildQuestionIndex();
      }
    } else {
      console.warn("idbKeyval library not loaded.");
    }
  } catch (err) {
    console.error("Error loading DB from IndexedDB", err);
  }

  if (savedSummary) {
    try {
      state.categorySummary = JSON.parse(savedSummary);
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
      state.prefs.discoverySearch = state.prefs.discoverySearch || "";
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

  populateFilters();
  bindDiscoveryUi();
  updateDashboard();
  updateThemeButton();
  syncPreferenceControls();
  emitDebugState("load_state:complete", {
    dbCount: state.db.length,
    summaryCount: state.categorySummary.length,
  });
}

async function saveState() {
  try {
    emitDebugState("save_state:begin", {
      dbCount: state.db.length,
      summaryCount: state.categorySummary.length,
    });
    setStoredJSON("stats", state.stats);
    setStoredJSON("prefs", state.prefs);
    setStoredJSON("summary", state.categorySummary);
    if (
      !suppressProgressSync &&
      typeof userState !== "undefined" &&
      userState.isLoggedIn
    ) {
      const meta = getProgressMeta();
      meta.localUpdatedAt = new Date().toISOString();
      setStoredJSON("progress_meta", meta);
      queueProgressSync();
    }
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
      if (check)
        check.style.display =
          option.dataset.sortValue === sortBy ? "inline-block" : "none";
    });
  document
    .querySelectorAll(".deck-sort-option[data-sort-direction]")
    .forEach((option) => {
      const check = option.querySelector(".sort-direction-check");
      if (check)
        check.style.display =
          option.dataset.sortDirection === sortDirection
            ? "inline-block"
            : "none";
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

  const discoveryPanel = document.getElementById("header-search-panel");
  const shouldLoadDiscovery =
    (discoveryPanel && !discoveryPanel.classList.contains("hidden")) ||
    Boolean(state.prefs.discoverySearch);

  if (shouldLoadDiscovery) {
    await ensureDiscoveryLoaded();
  }

  updateDiscoveryPanel();
}

let settingsClickCount = 0;
let settingsClickTimeout = null;

async function navigate(viewId) {
  if (viewId === "settings") {
    settingsClickCount++;
    clearTimeout(settingsClickTimeout);
    if (settingsClickCount >= 5) {
      const adminBtn = document.getElementById("btn-admin-nav");
      adminBtn.classList.remove("hidden");
      adminBtn.classList.add("animate-card-in");
      settingsClickCount = 0;
    } else {
      settingsClickTimeout = setTimeout(() => {
        settingsClickCount = 0;
      }, 2000);
    }
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

  document
    .querySelectorAll(".view-section")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById(`view-${viewId}`).classList.add("active");

  if (viewId === "stats") renderCharts();

  // FIXED: Safely check if adminState is defined globally
  if (viewId === "admin") {
    await ensureAdminLoaded();
    const activeAdminToken =
      typeof getAdminToken === "function" ? getAdminToken() : "";
    if (activeAdminToken && typeof loadAdminSubjects === "function") {
      loadAdminSubjects();
    }
  }

  sendTelemetry("navigate", { view: viewId });
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
  const shouldSuppressOverlay =
    state.session.active &&
    showOverlay &&
    /database|reconnect|waiting until your session ends/i.test(message);
  const effectiveShowOverlay = shouldSuppressOverlay ? false : showOverlay;
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
      true,
      visualState.overlayTitle,
      visualState.overlayDetail,
      tone,
    );
  } else if (tone === "warning" || tone === "error") {
    setGlobalLoadingState(
      true,
      visualState.overlayTitle,
      visualState.overlayDetail,
      tone,
    );
  } else {
    setGlobalLoadingState(false);
  }

  const connectionStatus = document.getElementById("connection-status");
  if (connectionStatus && effectiveShowOverlay) {
    clearTimeout(syncStatusHideTimer);
    connectionStatus.classList.remove("hidden", "opacity-0", "scale-95");
    connectionStatus.innerHTML = message;
    connectionStatus.className = `fixed bottom-5 left-1/2 z-[60] w-max max-w-[calc(100%-2rem)] -translate-x-1/2 rounded-lg px-4 py-2 text-center text-xs font-medium shadow-lg transition-all duration-500 ${visualState.panelClass}`;
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

function scheduleSyncPoll() {
  clearTimeout(syncPollTimer);
  syncPollTimer = setTimeout(() => syncDatabase(true, true), SYNC_INTERVAL_MS);
}

function applySummaryData(summaryData) {
  const previousSummary = JSON.stringify(state.categorySummary || []);
  const nextSummary = JSON.stringify(summaryData);
  const changed = previousSummary !== nextSummary;

  state.categorySummary = summaryData;
  syncConnected = true;
  saveState();
  populateFilters();
  return changed;
}

function scheduleSyncRetry(showOverlay = true) {
  clearTimeout(syncRetryTimer);
  clearInterval(syncCountdownTimer);
  const delay = SYNC_INTERVAL_MS;
  const retryAt = Date.now() + delay;
  const wasConnected = syncConnected;
  syncConnected = false;
  if (wasConnected) renderCategoryProgress();
  const renderCountdown = () => {
    const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
    updateSyncStatus(
      `<i class="fa-solid fa-xmark mr-1"></i> Database unavailable. Trying to reconnect (attempt ${syncAttempt}) in ${seconds}s...`,
      "warning",
      showOverlay,
    );
    if (seconds === 0) clearInterval(syncCountdownTimer);
  };
  renderCountdown();
  syncCountdownTimer = setInterval(renderCountdown, 1000);
  syncRetryTimer = setTimeout(() => syncDatabase(true, !showOverlay), delay);
}

async function syncDatabase(isRetry = false, isBackgroundCheck = false) {
  clearTimeout(syncRetryTimer);
  clearInterval(syncCountdownTimer);
  clearTimeout(syncPollTimer);
  if (syncAbortController) {
    syncAbortController.abort();
  }

  if (!isRetry) syncAttempt = 0;
  syncAttempt++;
  syncAbortController = new AbortController();
  const requestController = syncAbortController;
  const timeoutId = setTimeout(() => syncAbortController.abort(), 20000);

  const url = `${DB_URL}?_t=${Date.now()}`;
  updateSyncStatus(
    `<i class="fa-solid fa-spinner fa-spin mr-1"></i> ${isRetry ? "Checking for database updates" : "Connecting to database"}...`,
    "info",
    !isBackgroundCheck,
  );
  sendTelemetry("sync_attempt", { attempt: syncAttempt, retry: isRetry });

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
      lastSyncAt = Date.now();
      const completedAttempt = syncAttempt;
      const wasConnected = syncConnected;
      syncAttempt = 0;
      syncConnected = true;
      sanitizeDeletedDeckReferences();
      const changed =
        JSON.stringify(state.categorySummary || []) !==
        JSON.stringify(summaryData);
      const canApplyNow =
        state.prefs.databaseUpdateMode === "immediate" || !state.session.active;

      if (canApplyNow && (changed || !wasConnected)) {
        pendingSummaryData = null;
        applySummaryData(summaryData);
      } else if (!canApplyNow) {
        if (changed) pendingSummaryData = summaryData;
        if (!wasConnected) renderCategoryProgress();
      }

      sendTelemetry("sync_success", {
        attempt: completedAttempt,
        subjectCount: summaryData.length,
        changed,
        applied: canApplyNow,
      });

      updateSyncStatus(
        `<i class="fa-solid fa-check mr-1"></i> Connected. ${changed && !canApplyNow ? "Update waiting until your session ends." : `Checked ${summaryData.length} subjects.`}`,
        "success",
        !isBackgroundCheck && !initialSyncSuccessShown,
      );
      setGlobalLoadingState(false);
      if (!isBackgroundCheck && !initialSyncSuccessShown) {
        initialSyncSuccessShown = true;
        hideConnectionStatusAfterDelay();
      }
      scheduleSyncPoll();
    } else {
      clearTimeout(timeoutId);
      sendTelemetry("sync_empty", { attempt: syncAttempt });
      scheduleSyncRetry(!isBackgroundCheck);
      if (state.categorySummary.length && syncConnected)
        renderCategoryProgress();
    }
  } catch (err) {
    clearTimeout(timeoutId);
    if (requestController !== syncAbortController) return;
    console.error(err);
    sendTelemetry("sync_failure", {
      attempt: syncAttempt,
      error: err.name || "NetworkError",
      message: err.message || "Unknown sync error",
    });
    scheduleSyncRetry(!isBackgroundCheck);
    setGlobalLoadingState(
      true,
      "Database reconnecting",
      "The app is retrying the connection automatically. This may take a moment.",
      "warning",
    );

    const catList = document.getElementById("category-list");
    if (catList && state.categorySummary.length === 0) {
      catList.innerHTML = `
                    <div class="text-center py-10 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-800 animate-card-in">
                        <i class="fa-solid fa-triangle-exclamation text-3xl text-red-500 mb-3 hover:scale-110 transition-transform"></i>
                        <h3 class="font-bold text-red-700 dark:text-red-400">Database Connection Failed</h3>
                        <p class="text-sm text-red-600 dark:text-red-300 mt-1">The app is retrying the database connection automatically. You can keep this page open.</p>
                    </div>`;
    }
  }
}

function populateFilters() {
  const select = document.getElementById("filter-subject");
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
        (t) => `<option value="TAG:${escapeHTML(t)}">${escapeHTML(t)}</option>`,
      )
      .join("");
    html += "</optgroup>";
  }

  select.innerHTML = html;
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

function initSession() {
  const filterVal = document.getElementById("filter-subject").value;
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
  sendTelemetry("start_session", { subject: filterVal, poolSize: pool.length });
}

function renderQuestion() {
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
  const parts = String(fullSubject).split("::");
  document.getElementById("q-subject").innerText =
    parts.length >= 2 ? parts.slice(-2).join(" :: ") : fullSubject;

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
  if (q.ImageURL && q.ImageURL.trim() !== "") {
    imgEl.onload = () => imgEl.classList.remove("hidden");
    imgEl.onerror = () => {
      imgEl.removeAttribute("src");
      imgEl.classList.add("hidden");
    };
    imgEl.src = q.ImageURL;
    imgEl.alt = q.Question
      ? `Reference for: ${q.Question.substring(0, 50)}...`
      : "Question reference image";
    imgEl.classList.remove("hidden");
  } else {
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
        btn.innerHTML = `<span class="font-bold mr-2">${ch})</span> ${safeDisplayText}`;
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
}

function enterFolder(folderName, isLockedFolder) {
  const fullPath =
    state.currentPath && state.currentPath.length > 0
      ? state.currentPath.join("::") + "::" + folderName
      : folderName;

  if (isLockedFolder) {
    openFolderPasswordModal(fullPath, folderName);
    return;
  }

  if (!state.currentPath) state.currentPath = [];
  state.currentPath.push(folderName);
  renderCategoryProgress();
}

function goToPath(index) {
  if (!state.currentPath) state.currentPath = [];
  if (index === -1) {
    state.currentPath = [];
  } else {
    state.currentPath = state.currentPath.slice(0, index + 1);
  }
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
  return (state.categorySummary || []).filter((deck) => {
    if (!deck || !deck.Subject) return false;
    // Filter out decks marked as hidden (admin-controlled)
    if (deck.Hidden === true || String(deck.Hidden).toLowerCase() === "true")
      return false;
    // Deleted decks remain visible (just with 0 questions downloaded)
    return true;
  });
}

function renderCategoryProgress() {
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
  if (!state.currentPath) state.currentPath = [];
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
  function getFolderStats(node) {
    let total = 0;
    if (node._data) total += node._data.QuestionCount || 0;
    for (let k in node._children) {
      total += getFolderStats(node._children[k]);
    }
    return total;
  }
  const discoverySearchValue = state.prefs.discoverySearch || "";
  let html = `
        <div class="flex items-center gap-2 mb-6 text-sm font-medium text-gray-600 dark:text-gray-400 overflow-x-auto pb-2 bg-white dark:bg-gray-800 p-3 rounded-lg shadow-sm border border-gray-100 dark:border-gray-700">
            <button onclick="goToPath(-1)" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors flex items-center gap-2">
                <i class="fa-solid fa-folder-open text-brand-500"></i> HOME
            </button>
            ${state.currentPath
              .map(
                (dir, i) => `
                <i class="fa-solid fa-chevron-right text-xs text-gray-400"></i>
                <button onclick="goToPath(${i})" class="hover:text-brand-600 dark:hover:text-brand-400 transition-colors whitespace-nowrap">${escapeHTML(dir.toUpperCase())}</button>
            `,
              )
              .join("")}
        </div>`;

  const layoutClass = isGrid
    ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8"
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
  const sourceFilter =
    document.getElementById("deck-source-filter")?.value || "all";
  const favoriteDecks = Array.isArray(state.prefs.favoriteDecks)
    ? state.prefs.favoriteDecks
    : [];

  function matchesFavoriteDeck(node, currentKey) {
    const subject = node?._data?.Subject || "";
    const folderKey = String(currentKey || "").trim();
    const childKeys = Object.keys(node?._children || {});

    if (
      window.DiscoveryUtils &&
      typeof window.DiscoveryUtils.matchesFavoriteEntry === "function"
    ) {
      const matchesNode = window.DiscoveryUtils.matchesFavoriteEntry(
        subject,
        folderKey,
        favoriteDecks,
      );
      if (matchesNode) return true;
    } else {
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
    }

    return childKeys.some((childKey) =>
      matchesFavoriteDeck(node._children[childKey], childKey),
    );
  }

  function nodeMatchesDiscoveryQuery(node, query, currentKey = null) {
    const normalizedQuery = String(query || "")
      .trim()
      .toLowerCase();
    if (!normalizedQuery) return true;

    const subject = node?._data?.Subject || "";
    const folderName = currentKey ? String(currentKey) : "";
    const haystack = [subject, folderName]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (haystack.includes(normalizedQuery)) return true;

    const childKeys = Object.keys(node?._children || {});
    if (childKeys.length === 0) return false;

    return childKeys.some((childKey) =>
      nodeMatchesDiscoveryQuery(
        node._children[childKey],
        normalizedQuery,
        childKey,
      ),
    );
  }

  // CHANGED: Added currentKey and deep folder archive checks
  function nodeMatchesFilter(node, filter, currentKey = null) {
    const archivedDecks = state.prefs?.archivedDecks || [];
    let isArchived = false;

    // Check if the specific node/deck is archived
    if (
      node._data &&
      node._data.Subject &&
      archivedDecks.includes(node._data.Subject)
    ) {
      isArchived = true;
    }
    // Check if the top-level root folder of this node is archived
    if (node._data && node._data.Subject) {
      const topLevel = node._data.Subject.split("::")[0];
      if (archivedDecks.includes(topLevel)) {
        isArchived = true;
      }
    }
    // Check if the folder itself is archived while rendering the home view
    if (currentKey && (!state.currentPath || state.currentPath.length === 0)) {
      if (archivedDecks.includes(currentKey)) {
        isArchived = true;
      }
    }
    // Inherit archive state if we are inside a folder whose root is archived
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

  // CHANGED: Pass the current key for folder evaluation
  let visibleKeys = keys.filter((key) => {
    const item = currentNode[key];
    if (
      item._data &&
      !item._data.IsFolder &&
      Number(item._data.QuestionCount || 0) === 0
    ) {
      return false;
    }
    return (
      nodeMatchesFilter(currentNode[key], sourceFilter, key) &&
      nodeMatchesDiscoveryQuery(currentNode[key], discoverySearchValue, key)
    );
  });

  if (visibleKeys.length === 0) {
    html += `<div class="col-span-full text-center py-10 text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">${discoverySearchValue ? `No decks match “${escapeHTML(discoverySearchValue)}”.` : "No decks match your filter."}</div>`;
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
    const databaseUnavailable = !syncConnected;

    // CHANGED: Restrict Archive Icon to Root Path only
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

    const data = state.stats.subjectAccuracy[subj] || { total: 0, correct: 0 };
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
      ? "opacity-50 grayscale cursor-not-allowed pointer-events-none"
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
    const isLocked = cat.Locked === true;
    const lockIcon = isLocked
      ? `<i class="fa-solid fa-lock text-red-500 ml-2" title="Password Protected"></i>`
      : "";

    let statsHTML = "";
    let progressBarHTML = "";
    let countBadgeHTML = "";
    let resetBtnHTML = "";

    if (!isReview) {
      // statsHTML = `<p class="text-xs text-gray-500 dark:text-gray-400 transition-colors">Accuracy: ${data.total > 0 ? Math.round((data.correct/data.total)*100) : 0}%</p>`;
      countBadgeHTML = `
                <div class="flex items-center gap-1.5 flex-shrink-0 pt-1">
                    ${archiveBtnHTML}
                    ${isDownloaded ? `<button onclick="event.stopPropagation(); deleteSubjectData('${encodedSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300 p-1" title="Delete Downloaded Data"><i class="fa-solid fa-trash-can"></i></button>` : ``}
                    <span class="text-sm font-black ${themeColorText} transition-colors">${completedCount} / ${totalQuestionsInDb}</span>
                </div>`;
      progressBarHTML = `
                <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-4 overflow-hidden">
                    <div class="${themeColorBg} h-full rounded-full transition-all duration-700 ease-out" style="width: ${progressPercent}%"></div>
                </div>`;

      if (completedCount > 0 || mistakesCount > 0) {
        resetBtnHTML = `
                    <button onclick="resetCategory('${encodedSubj}')" class="w-10 sm:w-12 shrink-0 bg-red-50 text-red-600 dark:bg-red-900/20 py-2 px-1 rounded-lg font-bold hover:bg-red-100 dark:hover:bg-red-900/40 active:scale-90 transition-all duration-300 text-xs sm:text-sm border border-red-100 dark:border-red-800 flex items-center justify-center" title="Reset Progress">
                        <i class="fa-solid fa-rotate-left"></i>
                    </button>`;
      }
    } else {
      countBadgeHTML = `
                <div class="flex items-center gap-1.5 flex-shrink-0 pt-1">
                    ${archiveBtnHTML}
                    ${isDownloaded ? `<button onclick="event.stopPropagation(); deleteSubjectData('${encodedSubj}')" class="text-gray-400 hover:text-red-500 hover:scale-125 hover:rotate-12 transition-all duration-300 p-1" title="Delete Downloaded Data"><i class="fa-solid fa-trash-can"></i></button>` : ``}
                </div>`;
    }

    return `
        <div onclick="handleDeckClick('${encodedSubj}')" class="cursor-pointer animate-card-in ${cardClasses} ${availabilityClasses} p-5 rounded-xl shadow-sm hover:shadow-lg hover:-translate-y-1 ${themeShadowHover} active:scale-[0.99] border transition-all duration-400 relative w-full h-full flex flex-col" style="animation-delay: ${delay}s;" title="${databaseUnavailable ? "Waiting for database connection" : ""}">
                <div id="${loaderId}" class="hidden absolute inset-0 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm z-10 rounded-xl flex flex-col items-center justify-center transition-opacity">
                    <i class="fa-solid fa-spinner fa-spin text-3xl ${loaderColor} mb-2"></i>
                    <span class="text-sm font-bold text-gray-700 dark:text-gray-200">Fetching Latest...</span>
                </div>

                <!-- Card Header -->
                <div class="flex items-start justify-between mb-4 gap-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 mb-1 min-w-0">
                            <h3 class="font-bold text-lg text-gray-800 dark:text-gray-100 flex items-center transition-colors min-w-0">
                                <i class="fa-regular fa-file-lines text-gray-400 mr-2 text-sm flex-shrink-0"></i>
                                <span class="${deckNameMode} break-words">${safeName}</span> ${lockIcon}
                            </h3>
                            <div class="flex-shrink-0">
                                ${statusBadge}
                            </div>
                        </div>
                        ${statsHTML}
                    </div>
                    ${countBadgeHTML}
                </div>
                
                ${progressBarHTML}
                
                <div class="flex gap-2 mt-auto w-full" onclick="event.stopPropagation()">
                    <!-- Primary Action Button -->
                    <button onclick="handleDeckClick('${encodedSubj}')" class="flex-1 ${primaryActionColor} text-white py-2 px-2 rounded-lg font-bold active:scale-95 text-xs sm:text-sm shadow-sm hover:shadow transition-all duration-300 flex items-center justify-center group truncate" title="${primaryActionText}">
                        <i class="fa-solid ${primaryActionIcon} mr-1 sm:mr-2 group-hover:scale-125 transition-transform flex-shrink-0"></i> 
                        <span class="truncate">${primaryActionText}</span>
                    </button>
                    
                    <!-- Review Mistakes Button -->
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

                    <!-- Reset Button -->
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

      const isLocked = hasData && item._data.Locked === true;
      const lockIcon = isLocked
        ? `<i class="fa-solid fa-lock text-red-500 ml-2" title="Password Protected Folder"></i>`
        : "";

      // CHANGED: Support Archiving Folders at the Root layer
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
  container.className = "transition-all duration-500";
  container.innerHTML = html;
}

async function fetchAndStartCategory(subject, mode, pass = null) {
  const loader = document.getElementById(getDeckLoaderId(subject));
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

async function deleteSubjectData(subject) {
  subject = decodeHandlerValue(subject);
  if (
    await requestConfirmation(
      `Are you sure you want to delete the downloaded questions for "${subject}"? Your accuracy and progress stats will remain, but the app will remove the local data to save space.`,
      "Delete Downloaded Data",
    )
  ) {
    state.db = state.db.filter((q) => q.Subject !== subject);
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
      new Set([...(state.prefs.deletedDecks || []), subject].filter(Boolean)),
    );
    sanitizeDeletedDeckReferences();
    saveState();
    await safeIdbSet("mrh_db", state.db);
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
  let cachedQuestions = getQuestionsForSubject(subject);
  if (typeof customFilter === "function") {
    cachedQuestions = cachedQuestions.filter(customFilter);
  }

  if (cachedQuestions.length > 0 && !pass) {
    if (loaderElement) loaderElement.classList.add("hidden");
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
  if (loaderElement) loaderElement.classList.remove("hidden");
  try {
    let fetchUrl = `${DB_URL}?subject=${encodeURIComponent(subject)}&_t=${Date.now()}`;
    if (pass) fetchUrl += `&password=${encodeURIComponent(pass)}`;

    const response = await fetch(fetchUrl, { cache: "no-store" });
    const text = await response.text();
    let newQuestions;
    try {
      newQuestions = JSON.parse(text);
    } catch (parseError) {
      throw new Error(
        `Invalid backend response while loading deck: ${text.slice(0, 200)}`,
      );
    }
    if (newQuestions && newQuestions.error) throw new Error(newQuestions.error);
    if (!Array.isArray(newQuestions)) {
      throw new Error("Unexpected backend response format while loading deck.");
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
}

async function reviewDeck(subject, pass = null) {
  const loader = document.getElementById(getDeckLoaderId(subject));

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
  renderDeckReview(currentReviewSubject, currentReviewQuestions);
}

function renderDeckReview(subject, questions) {
  currentReviewSubject = subject;
  currentReviewQuestions = questions;

  const container = document.getElementById("deck-review-list");
  document.getElementById("deck-review-title").innerText = subject;

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
  let filteredQuestions = questions;
  if (
    window.DiscoveryUtils &&
    typeof window.DiscoveryUtils.filterQuestionsByStudyPreference === "function"
  ) {
    filteredQuestions = window.DiscoveryUtils.filterQuestionsByStudyPreference(
      questions,
      favoriteQuestions,
      studyFilterMode,
    );
  } else {
    filteredQuestions =
      studyFilterMode === "favorites"
        ? questions.filter((question) => favoriteQuestions.has(question.ID))
        : questions;
  }

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
                <span class="text-sm font-bold text-gray-600 dark:text-gray-300 flex-1 text-center">Page ${currentPage} / ${totalPages}</span>
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
                                    <i class="fa-solid fa-check-circle mr-2"></i> ${prefix}${escapeHTML(choiceText)}
                                </p>
                            </div>`;
          } else {
            choicesHTML += `
                            <div class="bg-gray-50 dark:bg-gray-800/50 border-l-4 border-gray-300 dark:border-gray-600 p-3 rounded-r-lg opacity-70">
                                <p class="text-sm font-medium text-gray-500 dark:text-gray-400">
                                    <i class="fa-solid fa-times mr-2 opacity-50"></i> ${prefix}${escapeHTML(choiceText)}
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

    let reportClass = globallyReportedQs.has(q.ID)
      ? "text-red-500 bg-red-50 dark:bg-red-900/30"
      : "text-gray-400 bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-900/30 hover:text-red-500";

    html += `
            <div class="bg-white dark:bg-gray-800 p-5 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 mb-6 animate-card-in">
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 dark:border-gray-700">
                    <span class="bg-brand-50 text-brand-600 text-xs px-2 py-1 rounded font-bold dark:bg-brand-900/30 dark:text-brand-400">Question ${originalIndex + 1}</span>
                    
                    <div class="flex gap-2 items-center">
                        <button onclick="event.stopPropagation(); toggleQuestionFavorite('${encodeHandlerValue(q.ID)}')" class="${isQuestionFavorite ? "text-yellow-500" : "text-gray-400 hover:text-yellow-500"} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${isQuestionFavorite ? "Remove from Favorites" : "Add to Favorites"}">
                            <i class="fa-solid fa-star"></i>
                        </button>
                        <!-- Feature 16: Individual Toggle Button -->
                        ${
                          isMultipleChoice
                            ? `<button onclick="toggleSpecificChoices('${encodeHandlerValue(q.ID)}')" class="text-xs font-bold px-2 py-1 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded transition-colors">
                          ${showWrongForThisQ ? '<i class="fa-solid fa-eye-slash mr-1"></i> Hide Choices' : '<i class="fa-solid fa-eye mr-1"></i> Show Choices'}
                        </button>`
                            : ""
                        }

                        <button onclick="openReportModalFromStudy('${encodeHandlerValue(q.ID)}')" class="${reportClass} text-xs font-bold flex items-center justify-center w-7 h-7 border border-gray-200 dark:border-gray-700 rounded-md shadow-sm active:scale-95 transition-all" title="${globallyReportedQs.has(q.ID) ? "Active Community Report" : "Report Issue"}">
                            <i class="fa-solid fa-triangle-exclamation"></i>
                        </button>
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
  }, 100);

  sendTelemetry("start_review", {
    subject: subject,
    poolSize: questions.length,
  });
}

function toggleHideABCD() {
  const isHidden = document.getElementById("toggle-hide-abcd").checked;
  state.prefs.hideABCD = isHidden;
  saveState();

  reRenderDeckReview();
}

function toggleQuizHideABCD() {
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
  const isChecked = document.getElementById("toggle-wrong-choices").checked;
  state.prefs.showWrongChoices = isChecked;
  saveState();
  reRenderDeckReview();
}

function toggleClozeMode(source) {
  const element = source || document.getElementById("toggle-cloze-mode");
  state.prefs.clozeEnabled = element ? Boolean(element.checked) : false;
  saveState();

  if (state.session.active) {
    renderQuestion();
  }
}

function toggleSrsMode(source) {
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
  }, 3000);
}

function showExplanation(q) {
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
  if (state.session.autoNextTimeout)
    clearTimeout(state.session.autoNextTimeout);
  stopVisualTimer();

  if (state.session.currentIndex < state.session.questions.length - 1) {
    const skipped = !state.session.userAnswers[state.session.currentIndex];
    state.session.currentIndex++;
    renderQuestion();
    saveSessionProgress();
    sendTelemetry(skipped ? "skip_question" : "next_question", {
      questionIndex: state.session.currentIndex - 1,
      nextQuestionIndex: state.session.currentIndex,
      questionId: state.session.questions[state.session.currentIndex - 1]?.ID,
    });
  } else {
    alert("Practice Session Complete! Great job.");
    clearSessionProgress();
    endSession(false);
  }
}

function prevQuestion() {
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
  sendTelemetry("answer_question", { qId: q.ID, isCorrect });
}

function endSession(silent = false) {
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

  sendTelemetry("end_session", { totalAnswered: state.session.currentIndex });
}

let chartRetryCount = 0;

function renderCharts() {
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
  state.prefs.darkMode = !state.prefs.darkMode;
  document.documentElement.classList.toggle("dark", state.prefs.darkMode);
  saveState();
  updateThemeButton();
}

function updateThemeButton() {
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
    state.stats = {
      totalAnswered: 0,
      correct: 0,
      mistakes: [],
      subjectAccuracy: {},
      completedQs: [],
    };
    state.session = {
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
    };

    state.prefs.studyProgress = {};
    state.prefs.qToggles = {};
    state.prefs.lastActivity = null;

    clearSessionProgress();
    saveState();
    alert("Progress Reset.");

    if (document.getElementById("view-stats").classList.contains("active"))
      renderCharts();
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
        "This permanently deletes all locally saved app data, including downloaded questions, progress, preferences, and saved sessions. Continue?",
        "Clear App Data",
      ))
    ) {
      return;
    }

    if (
      !(await requestConfirmation(
        "Final confirmation: this will permanently erase your downloaded decks, progress, preferences, saved sessions, and cached data. This cannot be undone.",
        "Confirm Permanent Deletion",
      ))
    ) {
      return;
    }

    if (typeof idbKeyval !== "undefined") {
      await idbKeyval.clear();
    }

    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key) localStorage.removeItem(key);
    }
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key) sessionStorage.removeItem(key);
    }

    if ("caches" in window) {
      const cacheNames = await caches.keys();
      await Promise.all(
        cacheNames.map((cacheName) => caches.delete(cacheName)),
      );
    }

    if ("indexedDB" in window && typeof indexedDB.databases === "function") {
      try {
        const dbs = await indexedDB.databases();
        await Promise.all(
          dbs.map(
            (db) =>
              new Promise((resolve) => {
                const request = indexedDB.deleteDatabase(db.name);
                request.onsuccess = () => resolve();
                request.onerror = () => resolve();
                request.onblocked = () => resolve();
              }),
          ),
        );
      } catch (error) {
        console.warn("IndexedDB cleanup could not complete.", error);
      }
    }

    state.db = [];
    state.categorySummary = [];
    state.stats = {
      totalAnswered: 0,
      correct: 0,
      mistakes: [],
      subjectAccuracy: {},
      completedQs: [],
      srsMap: {},
    };
    state.prefs = {
      ...state.prefs,
      darkMode: true,
      activeRecall: false,
      quizNavigationPosition: "top",
      quizNavigationMode: "manual",
      reviewNavigationPosition: "top",
      studySingleNavigationPosition: "top",
      studyScrollNavigationPosition: "top",
      databaseUpdateMode: "immediate",
      layoutMode: "grid",
      shuffleChoices: true,
      shuffleQuestions: true,
      hideABCD: false,
      quizHideABCD: false,
      showWrongChoices: false,
      clozeEnabled: false,
      srsEnabled: false,
      archivedDecks: [],
      deckSortBy: "letters",
      deckSortDirection: "asc",
      deckNameMode: "wrap",
      favoriteDecks: [],
      favoriteQuestions: [],
      recentDecks: [],
      discoverySearch: "",
      lastActivity: null,
    };
    state.session = {
      active: false,
      questions: [],
      currentIndex: 0,
      userAnswers: {},
      autoNextTimeout: null,
      revealedCloze: false,
    };
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

window.onload = async () => {
  setupTelemetry();
  setGlobalLoadingState(
    true,
    "Loading app data",
    "Checking saved progress and the latest database status...",
    "info",
  );
  await loadState();
  await restoreUserSession();

  if ("serviceWorker" in navigator) {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        await registration.unregister();
      }
    } catch (e) {
      console.warn("Unable to clear stale service worker registrations", e);
    }
  }

  const toggleElement = document.getElementById("globalModeToggle");
  if (toggleElement) {
    currentAppMode = toggleElement.checked ? "review" : "quiz";
  }

  syncDatabase();
  await syncUserProgress();
  fetchGlobalReports();
};

window.addEventListener("resize", () => {
  if (state.session.active && state.prefs.quizNavigationPosition === "auto")
    applyNavigationPosition();
});

function saveSessionProgress() {
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
    const deckInfo = state.categorySummary.find(
      (category) => category.Subject === activity.subject,
    );
    if (deckInfo?.Locked && !password) {
      pendingDeckSubject = activity.subject;
      pendingDeckAction = "resume-review";
      openDeckPasswordModal(activity.subject, "resume-review");
      return;
    }
    await reviewDeck(activity.subject, password);
    sendTelemetry("resume_session", {
      mode: "review",
      subject: activity.subject,
    });
    return;
  }

  const saved = getStoredItem("saved_session");
  if (!saved) return;

  const savedSession = pendingResumeSession || JSON.parse(saved);
  const currentQuestion = savedSession.questions?.[savedSession.currentIndex];
  const currentSubject = currentQuestion?.Subject;
  const deckInfo = state.categorySummary.find(
    (category) => category.Subject === currentSubject,
  );

  if (deckInfo?.Locked && !password) {
    pendingResumeSession = savedSession;
    pendingDeckSubject = currentSubject;
    pendingDeckAction = "resume";
    openDeckPasswordModal(currentSubject, "resume");
    return;
  }

  if (currentSubject && (password || deckInfo?.Locked)) {
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
  sendTelemetry("resume_session", {
    mode: "quiz",
    subject: currentSubject,
    questionIndex: state.session.currentIndex,
  });
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
  }, 3000);
}

function startVisualTimer() {
  const container = document.getElementById("auto-next-timer-container");
  const bar = document.getElementById("auto-next-timer-bar");

  container.classList.remove("hidden");

  bar.classList.remove("animate-timer-bar");
  void bar.offsetWidth;
  bar.classList.add("animate-timer-bar");
}

function stopVisualTimer() {
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
  state.prefs.deckNameMode = mode === "clip" ? "clip" : "wrap";
  saveState();
  renderCategoryProgress();
}

function changeDeckSort(sortOrder) {
  state.prefs.deckSortBy = ["letters", "questions"].includes(sortOrder)
    ? sortOrder
    : "letters";
  saveState();
  renderCategoryProgress();
  sendTelemetry("change_deck_sort", {
    sortBy: state.prefs.deckSortBy,
    direction: state.prefs.deckSortDirection,
  });
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
  sendTelemetry("change_deck_sort", {
    sortBy: state.prefs.deckSortBy,
    direction: state.prefs.deckSortDirection,
  });
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
  sendTelemetry("change_navigation_position", {
    position: normalized,
  });
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
  toggleModal("about-modal", true);
}

function closeAboutModal() {
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
  toggleModal("confirm-modal", false);
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    setTimeout(() => resolve(confirmed), 320);
  }
}

function openReportModal() {
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
  state.reportQuestion = null;
  toggleModal("report-modal", false);
}
function openSessionSettingsModal() {
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
  toggleModal("session-settings-modal", false);
}

// Open Review Settings Modal
function openReviewSettingsModal() {
  const modal = document.getElementById("review-settings-modal");
  const navigationButton = document.getElementById(
    "toggle-review-navigation-bottom",
  );
  const studyFilterSelect = document.getElementById("study-filter-select");
  if (navigationButton) {
    navigationButton.textContent = getScrollNavigationButtonLabel(
      getStudyNavigationPosition(state.prefs.studyLayout || "scroll"),
    );
  }
  if (studyFilterSelect) {
    studyFilterSelect.value = state.prefs.studyFilterMode || "all";
  }
  modal.classList.remove("hidden");
  // Small delay allows the browser to render 'block' before applying opacity for the transition
  setTimeout(() => {
    modal.classList.remove("opacity-0");
    modal.querySelector("div").classList.remove("scale-95");
  }, 10);
}

// Close Review Settings Modal
function closeReviewSettingsModal() {
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

function changeStudyFilterMode(mode) {
  const nextMode = mode === "favorites" ? "favorites" : "all";
  state.prefs.studyFilterMode = nextMode;
  saveState();
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
  pendingLockedFolderPath = fullPath;
  pendingLockedFolderName = folderName;

  document.getElementById("folder-password-message").innerText =
    `The folder "${folderName}" requires a password to view its contents.`;

  toggleModal("folder-password-modal", true);
}

function closeFolderPasswordModal() {
  toggleModal("folder-password-modal", false);
  const inputEl = document.getElementById("folder-password-input");
  if (inputEl) inputEl.value = "";
}

function openDeckPasswordModal(subject, action) {
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
  toggleModal("deck-password-modal", false);
  const inputEl = document.getElementById("deck-password-input");
  if (inputEl) inputEl.value = "";
}

function openReportModalFromStudy(questionId) {
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

function openGeneralFeedbackModal() {
  const feedbackComments = document.getElementById("feedback-comments");
  if (feedbackComments) feedbackComments.value = "";
  toggleModal("feedback-modal", true);
}

function closeGeneralFeedbackModal() {
  toggleModal("feedback-modal", false);
}

async function submitReport() {
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
  sendTelemetry("toggle_mode", { mode: currentAppMode });
}

function changeDatabaseUpdateMode(mode) {
  state.prefs.databaseUpdateMode = "immediate";
  saveState();
  if (pendingSummaryData && !state.session.active) {
    applySummaryData(pendingSummaryData);
    pendingSummaryData = null;
    updateSyncStatus(
      '<i class="fa-solid fa-check mr-1"></i> Database update applied immediately.',
      "success",
    );
  }
  sendTelemetry("change_database_update_mode", {
    mode: state.prefs.databaseUpdateMode,
  });
}

let pendingDeckSubject = null;
let pendingDeckAction = null;

function handleDeckClick(subj, action = "continue") {
  subj = decodeHandlerValue(subj);
  if (!subj) return;

  if (!syncConnected) {
    updateSyncStatus(
      '<i class="fa-solid fa-xmark mr-1"></i> Decks are temporarily unavailable while the database reconnects.',
      "warning",
    );
    return;
  }

  updateRecentDecks(subj);
  saveState();

  const deckInfo = state.categorySummary.find((c) => c.Subject === subj);
  if (deckInfo && deckInfo.Locked) {
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
  const isChecked = source.checked;
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

function toggleShuffleQuestions() {
  const isChecked = document.getElementById("toggle-shuffle-questions").checked;
  state.prefs.shuffleQuestions = isChecked;
  saveState();
  syncPreferenceControls();
}

async function autoSaveDeckPassword(deckPath, newPassword) {
  const safeToken = typeof getAdminToken === "function" ? getAdminToken() : "";
  const password = String(newPassword || "").trim();

  try {
    const result = await callBackend({
      type: "admin_update_password",
      token: safeToken,
      deck: deckPath,
      password: password,
    });

    if (result.status === "success") {
      console.log(`Password for ${deckPath} updated successfully.`);
    } else {
      alert("Failed to update password: " + result.message);
    }
  } catch (e) {
    alert("Network error while auto-saving password.");
    console.error(e);
  }
}

let userState = {
  username: "",
  isLoggedIn: false,
  sessionToken: "",
  sessionMode: "active",
  sessionExpiresAt: null,
  authVersion: 0,
};

function getAuthStateSnapshot() {
  return {
    username: userState.username || "",
    isLoggedIn: userState.isLoggedIn === true,
    sessionMode: userState.sessionMode || "active",
    sessionExpiresAt: userState.sessionExpiresAt || null,
    authVersion: (userState.authVersion || 0) + 1,
    identity: getSafeStorageIdentity(),
  };
}

function resetClientSession(reason = "auth") {
  userState = {
    username: "",
    isLoggedIn: false,
    sessionToken: "",
    sessionMode: "active",
    sessionExpiresAt: null,
    authVersion: (userState.authVersion || 0) + 1,
  };
  removeSessionStoredItem("user_session");
  updateProfileUI();
  if (reason !== "bootstrap") {
    showToast("Your session was cleared on this device.", "error");
  }
}

function applyAuthStateSnapshot(snapshot, source = "broadcast") {
  if (!snapshot) return false;
  const snapshotIdentity = snapshot.identity || "";
  if (snapshotIdentity && snapshotIdentity !== getSafeStorageIdentity()) {
    if (userState.isLoggedIn || snapshot.isLoggedIn) {
      resetClientSession("identity");
      showToast(
        "An account switch was detected. This tab is now in guest mode.",
        "error",
      );
    }
    return true;
  }
  if (!snapshot.isLoggedIn) {
    if (userState.isLoggedIn) {
      resetClientSession("logout");
    }
    return true;
  }
  const isConflict =
    userState.isLoggedIn &&
    snapshot.username &&
    snapshot.username !== userState.username;
  if (isConflict) {
    resetClientSession("conflict");
    showToast(
      "Another account is active in another tab. This tab was switched to guest mode.",
      "error",
    );
    return true;
  }
  return false;
}

function getAuthBroadcastChannelName() {
  return `mrh_auth_${getSafeStorageIdentity()}`;
}

function broadcastAuthState(reason = "state") {
  const snapshot = getAuthStateSnapshot();
  const authStateKey = getStorageKey("auth_state");
  if (typeof BroadcastChannel !== "undefined") {
    if (!authChannel || authChannel.name !== getAuthBroadcastChannelName()) {
      if (authChannel) {
        try {
          authChannel.close();
        } catch (e) {}
      }
      authChannel = new BroadcastChannel(getAuthBroadcastChannelName());
      authChannel.onmessage = (event) => {
        const payload = event.data || {};
        if (payload.identity && payload.identity === getSafeStorageIdentity())
          return;
        applyAuthStateSnapshot(payload, "broadcast");
      };
    }
    authChannel.postMessage({ ...snapshot, reason });
  }
  try {
    localStorage.setItem(authStateKey, JSON.stringify({ ...snapshot, reason }));
  } catch (e) {}
}

function setupAuthBroadcast() {
  if (typeof BroadcastChannel === "undefined") return;
  if (authChannel && authChannel.name === getAuthBroadcastChannelName()) return;
  if (authChannel) {
    try {
      authChannel.close();
    } catch (e) {}
    authChannel = null;
  }
  authChannel = new BroadcastChannel(getAuthBroadcastChannelName());
  authChannel.onmessage = (event) => {
    const payload = event.data || {};
    if (payload.identity && payload.identity === getSafeStorageIdentity())
      return;
    applyAuthStateSnapshot(payload, "broadcast");
  };
  if (!window.__mrhAuthStorageHandler) {
    window.__mrhAuthStorageHandler = (event) => {
      if (event.key !== getStorageKey("auth_state") || !event.newValue) return;
      try {
        const payload = JSON.parse(event.newValue);
        if (payload.identity && payload.identity === getSafeStorageIdentity())
          return;
        applyAuthStateSnapshot(payload, "storage");
      } catch (e) {}
    };
    window.addEventListener("storage", window.__mrhAuthStorageHandler);
  }
}

function scheduleOfflineSync() {
  clearTimeout(pendingOfflineSyncTimer);
  pendingOfflineSyncTimer = setTimeout(() => {
    flushPendingOfflineProgress().catch(() => {});
  }, 2000);
}

async function restoreUserSession() {
  try {
    const saved = JSON.parse(getSessionStoredItem("user_session", "null"));
    if (saved?.username && saved?.sessionToken) {
      const result = await callBackend({
        type: "verify_session",
        sessionToken: saved.sessionToken,
      });
      const isExpiredSession =
        result?.status === "error" &&
        /session expired|log in again|unauthorized/i.test(
          result?.message || "",
        );
      if (result.status === "success") {
        userState = {
          username: result.username || saved.username || "",
          isLoggedIn: true,
          sessionToken: saved.sessionToken || "",
          sessionMode: result.sessionMode || saved.sessionMode || "active",
          sessionExpiresAt:
            result.sessionExpiresAt || saved.sessionExpiresAt || null,
          authVersion: (saved.authVersion || 0) + 1,
        };
      } else if (isExpiredSession) {
        userState = {
          username: "",
          isLoggedIn: false,
          sessionToken: "",
          sessionMode: "active",
          sessionExpiresAt: null,
          authVersion: 0,
        };
        removeSessionStoredItem("user_session");
      } else {
        userState = {
          username: result.username || saved.username || "",
          isLoggedIn: true,
          sessionToken: saved.sessionToken || "",
          sessionMode: saved.sessionMode || "active",
          sessionExpiresAt: saved.sessionExpiresAt || null,
          authVersion: (saved.authVersion || 0) + 1,
        };
      }
    }
  } catch (e) {
    const savedFallback = JSON.parse(
      getSessionStoredItem("user_session", "null"),
    );
    if (savedFallback?.username && savedFallback?.sessionToken) {
      userState = {
        ...savedFallback,
        isLoggedIn: true,
        sessionToken: savedFallback.sessionToken || "",
        sessionMode: savedFallback.sessionMode || "active",
        sessionExpiresAt: savedFallback.sessionExpiresAt || null,
        authVersion: (savedFallback.authVersion || 0) + 1,
      };
    }
  }
  setupAuthBroadcast();
  updateProfileUI();
}

function getProfileSyncSummary() {
  const stats = state.stats || {};
  const answered = Number(stats.totalAnswered || 0);
  const correct = Number(stats.correct || 0);
  const mistakes = Array.isArray(stats.mistakes) ? stats.mistakes.length : 0;
  const pendingQueue = getPendingOfflineQueue().length;
  const syncedItems = [
    getStoredItem("stats") !== null ? "progress" : null,
    getStoredItem("prefs") !== null ? "preferences" : null,
    getStoredItem("saved_session") !== null ? "saved session" : null,
  ].filter(Boolean);

  return {
    answered,
    correct,
    mistakes,
    pendingQueue,
    syncedItems,
    storageIdentity: getSafeStorageIdentity(),
  };
}

function updateProfileUI() {
  const loggedIn = userState.isLoggedIn === true;
  const loginPanel = document.getElementById("profile-login-state");
  const signupPanel = document.getElementById("profile-signup-state");
  const loggedInPanel = document.getElementById("profile-logged-in-state");
  if (loginPanel) {
    loginPanel.hidden = loggedIn;
    loginPanel.classList.toggle("auth-panel-hidden", loggedIn);
  }
  if (signupPanel) {
    signupPanel.hidden = true;
    signupPanel.classList.add("auth-panel-hidden");
  }
  if (loggedInPanel) {
    loggedInPanel.hidden = !loggedIn;
    loggedInPanel.classList.toggle("auth-panel-hidden", !loggedIn);
  }
  const username = document.getElementById("profile-username");
  if (username) username.textContent = userState.username || "";

  const modeLabel = document.getElementById("profile-session-mode");
  if (modeLabel) {
    if (!loggedIn) {
      modeLabel.textContent = "Not signed in";
    } else if (userState.sessionMode === "guest") {
      modeLabel.textContent = "Guest mode · read-only";
    } else {
      modeLabel.textContent = "Active session";
    }
  }

  const noticeLabel = document.getElementById("profile-login-notice");
  if (noticeLabel) {
    noticeLabel.textContent = loggedIn
      ? `Logged in as ${userState.username || "your account"}`
      : "Login to access your profile.";
  }

  const syncStatusEl = document.getElementById("user-sync-status");
  if (syncStatusEl) {
    if (!loggedIn) {
      syncStatusEl.textContent = "Login to access online features.";
    } else if (userState.sessionMode === "guest") {
      syncStatusEl.textContent = "Guest mode · your changes stay local.";
    } else {
      const summary = getProfileSyncSummary();
      syncStatusEl.textContent = `Connected. Checked ${summary.answered} answered questions and ${summary.pendingQueue} pending offline change${summary.pendingQueue === 1 ? "" : "s"}.`;
    }
  }

  const detailsPanel = document.getElementById("profile-sync-details");
  const badgeEl = document.getElementById("profile-sync-badge");
  if (detailsPanel) {
    detailsPanel.hidden = !loggedIn;
  }
  if (badgeEl) {
    badgeEl.textContent = loggedIn
      ? userState.sessionMode === "guest"
        ? "Guest"
        : "Ready"
      : "Offline";
  }

  if (loggedIn) {
    const summary = getProfileSyncSummary();
    const answeredEl = document.getElementById("profile-stat-answered");
    const correctEl = document.getElementById("profile-stat-correct");
    const mistakesEl = document.getElementById("profile-stat-mistakes");
    const queueEl = document.getElementById("profile-stat-queue");
    const dataEl = document.getElementById("profile-stat-data");

    if (answeredEl) answeredEl.textContent = summary.answered;
    if (correctEl) correctEl.textContent = summary.correct;
    if (mistakesEl) mistakesEl.textContent = summary.mistakes;
    if (queueEl) queueEl.textContent = summary.pendingQueue;
    if (dataEl) {
      dataEl.textContent = summary.syncedItems.length
        ? summary.syncedItems.join(", ")
        : "none yet";
    }
  }
}

function normalizeProgressPayloadForComparison(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    return value.map((item) => normalizeProgressPayloadForComparison(item));
  }
  if (typeof value === "object") {
    const normalized = {};
    Object.keys(value)
      .sort()
      .forEach((key) => {
        normalized[key] = normalizeProgressPayloadForComparison(value[key]);
      });
    return normalized;
  }
  return value;
}

function areProgressPayloadsEquivalent(localPayload, remotePayload) {
  if (!localPayload || !remotePayload) return false;
  return (
    JSON.stringify(normalizeProgressPayloadForComparison(localPayload)) ===
    JSON.stringify(normalizeProgressPayloadForComparison(remotePayload))
  );
}

function getProgressMeta() {
  return SessionUtils.getProgressMeta();
}

function setProgressMeta(updatedAt, serverUpdatedAt = updatedAt || "") {
  return SessionUtils.setProgressMeta(updatedAt, serverUpdatedAt);
}

function clearLocalUserProgress() {
  return SessionUtils.clearLocalUserProgress();
}

function hasLocalProgress() {
  return SessionUtils.hasLocalProgress();
}

function applyRemoteProgress(payload, updatedAt) {
  return SessionUtils.applyRemoteProgress(payload, updatedAt);
}

function createIdempotencyKey(payload) {
  return SessionUtils.createIdempotencyKey(payload);
}

function getPendingOfflineQueue() {
  return SessionUtils.getPendingOfflineQueue();
}

function savePendingOfflineQueue(queue) {
  return SessionUtils.savePendingOfflineQueue(queue);
}

function queueOfflineProgress(payload, idempotencyKey) {
  return SessionUtils.queueOfflineProgress(payload, idempotencyKey);
}

async function flushPendingOfflineProgress() {
  return SessionUtils.flushPendingOfflineProgress();
}

async function chooseProgressConflict(
  localPayload,
  remotePayload,
  remoteUpdatedAt,
) {
  return SessionUtils.chooseProgressConflict(
    localPayload,
    remotePayload,
    remoteUpdatedAt,
  );
}

async function saveUserProgress(
  payload = getProgressPayload(),
  force = false,
  options = {},
) {
  return SessionUtils.saveUserProgress(payload, force, options);
}

function queueProgressSync() {
  return SessionUtils.queueProgressSync();
}

async function syncUserProgress() {
  return SessionUtils.syncUserProgress();
}

function showLoginForm() {
  const loginPanel = document.getElementById("profile-login-state");
  const signupPanel = document.getElementById("profile-signup-state");
  if (loginPanel) {
    loginPanel.hidden = false;
    loginPanel.classList.remove("auth-panel-hidden");
  }
  if (signupPanel) {
    signupPanel.hidden = true;
    signupPanel.classList.add("auth-panel-hidden");
  }
}

function showSignupForm() {
  const loginPanel = document.getElementById("profile-login-state");
  const signupPanel = document.getElementById("profile-signup-state");
  if (loginPanel) {
    loginPanel.hidden = true;
    loginPanel.classList.add("auth-panel-hidden");
  }
  if (signupPanel) {
    signupPanel.hidden = false;
    signupPanel.classList.remove("auth-panel-hidden");
  }
  document.getElementById("user-signup-error")?.classList.add("hidden");
}

async function submitUserLogin() {
  const username = document.getElementById("user-username")?.value.trim();
  const password = document.getElementById("user-password")?.value;
  const errorEl = document.getElementById("user-login-error");
  if (!username || !password) {
    if (errorEl) {
      errorEl.textContent = "Username and password are required.";
      errorEl.classList.remove("hidden");
    }
    return;
  }
  await userLogin(username, password);
}

async function submitUserSignup() {
  const username = document.getElementById("signup-username")?.value.trim();
  const password = document.getElementById("signup-password")?.value;
  const confirmation = document.getElementById(
    "signup-password-confirm",
  )?.value;
  const errorEl = document.getElementById("user-signup-error");
  const usernamePattern = /^[A-Za-z0-9_.-]{3,50}$/;

  let error = "";
  if (!usernamePattern.test(username || ""))
    error = "Use 3-50 letters, numbers, periods, underscores, or hyphens.";
  else if (!password || password.length < 8)
    error = "Use a website-only password with at least 8 characters.";
  else if (password !== confirmation) error = "Passwords do not match.";

  if (error) {
    if (errorEl) {
      errorEl.textContent = error;
      errorEl.classList.remove("hidden");
    }
    return;
  }
  await userSignup(username, password);
}

async function userLogin(username, password) {
  const btn = document.getElementById("btn-user-login");
  const errorEl = document.getElementById("user-login-error");

  return runWithActionLock("user-login", async () => {
    await runWithBusyButton(btn, "Verifying...", async () => {
      try {
        const result = await callBackend({
          type: "verify_user",
          username,
          password,
        });

        if (result.status === "success") {
          userState = {
            username,
            isLoggedIn: true,
            sessionToken: result.sessionToken || "",
            sessionMode: result.sessionMode || "active",
            sessionExpiresAt: result.sessionExpiresAt || null,
            authVersion: (userState.authVersion || 0) + 1,
          };
          setSessionStoredJSON("user_session", userState);
          broadcastAuthState("login");
          document.getElementById("user-password").value = "";
          setInlineError(errorEl, "");
          updateProfileUI();
          hideLoginSuggestion();
          sendTelemetry("user_login", { username });
          syncUserProgress().catch((error) =>
            console.error("Background progress sync failed.", error),
          );
        } else {
          setInlineError(
            errorEl,
            result.message || "Incorrect username or password.",
          );
        }
      } catch (e) {
        console.error(e);
        setInlineError(errorEl, "Network error while verifying user.");
      }
    });
  });
}

async function userSignup(username, password) {
  const btn = document.getElementById("btn-user-signup");
  const errorEl = document.getElementById("user-signup-error");

  return runWithActionLock("user-signup", async () => {
    await runWithBusyButton(btn, "Creating...", async () => {
      try {
        const result = await callBackend({
          type: "signup_user",
          username,
          password,
        });
        if (result.status === "success") {
          userState = {
            username,
            isLoggedIn: true,
            sessionToken: result.sessionToken || "",
            sessionMode: result.sessionMode || "active",
            sessionExpiresAt: result.sessionExpiresAt || null,
            authVersion: (userState.authVersion || 0) + 1,
          };
          setSessionStoredJSON("user_session", userState);
          broadcastAuthState("signup");
          document.getElementById("signup-password").value = "";
          document.getElementById("signup-password-confirm").value = "";
          setInlineError(errorEl, "");
          updateProfileUI();
          hideLoginSuggestion();
          sendTelemetry("user_signup", { username });
          syncUserProgress().catch((error) =>
            console.error("Background progress sync failed.", error),
          );
        } else {
          setInlineError(
            errorEl,
            result.message || "Unable to create account.",
          );
        }
      } catch (e) {
        console.error(e);
        setInlineError(errorEl, "Network error while creating account.");
      }
    });
  });
}

async function userLogout() {
  if (
    !(await requestConfirmation(
      "Log out of this device? Your saved account progress will remain available when you log in again.",
      "Log Out",
    ))
  )
    return;
  clearTimeout(progressSyncTimer);
  try {
    if (userState.isLoggedIn && userState.sessionToken) {
      await callBackend({
        type: "logout_user",
        sessionToken: userState.sessionToken,
      });
    }
  } catch (e) {
    console.warn("Logout request failed silently.", e);
  }
  if (userState.isLoggedIn) await saveUserProgress();
  userState = {
    username: "",
    isLoggedIn: false,
    sessionToken: "",
    sessionMode: "active",
    sessionExpiresAt: null,
    authVersion: 0,
  };
  removeSessionStoredItem("user_session");
  broadcastAuthState("logout");
  updateProfileUI();
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
        const response = await fetch(
          `${DB_URL}?subject=${encodeURIComponent(pendingLockedFolderPath || "")}&password=${encodeURIComponent(pass)}&_t=${Date.now()}`,
        );
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
          closeFolderPasswordModal();
          if (!state.currentPath) state.currentPath = [];
          state.currentPath.push(pendingLockedFolderName);
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
if (!state.prefs.studyPageSize) state.prefs.studyPageSize = 50;
if (!state.prefs.studyProgress) state.prefs.studyProgress = {};
if (!state.prefs.qToggles) state.prefs.qToggles = {};

function changeStudyLayout(layout) {
  state.prefs.studyLayout = layout;
  saveState();
  sendTelemetry("change_study_layout", {
    layout,
    subject: currentReviewSubject,
  });
  reRenderDeckReview();
}

if (!state.prefs.studyFilterMode) state.prefs.studyFilterMode = "all";

function changeStudyPageSize(size) {
  const parsedSize = parseInt(size, 10);
  if (!Number.isFinite(parsedSize) || parsedSize < 1) return;
  state.prefs.studyPageSize = parsedSize;
  let subject = currentReviewSubject;
  if (!state.prefs.studyProgress[subject])
    state.prefs.studyProgress[subject] = { page: 1, index: 0, scrollY: 0 };
  state.prefs.studyProgress[subject].page = 1;
  saveState();
  reRenderDeckReview();
}

function changeStudyPage(delta) {
  let subject = currentReviewSubject;
  state.prefs.studyProgress[subject].page += delta;
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
  reRenderDeckReview();
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

async function submitGeneralFeedback() {
  const comments = document.getElementById("feedback-comments").value.trim();
  if (!comments) return alert("Please enter your feedback.");
  const btn = document.getElementById("btn-submit-feedback");
  const originalText = btn.innerHTML;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Sending...';
  btn.disabled = true;

  try {
    const result = await callBackend({
      type: "submit_feedback",
      comments: comments,
      userId: getActiveIdentity(),
    });
    if (result.status !== "success") {
      throw new Error(result.message || "Feedback submission failed.");
    }
    btn.innerHTML = '<i class="fa-solid fa-check mr-2"></i> Sent!';
    btn.classList.remove("bg-brand-500", "hover:bg-brand-600");
    btn.classList.add("bg-green-500", "hover:bg-green-600");
    setTimeout(() => {
      closeGeneralFeedbackModal();
      setTimeout(() => {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.classList.remove("bg-green-500", "hover:bg-green-600");
        btn.classList.add("bg-brand-500", "hover:bg-brand-600");
      }, 500);
    }, 1500);
  } catch (err) {
    alert("Network error.");
    btn.innerHTML = originalText;
    btn.disabled = false;
  }
}

let lastScrollTop = 0;
let isTicking = false;

window.addEventListener("DOMContentLoaded", () => {
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
});
