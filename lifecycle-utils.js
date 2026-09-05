(function (globalScope) {
  "use strict";

  const timeoutIds = new Set();
  const intervalIds = new Set();
  const cleanupCallbacks = new Set();

  function setTimeoutTracked(callback, delay, ...args) {
    const id = globalScope.setTimeout(() => {
      timeoutIds.delete(id);
      callback(...args);
    }, delay);
    timeoutIds.add(id);
    return id;
  }

  function clearTimeoutTracked(id) {
    if (id === null || id === undefined) return;
    globalScope.clearTimeout(id);
    timeoutIds.delete(id);
  }

  function setIntervalTracked(callback, delay, ...args) {
    const id = globalScope.setInterval(callback, delay, ...args);
    intervalIds.add(id);
    return id;
  }

  function clearIntervalTracked(id) {
    if (id === null || id === undefined) return;
    globalScope.clearInterval(id);
    intervalIds.delete(id);
  }

  function registerCleanup(callback) {
    if (typeof callback !== "function") return () => undefined;
    cleanupCallbacks.add(callback);
    return () => cleanupCallbacks.delete(callback);
  }

  function cleanup() {
    timeoutIds.forEach((id) => globalScope.clearTimeout(id));
    intervalIds.forEach((id) => globalScope.clearInterval(id));
    timeoutIds.clear();
    intervalIds.clear();

    cleanupCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        if (globalScope.DebugUtils?.createDebugLogger) {
          globalScope.DebugUtils.createDebugLogger("lifecycle").error(
            "Cleanup callback failed.",
            error,
          );
        }
      }
    });
  }

  const LifecycleUtils = {
    setTimeout: setTimeoutTracked,
    clearTimeout: clearTimeoutTracked,
    setInterval: setIntervalTracked,
    clearInterval: clearIntervalTracked,
    registerCleanup,
    cleanup,
  };

  globalScope.LifecycleUtils = LifecycleUtils;
})(typeof window !== "undefined" ? window : globalThis);
