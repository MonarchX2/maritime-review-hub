(function (globalScope) {
  "use strict";

  const root =
    globalScope || (typeof globalThis !== "undefined" ? globalThis : {});

  function getFetch() {
    if (typeof root.fetch === "function") return root.fetch.bind(root);
    if (typeof fetch === "function") return fetch;
    throw new Error("Fetch is unavailable in this environment.");
  }

  function getAbortController() {
    if (typeof root.AbortController === "function") return root.AbortController;
    if (typeof AbortController === "function") return AbortController;
    return null;
  }

  function getBackendUrl(options) {
    const url = options && options.url != null ? options.url : root.DB_URL;
    if (!url) throw new Error("Backend URL (DB_URL) is not configured.");
    return String(url);
  }

  function getTimeoutMs(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 20000;
    return Math.min(parsed, 120000);
  }

  async function parseResponseBody(response) {
    const text = await response.text().catch(() => "");
    if (!text.trim()) return null;

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error(
        `Invalid response from backend. Expected JSON but received: ${text.slice(0, 200)}`,
      );
    }
  }

  function getErrorMessage(text, status) {
    const fallback = text || `Backend request failed (${status})`;
    if (!text) return fallback;

    try {
      const json = JSON.parse(text);
      return String(json?.message || json?.error || fallback);
    } catch (error) {
      return fallback;
    }
  }

  async function callBackend(payload, options = {}) {
    const { timeoutMs = 20000, url, headers, requestInit = {} } = options || {};

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new TypeError("Backend payload must be a plain object.");
    }
    if (!String(payload.type || "").trim()) {
      throw new TypeError("Backend request type is required.");
    }

    const fetchImpl = getFetch();
    const timeout = getTimeoutMs(timeoutMs);
    const Controller = getAbortController();
    const controller = Controller ? new Controller() : null;
    let timeoutId = null;

    const defaultHeaders = {
      "Content-Type": "text/plain;charset=utf-8",
    };
    const mergedHeaders = { ...defaultHeaders, ...(headers || {}) };

    const init = {
      ...requestInit,
      method: "POST",
      redirect: "follow",
      headers: mergedHeaders,
      body: JSON.stringify(payload),
    };

    if (controller) {
      init.signal = controller.signal;
      timeoutId = setTimeout(() => controller.abort(), timeout);
    }

    try {
      const response = controller
        ? await fetchImpl(getBackendUrl({ url }), init)
        : await Promise.race([
            fetchImpl(getBackendUrl({ url }), init),
            new Promise((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error("__MRH_TIMEOUT__")),
                timeout,
              );
            }),
          ]);

      if (!response || typeof response.ok !== "boolean") {
        throw new Error("Invalid response object from backend.");
      }

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(getErrorMessage(text, response.status));
      }

      const result = await parseResponseBody(response);
      if (
        result &&
        typeof result === "object" &&
        (result.status === "error" ||
          result.ok === false ||
          result.success === false ||
          Number(result.statusCode) >= 400)
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
      if (
        error?.name === "AbortError" ||
        error?.message === "__MRH_TIMEOUT__"
      ) {
        throw new Error("The request timed out. Please try again.");
      }
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  const NetworkUtils = { callBackend };

  if (typeof module !== "undefined" && module.exports)
    module.exports = NetworkUtils;
  root.NetworkUtils = NetworkUtils;
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
