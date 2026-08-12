(function (globalScope) {
  function generateUserId() {
    if (window.crypto && window.crypto.randomUUID) {
      return "user_" + crypto.randomUUID();
    }

    if (window.crypto && window.crypto.getRandomValues) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      return (
        "user_" +
        [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
      );
    }

    return "user_" + Math.random().toString(36).substring(2, 15);
  }

  function getPersistentStorageIdentity() {
    try {
      const stored = localStorage.getItem("mrh_storage_identity");
      if (stored) return stored;
    } catch (e) {}

    const generated = `device_${generateUserId()}`;
    try {
      localStorage.setItem("mrh_storage_identity", generated);
    } catch (e) {}
    return generated;
  }

  function getSafeStorageIdentity() {
    const username =
      typeof userState !== "undefined" && userState.username
        ? userState.username
        : "";
    if (username) {
      return String(username).replace(/[^a-zA-Z0-9_-]/g, "_") || "guest";
    }

    if (!state?.prefs?.storageIdentity) {
      state.prefs.storageIdentity = getPersistentStorageIdentity();
    }
    const rawIdentity =
      state?.prefs?.storageIdentity ||
      localStorage.getItem("mrh_storage_identity") ||
      state?.prefs?.userId ||
      "guest";
    return String(rawIdentity).replace(/[^a-zA-Z0-9_-]/g, "_") || "guest";
  }

  function getStorageNamespace() {
    return `mrh_${getSafeStorageIdentity()}`;
  }

  function getStorageKey(key) {
    return `${getStorageNamespace()}:${key}`;
  }

  function getLegacyStorageKey(key) {
    return `mrh_${key}`;
  }

  function getStoredItem(key, fallback = null) {
    const namespacedValue = localStorage.getItem(getStorageKey(key));
    if (namespacedValue !== null) return namespacedValue;
    const legacyValue = localStorage.getItem(getLegacyStorageKey(key));
    if (legacyValue !== null) return legacyValue;
    return fallback;
  }

  function getAnyNamespaceStoredItem(key, fallback = null) {
    for (let i = 0; i < localStorage.length; i++) {
      const storedKey = localStorage.key(i) || "";
      if (storedKey.endsWith(`:${key}`)) {
        const value = localStorage.getItem(storedKey);
        if (value !== null) return value;
      }
    }
    return fallback;
  }

  function setStoredItem(key, value) {
    localStorage.setItem(getStorageKey(key), value);
  }

  function removeStoredItem(key) {
    localStorage.removeItem(getStorageKey(key));
    localStorage.removeItem(getLegacyStorageKey(key));
  }

  function getStoredJSON(key, fallback = null) {
    try {
      const stored = getStoredItem(key);
      if (stored === null || stored === undefined) return fallback;
      return JSON.parse(stored);
    } catch (e) {
      return fallback;
    }
  }

  function setStoredJSON(key, value) {
    setStoredItem(key, JSON.stringify(value));
  }

  function getSessionStoredItem(key, fallback = null) {
    const namespacedValue = sessionStorage.getItem(getStorageKey(key));
    if (namespacedValue !== null) return namespacedValue;
    const legacyValue = sessionStorage.getItem(getLegacyStorageKey(key));
    if (legacyValue !== null) return legacyValue;

    for (let i = 0; i < sessionStorage.length; i++) {
      const storedKey = sessionStorage.key(i) || "";
      if (storedKey.endsWith(`:${key}`)) {
        const fallbackValue = sessionStorage.getItem(storedKey);
        if (fallbackValue !== null) return fallbackValue;
      }
    }
    return fallback;
  }

  function setSessionStoredItem(key, value) {
    sessionStorage.setItem(getStorageKey(key), value);
  }

  function removeSessionStoredItem(key) {
    sessionStorage.removeItem(getStorageKey(key));
    sessionStorage.removeItem(getLegacyStorageKey(key));
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const storedKey = sessionStorage.key(i) || "";
      if (storedKey.endsWith(`:${key}`)) {
        sessionStorage.removeItem(storedKey);
      }
    }
  }

  function getSessionStoredJSON(key, fallback = null) {
    try {
      const stored = getSessionStoredItem(key);
      if (stored === null || stored === undefined) return fallback;
      return JSON.parse(stored);
    } catch (e) {
      return fallback;
    }
  }

  function setSessionStoredJSON(key, value) {
    setSessionStoredItem(key, JSON.stringify(value));
  }

  function migrateLegacyStorageKeys() {
    const pairs = [
      ["stats", "mrh_stats"],
      ["prefs", "mrh_prefs"],
      ["summary", "mrh_summary"],
      ["saved_session", "mrh_saved_session"],
      ["progress_meta", "mrh_progress_meta"],
      ["user_session", "mrh_user_session"],
      ["reported_qs", "mrh_reported_qs"],
      ["login_suggestion_dismissed", "mrh_login_suggestion_dismissed"],
      ["pending_sync_queue", "mrh_pending_sync_queue"],
      ["recovery_snapshot", "mrh_recovery_snapshot"],
    ];

    pairs.forEach(([currentKey, legacyKey]) => {
      const namespacedKey = getStorageKey(currentKey);
      if (
        localStorage.getItem(namespacedKey) === null &&
        localStorage.getItem(legacyKey) !== null
      ) {
        localStorage.setItem(namespacedKey, localStorage.getItem(legacyKey));
      }
    });
  }

  function purgeOrphanedStorage(identityToKeep = null) {
    const activeIdentity = identityToKeep || getSafeStorageIdentity();
    const namespaces = new Set();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i) || "";
      const match = key.match(/^mrh_([^:]+):/);
      if (match) namespaces.add(match[1]);
    }

    namespaces.forEach((namespace) => {
      if (namespace === activeIdentity) return;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i) || "";
        if (key.startsWith(`mrh_${namespace}:`)) {
          localStorage.removeItem(key);
        }
      }
    });

    const legacyKeys = [
      "mrh_stats",
      "mrh_prefs",
      "mrh_summary",
      "mrh_saved_session",
      "mrh_progress_meta",
      "mrh_user_session",
      "mrh_reported_qs",
      "mrh_login_suggestion_dismissed",
      "mrh_pending_sync_queue",
      "mrh_recovery_snapshot",
    ];
    legacyKeys.forEach((legacyKey) => localStorage.removeItem(legacyKey));
  }

  const StorageUtils = {
    generateUserId,
    getPersistentStorageIdentity,
    getSafeStorageIdentity,
    getStorageNamespace,
    getStorageKey,
    getLegacyStorageKey,
    getStoredItem,
    getAnyNamespaceStoredItem,
    setStoredItem,
    removeStoredItem,
    getStoredJSON,
    setStoredJSON,
    getSessionStoredItem,
    setSessionStoredItem,
    removeSessionStoredItem,
    getSessionStoredJSON,
    setSessionStoredJSON,
    migrateLegacyStorageKeys,
    purgeOrphanedStorage,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = StorageUtils;
  }

  globalScope.StorageUtils = StorageUtils;
})(typeof window !== "undefined" ? window : globalThis);
