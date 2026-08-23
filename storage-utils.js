(function (globalScope) {
  "use strict";

  const root =
    globalScope || (typeof globalThis !== "undefined" ? globalThis : {});
  const MEMORY_LOCAL_KEY = "__mrhNodeStorage";
  const MEMORY_SESSION_KEY = "__mrhNodeSessionStorage";

  function createMemoryStorage(existing) {
    const store = existing && typeof existing === "object" ? existing : {};
    return {
      getItem(key) {
        const normalizedKey = String(key);
        return Object.prototype.hasOwnProperty.call(store, normalizedKey)
          ? String(store[normalizedKey])
          : null;
      },
      setItem(key, value) {
        store[String(key)] = String(value);
      },
      removeItem(key) {
        delete store[String(key)];
      },
      key(index) {
        const keys = Object.keys(store);
        return Number.isInteger(index) && index >= 0
          ? (keys[index] ?? null)
          : null;
      },
      get length() {
        return Object.keys(store).length;
      },
    };
  }

  function getMemoryStorage(kind) {
    const property = kind === "session" ? MEMORY_SESSION_KEY : MEMORY_LOCAL_KEY;
    if (!root[property] || typeof root[property] !== "object")
      root[property] = {};
    return createMemoryStorage(root[property]);
  }

  function isStorageLike(value) {
    return (
      value &&
      typeof value.getItem === "function" &&
      typeof value.setItem === "function" &&
      typeof value.removeItem === "function" &&
      typeof value.key === "function" &&
      typeof value.length === "number"
    );
  }

  function getStorage(kind) {
    const property = kind === "session" ? "sessionStorage" : "localStorage";
    try {
      const nativeStorage = root[property];
      if (isStorageLike(nativeStorage)) {
        // Probe access because browsers can expose storage but deny it at runtime.
        const probeKey = "__mrh_storage_probe__";
        nativeStorage.setItem(probeKey, "1");
        nativeStorage.removeItem(probeKey);
        return nativeStorage;
      }
    } catch (error) {
      // Fall back to in-memory storage when storage is blocked/unavailable.
    }
    return getMemoryStorage(kind);
  }

  function getLocalStorage() {
    return getStorage("local");
  }

  function getSessionStorage() {
    return getStorage("session");
  }

  function getRuntimeState() {
    const candidate = root && root.state;
    return candidate && typeof candidate === "object" ? candidate : {};
  }

  function getCrypto() {
    try {
      if (root && root.crypto) return root.crypto;
    } catch (error) {
      // Ignore inaccessible crypto implementations.
    }
    try {
      if (typeof globalThis !== "undefined" && globalThis.crypto)
        return globalThis.crypto;
    } catch (error) {
      // Ignore inaccessible crypto implementations.
    }
    return null;
  }

  function generateUserId() {
    const cryptoApi = getCrypto();
    if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
      return `user_${cryptoApi.randomUUID()}`;
    }

    if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return `user_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
    }

    // Last-resort uniqueness only; this is not a cryptographic identifier.
    return `user_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  }

  function normalizeIdentity(identity) {
    const normalized = String(identity ?? "").replace(/[^a-zA-Z0-9_-]/g, "_");
    return normalized || "guest";
  }

  function getPersistentStorageIdentity() {
    const store = getLocalStorage();
    try {
      const stored = store.getItem("mrh_storage_identity");
      if (stored) return String(stored);
    } catch (error) {
      // Use a generated identity below.
    }

    const generated = `device_${generateUserId()}`;
    try {
      store.setItem("mrh_storage_identity", generated);
    } catch (error) {
      // Identity remains valid for this invocation even if persistence is blocked.
    }
    return generated;
  }

  function getSafeStorageIdentity() {
    const runtimeState = getRuntimeState();
    if (!runtimeState.prefs || typeof runtimeState.prefs !== "object")
      runtimeState.prefs = {};

    if (!runtimeState.prefs.storageIdentity) {
      runtimeState.prefs.storageIdentity = getPersistentStorageIdentity();
    }

    const rawIdentity =
      runtimeState.prefs.storageIdentity ||
      runtimeState.prefs.userId ||
      "guest";
    return normalizeIdentity(rawIdentity);
  }

  function normalizeStorageKey(key) {
    return String(key ?? "");
  }

  function getStorageNamespace() {
    return `mrh_${getSafeStorageIdentity()}`;
  }

  function getStorageKey(key) {
    return `${getStorageNamespace()}:${normalizeStorageKey(key)}`;
  }

  function getLegacyStorageKey(key) {
    return `mrh_${normalizeStorageKey(key)}`;
  }

  function safeGetItem(store, key) {
    try {
      return store.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeSetItem(store, key, value) {
    try {
      store.setItem(key, String(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function safeRemoveItem(store, key) {
    try {
      store.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getStoredItem(key, fallback = null) {
    const store = getLocalStorage();
    const namespacedValue = safeGetItem(store, getStorageKey(key));
    if (namespacedValue !== null) return namespacedValue;

    const legacyValue = safeGetItem(store, getLegacyStorageKey(key));
    return legacyValue !== null ? legacyValue : fallback;
  }

  function getAnyNamespaceStoredItem(key, fallback = null) {
    const store = getLocalStorage();
    const suffix = `:${normalizeStorageKey(key)}`;
    const activeKey = getStorageKey(key);

    for (let i = 0; i < store.length; i += 1) {
      let storedKey = null;
      try {
        storedKey = store.key(i);
      } catch (error) {
        continue;
      }
      if (
        !storedKey ||
        storedKey === activeKey ||
        !storedKey.startsWith("mrh_") ||
        !storedKey.endsWith(suffix)
      )
        continue;

      const value = safeGetItem(store, storedKey);
      if (value !== null) return value;
    }
    return fallback;
  }

  function setStoredItem(key, value) {
    return safeSetItem(getLocalStorage(), getStorageKey(key), value);
  }

  function removeStoredItem(key) {
    const store = getLocalStorage();
    const removedCurrent = safeRemoveItem(store, getStorageKey(key));
    const removedLegacy = safeRemoveItem(store, getLegacyStorageKey(key));
    return removedCurrent && removedLegacy;
  }

  function getStoredJSON(key, fallback = null) {
    const stored = getStoredItem(key);
    if (stored === null || stored === undefined) return fallback;
    try {
      return JSON.parse(stored);
    } catch (error) {
      return fallback;
    }
  }

  function setStoredJSON(key, value) {
    try {
      return setStoredItem(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
  }

  function getSessionStoredItem(key, fallback = null) {
    const store = getSessionStorage();
    const namespacedValue = safeGetItem(store, getStorageKey(key));
    if (namespacedValue !== null) return namespacedValue;

    const legacyValue = safeGetItem(store, getLegacyStorageKey(key));
    if (legacyValue !== null) return legacyValue;

    return fallback;
  }

  function setSessionStoredItem(key, value) {
    return safeSetItem(getSessionStorage(), getStorageKey(key), value);
  }

  function removeSessionStoredItem(key) {
    const store = getSessionStorage();
    const removedCurrent = safeRemoveItem(store, getStorageKey(key));
    const removedLegacy = safeRemoveItem(store, getLegacyStorageKey(key));
    return removedCurrent && removedLegacy;
  }

  function getSessionStoredJSON(key, fallback = null) {
    const stored = getSessionStoredItem(key);
    if (stored === null || stored === undefined) return fallback;
    try {
      return JSON.parse(stored);
    } catch (error) {
      return fallback;
    }
  }

  function setSessionStoredJSON(key, value) {
    try {
      return setSessionStoredItem(key, JSON.stringify(value));
    } catch (error) {
      return false;
    }
  }

  const LEGACY_KEYS = [
    "stats",
    "prefs",
    "summary",
    "saved_session",
    "progress_meta",
    "user_session",
    "reported_qs",
    "login_suggestion_dismissed",
    "pending_sync_queue",
    "recovery_snapshot",
  ];

  function migrateLegacyStorageKeys() {
    const store = getLocalStorage();
    let migrated = 0;

    LEGACY_KEYS.forEach((key) => {
      const legacyKey = getLegacyStorageKey(key);
      const currentKey = getStorageKey(key);
      const currentValue = safeGetItem(store, currentKey);
      const legacyValue = safeGetItem(store, legacyKey);

      if (
        currentValue === null &&
        legacyValue !== null &&
        safeSetItem(store, currentKey, legacyValue)
      ) {
        migrated += 1;
      }
    });

    return migrated;
  }

  function clearCurrentNamespace(options = {}) {
    const localStore = getLocalStorage();
    const sessionStore = getSessionStorage();
    const includeLegacy = options.includeLegacy !== false;
    const currentKeys = [];

    const collectNamespacedKeys = (store, prefix) => {
      for (let i = 0; i < store.length; i += 1) {
        const key = safeGetStorageKeyAtIndex(store, i);
        if (key && key.startsWith(prefix)) currentKeys.push([store, key]);
      }
    };

    collectNamespacedKeys(localStore, `${getStorageNamespace()}:`);
    collectNamespacedKeys(sessionStore, `${getStorageNamespace()}:`);

    let removed = 0;
    currentKeys.forEach(([store, key]) => {
      if (safeRemoveItem(store, key)) removed += 1;
    });

    if (includeLegacy) {
      LEGACY_KEYS.forEach((key) => {
        if (safeRemoveItem(localStore, getLegacyStorageKey(key))) removed += 1;
        if (safeRemoveItem(sessionStore, getLegacyStorageKey(key))) removed += 1;
      });
    }

    return removed;
  }

  function purgeOrphanedStorage(identityToKeep = null) {
    const store = getLocalStorage();
    const activeIdentity = normalizeIdentity(
      identityToKeep || getSafeStorageIdentity(),
    );
    let removed = 0;
    const keysToRemove = [];

    for (let i = 0; i < store.length; i += 1) {
      const key = safeGetStorageKeyAtIndex(store, i);
      if (!key) continue;

      const match = key.match(/^mrh_([^:]+):/);
      if (match && match[1] !== activeIdentity) keysToRemove.push(key);
    }

    keysToRemove.forEach((key) => {
      if (safeRemoveItem(store, key)) removed += 1;
    });

    LEGACY_KEYS.forEach((key) => {
      if (safeRemoveItem(store, getLegacyStorageKey(key))) removed += 1;
    });

    return removed;
  }

  function safeGetStorageKeyAtIndex(store, index) {
    try {
      return store.key(index);
    } catch (error) {
      return null;
    }
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
    clearCurrentNamespace,
  };

  if (typeof module !== "undefined" && module.exports)
    module.exports = StorageUtils;
  root.StorageUtils = StorageUtils;
  root.getCrypto = getCrypto;
  root.getPersistentStorageIdentity = getPersistentStorageIdentity;
  root.getSafeStorageIdentity = getSafeStorageIdentity;
  root.getStorageKey = getStorageKey;
  root.getLegacyStorageKey = getLegacyStorageKey;
  root.getStorageNamespace = getStorageNamespace;
})(
  typeof window !== "undefined"
    ? window
    : typeof globalThis !== "undefined"
      ? globalThis
      : this,
);
