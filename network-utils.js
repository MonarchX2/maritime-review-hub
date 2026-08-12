(function (globalScope) {
  async function callBackend(payload, options = {}) {
    const timeoutMs = options.timeoutMs || 20000;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(DB_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        ...options,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        let message = text || `Backend request failed (${response.status})`;
        try {
          const json = JSON.parse(text);
          if (json && json.message) message = json.message;
        } catch (e) {
          // ignore invalid JSON
        }
        throw new Error(message);
      }

      const text = await response.text().catch(() => "");
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new Error(
          `Invalid response from backend. Expected JSON but received: ${text.slice(0, 200)}`,
        );
      }
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("The request timed out. Please try again.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function sendTelemetry(action, details) {
    const authenticatedUsername =
      typeof userState !== "undefined" && userState.isLoggedIn
        ? userState.username
        : "";
    const event = {
      type: "telemetry",
      userId: getActiveIdentity(),
      action,
      details: {
        ...details,
        username: authenticatedUsername || null,
        timestamp: new Date().toISOString(),
        currentView: document.querySelector(".view-section.active")?.id || null,
        appMode: typeof currentAppMode === "string" ? currentAppMode : null,
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          orientation: window.matchMedia("(orientation: portrait)").matches
            ? "portrait"
            : "landscape",
        },
        online: navigator.onLine,
      },
    };
    const payload = JSON.stringify({
      ...event,
    });

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
      navigator.sendBeacon(DB_URL, blob);
    } else {
      fetch(DB_URL, {
        method: "POST",
        redirect: "follow",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  }

  function setupTelemetry() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest(
        "button, a, select, input, [role='button']",
      );
      if (!target || target.dataset.telemetryIgnore === "true") return;
      sendTelemetry("ui_click", {
        element:
          target.id || target.getAttribute("aria-label") || target.tagName,
        text: (target.innerText || target.value || "").trim().slice(0, 120),
      });
    });

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!target.matches("input, select, textarea")) return;
      sendTelemetry("ui_change", {
        element: target.id || target.name || target.tagName,
        value: target.type === "checkbox" ? target.checked : target.value,
      });
    });

    window.addEventListener("online", () =>
      sendTelemetry("network_status", { online: true }),
    );
    window.addEventListener("offline", () =>
      sendTelemetry("network_status", { online: false }),
    );
    document.addEventListener("visibilitychange", () =>
      sendTelemetry("visibility_change", {
        visibility: document.visibilityState,
      }),
    );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && Date.now() - lastSyncAt > SYNC_INTERVAL_MS) {
        syncDatabase(true, true);
      }
    });
    window.addEventListener("error", (event) =>
      sendTelemetry("client_error", {
        message: event.message,
        source: event.filename,
        line: event.lineno,
      }),
    );
  }

  const NetworkUtils = {
    callBackend,
    sendTelemetry,
    setupTelemetry,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = NetworkUtils;
  }

  globalScope.NetworkUtils = NetworkUtils;
})(typeof window !== "undefined" ? window : globalThis);
