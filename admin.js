/*
 * Admin dashboard controller.
 *
 * Backend action names intentionally remain unchanged so this file stays
 * compatible with the existing admin endpoint contract.
 */

const ADMIN_REQUEST_TIMEOUT_MS = 30_000;
const ADMIN_MAX_BATCH_SIZE = 200;
const ADMIN_SUBJECT_MAX_LENGTH = 500;
const ADMIN_CACHE_CHANNEL_NAME = "mrh_cache_invalidation";

const adminState = {
  token: "",
  subjects: [],
  reports: [],
  admin_last_modified_timestamp: "",
  hierarchyLayoutMode: "current", // "current" = list, "new" = grid
};

let adminSaveInProgress = false;
let adminClearInProgress = false;
let adminSubjectsLoadVersion = 0;
let adminReportsLoadVersion = 0;
let adminPendingReload = false;
let adminExternalChangeWarningShown = false;
let adminCacheChannel = null;
const adminReportActionsInProgress = new Set();

function adminGetGlobal(name) {
  if (typeof globalThis === "undefined") return undefined;
  return globalThis[name];
}

function adminGetDocument() {
  return typeof document !== "undefined" ? document : null;
}

function adminGetElement(id) {
  const doc = adminGetDocument();
  return doc ? doc.getElementById(id) : null;
}

