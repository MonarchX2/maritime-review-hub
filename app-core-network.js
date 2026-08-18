(function (globalScope) {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 15000;

  function getDatabaseUrl() {
    try {
      if (typeof DB_URL !== "undefined" && String(DB_URL).trim()) {
        return String(DB_URL).trim();
      }
    } catch (_) {}
    if (typeof globalScope.DB_URL === "string" && globalScope.DB_URL.trim()) {
      return globalScope.DB_URL.trim();
    }
    return "";
  }

  function normalizeErrorMessage(payload, fallback) {
    if (payload && typeof payload === "object") {
      return String(payload.message || payload.error || fallback || "Request failed.");
    }
    return fallback || "Request failed.";
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      const preview = text.replace(/\s+/g, " ").slice(0, 240);
      const parseError = new Error(`Invalid backend JSON response: ${preview}`);
      parseError.cause = error;
      parseError.status = response.status;
      throw parseError;
    }
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    let externalAbortHandler = null;
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    if (externalSignal) {
      externalAbortHandler = () => controller.abort();
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", externalAbortHandler, { once: true });
    }

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener("abort", externalAbortHandler);
      }
    }
  }

  /**
   * Fixed backend contract:
   * POST JSON requests are dispatched by the backend's `type` field.
   * We deliberately do not invent/translate unsupported backend actions.
   */
  async function callBackend(payload, options = {}) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("Database URL is not configured.");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Backend payload must be an object.");
    }
    if (!String(payload.type || "").trim()) {
      throw new Error("Backend request type is required.");
    }

    const response = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=utf-8",
          Accept: "application/json",
          ...(options.headers || {}),
        },
        body: JSON.stringify(payload),
        redirect: "follow",
        cache: "no-store",
        signal: options.signal,
      },
      Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS,
    );

    const result = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(normalizeErrorMessage(result, `Backend HTTP ${response.status}.`));
      error.status = response.status;
      error.code = result?.code || "HTTP_ERROR";
      error.payload = result;
      throw error;
    }
    return result;
  }

  async function getDeckSummary(options = {}) {
    const url = new URL(getDatabaseUrl());
    url.searchParams.set("_t", Date.now().toString());
    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: { Accept: "application/json", ...(options.headers || {}) },
        redirect: "follow",
        cache: "no-store",
        signal: options.signal,
      },
      Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000,
    );
    const result = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(normalizeErrorMessage(result, `Backend HTTP ${response.status}.`));
      error.status = response.status;
      error.code = result?.code || "HTTP_ERROR";
      error.payload = result;
      throw error;
    }
    return result;
  }

  async function getDeck(subject, password = "", options = {}) {
    const url = new URL(getDatabaseUrl());
    url.searchParams.set("subject", String(subject || "").trim());
    if (password) url.searchParams.set("password", String(password));
    url.searchParams.set("_t", Date.now().toString());

    const response = await fetchWithTimeout(
      url.toString(),
      {
        method: "GET",
        headers: { Accept: "application/json", ...(options.headers || {}) },
        redirect: "follow",
        cache: "no-store",
        signal: options.signal,
      },
      Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000,
    );

    const result = await parseJsonResponse(response);
    if (!response.ok) {
      const error = new Error(normalizeErrorMessage(result, `Backend HTTP ${response.status}.`));
      error.status = response.status;
      error.code = result?.code || "HTTP_ERROR";
      error.payload = result;
      throw error;
    }
    return result;
  }

  const backendApi = {
    verifyAdmin: (token) => callBackend({ type: "verify_admin", token }),
    getAdminSubjects: (token) => callBackend({ type: "admin_get_subjects", token }),
    submitReport: (payload) => callBackend({ type: "submit_report", ...payload }),
    getReports: (role = "user", token = "") =>
      callBackend({ type: "get_reports", role, ...(role === "admin" ? { token } : {}) }),
    resolveReport: (token, reportId, action) =>
      callBackend({ type: "admin_resolve_report", token, reportId, action }),
    getCacheVersion: () => callBackend({ type: "get_cache_version" }),
    getSyncStatus: () => callBackend({ type: "get_sync_status" }),
    clearAllAccessMetadata: (token) => callBackend({ type: "admin_clear_all", token }),
    wipeEverything: (token) => callBackend({ type: "wipe_everything", token }),
    updateSubjects: (payload) => callBackend({ type: "admin_update", ...payload }),
    editQuestion: (payload) => callBackend({ type: "admin_edit_question", ...payload }),
  };

  function adminTokenStorageKey() {
    return "mrh_admin_token";
  }

  function getAdminToken() {
    try {
      if (typeof globalScope.getStoredItem === "function") {
        return String(globalScope.getStoredItem(adminTokenStorageKey(), "") || "").trim();
      }
      return String(globalScope.localStorage?.getItem(adminTokenStorageKey()) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function setAdminToken(token) {
    const clean = String(token || "").trim();
    try {
      if (typeof globalScope.setStoredItem === "function") {
        globalScope.setStoredItem(adminTokenStorageKey(), clean);
      } else if (globalScope.localStorage) {
        globalScope.localStorage.setItem(adminTokenStorageKey(), clean);
      }
    } catch (_) {
      // Token persistence is optional; the caller can keep it in memory.
    }
    return clean;
  }

  function clearAdminToken() {
    try {
      if (typeof globalScope.removeStoredItem === "function") {
        globalScope.removeStoredItem(adminTokenStorageKey());
      } else {
        globalScope.localStorage?.removeItem(adminTokenStorageKey());
      }
    } catch (_) {}
  }

  const AppNetwork = {
    callBackend,
    getDeckSummary,
    getDeck,
    ...backendApi,
    getAdminToken,
    setAdminToken,
    clearAdminToken,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppNetwork;
  }

  globalScope.callBackend = callBackend;
  globalScope.AppNetwork = AppNetwork;

  // Do not overwrite an admin.js implementation if one is already loaded.
  if (typeof globalScope.getAdminToken !== "function") globalScope.getAdminToken = getAdminToken;
  if (typeof globalScope.setAdminToken !== "function") globalScope.setAdminToken = setAdminToken;
  if (typeof globalScope.clearAdminToken !== "function") globalScope.clearAdminToken = clearAdminToken;
})(typeof window !== "undefined" ? window : globalThis);
