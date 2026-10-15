(async function () {
  "use strict";

  const APP_VERSION = "mrh-release-26.10.15-8";
  const APP_DISPLAY_VERSION = "26.10.15-8";
  const UPDATE_QUERY_PARAMETER = "__mrh_update";
  const LEGACY_PAGES_BASE_PATH = "/maritime-review-hub/";
  const rootScope = typeof window !== "undefined" ? window : globalThis;
  const bootstrapLogger = () => rootScope.DebugUtils || console;
  let serviceWorkerRegistration = null;
  let serviceWorkerRegistrationPromise = null;
  let serviceWorkerRegistrationFailed = false;
  let appUpdateCheck = null;
  let pendingAppUpdateVersion = "";
  let pendingUpdateTimer = null;
  let updateApplyInFlight = false;
  let nextUpdateApplyAttemptAt = 0;
  const APP_UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const PENDING_UPDATE_RETRY_INTERVAL_MS = 15 * 1000;

  if (typeof window !== "undefined") {
    const scriptUrl =
      document.currentScript?.src ||
      navigator.serviceWorker?.controller?.scriptURL ||
      window.location.href;
    const scriptPath = new URL(".", scriptUrl).pathname;
    rootScope.__MRH_APP_BASE_PATH = scriptPath.endsWith("/")
      ? scriptPath
      : `${scriptPath}/`;

    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has(UPDATE_QUERY_PARAMETER)) {
      currentUrl.searchParams.delete(UPDATE_QUERY_PARAMETER);
      window.history.replaceState(
        window.history.state,
        "",
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );
    }
  }

  rootScope.__MRH_APP__ = rootScope.__MRH_APP__ || {
    version: APP_VERSION,
  };

  if (rootScope.__MRH_APP__.version !== APP_VERSION) {
    rootScope.__MRH_APP__.version = APP_VERSION;
  }

  const versionLabel = `Version ${APP_DISPLAY_VERSION}`;
  ["site-version", "about-version"].forEach((elementId) => {
    const element =
      typeof document !== "undefined"
        ? document.getElementById(elementId)
        : null;
    if (element) element.textContent = versionLabel;
  });

  if (rootScope) {
    rootScope.globalScope = rootScope;
    if (typeof globalThis !== "undefined") {
      globalThis.globalScope = rootScope;
    }
  }

  function getAppUpdateNotice() {
    return typeof document === "undefined"
      ? null
      : document.getElementById("app-update-notice");
  }

  function setAppUpdateNotice(message, showRetry = false) {
    const notice = getAppUpdateNotice();
    if (!notice) return;

    const messageElement = document.getElementById("app-update-message");
    const retryButton = document.getElementById("app-update-retry");
    if (messageElement) messageElement.textContent = message;
    if (retryButton) retryButton.hidden = !showRetry;
    notice.hidden = !message;
  }

  function getUpdateDeferralMessage() {
    if (rootScope.navigator?.onLine === false) {
      return "An update is ready. It will be applied when you are back online.";
    }
    if (document.visibilityState !== "visible") {
      return "An update is ready. It will be applied when you return to this tab.";
    }
    if (
      rootScope.state?.session?.active ||
      document.querySelector("#view-practice.active, #view-deck-review.active")
    ) {
      return "An update is ready. It will be applied after you finish your current session.";
    }

    const dashboard = document.getElementById("view-dashboard");
    if (!dashboard?.classList.contains("active")) {
      return "An update is ready. It will be applied when you return to the dashboard.";
    }
    if (document.querySelector('[role="dialog"][aria-hidden="false"]')) {
      return "An update is ready. It will be applied after you close the open dialog.";
    }
    return "";
  }

  function sendCurrentVersionToWorker(...workers) {
    new Set(workers.filter(Boolean)).forEach((worker) => {
      if (typeof worker.postMessage !== "function") return;
      try {
        worker.postMessage({
          type: "MRH_CLIENT_VERSION",
          version: APP_VERSION,
        });
      } catch (error) {
        bootstrapLogger().warn(
          "Unable to report the loaded app version to its service worker:",
          error,
        );
      }
    });
  }

  function sendClientVersionResponse(event) {
    const requestId = event.data?.requestId;
    if (typeof requestId !== "string" || !event.source?.postMessage) return;
    try {
      event.source.postMessage({
        type: "MRH_CLIENT_VERSION_RESPONSE",
        requestId,
        version: APP_VERSION,
      });
    } catch (error) {
      bootstrapLogger().warn("Unable to reply to the service worker:", error);
    }
  }

  function schedulePendingUpdateCheck() {
    if (pendingUpdateTimer || typeof window?.setInterval !== "function") return;
    pendingUpdateTimer = window.setInterval(() => {
      void applyPendingAppUpdate();
    }, PENDING_UPDATE_RETRY_INTERVAL_MS);
  }

  function markAppUpdateAvailable(version) {
    if (
      typeof version !== "string" ||
      !/^mrh-[A-Za-z0-9._-]+$/.test(version) ||
      version === APP_VERSION
    ) {
      return;
    }

    pendingAppUpdateVersion = version;
    schedulePendingUpdateCheck();
    void applyPendingAppUpdate();
  }

  async function applyPendingAppUpdate() {
    if (!pendingAppUpdateVersion || updateApplyInFlight) return;

    const deferralMessage = getUpdateDeferralMessage();
    if (deferralMessage) {
      setAppUpdateNotice(deferralMessage);
      return;
    }
    if (Date.now() < nextUpdateApplyAttemptAt) return;

    updateApplyInFlight = true;
    setAppUpdateNotice("A new version is ready. Saving your progress…");
    try {
      if (typeof rootScope.saveState !== "function") {
        throw new Error("App state persistence is unavailable.");
      }
      const saved = await rootScope.saveState();
      if (saved === false) {
        throw new Error("App state could not be saved before updating.");
      }
      const deferralAfterSave = getUpdateDeferralMessage();
      if (deferralAfterSave) {
        setAppUpdateNotice(deferralAfterSave);
        return;
      }

      sendCurrentVersionToWorker(
        rootScope.navigator?.serviceWorker?.controller,
        serviceWorkerRegistration?.active,
      );
      if (!serviceWorkerRegistration && serviceWorkerRegistrationFailed) {
        const updateUrl = new URL(rootScope.location.href);
        updateUrl.searchParams.set(
          UPDATE_QUERY_PARAMETER,
          pendingAppUpdateVersion,
        );
        rootScope.location.replace(updateUrl.href);
      } else {
        rootScope.location.reload();
      }
    } catch (error) {
      bootstrapLogger().error("Unable to safely apply the app update:", error);
      nextUpdateApplyAttemptAt = Date.now() + 60 * 1000;
      setAppUpdateNotice(
        "An update is ready, but your progress could not be saved. The current version is still available; retry when ready.",
        true,
      );
    } finally {
      updateApplyInFlight = false;
    }
  }

  function handleServiceWorkerMessage(event) {
    const message = event.data;
    if (!message || typeof message !== "object") return;

    if (message.type === "MRH_QUERY_CLIENT_VERSION") {
      sendClientVersionResponse(event);
      return;
    }
    if (message.type === "MRH_UPDATE_AVAILABLE") {
      markAppUpdateAvailable(message.version);
    }
  }

  function checkDeployedVersion() {
    if (
      !rootScope.fetch ||
      rootScope.navigator?.onLine === false ||
      typeof rootScope.__MRH_APP_BASE_PATH !== "string"
    ) {
      return Promise.resolve();
    }

    const versionUrl = new URL(
      "version.json",
      new URL(rootScope.__MRH_APP_BASE_PATH, window.location.origin),
    );
    versionUrl.searchParams.set("check", String(Date.now()));

    return rootScope
      .fetch(versionUrl.href, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Version check failed with HTTP ${response.status}.`);
        }
        return response.json();
      })
      .then(async (release) => {
        if (
          typeof release?.version !== "string" ||
          !/^mrh-[A-Za-z0-9._-]+$/.test(release.version) ||
          release.version === APP_VERSION ||
          release.version === pendingAppUpdateVersion
        ) {
          return;
        }

        if (serviceWorkerRegistrationPromise) {
          await serviceWorkerRegistrationPromise;
        }

        // With a service worker, wait for its install/precache to succeed and
        // its activation message before offering the new release to the page.
        if (serviceWorkerRegistration) return;
        if (!serviceWorkerRegistrationFailed) return;

        await verifyDeployedReleaseAssets(release.version);
        markAppUpdateAvailable(release.version);
      })
      .catch((error) => {
        bootstrapLogger().warn("Deployed app version check failed:", error);
      });
  }

  async function verifyDeployedReleaseAssets(version) {
    const baseUrl = new URL(
      rootScope.__MRH_APP_BASE_PATH,
      window.location.origin,
    );
    const assetNames = [
      "index.html",
      "manifest.json",
      "icon.svg",
      "tailwind.generated.css",
      "styles.css",
      "app-config.js",
      "storage-utils.js",
      "text-utils.js",
      "debug-utils.js",
      "lifecycle-utils.js",
      "rendering-core.js",
      "app-core-state.js",
      "preferences-core.js",
      "dashboard-core.js",
      "app-core.js",
      "app-core-network.js",
      "sync-core.js",
      "deck-nav-core.js",
      "ui-modal-core.js",
      "session-core.js",
      "analytics-core.js",
      "deck-review-core.js",
      "quiz-rendering-core.js",
      "qr-transfer-core.js",
      "qr-vendor/qrcode-generator.js",
      "qr-vendor/jsQR.js",
    ];
    const checks = assetNames.map(async (name) => {
      const assetUrl = new URL(name, baseUrl);
      if (!/\.[0-9a-f]{16}\.(?:js|css|svg)$/.test(assetUrl.pathname)) {
        assetUrl.searchParams.set("v", version);
      }
      const response = await rootScope.fetch(assetUrl.href, {
        method: name === "app-entry.js" ? "GET" : "HEAD",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        throw new Error(
          `Release asset check failed with HTTP ${response.status}: ${name}`,
        );
      }
      if (name === "app-entry.js") {
        const source = await response.text();
        if (!source.includes(`const APP_VERSION = "${version}"`)) {
          throw new Error("The entry script does not match the release version.");
        }
      }
    });
    await Promise.all(checks);
  }

  function checkForAppUpdate() {
    if (
      appUpdateCheck ||
      rootScope.navigator?.onLine === false ||
      document.visibilityState !== "visible"
    ) {
      return appUpdateCheck || Promise.resolve();
    }

    appUpdateCheck = Promise.all([
      serviceWorkerRegistration
        ? serviceWorkerRegistration.update().catch((error) => {
            bootstrapLogger().warn(
              "Service worker update check failed:",
              error,
            );
          })
        : Promise.resolve(),
      checkDeployedVersion(),
    ]).finally(() => {
      appUpdateCheck = null;
    });
    return appUpdateCheck;
  }

  function startAppUpdateChecks() {
    if (rootScope.__mrhAppUpdateChecksStarted) return;
    rootScope.__mrhAppUpdateChecksStarted = true;

    void checkForAppUpdate();
    window.setInterval(checkForAppUpdate, APP_UPDATE_CHECK_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void checkForAppUpdate();
        void applyPendingAppUpdate();
      }
    });
    window.addEventListener("online", () => {
      void checkForAppUpdate();
      void applyPendingAppUpdate();
    });
    const checkUpdateWhenForegrounded = () => {
      void checkForAppUpdate();
      void applyPendingAppUpdate();
    };
    window.addEventListener("focus", checkUpdateWhenForegrounded);
    window.addEventListener("pageshow", checkUpdateWhenForegrounded);
    window.addEventListener("hashchange", () => {
      void applyPendingAppUpdate();
    });
    window.addEventListener("popstate", () => {
      void applyPendingAppUpdate();
    });

    document
      .getElementById("app-update-retry")
      ?.addEventListener("click", () => {
        nextUpdateApplyAttemptAt = 0;
        void applyPendingAppUpdate();
      });
  }

  const loadedFeatures = new Set();
  const loadingFeatures = new Map();
  const BOOTSTRAP_SCRIPTS = [
    "app-config.js",
    "storage-utils.js",
    "text-utils.js",
    "debug-utils.js",
    "lifecycle-utils.js",
    "rendering-core.js",
    "app-core-state.js",
    "preferences-core.js",
    "dashboard-core.js",
  ];
  const APPLICATION_RUNTIME_SCRIPTS = [
    "app-core.js",
    "app-core-network.js",
    "sync-core.js",
    "deck-nav-core.js",
    "ui-modal-core.js",
  ];
  const FEATURE_SCRIPTS = [
    "session-core.js",
    "analytics-core.js",
    "deck-review-core.js",
    "quiz-rendering-core.js",
    "qr-transfer-core.js",
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (typeof document === "undefined") {
        reject(new Error(`Cannot load ${src}: document is unavailable.`));
        return;
      }

      const resolvedSrc = (() => {
        const raw = String(src || "").trim();
        if (!raw) return raw;
        try {
          const baseHref =
            window.location.protocol === "file:"
              ? window.location.href
              : new URL(
                  rootScope.__MRH_APP_BASE_PATH || "/",
                  window.location.origin,
                ).href;
          return new URL(raw, baseHref).href;
        } catch {
          return raw;
        }
      })();

      const script = document.createElement("script");
      script.src = resolvedSrc;
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
  rootScope.openQrTransfer = async function openQrTransfer() {
    try {
      await loadFeatureScript("qr-transfer-core.js");
      rootScope.QRTransfer.open();
    } catch (error) {
      bootstrapLogger().error("Unable to open progress transfer:", error);
      if (typeof rootScope.showToast === "function") {
        rootScope.showToast(
          "Unable to open progress transfer. Please reload the app and try again.",
          "error",
        );
      }
    }
  };

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

  async function retireLegacyPagesApp() {
    if (
      rootScope.location?.hostname !== "monarchx2.github.io" ||
      rootScope.__MRH_APP_BASE_PATH !== "/mrh/"
    ) {
      return;
    }

    const legacyAppUrl = new URL(
      LEGACY_PAGES_BASE_PATH,
      rootScope.location.origin,
    );
    const isLegacyPath = (pathname) =>
      pathname === LEGACY_PAGES_BASE_PATH.slice(0, -1) ||
      pathname.startsWith(LEGACY_PAGES_BASE_PATH);

    if (typeof navigator.serviceWorker?.getRegistrations === "function") {
      try {
        const registrations =
          await navigator.serviceWorker.getRegistrations();
        const unregisterResults = await Promise.allSettled(
          registrations
            .filter((registration) => {
              const scopeUrl = new URL(registration.scope);
              return (
                scopeUrl.origin === legacyAppUrl.origin &&
                isLegacyPath(scopeUrl.pathname)
              );
            })
            .map((registration) => registration.unregister()),
        );
        unregisterResults.forEach((result) => {
          if (result.status === "rejected") {
            bootstrapLogger().warn(
              "Unable to unregister the legacy Pages service worker:",
              result.reason,
            );
          }
        });
      } catch (error) {
        bootstrapLogger().warn(
          "Unable to unregister the legacy Pages service worker:",
          error,
        );
      }
    }

    if (typeof rootScope.caches?.keys === "function") {
      try {
        const cacheNames = await rootScope.caches.keys();
        const cacheResults = await Promise.allSettled(
          cacheNames.map(async (cacheName) => {
            const cache = await rootScope.caches.open(cacheName);
            const requests = await cache.keys();
            const legacyRequests = requests.filter((request) => {
              const requestUrl = new URL(request.url);
              return (
                requestUrl.origin === legacyAppUrl.origin &&
                isLegacyPath(requestUrl.pathname)
              );
            });
            const deleteResults = await Promise.allSettled(
              legacyRequests.map((request) => cache.delete(request)),
            );
            deleteResults.forEach((result) => {
              if (result.status === "rejected") {
                bootstrapLogger().warn(
                  "Unable to delete a cached asset from the legacy Pages path:",
                  result.reason,
                );
              }
            });
          }),
        );
        cacheResults.forEach((result) => {
          if (result.status === "rejected") {
            bootstrapLogger().warn(
              "Unable to clear cached assets from the legacy Pages path:",
              result.reason,
            );
          }
        });
      } catch (error) {
        bootstrapLogger().warn(
          "Unable to clear cached assets from the legacy Pages path:",
          error,
        );
      }
    }
  }

  function registerServiceWorker() {
    if (
      typeof navigator === "undefined" ||
      !navigator.serviceWorker ||
      typeof navigator.serviceWorker.register !== "function"
    ) {
      serviceWorkerRegistrationFailed = true;
      return;
    }

    navigator.serviceWorker.addEventListener(
      "message",
      handleServiceWorkerMessage,
    );
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      sendCurrentVersionToWorker(navigator.serviceWorker.controller);
    });

    const swBaseUrl = new URL(
      rootScope.__MRH_APP_BASE_PATH || "/",
      window.location.origin,
    );
    const swScopeUrl = new URL(swBaseUrl.pathname, swBaseUrl.origin);
    const swUrl = new URL("sw.js", swBaseUrl);

    serviceWorkerRegistrationPromise = retireLegacyPagesApp()
      .then(() =>
        navigator.serviceWorker.register(swUrl.href, {
          scope: swScopeUrl.pathname,
          updateViaCache: "none",
        }),
      )
      .then((registration) => {
        serviceWorkerRegistration = registration;
        sendCurrentVersionToWorker(
          navigator.serviceWorker.controller,
          registration.active,
        );
        void checkForAppUpdate();
        return registration;
      })
      .catch((error) => {
        serviceWorkerRegistrationFailed = true;
        bootstrapLogger().warn("Service worker registration failed:", error);
        return null;
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
          const initialized = await rootScope.initializeApp();
          if (initialized !== true) {
            throw new Error("Application initialization did not complete successfully.");
          }
        }

        bootstrap.status = "ready";
        rootScope.__mrhBootstrapComplete = true;
        startAppUpdateChecks();
        sendCurrentVersionToWorker(
          navigator.serviceWorker?.controller,
          serviceWorkerRegistration?.active,
        );
        void applyPendingAppUpdate();
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
