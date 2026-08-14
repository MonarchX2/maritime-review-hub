(function (globalScope) {
  async function callBackend(payload, options = {}) {
    return NetworkUtils.callBackend(payload, options);
  }

  const AppNetwork = {
    callBackend,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = AppNetwork;
  }

  globalScope.callBackend = callBackend;
  globalScope.AppNetwork = AppNetwork;
})(typeof window !== "undefined" ? window : globalThis);
