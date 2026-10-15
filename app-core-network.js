(function (globalScope) {
  "use strict";

  const DEFAULT_TIMEOUT_MS = 15000;
  const LEGACY_APP_PATH = "/maritime-review-hub/";
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
  let latestBackendCacheVersion = "";
  let backendPurgePromise = null;

  async function purgeAppOwnedData() {
    if (backendPurgePromise) return backendPurgePromise;

    backendPurgePromise = (async () => {
      const basePath =
        typeof globalScope.__MRH_APP_BASE_PATH === "string"
          ? globalScope.__MRH_APP_BASE_PATH
          : "/";
      const currentPath = basePath.endsWith("/")
        ? basePath
        : `${basePath}/`;
      const legacyPath = LEGACY_APP_PATH;
      const isAppPath = (pathname) =>
        pathname === currentPath.slice(0, -1) ||
        pathname.startsWith(currentPath) ||
        pathname === legacyPath.slice(0, -1) ||
        pathname.startsWith(legacyPath);
      const operations = [];
      const logger = globalScope.DebugUtils || console;

      if (typeof globalScope.StorageUtils?.clearAllAppNamespaces === "function") {
        operations.push(() =>
          globalScope.StorageUtils.clearAllAppNamespaces(),
        );
      } else {
        operations.push(() => {
          throw new Error("App storage cleanup is unavailable.");
        });
      }

      if (typeof globalScope.indexedDB?.deleteDatabase === "function") {
        operations.push(
          () =>
            new Promise((resolve, reject) => {
              const request = globalScope.indexedDB.deleteDatabase("mrh_db");
              request.onsuccess = () => resolve();
              request.onerror = () =>
                reject(request.error || new Error("Unable to delete app database."));
              request.onblocked = () =>
                reject(new Error("App database deletion is blocked by another tab."));
            }),
        );
      }

      if (
        typeof globalScope.caches?.keys === "function" &&
        typeof globalScope.caches?.delete === "function"
      ) {
        operations.push(async () => {
          const names = await globalScope.caches.keys();
          const appCaches = names.filter((name) => name.startsWith("mrh-cache-"));
          const results = await Promise.all(
            appCaches.map((name) => globalScope.caches.delete(name)),
          );
          if (results.some((deleted) => !deleted)) {
            throw new Error("Unable to delete one or more app caches.");
          }
        });
      }

      if (
        typeof globalScope.navigator?.serviceWorker?.getRegistrations ===
        "function"
      ) {
        operations.push(async () => {
          const registrations =
            await globalScope.navigator.serviceWorker.getRegistrations();
          const ownedRegistrations = registrations.filter((registration) => {
            const scopeUrl = new URL(registration.scope);
            return (
              scopeUrl.origin === globalScope.location?.origin &&
              isAppPath(scopeUrl.pathname)
            );
          });
          const results = await Promise.allSettled(
            ownedRegistrations.map((registration) => registration.unregister()),
          );
          if (
            results.some(
              (result) =>
                result.status === "rejected" ||
                (result.status === "fulfilled" && !result.value),
            )
          ) {
            throw new Error("Unable to unregister one or more app workers.");
          }
        });
      }

      const results = await Promise.allSettled(
        operations.map((operation) => Promise.resolve().then(operation)),
      );
      const failed = results.filter((result) => result.status === "rejected");
      failed.forEach((result) =>
        logger.error?.(
          "Unable to completely purge app-owned browser data:",
          result.reason,
        ),
      );

      if (typeof globalScope.location?.replace === "function") {
        const terminalUrl = new URL(
          "client-update-required.html",
          new URL(currentPath, globalScope.location.origin),
        );
        terminalUrl.searchParams.set(
          "cleanup",
          failed.length === 0 ? "complete" : "incomplete",
        );
        globalScope.location.replace(terminalUrl.href);
      }

      if (failed.length > 0) {
        throw new Error(
          "The server required outdated app data to be removed, but some app storage could not be cleared.",
        );
      }
    })();

    return backendPurgePromise;
  }

  async function processBackendError(error) {
    if (!error) return;
    if (error.payload?.purgeClientData === true) {
      await purgeAppOwnedData();
    }
    throw error;
  }

  function rememberBackendCacheVersion(response) {
    const version = String(
      response?.cacheVersion ?? response?.version ?? "",
    ).trim();
    if (version) latestBackendCacheVersion = version;
    return response;
  }

  async function getPayloadFingerprint(payload) {
    const cryptoApi = globalScope.crypto || globalThis.crypto;
    const Encoder =
      globalScope.TextEncoder ||
      (typeof TextEncoder !== "undefined" ? TextEncoder : null);
    if (!cryptoApi?.subtle || !Encoder) {
      throw new Error("Secure payload fingerprint verification is unavailable.");
    }
    const bytes = new Encoder().encode(JSON.stringify(payload));
    const digest = await cryptoApi.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  }

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
    if (error.isBackendError) {
      return (
        status === 408 ||
        status === 429 ||
        status >= 500 ||
        ["NOT_READY", "SERVER_ERROR", "TEMPORARY_UNAVAILABLE"].includes(
          String(error.code || "").toUpperCase(),
        )
      );
    }
    if (status === 408 || status === 429 || status >= 500) return true;
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
    let reconnectPromise = null;
    let resolveReconnect = null;
    let poolDestroyed = false;
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
          const response = await fetchWithTimeout(
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
          if (!response.ok) {
            throw new Error(
              `Connection pool health check failed with HTTP ${response.status}.`,
            );
          }
          lastSuccessfulResponseAt = Date.now();
          lastActivityAt = Date.now();
        } catch (error) {
          networkLogger.warn("Connection pool health check failed.", error);
          if (settings.autoReconnect && !poolDestroyed) {
            await reconnect();
          }
        }
      }, settings.healthCheckIntervalMs);
    }

    function reconnect() {
      if (poolDestroyed) {
        return Promise.reject(new Error("Connection pool has been destroyed."));
      }
      if (reconnecting) return reconnectPromise || Promise.resolve();
      reconnecting = true;
      const reconnectError = new Error(
        "Connection pool reconnected while request was queued.",
      );
      reconnectError.name = "ReconnectError";
      queue.splice(0).forEach(({ reject }) => reject(reconnectError));
      if (keepAliveTimer) {
        lifecycle.clearInterval(keepAliveTimer);
        keepAliveTimer = null;
      }
      reconnectPromise = new Promise((resolve) => {
        resolveReconnect = resolve;
        reconnectTimer = lifecycle.setTimeout(() => {
          reconnectTimer = null;
          reconnecting = false;
          lastActivityAt = Date.now();
          lastSuccessfulResponseAt = Date.now();
          resolveReconnect = null;
          if (!poolDestroyed) {
            scheduleIdleKeepAlive();
            scheduleHealthCheck();
          }
          reconnectPromise = null;
          resolve();
        }, settings.reconnectDelayMs);
      });
      return reconnectPromise;
    }

    function releaseConnection() {
      lastActivityAt = Date.now();
      lastSuccessfulResponseAt = Date.now();
      const next = queue.shift();
      if (next) {
        next.resolve();
      } else {
        activeConnections = Math.max(0, activeConnections - 1);
      }
      if (!poolDestroyed) {
        scheduleIdleKeepAlive();
        scheduleHealthCheck();
      }
    }

    function acquireConnection() {
      if (poolDestroyed) {
        return Promise.reject(new Error("Connection pool has been destroyed."));
      }
      if (activeConnections < settings.maxConnections && queue.length === 0) {
        activeConnections += 1;
        return Promise.resolve();
      }

      return new Promise((resolve, reject) => {
        queue.push({ resolve, reject });
      });
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

      let acquired = false;
      try {
        await acquireConnection();
        acquired = true;
        if (reconnecting) await reconnectPromise;
        if (poolDestroyed) {
          throw new Error("Connection pool has been destroyed.");
        }
        lastActivityAt = Date.now();
        scheduleIdleKeepAlive();
        scheduleHealthCheck();
        return await retryWithBackoff(operation, {
          maxRetries: attemptLimit,
          baseRetryDelayMs: baseDelay,
          maxRetryDelayMs: maxDelay,
        });
      } catch (error) {
        if (
          !poolDestroyed &&
          settings.autoReconnect &&
          isRetryableError(error)
        ) {
          await reconnect();
        }
        throw error;
      } finally {
        if (acquired) releaseConnection();
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
        if (poolDestroyed) return;
        poolDestroyed = true;
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
        if (reconnecting) {
          reconnecting = false;
          reconnectPromise = null;
          resolveReconnect?.();
          resolveReconnect = null;
        }
        const destroyedError = new Error("Connection pool has been destroyed.");
        queue.splice(0).forEach(({ reject }) => reject(destroyedError));
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
      allowed: ["type", "subject", "password", "page", "limit", "appVersion"],
    },
    verify_folder_access: {
      required: ["subject", "password"],
      allowed: ["type", "subject", "password", "appVersion"],
    },
    verify_access: {
      required: ["subject", "password"],
      allowed: ["type", "subject", "password", "appVersion"],
    },
    get_cache_version: { required: [], allowed: ["type", "appVersion"] },
    get_sync_status: { required: [], allowed: ["type", "appVersion"] },
    list_public_resources: {
      required: [],
      allowed: ["type", "folderId", "appVersion"],
    },
    get_resource_preview: {
      required: ["fileId"],
      allowed: ["type", "fileId", "appVersion"],
    },
    get_resource_dashboard: {
      required: [],
      allowed: ["type", "appVersion"],
    },
  });

  const STRING_FIELD_LIMITS = Object.freeze({
    type: 64,
    subject: 500,
    password: 500,
    folderId: 200,
    fileId: 200,
    appVersion: 128,
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
          !/^[ABCDE]$/.test(key) ||
          (payload.choices[key] !== null &&
            payload.choices[key] !== undefined &&
            typeof payload.choices[key] !== "string")
        ) {
          throw new Error(
            "Backend choices must contain only A-E string values.",
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
        (typeof result.error === "string" && result.error.trim() !== "") ||
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
    error.status = statusCode || (response.ok ? 0 : response.status);
    error.code = result?.code || "HTTP_ERROR";
    error.payload = result;
    error.isBackendError = true;
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
    const appVersion = String(globalScope.__MRH_APP__?.version || "").trim();
    if (!appVersion) throw new Error("Client app version is unavailable.");
    const versionedPayload = { ...payload, appVersion };
    validateBackendPayload(versionedPayload);

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
            body: JSON.stringify(versionedPayload),
            redirect: "follow",
            cache: "no-store",
            keepalive: true,
            signal: options.signal,
          },
          Number(options.timeoutMs) > 0
            ? Number(options.timeoutMs)
            : DEFAULT_TIMEOUT_MS,
        );

        const result = await parseJsonResponse(response);
        const backendError = getBackendError(result, response);
        if (backendError) await processBackendError(backendError);
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
        if (latestBackendCacheVersion) {
          url.searchParams.set("cv", latestBackendCacheVersion);
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
        if (backendError) await processBackendError(backendError);
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
      const trackedRequest = request.finally(() => {
        if (deckSummaryInFlight === trackedRequest) {
          deckSummaryInFlight = null;
        }
      });
      deckSummaryInFlight = trackedRequest;
      return trackedRequest;
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
      if (latestBackendCacheVersion) {
        url.searchParams.set("cv", latestBackendCacheVersion);
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
        if (backendError) await processBackendError(backendError);
        return result;
      } catch (error) {
        if (options.allowFallback !== false && !error?.isBackendError) {
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
    async getCacheVersion(options = {}) {
      return rememberBackendCacheVersion(
        await callBackend({ type: "get_cache_version" }, options),
      );
    },
    async getSyncStatus(options = {}) {
      return rememberBackendCacheVersion(
        await callBackend({ type: "get_sync_status" }, options),
      );
    },
  };

  const AppNetwork = {
    callBackend,
    getDeckSummary,
    getDeck,
    getPayloadFingerprint,
    calculateRetryDelay,
    isRetryableError,
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
