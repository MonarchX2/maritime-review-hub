(function (globalScope) {
  async function callBackend(payload, options = {}) {
    return NetworkUtils.callBackend(payload, options);
  }

  function sendTelemetry(action, details) {
    return NetworkUtils.sendTelemetry(action, details);
  }

  function setupTelemetry() {
    return NetworkUtils.setupTelemetry();
  }

  function getActiveIdentity() {
    const authenticatedUsername =
      typeof userState !== "undefined" && userState.isLoggedIn
        ? userState.username
        : "";
    return authenticatedUsername || state.prefs.userId;
  }

  const AppNetwork = {
    callBackend,
    sendTelemetry,
    setupTelemetry,
    getActiveIdentity,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppNetwork;
  }

  globalScope.callBackend = callBackend;
  globalScope.sendTelemetry = sendTelemetry;
  globalScope.setupTelemetry = setupTelemetry;
  globalScope.getActiveIdentity = getActiveIdentity;
  globalScope.AppNetwork = AppNetwork;
})(typeof window !== "undefined" ? window : globalThis);
