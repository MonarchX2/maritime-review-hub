(function (globalScope) {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 15000;
  const DEFAULT_POOL_CONFIG = {
    maxConnections: 8,
    maxRetries: 7,
    baseRetryDelayMs: 500,
    maxRetryDelayMs: 60000,
    idleTimeoutMs: 60000,
    keepAlive: true,
    keepAliveIntervalMs: 10000,
    reconnectDelayMs: 1000,
    autoReconnect: true,
    healthCheckIntervalMs: 25000,
    healthCheckTimeoutMs: 8000,
  };
  const lifecycle = globalScope.LifecycleUtils || {
    setTimeout: globalScope.setTimeout.bind(globalScope),
    clearTimeout: globalScope.clearTimeout.bind(globalScope),
    setInterval: globalScope.setInterval.bind(globalScope),
    clearInterval: globalScope.clearInterval.bind(globalScope),
  };
  const networkLogger = globalScope.DebugUtils?.createDebugLogger
    ? globalScope.DebugUtils.createDebugLogger("mrh-network")
    : { warn: () => {}, error: () => {} };
  let cachedDatabaseUrl = "";

  function calculateRetryDelay(
    attempt,
    baseDelayMs = DEFAULT_POOL_CONFIG.baseRetryDelayMs,
    maxDelayMs = DEFAULT_POOL_CONFIG.maxRetryDelayMs,
  ) {
    const safeAttempt = Math.max(0, Number(attempt) || 0);
    const exponential = baseDelayMs * Math.pow(2, safeAttempt);
    return Math.min(maxDelayMs, exponential);
  }

  function isRetryableError(error) {
    if (!error) return false;
    const status = Number(error?.status);
    if (Number.isFinite(status) && status >= 500) return true;
    if (status === 429) return true;
    if (error.name === "TimeoutError") return true;
    if (
      error.message &&
      /network|fetch|Failed to fetch|timed out|temporar|reconnect/i.test(
        error.message,
      )
    ) {
      return true;
    }
    return false;
  }

  async function retryWithBackoff(operation, options = {}) {
    const maxRetries = Number(
      options.maxRetries ?? DEFAULT_POOL_CONFIG.maxRetries,
    );
    let attempt = 0;

    while (true) {
      try {
        return await operation(attempt);
      } catch (error) {
        if (attempt >= maxRetries || !isRetryableError(error)) {
          throw error;
        }
        const delay = calculateRetryDelay(
          attempt,
          Number(
            options.baseRetryDelayMs ?? DEFAULT_POOL_CONFIG.baseRetryDelayMs,
          ),
          Number(
            options.maxRetryDelayMs ?? DEFAULT_POOL_CONFIG.maxRetryDelayMs,
          ),
        );
        await new Promise((resolve) => lifecycle.setTimeout(resolve, delay));
        attempt += 1;
      }
    }
  }

  function createConnectionPool(config = {}) {
    const settings = {
      ...DEFAULT_POOL_CONFIG,
      ...config,
    };
    const queue = [];
    let activeConnections = 0;
    let keepAliveTimer = null;
    let healthCheckTimer = null;
    let reconnectTimer = null;
    let reconnecting = false;
    let lastActivityAt = Date.now();
    let lastSuccessfulResponseAt = Date.now();

    function scheduleIdleKeepAlive() {
      if (!settings.keepAlive) {
        if (keepAliveTimer) {
          lifecycle.clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        return;
      }

      if (keepAliveTimer) return;
      keepAliveTimer = lifecycle.setInterval(() => {
        const idleMs = Date.now() - lastActivityAt;
        if (idleMs >= settings.idleTimeoutMs && activeConnections === 0) {
          lastActivityAt = Date.now();
          lastSuccessfulResponseAt = Date.now();
        }
      }, settings.keepAliveIntervalMs);
    }

    function scheduleHealthCheck() {
      if (healthCheckTimer) return;
      healthCheckTimer = lifecycle.setInterval(async () => {
        if (reconnecting || activeConnections > 0) return;
        const idleMs = Date.now() - lastSuccessfulResponseAt;
        if (idleMs < settings.healthCheckIntervalMs) return;

        try {
          const databaseUrl = getDatabaseUrl();
          if (!databaseUrl) return;
          const url = new URL(
            databaseUrl,
            globalScope.location?.href || undefined,
          );
          await fetchWithTimeout(
            url.toString(),
            {
              method: "GET",
              headers: { Accept: "application/json" },
              redirect: "follow",
              cache: "no-store",
              keepalive: true,
            },
            settings.healthCheckTimeoutMs,
          );
          lastSuccessfulResponseAt = Date.now();
          lastActivityAt = Date.now();
        } catch (error) {
          networkLogger.warn("Connection pool health check failed.", error);
          if (settings.autoReconnect) {
            await reconnect();
          }
        }
      }, settings.healthCheckIntervalMs);
    }

    function reconnect() {
      if (reconnecting) return Promise.resolve();
      reconnecting = true;
      activeConnections = 0;
      queue.length = 0;
      if (keepAliveTimer) {
        lifecycle.clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      return new Promise((resolve) => {
        reconnectTimer = lifecycle.setTimeout(() => {
          reconnectTimer = null;
          reconnecting = false;
          lastActivityAt = Date.now();
          lastSuccessfulResponseAt = Date.now();
          scheduleIdleKeepAlive();
          scheduleHealthCheck();
          resolve();
        }, settings.reconnectDelayMs);
      });
    }

    function releaseConnection() {
      activeConnections = Math.max(0, activeConnections - 1);
      lastActivityAt = Date.now();
      lastSuccessfulResponseAt = Date.now();
      scheduleIdleKeepAlive();
      scheduleHealthCheck();
      const next = queue.shift();
      if (next) {
        next();
      }
    }

    async function request(operation, requestOptions = {}) {
      const attemptLimit = Number(
        requestOptions.maxRetries ?? settings.maxRetries,
      );
      const baseDelay = Number(
        requestOptions.baseRetryDelayMs ?? settings.baseRetryDelayMs,
      );
      const maxDelay = Number(
        requestOptions.maxRetryDelayMs ?? settings.maxRetryDelayMs,
      );

      if (reconnecting) {
        await new Promise((resolve) =>
          lifecycle.setTimeout(resolve, settings.reconnectDelayMs),
        );
      }

      if (activeConnections >= settings.maxConnections) {
        await new Promise((resolve) => {
          queue.push(resolve);
        });
      }

      activeConnections += 1;
      lastActivityAt = Date.now();
      scheduleIdleKeepAlive();
      scheduleHealthCheck();

      try {
        return await retryWithBackoff(operation, {
          maxRetries: attemptLimit,
          baseRetryDelayMs: baseDelay,
          maxRetryDelayMs: maxDelay,
        });
      } catch (error) {
        if (settings.autoReconnect && isRetryableError(error)) {
          await reconnect();
        }
        throw error;
      } finally {
        releaseConnection();
      }
    }

    scheduleIdleKeepAlive();
    scheduleHealthCheck();

    return {
      settings,
      request,
      reconnect,
      getState: () => ({
        activeConnections,
        reconnecting,
        queueLength: queue.length,
        lastActivityAt,
        lastSuccessfulResponseAt,
      }),
      destroy: () => {
        if (keepAliveTimer) {
          lifecycle.clearInterval(keepAliveTimer);
          keepAliveTimer = null;
        }
        if (healthCheckTimer) {
          lifecycle.clearInterval(healthCheckTimer);
          healthCheckTimer = null;
        }
        if (reconnectTimer) {
          lifecycle.clearTimeout(reconnectTimer);
          reconnectTimer = null;
        }
      },
    };
  }

  const defaultConnectionPool = createConnectionPool();

  function getDatabaseUrl() {
    if (cachedDatabaseUrl) return cachedDatabaseUrl;
    const configuredUrl = globalScope.MRH_CONFIG?.databaseUrl;
    if (typeof configuredUrl === "string" && configuredUrl.trim()) {
      cachedDatabaseUrl = configuredUrl.trim();
      return cachedDatabaseUrl;
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

  const REQUEST_SCHEMAS = Object.freeze({
    get_deck: {
      required: ["subject"],
      allowed: ["type", "subject", "password", "page", "limit"],
    },
    verify_folder_access: {
      required: ["subject", "password"],
      allowed: ["type", "subject", "password"],
    },
    verify_access: {
      required: ["subject", "password"],
      allowed: ["type", "subject", "password"],
    },
    submit_report: {
      required: ["questionId", "subject", "errorType"],
      allowed: [
        "type",
        "questionId",
        "subject",
        "questionText",
        "errorType",
        "lesson",
        "comments",
        "choices",
        "correctAnswer",
      ],
    },
    get_reports: {
      required: [],
      allowed: ["type", "role", "page", "limit"],
    },
    get_cache_version: { required: [], allowed: ["type"] },
    get_sync_status: { required: [], allowed: ["type"] },
  });

  const STRING_FIELD_LIMITS = Object.freeze({
    type: 64,
    subject: 500,
    password: 500,
    questionId: 200,
    questionText: 10000,
    errorType: 200,
    lesson: 500,
    comments: 10000,
    correctAnswer: 200,
    role: 64,
  });
  const MAX_BACKEND_PAYLOAD_BYTES = 500000;

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function validateRequestValue(value, key, depth = 0) {
    if (depth > 4) throw new Error("Backend payload is too deeply nested.");
    if (value === null || value === undefined) return;

    if (typeof value === "string") {
      const limit = STRING_FIELD_LIMITS[key] ?? 2000;
      if (value.length > limit) {
        throw new Error(`Backend field '${key}' exceeds its size limit.`);
      }
      return;
    }

    if (typeof value === "number") {
      if (!Number.isFinite(value))
        throw new Error(`Backend field '${key}' must be finite.`);
      return;
    }

    if (typeof value === "boolean") return;
    if (Array.isArray(value)) {
      if (value.length > 1000)
        throw new Error(`Backend field '${key}' has too many items.`);
      value.forEach((item) => validateRequestValue(item, key, depth + 1));
      return;
    }

    if (isRecord(value)) {
      const keys = Object.keys(value);
      if (keys.length > 50)
        throw new Error(`Backend field '${key}' has too many properties.`);
      keys.forEach((childKey) =>
        validateRequestValue(value[childKey], childKey, depth + 1),
      );
      return;
    }

    throw new Error(`Backend field '${key}' has an unsupported value.`);
  }

  function validateBackendPayload(payload) {
    if (!isRecord(payload)) {
      throw new Error("Backend payload must be an object.");
    }

    const type = String(payload.type || "").trim();
    const schema = REQUEST_SCHEMAS[type];
    if (!schema) throw new Error("Unsupported backend request type.");

    const allowed = new Set(schema.allowed);
    Object.keys(payload).forEach((key) => {
      if (!allowed.has(key)) {
        throw new Error(`Unexpected backend field '${key}'.`);
      }
      validateRequestValue(payload[key], key);
    });

    schema.required.forEach((key) => {
      const value = payload[key];
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(`Backend field '${key}' is required.`);
      }
    });

    if (
      payload.page !== undefined &&
      (!Number.isInteger(payload.page) || payload.page < 1)
    ) {
      throw new Error("Backend field 'page' must be a positive integer.");
    }
    if (
      payload.limit !== undefined &&
      (!Number.isInteger(payload.limit) ||
        payload.limit < 1 ||
        payload.limit > 1000)
    ) {
      throw new Error(
        "Backend field 'limit' must be an integer from 1 to 1000.",
      );
    }
    if (payload.choices !== undefined) {
      if (!isRecord(payload.choices))
        throw new Error("Backend field 'choices' must be an object.");
      Object.keys(payload.choices).forEach((key) => {
        if (
          !/^[ABCD]$/.test(key) ||
          (payload.choices[key] !== null &&
            payload.choices[key] !== undefined &&
            typeof payload.choices[key] !== "string")
        ) {
          throw new Error(
            "Backend choices must contain only A-D string values.",
          );
        }
      });
    }

    const serialized = JSON.stringify(payload);
    if (serialized.length > MAX_BACKEND_PAYLOAD_BYTES) {
      throw new Error("Backend payload exceeds the maximum size.");
    }
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
    const timer = lifecycle.setTimeout(() => {
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
      lifecycle.clearTimeout(timer);
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
  /**
   * @param {Record<string, unknown>} payload
   * @param {{signal?: AbortSignal, timeoutMs?: number, maxRetries?: number}} [options]
   * @returns {Promise<Record<string, unknown>>}
   */
  async function callBackend(payload, options = {}) {
    const url = getDatabaseUrl();
    if (!url) throw new Error("Database URL is not configured.");
    validateBackendPayload(payload);

    return defaultConnectionPool.request(
      async () => {
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
            cache: "reload",
            keepalive: true,
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
      },
      {
        maxRetries: Number(
          options.maxRetries ?? DEFAULT_POOL_CONFIG.maxRetries,
        ),
        baseRetryDelayMs: Number(
          options.baseRetryDelayMs ?? DEFAULT_POOL_CONFIG.baseRetryDelayMs,
        ),
        maxRetryDelayMs: Number(
          options.maxRetryDelayMs ?? DEFAULT_POOL_CONFIG.maxRetryDelayMs,
        ),
      },
    );
  }

  let deckSummaryInFlight = null;

  /**
   * @param {{signal?: AbortSignal, timeoutMs?: number}} [options]
   * @returns {Promise<unknown>}
   */
  async function getDeckSummary(options = {}) {
    if (!options.signal && deckSummaryInFlight) {
      return deckSummaryInFlight;
    }

    const request = defaultConnectionPool.request(
      async () => {
        const databaseUrl = getDatabaseUrl();
        if (!databaseUrl) throw new Error("Database URL is not configured.");
        const url = new URL(
          databaseUrl,
          globalScope.location?.href || undefined,
        );

        const appVersion =
          typeof globalThis.__MRH_APP__?.version === "string"
            ? globalThis.__MRH_APP__.version.trim()
            : "";
        if (appVersion) {
          url.searchParams.set("v", appVersion);
        }

        const response = await fetchWithTimeout(
          url.toString(),
          {
            method: "GET",
            headers: { Accept: "application/json", ...(options.headers || {}) },
            redirect: "follow",
            cache: "no-cache",
            keepalive: true,
            signal: options.signal,
          },
          Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000,
        );
        const result = await parseJsonResponse(response);
        const backendError = getBackendError(result, response);
        if (backendError) throw backendError;
        return result;
      },
      {
        maxRetries: Number(
          options.maxRetries ?? DEFAULT_POOL_CONFIG.maxRetries,
        ),
        baseRetryDelayMs: Number(
          options.baseRetryDelayMs ?? DEFAULT_POOL_CONFIG.baseRetryDelayMs,
        ),
        maxRetryDelayMs: Number(
          options.maxRetryDelayMs ?? DEFAULT_POOL_CONFIG.maxRetryDelayMs,
        ),
      },
    );

    if (!options.signal) {
      deckSummaryInFlight = request.finally(() => {
        deckSummaryInFlight = null;
      });
      return deckSummaryInFlight;
    }

    return request;
  }

  async function getDeck(subject, password = "", options = {}) {
    const normalizedSubject = String(subject || "").trim();
    const hasPassword = String(password || "").trim().length > 0;
    const useDirectGet =
      !hasPassword &&
      options.page === undefined &&
      options.limit === undefined &&
      !options.forcePost;

    if (useDirectGet) {
      const databaseUrl = getDatabaseUrl();
      if (!databaseUrl) {
        return callBackend(
          {
            type: "get_deck",
            subject: normalizedSubject,
            password: "",
          },
          options,
        );
      }

      const url = new URL(databaseUrl, globalScope.location?.href || undefined);
      url.searchParams.set("subject", normalizedSubject);

      const appVersion =
        typeof globalThis.__MRH_APP__?.version === "string"
          ? globalThis.__MRH_APP__.version.trim()
          : "";
      if (appVersion) {
        url.searchParams.set("v", appVersion);
      }

      try {
        const response = await fetchWithTimeout(
          url.toString(),
          {
            method: "GET",
            headers: { Accept: "application/json" },
            redirect: "follow",
            cache: "no-cache",
            keepalive: true,
            signal: options.signal,
          },
          Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000,
        );
        const result = await parseJsonResponse(response);
        const backendError = getBackendError(result, response);
        if (backendError) throw backendError;
        return result;
      } catch (error) {
        if (options.allowFallback !== false) {
          return callBackend(
            {
              type: "get_deck",
              subject: normalizedSubject,
              password: "",
            },
            options,
          );
        }
        throw error;
      }
    }

    return callBackend(
      {
        type: "get_deck",
        subject: normalizedSubject,
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
          ...(options.role !== undefined ? { role: options.role } : {}),
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
    calculateRetryDelay,
    retryWithBackoff,
    createConnectionPool,
    reconnect: () => defaultConnectionPool.reconnect(),
    getConnectionPoolState: () => defaultConnectionPool.getState(),
    destroy: () => defaultConnectionPool.destroy(),
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
