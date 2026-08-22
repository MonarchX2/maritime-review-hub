(async function () {
  "use strict";

  const rootScope = typeof window !== "undefined" ? window : globalThis;

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

  async function loadCoreHelpers() {
    const cores = [
      "storage-utils.js",
      "text-utils.js",
      "network-utils.js",
      "session-utils.js",
      "debug-utils.js",
      "app-core-state.js",
      "app-core-network.js",
    ];

    /*
     * These helpers are intentionally loaded in order. They are global
     * scripts, so sequential loading guarantees that a later helper sees
     * everything established by an earlier helper.
     */
    for (const src of cores) {
      await loadFeatureScript(src);
    }
  }

  async function loadApplicationCores() {
    const applicationCores = [
      "state-core.js",
      "ui-core.js",
      "session-core.js",
      "ui-modal-core.js",
      "deck-nav-core.js",
      "deck-review-core.js",
      "analytics-core.js",
      "quiz-rendering-core.js",
    ];

    /*
     * Do not Promise.all() these global scripts. Their implementations may
     * depend on functions/constants registered by an earlier core. Sequential
     * loading eliminates nondeterministic initialization races while keeping
     * the same public script order.
     */
    for (const src of applicationCores) {
      await loadFeatureScript(src);
    }
  }

  function showBootstrapError(error) {
    console.error("App bootstrap failed:", error);

    const status =
      typeof document !== "undefined"
        ? document.getElementById("connection-status")
        : null;

    if (!status) return;

    status.textContent =
      "Unable to start the app. Please reload the page.";
    status.classList.remove("hidden");
    status.setAttribute("role", "alert");
  }

  try {
    await loadCoreHelpers();
    await loadScript("app-core.js");
    await loadApplicationCores();

    // Dynamic scripts do not participate reliably in the original
    // DOMContentLoaded listener in app-core.js. Explicitly initialize once
    // every runtime module is present.
    if (typeof rootScope.initializeApp === "function") {
      rootScope.initializeApp();
    }
  } catch (error) {
    showBootstrapError(error);
  }
})();
