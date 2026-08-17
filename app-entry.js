(async function () {
  const rootScope = typeof window !== "undefined" ? window : globalThis;
  if (typeof rootScope !== "undefined") {
    rootScope.globalScope = rootScope;
    if (typeof globalThis !== "undefined") globalThis.globalScope = rootScope;
  }

  // Ensure the app starts after DOM is ready and required helpers are loaded.
  const loadedFeatures = new Set();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = false;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
  }

  window.loadFeatureScript = async function (src) {
    if (loadedFeatures.has(src)) return;
    await loadScript(src);
    loadedFeatures.add(src);
  };

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

    for (const src of cores) {
      await loadFeatureScript(src);
    }
  }

  try {
    await loadCoreHelpers();
    await loadScript("app-core.js");
    await Promise.all([
      loadFeatureScript("state-core.js"),
      loadFeatureScript("ui-core.js"),
      loadFeatureScript("session-core.js"),
      loadFeatureScript("ui-modal-core.js"),
      loadFeatureScript("deck-nav-core.js"),
      loadFeatureScript("deck-review-core.js"),
      loadFeatureScript("analytics-core.js"),
    ]);
  } catch (error) {
    console.error("App bootstrap failed:", error);
    const status = document.getElementById("connection-status");
    if (status) {
      status.textContent = "Unable to start the app. Please reload the page.";
      status.classList.remove("hidden");
    }
  }
})();
