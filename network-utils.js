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

  const NetworkUtils = {
    callBackend,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = NetworkUtils;
  }

  globalScope.NetworkUtils = NetworkUtils;
})(typeof window !== "undefined" ? window : globalThis);
