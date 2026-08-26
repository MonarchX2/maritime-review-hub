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
      return String(
        payload.message || payload.error || fallback || "Request failed.",
      );
    }
    return fallback || "Request failed.";
  }

  function getBackendError(result, response) {
    const statusCode = Number(result?.statusCode);
    const hasErrorEnvelope =
      result &&
      typeof result === "object" &&
      (result.status === "error" ||
        result.ok === false ||
        result.success === false ||
        (Number.isFinite(statusCode) && statusCode >= 400));
    if (response.ok && !hasErrorEnvelope) return null;

    const error = new Error(
      normalizeErrorMessage(
        result,
        response.ok
          ? "Backend request failed."
          : `Backend HTTP ${response.status}.`,
      ),
    );
    error.status = response.ok ? statusCode || 500 : response.status;
    error.code = result?.code || "HTTP_ERROR";
    error.payload = result;
    return error;
  }

  async function parseJsonResponse(response) {
    const text = await response.text();
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      const emptyError = new Error("Backend returned an empty response body.");
      emptyError.status = response.status;
      throw emptyError;
    }
    try {
      return JSON.parse(trimmed);
    } catch (error) {
      const preview = trimmed.replace(/\s+/g, " ").slice(0, 240);
      const parseError = new Error(
        `Invalid backend JSON response: ${preview || "empty or non-JSON body"}`,
      );
      parseError.cause = error;
      parseError.status = response.status;
      throw parseError;
    }
  }

  async function fetchWithTimeout(
    url,
    options = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {
    const controller = new AbortController();
    const externalSignal = options.signal;
    let externalAbortHandler = null;
    let didTimeout = false;
    const timer = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, timeoutMs);

    if (externalSignal) {
      externalAbortHandler = () => controller.abort();
      if (externalSignal.aborted) controller.abort();
      else
        externalSignal.addEventListener("abort", externalAbortHandler, {
          once: true,
        });
    }

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (didTimeout) {
        const timeoutError = new Error(
          `Backend request timed out after ${timeoutMs}ms.`,
        );
        timeoutError.name = "TimeoutError";
        timeoutError.cause = error;
        throw timeoutError;
      }
      throw error;
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
      Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : DEFAULT_TIMEOUT_MS,
    );

    const result = await parseJsonResponse(response);
    const backendError = getBackendError(result, response);
    if (backendError) throw backendError;
    return result;
  }

  async function getDeckSummary(options = {}) {
    const databaseUrl = getDatabaseUrl();
    if (!databaseUrl) throw new Error("Database URL is not configured.");
    const url = new URL(databaseUrl, globalScope.location?.href || undefined);
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
    const backendError = getBackendError(result, response);
    if (backendError) throw backendError;
    return result;
  }

  async function getDeck(subject, password = "", options = {}) {
    return callBackend(
      {
        type: "get_deck",
        subject: String(subject || "").trim(),
        password: String(password || ""),
        ...(options.page !== undefined ? { page: options.page } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      },
      options,
    );
  }

  const backendApi = {
    submitReport: (payload) =>
      callBackend({ type: "submit_report", ...payload }),
    getReports: (options = {}) =>
      callBackend(
        {
          type: "get_reports",
          ...(options.page !== undefined ? { page: options.page } : {}),
          ...(options.limit !== undefined ? { limit: options.limit } : {}),
        },
        options,
      ),
    getCacheVersion: () => callBackend({ type: "get_cache_version" }),
    getSyncStatus: (options = {}) =>
      callBackend({ type: "get_sync_status" }, options),
  };

  const AppNetwork = {
    callBackend,
    getDeckSummary,
    getDeck,
    verifyFolderAccess: (subject, password, options = {}) =>
      callBackend(
        {
          type: "verify_folder_access",
          subject: String(subject || "").trim(),
          password: String(password || ""),
        },
        options,
      ),
    ...backendApi,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppNetwork;
  }

  globalScope.callBackend = callBackend;
  globalScope.AppNetwork = AppNetwork;
})(typeof window !== "undefined" ? window : globalThis);
