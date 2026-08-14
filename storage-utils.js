(function (globalScope) {
  const fallbackStorage =
    typeof globalThis !== "undefined"
      ? globalThis.__mrhNodeStorage || (globalThis.__mrhNodeStorage = {})
      : {};

  function getRuntimeState() {
    if (typeof globalThis !== "undefined" && globalThis.state) {
      return globalThis.state;
    }
    if (typeof state !== "undefined" && state) {
      return state;
    }
    return {};
  }

  function getLocalStorage() {
    if (typeof localStorage !== "undefined") return localStorage;
    return {
      store: fallbackStorage,
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(this.store, key)
          ? this.store[key]
          : null;
      },
      setItem(key, value) {
        this.store[key] = String(value);
      },
      removeItem(key) {
        delete this.store[key];
      },
      key(index) {
        return Object.keys(this.store)[index] || null;
      },
      get length() {
        return Object.keys(this.store).length;
      },
    };
  }

  function getSessionStorage() {
    return getLocalStorage();
  }

  function getCrypto() {
    if (typeof crypto !== "undefined") return crypto;
    if (typeof globalThis !== "undefined" && globalThis.crypto) {
      return globalThis.crypto;
    }
    return null;
  }

  function generateUserId() {
    const cryptoApi = getCrypto();
    if (cryptoApi && cryptoApi.randomUUID) {
      return "user_" + cryptoApi.randomUUID();
    }

    if (cryptoApi && cryptoApi.getRandomValues) {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return (
        "user_" +
        [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")
      );
    }

    return "user_" + Math.random().toString(36).substring(2, 15);
  }

  function getPersistentStorageIdentity() {
    const store = getLocalStorage();
    try {
      const stored = store.getItem("mrh_storage_identity");
      if (stored) return stored;
    } catch (e) {}

    const generated = `device_${generateUserId()}`;
    try {
      store.setItem("mrh_storage_identity", generated);
    } catch (e) {}
    return generated;
  }

  function getSafeStorageIdentity() {
    const runtimeState = getRuntimeState();

    if (!runtimeState.prefs) runtimeState.prefs = {};
    if (!runtimeState.prefs.storageIdentity) {
      runtimeState.prefs.storageIdentity = getPersistentStorageIdentity();
    }
    const store = getLocalStorage();
    const rawIdentity =
      runtimeState.prefs.storageIdentity ||
      (store && typeof store.getItem === "function"
        ? store.getItem("mrh_storage_identity")
        : null) ||
      runtimeState.prefs.userId ||
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
    const store = getLocalStorage();
    const namespacedValue = store.getItem(getStorageKey(key));
    if (namespacedValue !== null) return namespacedValue;
    const legacyValue = store.getItem(getLegacyStorageKey(key));
    if (legacyValue !== null) return legacyValue;
    return fallback;
  }

  function getAnyNamespaceStoredItem(key, fallback = null) {
    const store = getLocalStorage();
    for (let i = 0; i < store.length; i++) {
      const storedKey = store.key(i) || "";
      if (storedKey.endsWith(`:${key}`)) {
        const value = store.getItem(storedKey);
        if (value !== null) return value;
      }
    }
    return fallback;
  }

  function setStoredItem(key, value) {
    const store = getLocalStorage();
    store.setItem(getStorageKey(key), value);
  }

  function removeStoredItem(key) {
    const store = getLocalStorage();
    store.removeItem(getStorageKey(key));
    store.removeItem(getLegacyStorageKey(key));
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
    const store = getSessionStorage();
    const namespacedValue = store.getItem(getStorageKey(key));
    if (namespacedValue !== null) return namespacedValue;
    const legacyValue = store.getItem(getLegacyStorageKey(key));
    if (legacyValue !== null) return legacyValue;

    for (let i = 0; i < store.length; i++) {
      const storedKey = store.key(i) || "";
      if (storedKey.endsWith(`:${key}`)) {
        const fallbackValue = store.getItem(storedKey);
        if (fallbackValue !== null) return fallbackValue;
      }
    }
    return fallback;
  }

  function setSessionStoredItem(key, value) {
    const store = getSessionStorage();
    store.setItem(getStorageKey(key), value);
  }

  function removeSessionStoredItem(key) {
    const store = getSessionStorage();
    store.removeItem(getStorageKey(key));
    store.removeItem(getLegacyStorageKey(key));
    for (let i = store.length - 1; i >= 0; i--) {
      const storedKey = store.key(i) || "";
      if (storedKey.endsWith(`:${key}`)) {
        store.removeItem(storedKey);
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
    const store = getLocalStorage();
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
        store.getItem(namespacedKey) === null &&
        store.getItem(legacyKey) !== null
      ) {
        store.setItem(namespacedKey, store.getItem(legacyKey));
      }
    });
  }

  function purgeOrphanedStorage(identityToKeep = null) {
    const store = getLocalStorage();
    const activeIdentity = identityToKeep || getSafeStorageIdentity();
    const namespaces = new Set();
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i) || "";
      const match = key.match(/^mrh_([^:]+):/);
      if (match) namespaces.add(match[1]);
    }

    namespaces.forEach((namespace) => {
      if (namespace === activeIdentity) return;
      for (let i = store.length - 1; i >= 0; i--) {
        const key = store.key(i) || "";
        if (key.startsWith(`mrh_${namespace}:`)) {
          store.removeItem(key);
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
    legacyKeys.forEach((legacyKey) => store.removeItem(legacyKey));
  }

  const StorageUtils = {
    generateUserId,
    getCrypto,
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
  globalScope.getCrypto = getCrypto;
  globalScope.getPersistentStorageIdentity = getPersistentStorageIdentity;
  globalScope.getSafeStorageIdentity = getSafeStorageIdentity;
  globalScope.getStorageKey = getStorageKey;
  globalScope.getLegacyStorageKey = getLegacyStorageKey;
  globalScope.getStorageNamespace = getStorageNamespace;
})(typeof window !== "undefined" ? window : globalThis);