function adminEscapeHTML(value) {
  const text = String(value ?? "");
  return text.replace(/[&<>'"]/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function adminString(value) {
  return typeof value === "string" ? value : String(value ?? "");
}

function adminNormalizeText(value) {
  return adminString(value).trim();
}

function adminToBoolean(value) {
  if (value === true) return true;
  if (typeof value === "number") return value !== 0;
  return ["true", "1", "yes", "on"].includes(
    adminNormalizeText(value).toLowerCase(),
  );
}

function adminHasPassword(value) {
  return adminNormalizeText(value).length > 0;
}

function getAdminToken() {
  return adminState.token || "";
}

function setAdminToken(token) {
  const normalized = adminString(token);
  adminState.token = normalized;
  return normalized;
}

function clearAdminToken() {
  adminState.token = "";
}

function adminIsAuthenticated() {
  return Boolean(getAdminToken());
}

function adminNotify(message) {
  const text = adminString(message) || "An unexpected error occurred.";
  const notify = adminGetGlobal("alert");
  if (typeof notify === "function") {
    notify(text);
  } else {
    console.error("[ADMIN]", text);
  }
}

function adminConfirm(message) {
  const confirmFn = adminGetGlobal("confirm");
  return typeof confirmFn === "function" ? confirmFn(message) : false;
}

function adminIsUnauthorizedResult(result) {
  return Boolean(
    result &&
    (String(result.code || "").toUpperCase() === "UNAUTHORIZED" ||
      String(result.status || "").toLowerCase() === "unauthorized"),
  );
}

function adminIsUnauthorizedError(error) {
  const message = adminNormalizeText(error?.message).toLowerCase();
  return (
    String(error?.code || "").toUpperCase() === "UNAUTHORIZED" ||
    message.includes("unauthorized") ||
    message.includes("authentication") ||
    message.includes("session expired") ||
    message.includes("401")
  );
}

function adminShowLoginUI() {
  adminGetElement("admin-login-section")?.classList.remove("hidden");
  adminGetElement("admin-dashboard-section")?.classList.add("hidden");
}

function adminShowDashboardUI() {
  adminGetElement("admin-login-section")?.classList.add("hidden");
  adminGetElement("admin-dashboard-section")?.classList.remove("hidden");
}

function adminHandleUnauthorized(
  message = "Your admin session has expired. Please sign in again.",
) {
  clearAdminToken();
  adminShowLoginUI();

  const passwordInput = adminGetElement("admin-password");
  if (passwordInput) passwordInput.value = "";

  const errorEl = adminGetElement("admin-login-error");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }
}

async function parseJsonResponse(response) {
  if (!response || typeof response.ok !== "boolean") {
    throw new Error("Invalid backend response object.");
  }

  const text = await response.text().catch(() => "");
  const cleaned = text.replace(/^\uFEFF/, "").trim();

  if (!response.ok) {
    let message = `Backend request failed (${response.status})`;
    if (cleaned) {
      try {
        const json = JSON.parse(cleaned);
        if (json && typeof json.message === "string" && json.message.trim()) {
          message = json.message.trim();
        }
      } catch (_) {
        // Preserve the generic HTTP error rather than exposing a full HTML error page.
      }
    }
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  if (!cleaned) {
    throw new Error("The backend returned an empty response.");
  }

  try {
    const result = JSON.parse(cleaned);
    if (
      result &&
      typeof result === "object" &&
      (result.status === "error" ||
        result.ok === false ||
        result.success === false)
    ) {
      const error = new Error(
        String(result.message || result.error || "Backend request failed."),
      );
      error.status = Number(result.statusCode) || response.status;
      error.code = result.code || "BACKEND_ERROR";
      error.payload = result;
      throw error;
    }
    return result;
  } catch (error) {
    if (error?.payload) throw error;
    throw new Error(
      `Invalid JSON response from backend: ${cleaned.slice(0, 200)}`,
    );
  }
}

async function adminFetch(payload, options = {}) {
  const configuredUrl =
    typeof DB_URL !== "undefined" && DB_URL ? String(DB_URL).trim() : "";
  if (!configuredUrl) {
    throw new Error("Backend URL is not configured.");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("Backend payload must be a plain object.");
  }

  if (typeof fetch !== "function") {
    throw new Error("Fetch is not available in this environment.");
  }

  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  const requestedTimeout = Number(options.timeoutMs);
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(1, requestedTimeout)
    : ADMIN_REQUEST_TIMEOUT_MS;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;

  try {
    const response = await fetch(configuredUrl, {
      method: "POST",
      redirect: "follow",
      cache: "no-store",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
        Accept: "application/json, text/plain;q=0.9, */*;q=0.8",
      },
      body: JSON.stringify(payload),
      ...(controller ? { signal: controller.signal } : {}),
    });

    return await parseJsonResponse(response);
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("The backend request timed out. Please try again.");
    }
    throw error;
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function adminFormatTimestamp(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown time" : date.toLocaleString();
}

function adminGetModalInner(modal) {
  return (
    modal?.querySelector(":scope > div") || modal?.querySelector("div") || null
  );
}

function adminShowModal(modal) {
  if (!modal) return false;
  const inner = adminGetModalInner(modal);
  modal.classList.remove("hidden", "opacity-0");
  if (inner) inner.classList.remove("scale-95");
  return true;
}

function adminHideModal(modal) {
  if (!modal) return false;
  const inner = adminGetModalInner(modal);
  modal.classList.add("opacity-0");
  if (inner) inner.classList.add("scale-95");
  setTimeout(() => modal.classList.add("hidden"), 300);
  return true;
}

function hideAdminSettingsModal() {
  return adminHideModal(adminGetElement("admin-settings-modal"));
}

function adminBroadcastCacheInvalidation(source = "admin") {
  if (typeof BroadcastChannel === "undefined") return false;

  try {
    const channel = new BroadcastChannel(ADMIN_CACHE_CHANNEL_NAME);
    channel.postMessage({
      type: "cache_invalidated",
      source: adminString(source) || "admin",
      timestamp: Date.now(),
    });
    channel.close();
    return true;
  } catch (error) {
    console.warn("[ADMIN] Cache invalidation broadcast failed:", error);
    return false;
  }
}

function adminHasUnsavedChanges() {
  if (adminSaveInProgress || adminClearInProgress) return false;

  const doc = adminGetDocument();
  if (!doc) return false;

  for (const input of doc.querySelectorAll(".folder-pass-input")) {
    const current = adminString(input.value).trim();
    const original = adminString(input.getAttribute("data-orig")).trim();
    if (current !== original) return true;
  }

  for (const checkbox of doc.querySelectorAll(".folder-hidden-input")) {
    const current = Boolean(checkbox.checked);
    const original = adminToBoolean(checkbox.getAttribute("data-orig"));
    if (current !== original) return true;
  }

  for (const input of doc.querySelectorAll("input[id^='new-subj-']")) {
    const current = adminString(input.value).trim();
    const original = adminString(
      input.getAttribute("data-original-name"),
    ).trim();
    if (current !== original) return true;
  }

  for (const input of doc.querySelectorAll(".deck-pass-input")) {
    const current = adminString(input.value).trim();
    const original = adminString(input.getAttribute("data-orig")).trim();
    if (current !== original) return true;
  }

  for (const checkbox of doc.querySelectorAll(".deck-hidden-input")) {
    const current = Boolean(checkbox.checked);
    const original = adminToBoolean(checkbox.getAttribute("data-orig"));
    if (current !== original) return true;
  }

  return false;
}

function adminMarkExternalChangePending() {
  adminPendingReload = true;
  if (!adminExternalChangeWarningShown) {
    adminNotify(
      "The database changed in another session while this page had unsaved changes. Your edits were kept; reload after reviewing them, or save to let the backend perform its conflict check.",
    );
    adminExternalChangeWarningShown = true;
  }
}

async function adminRefreshAfterInvalidation() {
  if (!adminIsAuthenticated()) return;

  if (adminSaveInProgress || adminClearInProgress || adminHasUnsavedChanges()) {
    adminMarkExternalChangePending();
    return;
  }

  adminPendingReload = false;
  adminExternalChangeWarningShown = false;
  await loadAdminSubjects({ reason: "broadcast" });
}

function adminSetupCacheChannel() {
  if (adminCacheChannel || typeof BroadcastChannel === "undefined") return;

  try {
    adminCacheChannel = new BroadcastChannel(ADMIN_CACHE_CHANNEL_NAME);
    adminCacheChannel.onmessage = (event) => {
      const data = event?.data;
      if (
        !data ||
        data.type !== "cache_invalidated" ||
        !adminIsAuthenticated()
      ) {
        return;
      }
      void adminRefreshAfterInvalidation().catch((error) => {
        console.error("[ADMIN] Broadcast refresh failed:", error);
      });
    };
  } catch (error) {
    adminCacheChannel = null;
    console.warn("[ADMIN] BroadcastChannel unavailable:", error);
  }
}

function adminCloseCacheChannel() {
  if (!adminCacheChannel) return;
  try {
    adminCacheChannel.close();
  } catch (_) {
    // Best effort only.
  }
  adminCacheChannel = null;
}

async function adminLogin() {
  const passwordInput = adminGetElement("admin-password");
  const btn = adminGetElement("btn-admin-login");
  const errorEl = adminGetElement("admin-login-error");

  const rawPassword = adminString(passwordInput?.value);
  if (!rawPassword.trim()) {
    if (errorEl) {
      errorEl.textContent = "Enter the admin password.";
      errorEl.classList.remove("hidden");
    }
    passwordInput?.focus();
    return false;
  }

  if (btn?.disabled) return false;

  const originalText = btn?.innerHTML || "Verify";
  if (btn) {
    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Verifying...';
    btn.disabled = true;
  }

  try {
    const result = await adminFetch({
      type: "verify_admin",
      token: rawPassword,
    });

    if (result?.status === "success") {
      setAdminToken(rawPassword);
      if (errorEl) errorEl.classList.add("hidden");
      adminShowDashboardUI();
      initializeAdminUI();
      adminSetupCacheChannel();
      await Promise.allSettled([loadAdminSubjects(), adminLoadReports()]);
      return true;
    }

    const message =
      typeof result?.message === "string" && result.message.trim()
        ? result.message.trim()
        : "Incorrect password.";
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove("hidden");
    }
    return false;
  } catch (error) {
    console.error("[ADMIN] Login failed:", error);
    if (errorEl) {
      errorEl.textContent = error?.message || "Unable to reach the backend.";
      errorEl.classList.remove("hidden");
    } else {
      adminNotify(error?.message || "Network error while verifying password.");
    }
    return false;
  } finally {
    if (btn) {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  }
}

function collectAdminStats() {
  const records = Array.isArray(adminState.subjects) ? adminState.subjects : [];
  const stats = {
    folders: 0,
    decks: 0,
    lockedDecks: 0,
    hiddenDecks: 0,
  };

  for (const record of records) {
    if (!record || !adminNormalizeText(record.Subject)) continue;

    const isFolder = adminToBoolean(record.IsFolder);
    if (isFolder) {
      stats.folders += 1;
      continue;
    }

    stats.decks += 1;
    if (adminHasPassword(record.Password ?? record.password)) {
      stats.lockedDecks += 1;
    }
    if (adminToBoolean(record.Hidden)) stats.hiddenDecks += 1;
  }

  return {
    ...stats,
    publicDecks: Math.max(stats.decks - stats.lockedDecks, 0),
  };
}

function renderAdminSummary() {
  const container = adminGetElement("admin-summary-cards");
  if (!container) return;

  const stats = collectAdminStats();
  const cards = [
    {
      label: "Decks",
      value: stats.decks,
      icon: "fa-layer-group",
      iconClasses:
        "bg-brand-100 text-brand-600 dark:bg-brand-900/30 dark:text-brand-300",
    },
    {
      label: "Folders",
      value: stats.folders,
      icon: "fa-folder-tree",
      iconClasses:
        "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300",
    },
    {
      label: "Locked",
      value: stats.lockedDecks,
      icon: "fa-lock",
      iconClasses:
        "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-300",
    },
    {
      label: "Hidden",
      value: stats.hiddenDecks,
      icon: "fa-eye-slash",
      iconClasses:
        "bg-purple-100 text-purple-600 dark:bg-purple-900/30 dark:text-purple-300",
    },
  ];

  container.innerHTML = cards
    .map(
      (card) => `
        <div class="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 p-4">
          <div class="flex items-center justify-between">
            <span class="inline-flex h-10 w-10 items-center justify-center rounded-lg ${card.iconClasses}">
              <i class="fa-solid ${card.icon}"></i>
            </span>
            <span class="text-2xl font-bold text-gray-900 dark:text-white">${card.value}</span>
          </div>
          <div class="mt-3">
            <p class="text-sm font-bold uppercase tracking-[0.18em] text-gray-600 dark:text-gray-400">${card.label}</p>
          </div>
        </div>
      `,
    )
    .join("");
}

async function adminFetchStableSubjects(token, attempts = 2) {
  let lastSubjects = null;
  let lastTimestamp = "";

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = await adminFetch({
      type: "get_cache_version",
      token,
    });

    if (adminIsUnauthorizedResult(before)) {
      clearAdminToken();
      throw new Error("Unauthorized admin session.");
    }

    const beforeTimestamp = adminNormalizeText(before?.timestamp);
    if (!beforeTimestamp) {
      throw new Error(
        "The backend did not provide a database version timestamp.",
      );
    }

    const subjects = await adminFetch({
      type: "admin_get_subjects",
      token,
    });

    if (adminIsUnauthorizedResult(subjects)) {
      clearAdminToken();
      throw new Error("Unauthorized admin session.");
    }

    if (!Array.isArray(subjects)) {
      throw new Error(
        "Unexpected response from the backend. Please check server configuration.",
      );
    }

    const after = await adminFetch({
      type: "get_cache_version",
      token,
    });
    if (adminIsUnauthorizedResult(after)) {
      clearAdminToken();
      throw new Error("Unauthorized admin session.");
    }
    const afterTimestamp = adminNormalizeText(after?.timestamp);

    lastSubjects = subjects;
    lastTimestamp = afterTimestamp;

    if (afterTimestamp && afterTimestamp === beforeTimestamp) {
      return { subjects, timestamp: afterTimestamp };
    }
  }

  if (Array.isArray(lastSubjects) && lastTimestamp) {
    return { subjects: lastSubjects, timestamp: lastTimestamp };
  }

  throw new Error(
    "The database changed while it was being loaded. Please try again.",
  );
}

async function loadAdminSubjects(options = {}) {
  const container = adminGetElement("admin-subject-list");
  if (!container) return false;

  const token = getAdminToken();
  if (!token) {
    container.innerHTML =
      '<p class="text-center text-red-500 py-6">Admin session expired. Please sign in again.</p>';
    adminShowLoginUI();
    return false;
  }

  const requestVersion = ++adminSubjectsLoadVersion;
  container.innerHTML =
    '<p class="text-center text-brand-500 py-6"><i class="fa-solid fa-spinner fa-spin mr-2"></i> Fetching secure database...</p>';

  try {
    const loaded = await adminFetchStableSubjects(token, 2);

    if (requestVersion !== adminSubjectsLoadVersion) return false;
    if (getAdminToken() !== token) return false;

    adminState.subjects = loaded.subjects;
    adminState.admin_last_modified_timestamp = loaded.timestamp;
    renderAdminSummary();
    renderAdminSubjectList();
    return true;
  } catch (error) {
    if (requestVersion !== adminSubjectsLoadVersion) return false;

    console.error("[ADMIN] Subject load failed:", error);

    if (adminIsUnauthorizedError(error)) {
      adminHandleUnauthorized();
      return false;
    }

    container.innerHTML = `<p class="text-center text-red-500 py-6">${adminEscapeHTML(
      error?.message || "Network error. Could not load database.",
    )}</p>`;
    return false;
  } finally {
    if (
      adminPendingReload &&
      !adminSaveInProgress &&
      !adminClearInProgress &&
      !adminHasUnsavedChanges() &&
      adminIsAuthenticated()
    ) {
      adminPendingReload = false;
      adminExternalChangeWarningShown = false;
      void loadAdminSubjects({ reason: "pending-broadcast" });
    }
    if (options.reason === "broadcast") {
      adminExternalChangeWarningShown = false;
    }
  }
}

function updateAdminLayoutControls() {
  const isGrid = adminState.hierarchyLayoutMode === "new";
  const checkbox = adminGetElement("layout-toggle-checkbox");
  const button = adminGetElement("admin-layout-toggle-button");
  const icon = adminGetElement("admin-layout-toggle-icon");
  const label = adminGetElement("admin-layout-toggle-label");

  if (checkbox) checkbox.checked = isGrid;
  if (button) {
    button.setAttribute("aria-pressed", String(isGrid));
    button.classList.toggle("bg-brand-600", isGrid);
    button.classList.toggle("text-white", isGrid);
    button.classList.toggle("bg-gray-100", !isGrid);
    button.classList.toggle("text-gray-700", !isGrid);
    button.classList.toggle("dark:bg-gray-700", !isGrid);
    button.classList.toggle("dark:text-gray-200", !isGrid);
  }
  if (icon) {
    icon.className = isGrid
      ? "fa-solid fa-table-cells mr-2"
      : "fa-solid fa-list mr-2";
  }
  if (label) label.textContent = isGrid ? "Grid View" : "List View";
}

function setAdminHierarchyLayoutMode(mode) {
  adminState.hierarchyLayoutMode = mode === "new" ? "new" : "current";
  updateAdminLayoutControls();
  renderAdminSubjectList();
}

function toggleHierarchyLayout() {
  const checkbox = adminGetElement("layout-toggle-checkbox");
  setAdminHierarchyLayoutMode(Boolean(checkbox?.checked) ? "new" : "current");
}

function initializeAdminUI() {
  updateAdminLayoutControls();
  adminBindSubjectEvents();
  adminBindReportEvents();
}

function adminCreateTreeNode() {
  return {
    subfolders: Object.create(null),
    decks: [],
    folderPass: "",
    folderHidden: false,
    UUID: "",
    hasFolderRecord: false,
  };
}

function adminBuildSubjectTree() {
  const tree = adminCreateTreeNode();

  const records = Array.isArray(adminState.subjects) ? adminState.subjects : [];
  records.forEach((cat, index) => {
    if (!cat) return;

    const subject = adminNormalizeText(cat.Subject);
    if (!subject) return;

    const parts = subject.split("::").map((part) => part.trim());
    if (!parts.length || parts.some((part) => !part)) return;

    const pass = adminNormalizeText(cat.Password ?? cat.password);
    const hidden = adminToBoolean(cat.Hidden);
    const isFolder = adminToBoolean(cat.IsFolder);

    let currentNode = tree;
    for (const part of parts) {
      if (!currentNode.subfolders[part]) {
        currentNode.subfolders[part] = adminCreateTreeNode();
      }
      currentNode = currentNode.subfolders[part];
    }

    if (isFolder) {
      currentNode.folderPass = pass;
      currentNode.folderHidden = hidden;
      currentNode.UUID = currentNode.UUID || adminNormalizeText(cat.UUID);
      currentNode.hasFolderRecord = true;
      return;
    }

    const deckName = parts[parts.length - 1];
    currentNode = tree;
    for (const part of parts.slice(0, -1)) {
      if (!currentNode.subfolders[part]) {
        currentNode.subfolders[part] = adminCreateTreeNode();
      }
      currentNode = currentNode.subfolders[part];
    }

    currentNode.decks.push({
      originalFull: subject,
      deckName,
      index,
      password: pass,
      hidden,
      UUID: adminNormalizeText(cat.UUID),
    });
  });

  return tree;
}

function adminCountDecks(node) {
  let count = node?.decks?.length || 0;
  for (const child of Object.values(node?.subfolders || {})) {
    count += adminCountDecks(child);
  }
  return count;
}

function adminMakeModalId(kind, sequence) {
  return `admin-${kind}-modal-${sequence}`;
}

function adminRenderFolderSettingsModal({
  modalId,
  folderName,
  folderPath,
  node,
}) {
  const persistedText = node.hasFolderRecord
    ? ""
    : '<p class="mt-2 rounded border border-blue-200 bg-blue-50 p-2 text-xs text-blue-800 dark:border-blue-900/40 dark:bg-blue-900/20 dark:text-blue-200">This hierarchy node does not yet have an access record. Saving will create one automatically.</p>';

  return `
    <div id="${modalId}" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] hidden opacity-0 flex items-center justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label="${adminEscapeHTML(folderName)} settings">
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-sm w-full p-6 transform scale-95 transition-all my-auto">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-gray-800 dark:text-gray-100">
            <i class="fa-solid fa-sliders text-amber-600 dark:text-amber-400 mr-2"></i>${adminEscapeHTML(folderName)} Settings
          </h3>
          <button type="button" data-admin-action="close-modal" data-modal-id="${modalId}" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl" aria-label="Close folder settings">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <div class="space-y-4">
          <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label class="block text-base font-bold text-red-700 dark:text-red-400 mb-2">
              <i class="fa-solid fa-lock mr-2"></i> Lock Folder
            </label>
            <input type="text"
              class="folder-pass-input w-full p-2 border border-red-300 dark:border-red-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-red-500 focus:ring-2 outline-none transition-all"
              placeholder="Leave blank for public folder..."
              data-path="${adminEscapeHTML(folderPath)}"
              data-orig="${adminEscapeHTML(node.folderPass)}"
              value="${adminEscapeHTML(node.folderPass)}"
              ${adminSaveInProgress || adminClearInProgress ? "disabled" : ""}>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Password to access this folder and subfolders</p>
            ${persistedText}
          </div>

          <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
            <label class="text-base font-bold text-purple-700 dark:text-purple-400 flex items-center gap-2 cursor-pointer">
              <input type="checkbox"
                class="folder-hidden-input w-5 h-5 cursor-pointer"
                data-path="${adminEscapeHTML(folderPath)}"
                data-orig="${String(node.folderHidden)}"
                ${node.folderHidden ? "checked" : ""}
                ${adminSaveInProgress || adminClearInProgress ? "disabled" : ""}>
              <i class="fa-solid fa-eye-slash"></i> Hide Entire Folder
            </label>
            <p class="text-xs text-gray-500 dark:text-gray-400 mt-2">Hidden from regular users; all descendants remain inaccessible until the folder is shown.</p>
          </div>

          <div class="border-t border-gray-200 dark:border-gray-700 pt-4">
            <button type="button" data-admin-action="close-modal" data-modal-id="${modalId}" class="w-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-4 py-2 rounded-lg font-bold hover:bg-gray-300 dark:hover:bg-gray-600 transition-all">Close</button>
          </div>
        </div>
      </div>
    </div>`;
}

function adminRenderDeck(deck, layout) {
  const password = adminEscapeHTML(deck.password);
  const originalPath = adminEscapeHTML(deck.originalFull);
  const uuid = adminEscapeHTML(deck.UUID);
  const hiddenChecked = deck.hidden ? "checked" : "";
  const disabled =
    adminSaveInProgress || adminClearInProgress ? "disabled" : "";

  if (layout === "grid") {
    return `
      <div class="group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-full relative" data-admin-deck-card="true">
        <div class="h-12 bg-purple-500 dark:bg-purple-700 transition-colors relative"></div>
        <div class="p-4 flex-1 flex flex-col">
          <div class="flex items-start justify-between gap-2 mb-3 min-w-0">
            <h3 class="font-bold text-gray-800 dark:text-gray-100 text-lg flex items-center min-w-0">
              <i class="fa-regular fa-file-lines text-gray-400 mr-2 text-sm flex-shrink-0"></i>
              <span class="truncate">${adminEscapeHTML(deck.deckName)}</span>
            </h3>
            <span class="bg-gray-100 text-gray-500 text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold dark:bg-gray-700 dark:text-gray-400 shadow-sm"><i class="fa-solid fa-cloud mr-1"></i></span>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2 break-all font-mono">${originalPath}</p>
          <div class="mb-3">
            <div class="flex justify-between items-center mb-1">
              <label class="text-[10px] font-bold text-brand-600 dark:text-brand-400 uppercase tracking-wider">New Path</label>
              <span class="text-[10px] text-gray-500 font-mono" data-char-count="${deck.index}">${deck.originalFull.length}/${ADMIN_SUBJECT_MAX_LENGTH}</span>
            </div>
            <input type="text"
              id="new-subj-${deck.index}"
              value="${originalPath}"
              maxlength="${ADMIN_SUBJECT_MAX_LENGTH}"
              data-uuid="${uuid}"
              data-original-name="${originalPath}"
              class="admin-subject-path-input w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-sm focus:border-brand-500 focus:ring-2 outline-none transition-all"
              ${disabled}>
          </div>
          ${uuid ? `<p class="text-[10px] text-gray-500 dark:text-gray-400 mb-3 break-all font-mono">${uuid}</p>` : ""}
          <div class="space-y-2 mt-auto">
            <div>
              <label class="text-[10px] font-bold text-red-600 dark:text-red-400 block mb-1 uppercase tracking-wider"><i class="fa-solid fa-lock mr-1"></i> Password</label>
              <input type="text" id="deck-pass-${deck.index}" value="${password}" data-uuid="${uuid}" data-orig="${password}" class="deck-pass-input w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-sm focus:border-red-500 focus:ring-2 outline-none transition-all" placeholder="Public" ${disabled}>
            </div>
            <label class="text-[10px] font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2 cursor-pointer p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700">
              <input type="checkbox" id="deck-hidden-${deck.index}" class="deck-hidden-input w-4 h-4 cursor-pointer" data-uuid="${uuid}" data-index="${deck.index}" data-path="${originalPath}" data-orig="${String(deck.hidden)}" ${hiddenChecked} ${disabled}>
              <i class="fa-solid fa-eye-slash text-sm"></i><span>Hidden</span>
            </label>
          </div>
        </div>
      </div>`;
  }

  return `
    <div class="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-brand-300 dark:hover:border-brand-700 hover:shadow-md transition-all mb-3" data-uuid="${uuid}">
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="lg:col-span-2">
          <span class="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider block mb-1">📖 Deck Name</span>
          <div class="font-semibold text-gray-800 dark:text-gray-100 text-lg break-words" title="${originalPath}">${adminEscapeHTML(deck.deckName)}</div>
          <div class="text-sm text-gray-600 dark:text-gray-400 mt-1 font-mono">Full path: ${originalPath}</div>
          <div class="mt-3">
            <div class="flex justify-between items-center mb-2">
              <span class="text-sm font-bold text-brand-600 dark:text-brand-400 uppercase">New Path</span>
              <span class="text-sm text-gray-500 font-mono" data-char-count="${deck.index}">${deck.originalFull.length}/${ADMIN_SUBJECT_MAX_LENGTH}</span>
            </div>
            <input type="text"
              id="new-subj-${deck.index}"
              value="${originalPath}"
              maxlength="${ADMIN_SUBJECT_MAX_LENGTH}"
              data-uuid="${uuid}"
              data-original-name="${originalPath}"
              class="admin-subject-path-input w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-brand-500 focus:ring-2 outline-none transition-all"
              ${disabled}>
          </div>
        </div>

        <div class="space-y-3 flex flex-col">
          ${
            uuid
              ? `<div class="inline-flex max-w-full items-center gap-2 rounded border border-blue-200 bg-blue-50 px-2 py-1 dark:border-blue-700 dark:bg-blue-900/20"><span class="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">🔑</span><span class="max-w-full truncate font-mono text-sm text-blue-800 dark:text-blue-300 select-all" title="UUID">${uuid}</span></div>`
              : `<div class="inline-flex max-w-full items-center gap-2 rounded border border-dashed border-gray-300 bg-gray-100 px-2 py-1 dark:border-gray-600 dark:bg-gray-700"><span class="text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">🔑</span><span class="text-xs text-gray-400 dark:text-gray-500">Will be assigned</span></div>`
          }

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="text-sm font-bold text-red-600 dark:text-red-400 block mb-1"><i class="fa-solid fa-lock"></i> Password</label>
              <input type="text" id="deck-pass-${deck.index}" value="${password}" placeholder="Public" data-uuid="${uuid}" data-orig="${password}" class="deck-pass-input w-full p-2 border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded text-base focus:border-red-500 focus:ring-2 outline-none transition-all" ${disabled}>
            </div>
            <div class="flex items-end">
              <label class="text-sm font-bold text-purple-600 dark:text-purple-400 flex items-center gap-2 cursor-pointer p-2 bg-gray-50 dark:bg-gray-900 rounded border border-gray-200 dark:border-gray-700 w-full">
                <input type="checkbox" id="deck-hidden-${deck.index}" class="deck-hidden-input w-4 h-4 cursor-pointer" data-uuid="${uuid}" data-index="${deck.index}" data-path="${originalPath}" data-orig="${String(deck.hidden)}" ${hiddenChecked} ${disabled}>
                <i class="fa-solid fa-eye-slash text-base"></i><span>Hidden</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderAdminSubjectList() {
  const container = adminGetElement("admin-subject-list");
  if (!container) return;

  const tree = adminBuildSubjectTree();
  const html =
    adminState.hierarchyLayoutMode === "new"
      ? renderGridView(tree)
      : renderAdminListView(tree);

  container.innerHTML =
    html || '<p class="text-center text-gray-500 py-6">No subjects found.</p>';
  renderAdminSummary();
  adminBindSubjectEvents();
}

function renderAdminListView(tree) {
  let modalSequence = 0;

  function renderNode(node, folderName, depth = 0, currentPath = "") {
    let html = "";
    const fullPath =
      depth === 0
        ? ""
        : currentPath
          ? `${currentPath}::${folderName}`
          : folderName;

    const childFolders = Object.entries(node.subfolders).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    for (const [subName, subNode] of childFolders) {
      html += renderNode(subNode, subName, depth + 1, fullPath);
    }

    if (node.decks.length) {
      if (depth > 0) {
        html += `<div class="my-2 pt-2 border-t border-gray-200 dark:border-gray-700"><span class="text-sm font-bold text-gray-600 dark:text-gray-400 uppercase tracking-wider">📚 Decks in this folder</span></div>`;
      }

      node.decks
        .slice()
        .sort((a, b) =>
          a.deckName.localeCompare(b.deckName, undefined, {
            sensitivity: "base",
          }),
        )
        .forEach((deck) => {
          html += adminRenderDeck(deck, "list");
        });
    }

    if (depth === 0) return html;

    const totalDecks = adminCountDecks(node);
    const depthColor =
      depth === 1
        ? "bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800"
        : "bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700";
    const indentClass = depth > 1 ? "ml-2 md:ml-4" : "";
    const modalId = adminMakeModalId("folder", ++modalSequence);

    return `
      <details class="${indentClass} mb-2 ${depthColor} rounded-lg border group shadow-sm">
        <summary class="font-bold text-gray-700 dark:text-gray-300 p-3 cursor-pointer flex items-center justify-between hover:bg-white/50 dark:hover:bg-gray-900/30 transition-colors outline-none list-none group-open:bg-white/50 dark:group-open:bg-gray-900/30">
          <span class="flex items-center gap-3 flex-1 min-w-0">
            <i class="fa-solid fa-folder text-brand-500 text-lg flex-shrink-0"></i>
            <span class="font-semibold text-base truncate">${adminEscapeHTML(folderName)}</span>
            <span class="bg-brand-100 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 text-sm px-2 py-0.5 rounded-full font-semibold flex-shrink-0">${totalDecks}</span>
          </span>
          <span class="flex items-center gap-2 flex-shrink-0">
            ${
              node.UUID
                ? `<span class="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-1 dark:border-blue-700 dark:bg-blue-900/20 max-w-[200px]"><span class="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">🔑</span><span class="font-mono text-xs text-blue-800 dark:text-blue-300 truncate select-all">${adminEscapeHTML(node.UUID)}</span></span>`
                : ""
            }
            <button type="button" data-admin-action="open-folder-modal" data-modal-id="${modalId}" class="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 p-2 rounded hover:bg-amber-200 dark:hover:bg-amber-900/50 transition-colors flex-shrink-0" title="Folder settings" aria-label="Folder settings for ${adminEscapeHTML(folderName)}">
              <i class="fa-solid fa-sliders text-lg"></i>
            </button>
            <i class="fa-solid fa-chevron-down text-gray-400 transition-transform duration-300 group-open:rotate-180 text-base flex-shrink-0"></i>
          </span>
        </summary>
        <div class="px-4 py-3 border-t ${depthColor.includes("blue") ? "border-blue-200 dark:border-blue-800" : "border-gray-200 dark:border-gray-700"} space-y-2">
          ${html}
        </div>
      </details>
      ${adminRenderFolderSettingsModal({ modalId, folderName, folderPath: fullPath, node })}`;
  }

  return renderNode(tree, "Root", 0, "");
}

function renderGridView(tree) {
  let html =
    '<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">';
  let modalSequence = 0;

  function renderGridItems(node, parentPath = "") {
    const folders = Object.entries(node.subfolders).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );

    for (const [folderName, subNode] of folders) {
      const folderPath = parentPath
        ? `${parentPath}::${folderName}`
        : folderName;
      const modalId = adminMakeModalId("grid-folder", ++modalSequence);
      const totalDecks = adminCountDecks(subNode);
      const contents = renderGridFolderContents(subNode, folderPath);

      html += `
        <div class="group animate-card-in bg-white dark:bg-gray-800 rounded-xl shadow-sm hover:shadow-lg transition-all duration-300 border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col h-full relative">
          <div class="h-12 bg-brand-500 dark:bg-brand-700 transition-colors relative"></div>
          <div class="p-4 flex-1 flex flex-col justify-between">
            <div class="flex justify-between items-start w-full gap-2">
              <h3 class="font-bold text-gray-900 dark:text-gray-100 uppercase tracking-wide text-lg flex items-center min-w-0">
                <span class="truncate">${adminEscapeHTML(folderName)}</span>
              </h3>
              <button type="button" data-admin-action="open-folder-modal" data-modal-id="${modalId}" class="text-gray-400 hover:text-brand-500 dark:hover:text-brand-400 transition-colors p-1" aria-label="Folder settings">
                <i class="fa-solid fa-gear text-sm"></i>
              </button>
            </div>
            <div class="flex justify-between items-center text-sm text-gray-500 dark:text-gray-400 mt-2">
              <span>${totalDecks} ${totalDecks === 1 ? "deck" : "decks"}</span>
              ${subNode.hasFolderRecord ? "" : '<span class="text-amber-600 dark:text-amber-400">Virtual folder</span>'}
            </div>
            <details class="mt-4">
              <summary class="cursor-pointer w-full bg-brand-600 text-white py-2 px-3 rounded-lg font-bold text-xs sm:text-sm shadow-sm hover:bg-brand-700 transition-all duration-300">View Contents</summary>
              <div class="mt-3 space-y-3">${contents || '<p class="text-xs text-gray-500">Empty folder.</p>'}</div>
            </details>
          </div>
          ${adminRenderFolderSettingsModal({ modalId, folderName, folderPath, node: subNode })}
        </div>`;
    }

    for (const deck of node.decks.slice().sort((a, b) =>
      a.deckName.localeCompare(b.deckName, undefined, {
        sensitivity: "base",
      }),
    )) {
      html += adminRenderDeck(deck, "grid");
    }
  }

  function renderGridFolderContents(node, folderPath) {
    let contents = "";
    const children = Object.entries(node.subfolders).sort(([a], [b]) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
    for (const [name, child] of children) {
      const childDeckCount = adminCountDecks(child);
      contents += `<div class="rounded border border-gray-200 dark:border-gray-700 p-2"><div class="font-semibold text-sm text-gray-800 dark:text-gray-100">📁 ${adminEscapeHTML(name)}</div><div class="text-xs text-gray-500">${childDeckCount} deck${childDeckCount === 1 ? "" : "s"}</div></div>`;
    }
    for (const deck of node.decks.slice().sort((a, b) =>
      a.deckName.localeCompare(b.deckName, undefined, {
        sensitivity: "base",
      }),
    )) {
      contents += `<div class="rounded border border-gray-200 dark:border-gray-700 p-2"><div class="font-semibold text-sm text-gray-800 dark:text-gray-100">📖 ${adminEscapeHTML(deck.deckName)}</div><div class="text-xs text-gray-500 font-mono break-all">${adminEscapeHTML(deck.originalFull)}</div></div>`;
    }
    void folderPath;
    return contents;
  }

  renderGridItems(tree);
  html += "</div>";
  return html;
}

function adminBindSubjectEvents() {
  const container = adminGetElement("admin-subject-list");
  if (!container || container.dataset.adminSubjectEventsBound === "true")
    return;
  container.dataset.adminSubjectEventsBound = "true";

  container.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-admin-action]");
    if (!target || !container.contains(target)) return;

    const action = target.getAttribute("data-admin-action");
    const modalId = target.getAttribute("data-modal-id");

    if (action === "open-folder-modal") {
      adminShowModal(adminGetElement(modalId));
    } else if (action === "close-modal") {
      adminHideModal(adminGetElement(modalId));
    }
  });

  container.addEventListener("input", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (!input.matches(".admin-subject-path-input")) return;

    const index = input.id.replace(/^new-subj-/, "");
    const count = Array.from(
      container.querySelectorAll("[data-char-count]"),
    ).find((element) => element.getAttribute("data-char-count") === index);
    if (!count) return;
    count.textContent = `${input.value.length}/${ADMIN_SUBJECT_MAX_LENGTH}`;
    count.classList.toggle(
      "text-red-500",
      input.value.length >= ADMIN_SUBJECT_MAX_LENGTH * 0.9,
    );
  });
}

function adminBindReportEvents() {
  const container = adminGetElement("admin-reports-list");
  if (!container || container.dataset.adminReportEventsBound === "true") return;
  container.dataset.adminReportEventsBound = "true";

  container.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-admin-report-action]");
    if (!target || !container.contains(target)) return;

    const action = target.getAttribute("data-admin-report-action");
    const reportId = target.getAttribute("data-report-id") || "";
    if (action === "edit") {
      openEditModal(reportId);
    } else if (action === "resolve") {
      void adminActionReport(reportId, "resolve");
    } else if (action === "delete") {
      void adminActionReport(reportId, "delete");
    }
  });
}

function adminNormalizeSubjectPath(value) {
  return adminString(value)
    .trim()
    .replace(/\s*::\s*/g, "::");
}

function adminValidateSubjectPath(path) {
  const normalized = adminNormalizeSubjectPath(path);
  if (!normalized) return "Subject path cannot be empty.";
  if (normalized.length > ADMIN_SUBJECT_MAX_LENGTH) {
    return `Subject path must be ${ADMIN_SUBJECT_MAX_LENGTH} characters or fewer.`;
  }

  const parts = normalized.split("::");
  if (parts.some((part) => !part.trim())) {
    return "Subject paths cannot contain empty hierarchy levels.";
  }
  if (parts.some((part) => part.trim().length > 100)) {
    return "Each hierarchy level must be 100 characters or fewer.";
  }
  return "";
}

function adminAddUpdate(map, oldName, patch) {
  const normalizedOld = adminNormalizeSubjectPath(oldName);
  if (!normalizedOld) return;

  const existing = map.get(normalizedOld) || {
    oldName: normalizedOld,
    newName: normalizedOld,
  };
  Object.assign(existing, patch);
  map.set(normalizedOld, existing);
}

function adminCollectUpdates() {
  const doc = adminGetDocument();
  const updatesBySubject = new Map();
  const errors = [];

  if (!doc) return { updates: [], errors: ["Document is not available."] };

  for (const input of doc.querySelectorAll(".folder-pass-input")) {
    const path = adminNormalizeSubjectPath(input.getAttribute("data-path"));
    const pass = adminNormalizeText(input.value);
    const original = adminNormalizeText(input.getAttribute("data-orig"));

    if (!path) {
      errors.push("A folder setting is missing its path.");
      continue;
    }

    const pathError = adminValidateSubjectPath(path);
    if (pathError) {
      errors.push(`${path}: ${pathError}`);
      continue;
    }

    if (pass !== original) {
      adminAddUpdate(updatesBySubject, path, { password: pass, newName: path });
    }
  }

  for (const checkbox of doc.querySelectorAll(".folder-hidden-input")) {
    const path = adminNormalizeSubjectPath(checkbox.getAttribute("data-path"));
    const hidden = Boolean(checkbox.checked);
    const original = adminToBoolean(checkbox.getAttribute("data-orig"));

    if (!path) {
      errors.push("A folder setting is missing its path.");
      continue;
    }

    const pathError = adminValidateSubjectPath(path);
    if (pathError) {
      errors.push(`${path}: ${pathError}`);
      continue;
    }

    if (hidden !== original) {
      adminAddUpdate(updatesBySubject, path, { hidden, newName: path });
    }
  }

  const records = Array.isArray(adminState.subjects) ? adminState.subjects : [];

  records.forEach((record, index) => {
    if (!record || adminToBoolean(record.IsFolder)) return;

    const originalName = adminNormalizeSubjectPath(record.Subject);
    if (!originalName) return;

    const newNameInput = adminGetElement(`new-subj-${index}`);
    const passInput = adminGetElement(`deck-pass-${index}`);
    const hiddenInput = adminGetElement(`deck-hidden-${index}`);

    if (!passInput) return;

    const inputValue = newNameInput
      ? adminNormalizeSubjectPath(newNameInput.value)
      : originalName;
    const newName = inputValue || originalName;

    const pathError = adminValidateSubjectPath(newName);
    if (pathError) errors.push(`${originalName}: ${pathError}`);

    const originalPass = adminNormalizeText(record.Password ?? record.password);
    const currentPass = adminNormalizeText(passInput.value);
    const originalHidden = adminToBoolean(record.Hidden);
    const currentHidden = hiddenInput
      ? Boolean(hiddenInput.checked)
      : originalHidden;

    const patch = { newName };
    let changed = newName !== originalName;

    if (currentPass !== originalPass) {
      patch.password = currentPass;
      changed = true;
    }

    if (currentHidden !== originalHidden) {
      patch.hidden = currentHidden;
      changed = true;
    }

    if (changed) adminAddUpdate(updatesBySubject, originalName, patch);
  });

  const updates = Array.from(updatesBySubject.values());

  const changedNames = new Map();
  for (const update of updates) {
    const finalName = adminNormalizeSubjectPath(update.newName);
    const existing = changedNames.get(finalName);
    if (existing && existing !== update.oldName) {
      errors.push(`Duplicate destination subject: ${finalName}`);
    }
    changedNames.set(finalName, update.oldName);
  }

  if (updates.length > ADMIN_MAX_BATCH_SIZE) {
    errors.push(
      `Too many changes. Save ${ADMIN_MAX_BATCH_SIZE} or fewer items at a time.`,
    );
  }

  return { updates, errors: [...new Set(errors)] };
}

async function adminClearAllSubjects() {
  if (adminClearInProgress || adminSaveInProgress) return false;
  if (!adminIsAuthenticated()) {
    adminHandleUnauthorized();
    return false;
  }

  if (adminHasUnsavedChanges()) {
    adminNotify(
      "Save or discard your current changes before clearing access settings.",
    );
    return false;
  }

  const customConfirm = adminGetGlobal("requestConfirmation");
  let confirmed = false;
  if (typeof customConfirm === "function") {
    confirmed = await customConfirm(
      "Clear all administrator-set passwords and hidden flags from the hierarchy? The database files and subjects will NOT be deleted.",
      "Clear Access Settings",
    );
  } else {
    confirmed = adminConfirm(
      "Clear all administrator-set passwords and hidden flags from the hierarchy? The database files and subjects will NOT be deleted.",
    );
  }
  if (!confirmed) return false;

  const btn = adminGetElement("btn-admin-clear-all");
  const originalHTML = btn?.innerHTML || "Clear";
  adminClearInProgress = true;
  lockAdminInputs(true);
  if (btn) {
    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Clearing...';
    btn.disabled = true;
  }

  try {
    const token = getAdminToken();
    if (!token)
      throw new Error("Your admin session has expired. Please sign in again.");

    const result = await adminFetch({
      type: "admin_clear_all",
      token,
    });

    if (adminIsUnauthorizedResult(result)) {
      adminHandleUnauthorized();
      return false;
    }
    if (result?.status !== "success") {
      throw new Error(result?.message || "Could not clear access settings.");
    }

    if (result.admin_last_modified_timestamp) {
      adminState.admin_last_modified_timestamp = adminNormalizeText(
        result.admin_last_modified_timestamp,
      );
    }

    adminBroadcastCacheInvalidation("admin-clear-access-settings");
    await loadAdminSubjects({ reason: "clear-all" });
    adminNotify(result.message || "Passwords and hidden flags were cleared.");
    return true;
  } catch (error) {
    console.error("[ADMIN] Clear access settings failed:", error);
    if (adminIsUnauthorizedError(error)) adminHandleUnauthorized();
    else
      adminNotify(
        error?.message || "Network error while clearing access settings.",
      );
    return false;
  } finally {
    adminClearInProgress = false;
    lockAdminInputs(false);
    if (btn) {
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    }
  }
}

async function saveAdminChanges() {
  if (adminSaveInProgress || adminClearInProgress) {
    adminNotify("Another admin operation is already in progress.");
    return false;
  }

  const token = getAdminToken();
  if (!token) {
    adminHandleUnauthorized();
    return false;
  }

  const { updates, errors } = adminCollectUpdates();
  if (errors.length) {
    adminNotify(errors.join("\n"));
    return false;
  }
  if (!updates.length) {
    adminNotify("No changes detected.");
    return false;
  }

  if (!adminState.admin_last_modified_timestamp) {
    adminNotify(
      "The database version could not be verified. Reload the admin data before saving.",
    );
    return false;
  }

  const btn = adminGetElement("btn-admin-save");
  const originalHTML = btn?.innerHTML || "Save Changes";
  adminSaveInProgress = true;
  lockAdminInputs(true);
  if (btn) {
    btn.innerHTML =
      '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
    btn.disabled = true;
  }

  try {
    const result = await adminFetch({
      type: "admin_update",
      token,
      updates,
      admin_last_modified_timestamp: adminState.admin_last_modified_timestamp,
    });

    if (adminIsUnauthorizedResult(result)) {
      adminHandleUnauthorized();
      return false;
    }

    if (result?.status === "conflict") {
      const serverTimestamp = adminNormalizeText(
        result.admin_last_modified_timestamp || result.serverTimestamp,
      );
      if (serverTimestamp)
        adminState.admin_last_modified_timestamp = serverTimestamp;
      adminNotify(
        result.message ||
          "The database changed after this page was loaded. Reload before saving again.",
      );
      adminPendingReload = false;
      await loadAdminSubjects({ reason: "conflict" });
      return false;
    }

    if (result?.status !== "success") {
      throw new Error(result?.message || "The backend rejected the changes.");
    }

    if (result.admin_last_modified_timestamp) {
      adminState.admin_last_modified_timestamp = adminNormalizeText(
        result.admin_last_modified_timestamp,
      );
    }

    adminExternalChangeWarningShown = false;
    adminPendingReload = false;
    adminBroadcastCacheInvalidation("admin-update");

    if (btn) {
      btn.innerHTML = '<i class="fa-solid fa-check-circle mr-2"></i> Saved';
      btn.classList.add("ring-2", "ring-green-300");
    }

    await loadAdminSubjects({ reason: "save" });
    return true;
  } catch (error) {
    console.error("[ADMIN] Save failed:", error);
    if (adminIsUnauthorizedError(error)) adminHandleUnauthorized();
    else adminNotify(error?.message || "Network error while saving changes.");
    return false;
  } finally {
    adminSaveInProgress = false;
    lockAdminInputs(false);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHTML;
      btn.classList.remove("ring-2", "ring-green-300", "ring-yellow-300");
    }
  }
}

function lockAdminInputs(lock) {
  const doc = adminGetDocument();
  if (!doc) return;

  const selectors = [
    ".folder-pass-input",
    ".folder-hidden-input",
    ".deck-pass-input",
    ".deck-hidden-input",
    ".admin-subject-path-input",
  ].join(",");

  for (const input of doc.querySelectorAll(selectors)) {
    if (lock) {
      if (input.dataset.adminOriginallyDisabled === undefined) {
        input.dataset.adminOriginallyDisabled = String(Boolean(input.disabled));
      }
      input.disabled = true;
      input.classList.add("opacity-50", "cursor-not-allowed");
    } else {
      const originallyDisabled =
        input.dataset.adminOriginallyDisabled === "true";
      input.disabled = originallyDisabled;
      delete input.dataset.adminOriginallyDisabled;
      input.classList.remove("opacity-50", "cursor-not-allowed");
    }
  }
}

function adminGetReportChoices(report) {
  return [report?.optionA, report?.optionB, report?.optionC, report?.optionD]
    .map((choice) => adminNormalizeText(choice))
    .filter(Boolean);
}

async function adminFetchAllReports(token) {
  const pageSize = 100;
  const reports = [];
  for (let page = 1; page <= 100; page += 1) {
    const result = await adminFetch({
      type: "get_reports",
      role: "admin",
      token,
      page,
      limit: pageSize,
    });
    if (Array.isArray(result)) return reports.concat(result);
    if (!result || !Array.isArray(result.data))
      throw new Error("The reports endpoint returned an invalid response.");
    reports.push(...result.data);
    if (reports.length >= Number(result.total || reports.length)) break;
    if (result.data.length < pageSize) break;
  }
  return reports;
}

async function adminLoadReports() {
  const container = adminGetElement("admin-reports-list");
  if (!container) return false;

  const token = getAdminToken();
  if (!token) {
    container.innerHTML =
      '<div class="text-red-500 text-center py-6">Admin session expired. Please sign in again.</div>';
    adminShowLoginUI();
    return false;
  }

  const requestVersion = ++adminReportsLoadVersion;
  container.innerHTML =
    '<p class="text-center text-gray-500 py-4"><i class="fa-solid fa-spinner fa-spin"></i> Loading reports...</p>';

  try {
    const reports = await adminFetchAllReports(token);

    if (
      requestVersion !== adminReportsLoadVersion ||
      getAdminToken() !== token
    ) {
      return false;
    }

    if (adminIsUnauthorizedResult(reports)) {
      adminHandleUnauthorized();
      return false;
    }
    if (!Array.isArray(reports)) {
      throw new Error("The reports endpoint returned an invalid response.");
    }

    adminState.reports = reports.filter(
      (report) => report && adminNormalizeText(report.id),
    );

    if (!adminState.reports.length) {
      container.innerHTML =
        '<div class="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-xl text-center text-gray-500">No reports found in the database.</div>';
      adminBindReportEvents();
      return true;
    }

    container.innerHTML = adminState.reports
      .map((report) => {
        const id = adminNormalizeText(report.id);
        const choices = adminGetReportChoices(report);
        const questionType = choices.length <= 1 ? "Identification" : "MCQ";
        const status = adminNormalizeText(report.status) || "Pending";
        const isResolved = status.toLowerCase() === "resolved";
        const resolvedButton = isResolved
          ? ""
          : `<button type="button" data-admin-report-action="resolve" data-report-id="${adminEscapeHTML(id)}" class="flex-1 bg-green-500 text-white px-4 py-2 rounded font-bold hover:bg-green-600 shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-check mr-2"></i> Mark Resolved</button>`;

        return `
          <div class="bg-white dark:bg-gray-800 p-5 rounded-xl border-l-4 border-yellow-500 shadow-sm relative group mb-4" data-report-card="true" data-report-id="${adminEscapeHTML(id)}">
            <div class="flex justify-between items-start mb-2 gap-3">
              <span class="text-xs font-mono text-gray-500 bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">ID: ${adminEscapeHTML(report.questionId || "N/A")}</span>
              <span class="text-xs text-gray-400">${adminEscapeHTML(adminFormatTimestamp(report.timestamp))}</span>
            </div>
            <div class="text-xs text-brand-500 font-bold uppercase tracking-wider mb-1">${adminEscapeHTML(report.subject || "N/A")}</div>
            ${report.lesson ? `<div class="text-sm text-gray-600 dark:text-gray-300 mb-2"><strong>Lesson / Topic:</strong> ${adminEscapeHTML(report.lesson)}</div>` : ""}
            <div class="text-xs text-brand-600 dark:text-brand-400 font-bold uppercase mb-2">Question Type: ${questionType}</div>
            <div class="font-bold text-gray-800 dark:text-gray-100 mb-2">${adminEscapeHTML(report.errorType || "Unknown issue")}</div>

            <div class="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg text-sm text-gray-700 dark:text-gray-300 mb-3 border border-gray-200 dark:border-gray-700">
              <div class="mb-3"><strong class="text-gray-900 dark:text-white">Q:</strong> ${adminEscapeHTML(report.questionText || "N/A")}</div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2 py-3 border-t border-gray-200 dark:border-gray-700 text-xs">
                <div class="truncate" title="${adminEscapeHTML(report.optionA || "")}"><strong class="text-gray-500 mr-1">A:</strong> ${adminEscapeHTML(report.optionA || "N/A")}</div>
                <div class="truncate" title="${adminEscapeHTML(report.optionB || "")}"><strong class="text-gray-500 mr-1">B:</strong> ${adminEscapeHTML(report.optionB || "N/A")}</div>
                <div class="truncate" title="${adminEscapeHTML(report.optionC || "")}"><strong class="text-gray-500 mr-1">C:</strong> ${adminEscapeHTML(report.optionC || "N/A")}</div>
                <div class="truncate" title="${adminEscapeHTML(report.optionD || "")}"><strong class="text-gray-500 mr-1">D:</strong> ${adminEscapeHTML(report.optionD || "N/A")}</div>
              </div>
              <div class="pt-3 border-t border-gray-200 dark:border-gray-700"><strong class="text-green-600 dark:text-green-400 mr-1">Answer:</strong> ${adminEscapeHTML(report.correctAnswer || "N/A")}</div>
            </div>

            ${report.comments ? `<p class="text-sm text-gray-600 dark:text-gray-400 mb-4 bg-yellow-50 dark:bg-yellow-900/10 p-2 rounded border border-yellow-100 dark:border-yellow-900/30"><i class="fa-solid fa-comment text-yellow-600 mr-2"></i>${adminEscapeHTML(report.comments)}</p>` : ""}

            <div class="flex gap-2 flex-wrap">
              <button type="button" data-admin-report-action="edit" data-report-id="${adminEscapeHTML(id)}" class="flex-1 bg-blue-500 text-white px-4 py-2 rounded font-bold hover:bg-blue-600 shadow-sm active:scale-95 transition-all"><i class="fa-solid fa-pen mr-2"></i> Edit Data</button>
              ${resolvedButton}
              <button type="button" data-admin-report-action="delete" data-report-id="${adminEscapeHTML(id)}" class="bg-red-100 text-red-600 px-4 py-2 rounded font-bold hover:bg-red-200 shadow-sm active:scale-95 transition-all" title="Hard Delete from Sheet"><i class="fa-solid fa-trash-can"></i></button>
            </div>
          </div>`;
      })
      .join("");

    adminBindReportEvents();
    return true;
  } catch (error) {
    if (requestVersion !== adminReportsLoadVersion) return false;

    console.error("[ADMIN] Reports load failed:", error);
    if (adminIsUnauthorizedError(error)) adminHandleUnauthorized();
    container.innerHTML = `<div class="text-red-500 text-center py-6">${adminEscapeHTML(error?.message || "Failed to fetch admin reports.")}</div>`;
    return false;
  }
}

async function adminResolveReportAction(reportId, action) {
  const normalizedId = adminNormalizeText(reportId);
  const normalizedAction = adminNormalizeText(action).toLowerCase();

  if (!normalizedId) throw new Error("Report ID is required.");
  if (!["resolve", "delete"].includes(normalizedAction)) {
    throw new Error("Unsupported report action.");
  }

  if (!adminIsAuthenticated()) {
    throw new Error("Unauthorized admin session.");
  }

  if (adminReportActionsInProgress.has(normalizedId)) {
    throw new Error("This report is already being updated.");
  }

  adminReportActionsInProgress.add(normalizedId);
  try {
    const result = await adminFetch({
      type: "admin_resolve_report",
      token: getAdminToken(),
      reportId: normalizedId,
      action: normalizedAction,
    });

    if (adminIsUnauthorizedResult(result)) {
      adminHandleUnauthorized();
      throw new Error("Unauthorized admin session.");
    }
    if (result?.status !== "success") {
      throw new Error(
        result?.message || "The backend rejected the report action.",
      );
    }
    return result;
  } finally {
    adminReportActionsInProgress.delete(normalizedId);
  }
}

async function adminActionReport(reportId, action) {
  const normalizedAction = adminNormalizeText(action).toLowerCase();
  const normalizedId = adminNormalizeText(reportId);
  if (!normalizedId || !["resolve", "delete"].includes(normalizedAction)) {
    adminNotify("Unsupported report action.");
    return false;
  }

  if (normalizedAction === "delete") {
    const customConfirm = adminGetGlobal("requestConfirmation");
    const confirmed =
      typeof customConfirm === "function"
        ? await customConfirm(
            "Are you sure you want to permanently delete this report from Google Sheets?",
            "Delete Report",
          )
        : adminConfirm(
            "Are you sure you want to permanently delete this report?",
          );
    if (!confirmed) return false;
  }

  try {
    await adminResolveReportAction(normalizedId, normalizedAction);
    adminNotify(
      normalizedAction === "resolve"
        ? "Report marked as resolved."
        : "Report permanently deleted.",
    );
    await adminLoadReports();
    return true;
  } catch (error) {
    console.error("[ADMIN] Report action failed:", error);
    if (adminIsUnauthorizedError(error)) adminHandleUnauthorized();
    else
      adminNotify(error?.message || "Network error while updating the report.");
    return false;
  }
}

function openEditModal(reportId) {
  const normalizedId = adminNormalizeText(reportId);
  const report = adminState.reports.find(
    (item) => adminNormalizeText(item?.id) === normalizedId,
  );
  if (!report) {
    adminNotify("Report reference not found.");
    return false;
  }

  const modal = adminGetElement("admin-edit-modal");
  if (!modal) {
    adminNotify("The edit form is not available.");
    return false;
  }

  const assignments = {
    "edit-report-id": adminString(report.id),
    "edit-question-id": adminString(report.questionId),
    "edit-q-text": adminString(report.questionText),
    "edit-q-optA": adminString(report.optionA),
    "edit-q-optB": adminString(report.optionB),
    "edit-q-optC": adminString(report.optionC),
    "edit-q-optD": adminString(report.optionD),
    "edit-q-answer": adminString(report.correctAnswer),
  };

  for (const [id, value] of Object.entries(assignments)) {
    const element = adminGetElement(id);
    if (element) element.value = value;
  }

  adminShowModal(modal);
  return true;
}

function closeEditModal() {
  return adminHideModal(adminGetElement("admin-edit-modal"));
}

function adminValidateEditedQuestion(report, fields) {
  if (!fields.questionId) return "Question ID is required.";
  if (!fields.questionText) return "Question text is required.";

  const choices = adminGetReportChoices(fields);
  if (choices.length >= 2) {
    if (!["A", "B", "C", "D"].includes(fields.correctAnswer)) {
      return "For multiple-choice questions, correct answer must be A, B, C, or D.";
    }
    const answerMap = {
      A: fields.optionA,
      B: fields.optionB,
      C: fields.optionC,
      D: fields.optionD,
    };
    if (!adminNormalizeText(answerMap[fields.correctAnswer])) {
      return `Option ${fields.correctAnswer} cannot be the correct answer because it is empty.`;
    }
  } else if (!fields.correctAnswer) {
    return "An answer is required.";
  }

  if (!adminNormalizeText(report.subject)) return "Report subject is missing.";
  return "";
}

async function saveEditedQuestion() {
  const saveBtn = adminGetElement("btn-save-edit");
  const reportId = adminNormalizeText(adminGetElement("edit-report-id")?.value);
  const questionId = adminNormalizeText(
    adminGetElement("edit-question-id")?.value,
  );
  if (!saveBtn) {
    adminNotify("Edit form is not available.");
    return false;
  }

  const report = adminState.reports.find(
    (item) => adminNormalizeText(item?.id) === reportId,
  );
  if (!report) {
    adminNotify("Report reference not found.");
    return false;
  }

  if (!getAdminToken()) {
    adminHandleUnauthorized();
    return false;
  }
  if (saveBtn.disabled) return false;

  const fields = {
    questionId,
    questionText: adminNormalizeText(adminGetElement("edit-q-text")?.value),
    optionA: adminNormalizeText(adminGetElement("edit-q-optA")?.value),
    optionB: adminNormalizeText(adminGetElement("edit-q-optB")?.value),
    optionC: adminNormalizeText(adminGetElement("edit-q-optC")?.value),
    optionD: adminNormalizeText(adminGetElement("edit-q-optD")?.value),
    correctAnswer: adminNormalizeText(
      adminGetElement("edit-q-answer")?.value,
    ).toUpperCase(),
  };

  const validationError = adminValidateEditedQuestion(report, fields);
  if (validationError) {
    adminNotify(validationError);
    return false;
  }

  const originalText = saveBtn.innerHTML;
  saveBtn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin mr-2"></i> Saving...';
  saveBtn.disabled = true;

  try {
    const result = await adminFetch({
      type: "admin_edit_question",
      token: getAdminToken(),
      subject: adminString(report.subject),
      questionId: fields.questionId,
      questionText: fields.questionText,
      optionA: fields.optionA,
      optionB: fields.optionB,
      optionC: fields.optionC,
      optionD: fields.optionD,
      correctAnswer: fields.correctAnswer,
    });

    if (adminIsUnauthorizedResult(result)) {
      adminHandleUnauthorized();
      return false;
    }
    if (result?.status !== "success") {
      throw new Error(result?.message || "Failed to update question.");
    }

    closeEditModal();

    let resolutionSucceeded = true;
    try {
      await adminResolveReportAction(reportId, "resolve");
    } catch (resolutionError) {
      resolutionSucceeded = false;
      console.error(
        "[ADMIN] Question saved but report resolution failed:",
        resolutionError,
      );
    }

    await adminLoadReports();
    adminNotify(
      resolutionSucceeded
        ? result.message || "Question updated successfully and report resolved."
        : `${result.message || "Question updated successfully."} However, the report could not be marked as resolved.`,
    );
    return true;
  } catch (error) {
    console.error("[ADMIN] Question edit failed:", error);
    if (adminIsUnauthorizedError(error)) adminHandleUnauthorized();
    else
      adminNotify(
        error?.message ||
          "Network error while trying to save question changes.",
      );
    return false;
  } finally {
    saveBtn.innerHTML = originalText;
    saveBtn.disabled = false;
  }
}

// Legacy compatibility helpers. The current generated UI no longer depends on them,
// but keeping the public functions avoids breaking older HTML that may still call them.
function cascadePasswordCompat(btn) {
  // Compatibility entry point retained for older HTML. Password inheritance is
  // intentionally disabled: each node is governed only by its own metadata.
  const input = btn?.previousElementSibling;
  if (!input) return 0;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return 0;
}

function cascadeHiddenCompat(btn) {
  // Compatibility entry point retained for older HTML. Hidden state is stored
  // on the selected folder/deck and is evaluated hierarchically by the backend;
  // it is never copied into child metadata.
  const checkbox = btn?.previousElementSibling;
  if (!checkbox) return 0;
  checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  return 0;
}

function adminExposePublicAPI() {
  if (typeof globalThis === "undefined") return;
  const root = globalThis;
  root.adminState = adminState;
  root.adminLogin = adminLogin;
  root.adminIsAuthenticated = adminIsAuthenticated;
  root.getAdminToken = getAdminToken;
  root.setAdminToken = setAdminToken;
  root.clearAdminToken = clearAdminToken;
  root.hideAdminSettingsModal = hideAdminSettingsModal;
  root.loadAdminSubjects = loadAdminSubjects;
  root.renderAdminSubjectList = renderAdminSubjectList;
  root.initializeAdminUI = initializeAdminUI;
  root.setAdminHierarchyLayoutMode = setAdminHierarchyLayoutMode;
  root.toggleHierarchyLayout = toggleHierarchyLayout;
  root.adminClearAllSubjects = adminClearAllSubjects;
  root.saveAdminChanges = saveAdminChanges;
  root.adminLoadReports = adminLoadReports;
  root.adminActionReport = adminActionReport;
  root.openEditModal = openEditModal;
  root.closeEditModal = closeEditModal;
  root.saveEditedQuestion = saveEditedQuestion;
  root.cascadePassword = cascadePasswordCompat;
  root.cascadeHidden = cascadeHiddenCompat;
}

adminExposePublicAPI();
adminSetupCacheChannel();

if (
  typeof globalThis !== "undefined" &&
  typeof globalThis.addEventListener === "function"
) {
  globalThis.addEventListener("pagehide", adminCloseCacheChannel);
  globalThis.addEventListener("pageshow", adminSetupCacheChannel);
}
