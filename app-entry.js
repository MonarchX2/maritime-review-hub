(async function () {
  "use strict";

  const APP_VERSION = "mrh-release-2026.08.30";
  const rootScope = typeof window !== "undefined" ? window : globalThis;

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

  /*
   * Feature script loader
   * ---------------------
   * Keep one promise per URL so concurrent callers cannot inject the same
   * script more than once. A loaded Set alone is not sufficient because it is
   * updated only after the script's load event fires.
   */
  const loadedFeatures = new Set();
  const loadingFeatures = new Map();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") {
        reject(new Error(`Cannot load ${src}: document is unavailable.`));
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.async = false;

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

  async function loadCoreHelpers() {
    // Stage 1: bootstrap helpers.
    const cores = [
      "storage-utils.js",
      "text-utils.js",
      "debug-utils.js",
      "app-core-state.js",
    ];

    for (const file of cores) {
      await loadFeatureScript(file);
    }
  }

  async function loadApplicationRuntime() {
    // Stage 2: app runtime.
    await loadFeatureScript("app-core.js");
    await loadFeatureScript("app-core-network.js");

    // Stage 3: feature modules.
    await loadFeatureScript("session-core.js");
    await loadFeatureScript("analytics-core.js");
    await loadFeatureScript("ui-modal-core.js");
    await loadFeatureScript("deck-nav-core.js");
    await loadFeatureScript("deck-review-core.js");
    await loadFeatureScript("quiz-rendering-core.js");
  }

  function showBootstrapError(error) {
    console.error("App bootstrap failed:", error);

    const status =
      typeof document !== "undefined"
        ? document.getElementById("connection-status")
        : null;

    if (!status) return;

    status.textContent = "Unable to start the app. Please reload the page.";
    status.classList.remove("hidden");
    status.setAttribute("role", "alert");
  }

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

    navigator.serviceWorker
      .register(swUrl.href, {
        scope: "./",
        updateViaCache: "none",
      })
      .catch((error) => {
        console.warn("Service worker registration failed:", error);
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

  async function waitForRuntimeDependencies(timeoutMs = 15000) {
    const startTime = Date.now();
    let lastMissing = [];

    while (Date.now() - startTime < timeoutMs) {
      const missing = missingRuntimeDependencies();
      if (missing.length === 0) {
        rootScope.__mrhRuntimeReady = true;
        return;
      }

      lastMissing = missing;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    rootScope.__mrhRuntimeReady = false;
    throw new Error(
      `Startup dependencies were not ready in time: ${lastMissing.join(", ")}`,
    );
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
        await loadCoreHelpers();
        await loadApplicationRuntime();
        await waitForRuntimeDependencies();

        if (typeof rootScope.initializeApp === "function") {
          rootScope.initializeApp();
        }

        bootstrap.status = "ready";
        rootScope.__mrhBootstrapComplete = true;
        registerServiceWorker();
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
