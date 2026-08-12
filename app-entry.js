(async function () {
  // Ensure the app starts after DOM is ready and required helpers are loaded.
  const loadedFeatures = new Set();

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
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

  function loadCoreHelpers() {
    return Promise.all([
      loadFeatureScript("storage-utils.js"),
      loadFeatureScript("text-utils.js"),
      loadFeatureScript("network-utils.js"),
      loadFeatureScript("session-utils.js"),
    ]);
  }

  try {
    await loadCoreHelpers();
    await loadScript("app-core.js");
  } catch (error) {
    console.error("App bootstrap failed:", error);
    const status = document.getElementById("connection-status");
    if (status) {
      status.textContent = "Unable to start the app. Please reload the page.";
      status.classList.remove("hidden");
    }
  }
})();
