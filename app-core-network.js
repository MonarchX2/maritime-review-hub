(function (globalScope) {
  async function callBackend(payload, options = {}) {
    return NetworkUtils.callBackend(payload, options);
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
    getActiveIdentity,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppNetwork;
  }

  globalScope.callBackend = callBackend;
  globalScope.getActiveIdentity = getActiveIdentity;
  globalScope.AppNetwork = AppNetwork;
})(typeof window !== "undefined" ? window : globalThis);
