(async function () {
  "use strict";

  const APP_VERSION = "mrh-release-2026.09.03";
  const rootScope = typeof window !== "undefined" ? window : globalThis;
  const bootstrapLogger = () => rootScope.DebugUtils || console;

  rootScope.__MRH_APP__ = rootScope.__MRH_APP__ || {
    version: APP_VERSION,
  };

  if (rootScope.__MRH_APP__.version !== APP_VERSION) {
    rootScope.__MRH_APP__.version = APP_VERSION;
  }

  if (rootScope) {
    rootScope.globalScope = rootScope;
    if (typeof globalThis !== "undefined") {
      globalThis.globalScope = rootScope;
    }
  }

  const loadedFeatures = new Set();
  const loadingFeatures = new Map();
  const BOOTSTRAP_SCRIPTS = [
    "app-config.js",
    "storage-utils.js",
    "text-utils.js",
    "debug-utils.js",
    "lifecycle-utils.js",
    "app-core-state.js",
  ];
  const APPLICATION_RUNTIME_SCRIPTS = [
    "app-core.js",
    "app-core-network.js",
    "sync-core.js",
  ];
  const FEATURE_SCRIPTS = [
    "session-core.js",
    "analytics-core.js",
    "ui-modal-core.js",
    "deck-nav-core.js",
    "deck-review-core.js",
    "quiz-rendering-core.js",
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") {
        reject(new Error(`Cannot load ${src}: document is unavailable.`));
        return;
      }

      const versionedSrc = (() => {
        const raw = String(src || "").trim();
        if (!raw) return raw;
        try {
          const url = new URL(raw, window.location.href);
          url.searchParams.set("v", APP_VERSION);
          return url.href;
        } catch (error) {
          return raw.includes("?")
            ? `${raw}&v=${APP_VERSION}`
            : `${raw}?v=${APP_VERSION}`;
        }
      })();

      const script = document.createElement("script");
      script.src = versionedSrc;
      script.async = false;
      script.defer = false;

      script.onload = () => resolve();
      script.onerror = () => {
        reject(new Error(`Failed to load ${src}`));
      };

      document.head.appendChild(script);
    });
  }

  function loadFeatureScript(src) {
    if (!src || typeof src !== "string") {
      return Promise.reject(
        new TypeError("Feature script path must be a non-empty string."),
      );
    }

    if (loadedFeatures.has(src)) {
      return Promise.resolve();
    }

    const existingPromise = loadingFeatures.get(src);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = loadScript(src)
      .then(() => {
        loadedFeatures.add(src);
      })
      .finally(() => {
        loadingFeatures.delete(src);
      });

    loadingFeatures.set(src, promise);
    return promise;
  }

  rootScope.loadFeatureScript = loadFeatureScript;

  rootScope.__MRH_BOOTSTRAP__ = {
    status: "idle",
    ready: null,
    error: null,
  };

  async function loadScriptsInParallel(files) {
    if (!Array.isArray(files) || files.length === 0) {
      return;
    }

    await Promise.all(files.map((file) => loadFeatureScript(file)));
  }

  async function loadCoreHelpers() {
    await loadScriptsInParallel(BOOTSTRAP_SCRIPTS);
  }

  function scheduleIdleFeatureLoad() {
    if (typeof rootScope.requestIdleCallback === "function") {
      rootScope.requestIdleCallback(
        () => {
          loadScriptsInParallel(FEATURE_SCRIPTS).catch((error) => {
            bootstrapLogger().warn(
              "Deferred feature script loading failed:",
              error,
            );
          });
        },
        { timeout: 2500 },
      );
      return;
    }

    (rootScope.LifecycleUtils || rootScope).setTimeout(() => {
      loadScriptsInParallel(FEATURE_SCRIPTS).catch((error) => {
        bootstrapLogger().warn(
          "Deferred feature script loading failed:",
          error,
        );
      });
    }, 100);
  }

  async function loadApplicationRuntime() {
    await loadScriptsInParallel(APPLICATION_RUNTIME_SCRIPTS);
    scheduleIdleFeatureLoad();
  }

  function showBootstrapError(error) {
    bootstrapLogger().error("App bootstrap failed:", error);

    const status =
      typeof document !== "undefined"
        ? document.getElementById("connection-status")
        : null;

    if (!status) return;

    status.textContent = "Unable to start the app. Please reload the page.";
    status.classList.remove("hidden");
    status.setAttribute("role", "alert");
  }

  rootScope.showBootstrapError = showBootstrapError;

  function registerServiceWorker() {
    if (
      typeof navigator === "undefined" ||
      !navigator.serviceWorker ||
      typeof navigator.serviceWorker.register !== "function"
    ) {
      return;
    }

    const swUrl = new URL("./sw.js", window.location.href);
    swUrl.searchParams.set("v", rootScope.__MRH_APP__?.version || APP_VERSION);

    const controllerUrl = navigator.serviceWorker.controller?.scriptURL || "";
    const controllerVersion = (() => {
      try {
        const controller = new URL(controllerUrl);
        return controller.searchParams.get("v") || "";
      } catch (error) {
        return "";
      }
    })();

    if (
      controllerUrl &&
      controllerVersion &&
      controllerVersion !== APP_VERSION
    ) {
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => {
          return Promise.all(
            registrations.map((registration) => registration.unregister()),
          );
        })
        .catch((error) => {
          bootstrapLogger().warn(
            "Service worker refresh cleanup failed:",
            error,
          );
        });
    }

    navigator.serviceWorker
      .register(swUrl.href, {
        scope: "./",
        updateViaCache: "none",
      })
      .then((registration) => registration.update())
      .catch((error) => {
        bootstrapLogger().warn("Service worker registration failed:", error);
      });
  }

  function missingRuntimeDependencies() {
    const missing = [];

    if (typeof rootScope.StorageUtils === "undefined") {
      missing.push("StorageUtils");
    }
    if (typeof rootScope.TextUtils === "undefined") {
      missing.push("TextUtils");
    }
    if (typeof rootScope.AppState === "undefined") {
      missing.push("AppState");
    }
    if (typeof rootScope.AppNetwork === "undefined") {
      missing.push("AppNetwork");
    }
    if (typeof rootScope.initializeApp !== "function") {
      missing.push("initializeApp");
    }

    return missing;
  }

  function waitForRuntimeDependencies() {
    const missing = missingRuntimeDependencies();
    if (missing.length) {
      rootScope.__mrhRuntimeReady = false;
      throw new Error(
        `Startup dependencies were not ready after script loading: ${missing.join(", ")}`,
      );
    }
    rootScope.__mrhRuntimeReady = true;
  }

  async function startApplicationBootstrap() {
    const bootstrap = rootScope.__MRH_BOOTSTRAP__ || {
      status: "idle",
      ready: null,
      error: null,
    };

    if (bootstrap.status === "loading" && bootstrap.ready) {
      return bootstrap.ready;
    }

    if (bootstrap.status === "ready" && bootstrap.ready) {
      return bootstrap.ready;
    }

    bootstrap.status = "loading";
    bootstrap.error = null;

    bootstrap.ready = (async function () {
      try {
        registerServiceWorker();
        await loadCoreHelpers();
        await loadApplicationRuntime();
        await waitForRuntimeDependencies();

        if (typeof rootScope.initializeApp === "function") {
          rootScope.initializeApp();
        }

        bootstrap.status = "ready";
        rootScope.__mrhBootstrapComplete = true;
        return true;
      } catch (error) {
        bootstrap.status = "failed";
        bootstrap.error = error;
        rootScope.__mrhBootstrapComplete = false;
        showBootstrapError(error);
        throw error;
      }
    })();

    return bootstrap.ready;
  }

  rootScope.startApplicationBootstrap = startApplicationBootstrap;
  rootScope.__MRH_BOOTSTRAP__.ready = startApplicationBootstrap();
})();
