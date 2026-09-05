(function (globalScope) {
  "use strict";

  globalScope.MRH_CONFIG = Object.freeze({
    databaseUrl:
      "https://script.google.com/macros/s/AKfycbyM7L_Fam7UT8iRrCVy09ktV5VPPJxMLF2in6kwUewUJJ-La-BYd8okAsPVC8Tkcaw/exec",
    syncIntervalMs: 60 * 1000,
    syncRetryIntervalMs: 3 * 1000,
    quizNavigationBreakpoint: 768,
    staleCacheMaxAgeMs: 10 * 1000,
    syncRequestTimeoutMs: 60 * 1000,
    syncRetryMaxDelayMs: 60 * 1000,
    leaderHeartbeatIntervalMs: 10 * 1000,
    leaderPeerTtlMs: 25 * 1000,
    storageMaxJsonPayloadBytes: 250000,
    deferredInitializationDelayMs: 50,
    statusHideAnimationDelayMs: 250,
    statusHiddenDelayMs: 500,
  });
})(typeof window !== "undefined" ? window : globalThis);
