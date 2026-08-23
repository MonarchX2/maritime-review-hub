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
    // The canonical runtime below depends on these shared helpers and the
    // state module must run before app-core.js evaluates its legacy code.
    const cores = [
      "storage-utils.js",
      "text-utils.js",
      "debug-utils.js",
      "app-core-state.js",
    ];

    for (const src of cores) {
      await loadFeatureScript(src);
    }
  }

  async function loadApplicationRuntime() {
    await loadFeatureScript("app-core.js");
    await loadFeatureScript("app-core-network.js");
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
    await loadApplicationRuntime();

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
