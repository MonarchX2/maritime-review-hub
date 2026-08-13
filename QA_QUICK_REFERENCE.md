# QA QUICK REFERENCE - Essential Console Scripts

**Maritime Review Hub - One-Minute Validation Toolkit**

---

## Quick Health Check (Copy & Paste)

```javascript
// Run this in any tab's console (F12) for instant status
console.clear();
console.log(
  "%c⚡ QUICK HEALTH CHECK",
  "font-size:14px;font-weight:bold;color:#0066cc",
);

const health = {
  app: typeof state !== "undefined" && state?.categorySummary?.length > 0,
  sync: syncConnected === true,
  sw: "serviceWorker" in navigator,
  bc: typeof BroadcastChannel !== "undefined",
  leader: isLeaderTab || false,
  online: navigator.onLine,
};

console.table(health);
console.log(
  Object.values(health).every((v) => v) ? "✓ HEALTHY" : "⚠ CHECK DETAILS",
);
```

---

## 1. Initial Load Validation (< 1 minute)

```javascript
console.log("=== LOAD COMPLETE? ===");
console.log("✓ Categories:", state.categorySummary?.length, "loaded");
console.log("✓ Sync connected:", syncConnected);
console.log(
  "✓ Service Worker:",
  navigator.serviceWorker?.controller ? "Active" : "Inactive",
);
console.log(
  "✓ Errors:",
  document.querySelectorAll('[class*="error"], [class*="Error"]').length,
  "elements",
);
```

---

## 2. Multi-Tab Sync Status (Run in each tab)

```javascript
console.log("=== THIS TAB ===");
console.log("Tab ID:", window.mrh_tabId);
console.log("Is Leader:", isLeaderTab ? "YES ✓" : "NO (follower)");
console.log(
  "BroadcastChannel active:",
  typeof leaderElectionChannel !== "undefined" ? "✓" : "✗",
);

// Expected: Only ONE tab shows "Is Leader: YES", others show "NO"
```

---

## 3. Polling Verification (Leader Tab Only)

```javascript
console.log("=== POLLING STATUS ===");
console.log("Interval (ms):", pollingIntervalMs);
console.log(
  "Timer active:",
  cacheVersionCheckTimer ? "✓ Running" : "✗ Stopped",
);
console.log("Last ETag:", lastCacheVersionHash || "None yet");
console.log("Cache version:", localCacheVersion);
console.log("Failure retries:", failureRetryCount);
```

**Expected:** Timer shows a number (milliseconds), Last ETag shows hash

---

## 4. Admin State Check

```javascript
console.log("=== ADMIN STATE ===");
console.log("Token:", adminState.token ? "✓ Set" : "✗ Not set");
console.log("Subjects loaded:", adminState.subjects?.length || 0);
console.log(
  "Timestamp for conflict detection:",
  adminState.admin_last_modified_timestamp || "Not loaded",
);
```

---

## 5. Service Worker Status

```javascript
console.log("=== SERVICE WORKER ===");
const sw = navigator.serviceWorker?.controller;
console.log("Registered:", navigator.serviceWorker ? "✓" : "✗");
console.log("Active:", sw ? "✓" : "✗");
console.log("URL:", sw?.scriptURL || "N/A");

// Check cache
caches.keys().then((names) => {
  console.log("Cache stores:", names);
  names.forEach((name) => {
    caches.open(name).then((cache) => {
      cache.keys().then((urls) => {
        console.log(`  ${name}: ${urls.length} items`);
      });
    });
  });
});
```

---

## 6. Data Integrity (Orphaned References Check)

```javascript
console.log("=== DATA INTEGRITY ===");

const appSubjects = new Set(
  (state.categorySummary || []).map((c) => c.Subject),
);
const adminSubjects = new Set(
  (adminState.subjects || []).map((s) => s.Subject),
);

console.log("App subjects:", appSubjects.size);
console.log("Admin subjects:", adminSubjects.size);

const orphaned = [...adminSubjects].filter((s) => !appSubjects.has(s));
if (orphaned.length > 0) {
  console.warn("⚠ Orphaned (0/0):", orphaned);
} else {
  console.log("✓ No orphaned references");
}
```

---

## 7. Network Request Monitor

```javascript
console.log("=== MONITORING NETWORK ===");

// Intercept all fetch requests to DB_URL
const originalFetch = window.fetch;
let requestCount = 0;

window.fetch = function (...args) {
  if (args[0]?.includes?.("script.google.com")) {
    const body = args[1]?.body;
    const type = body?.includes?.("get_cache_version")
      ? "POLL"
      : body?.includes?.("admin_update")
        ? "ADMIN"
        : "DATA";
    console.log(
      `[${++requestCount}] ${type}:`,
      new Date().toLocaleTimeString(),
    );
  }
  return originalFetch.apply(this, args);
};

console.log("Monitoring active. Check console for requests.");
```

---

## 8. Toast Notification Monitor

```javascript
console.log("=== WATCHING TOASTS ===");

// Watch for toast notifications
const observer = new MutationObserver((mutations) => {
  mutations.forEach((m) => {
    if (m.addedNodes.length) {
      m.addedNodes.forEach((node) => {
        if (node.id?.includes("toast") || node.className?.includes("toast")) {
          console.log("[TOAST]", node.textContent);
        }
      });
    }
  });
});

const container =
  document.getElementById("app-toast-container") || document.body;
observer.observe(container, { childList: true, subtree: true });
console.log("Toast monitor active");
```

---

## 9. Session Progress Tracking

```javascript
console.log("=== SESSION PROGRESS ===");
console.log("Session active:", state.session?.active);
console.log("Subject:", state.session?.subject);
console.log("Questions attempted:", state.session?.attempted?.length || 0);
console.log("Completed questions:", state.stats?.completedQs?.length || 0);
console.log("Mistakes:", state.stats?.mistakes?.length || 0);

// Check if saved
console.log("Saved to storage:", localStorage.getItem("mrh_state") ? "✓" : "✗");
```

---

## 10. Offline/Online Transition Test

```javascript
console.log("=== OFFLINE MODE TEST ===");

// Monitor online/offline
document.addEventListener("online", () => {
  console.log("[ONLINE] Connected at", new Date().toLocaleTimeString());
  console.log("Sync connected:", syncConnected);
});

document.addEventListener("offline", () => {
  console.log("[OFFLINE] Disconnected at", new Date().toLocaleTimeString());
  console.log("Has cached data:", (state.categorySummary?.length || 0) > 0);
});

console.log("Current status:", navigator.onLine ? "ONLINE" : "OFFLINE");
console.log("Monitoring... Open DevTools Network → Offline to test");
```

---

## 11. Admin Save Validation

```javascript
console.log("=== ADMIN SAVE TEST ===");

// Monitor save button state
const saveBtn = document.querySelector('[onclick*="saveAdminChanges"]');
if (saveBtn) {
  console.log("Save button found: ✓");
  console.log("Currently disabled:", saveBtn.disabled);
  console.log("Button text:", saveBtn.textContent);
  console.log("Admin save in progress:", adminSaveInProgress);
  console.log("Inputs locked:", adminInputsLocked);
} else {
  console.log("Save button not found - check selector");
}

// Try to make a change and save to test optim UI lock
```

---

## 12. Browser Compatibility Check

```javascript
console.log("=== BROWSER COMPATIBILITY ===");
console.log("Browser:", navigator.userAgent.split(" ").slice(-3).join(" "));
console.log(
  "BroadcastChannel:",
  typeof BroadcastChannel !== "undefined" ? "✓" : "✗",
);
console.log("Service Worker:", "serviceWorker" in navigator ? "✓" : "✗");
console.log("Fetch API:", typeof fetch !== "undefined" ? "✓" : "✗");
console.log("LocalStorage:", typeof localStorage !== "undefined" ? "✓" : "✗");
console.log("IndexedDB:", typeof indexedDB !== "undefined" ? "✓" : "✗");

// Fallback mode?
const fallback = typeof BroadcastChannel === "undefined";
console.log(
  "Using fallback mode:",
  fallback ? "YES (single-tab)" : "NO (multi-tab)",
);
```

---

## 13. Polling Interval Distribution (Wait 2+ minutes)

```javascript
console.log("=== POLLING JITTER TEST ===");

// Run this BEFORE polling events happen
const pollingIntervals = [];
let lastTime = Date.now();

// Hook into cache version checks
const originalCheck = window.checkCacheVersionWithETag;
window.checkCacheVersionWithETag = async function () {
  const now = Date.now();
  const interval = now - lastTime;
  if (lastTime > 0) {
    pollingIntervals.push(interval);
    console.log(
      `Poll #${pollingIntervals.length}: ${(interval / 1000).toFixed(1)}s`,
    );
  }
  lastTime = now;
  return originalCheck.call(this);
};

console.log("Collecting polling intervals...");
console.log("Wait 2+ minutes, then run:");
console.log("  JSON.stringify(pollingIntervals.map(i => (i/1000).toFixed(1)))");
console.log("Expected: values between 25-40 seconds with variation");
```

---

## 14. Cache Update Simulation

```javascript
console.log("=== TESTING CACHE UPDATE ===");

// Simulate cache version change
if (isLeaderTab) {
  console.log("As leader, simulating version update...");

  // Broadcast to all tabs
  if (typeof leaderElectionChannel !== "undefined") {
    leaderElectionChannel.postMessage({
      type: "cache_invalidated",
      timestamp: new Date().toISOString(),
      cacheVersion: localCacheVersion + 1,
    });
    console.log("Sent cache invalidation to all tabs");
    console.log("Watch for toast notification across tabs");
  }
}
```

---

## 15. Full Diagnostic Dump

```javascript
console.clear();
console.log(
  "%c📋 FULL DIAGNOSTICS",
  "font-size:16px;font-weight:bold;color:#0066cc",
);

const diagnostics = {
  "=== APP STATE ===": {
    categoriesLoaded: state.categorySummary?.length || 0,
    questionsLoaded: state.db?.length || 0,
    syncConnected,
    userLoggedIn: typeof userState !== "undefined" && userState.isLoggedIn,
  },
  "=== CACHE & POLLING ===": {
    localCacheVersion,
    remoteCacheVersion,
    lastCacheHash: lastCacheVersionHash?.substring(0, 10) + "..." || "None",
    pollingActive: cacheVersionCheckTimer ? "✓" : "✗",
  },
  "=== MULTI-TAB ===": {
    tabId: window.mrh_tabId?.substring(0, 15) + "..." || "None",
    isLeader: isLeaderTab,
    bcChannelActive: typeof leaderElectionChannel !== "undefined",
  },
  "=== ADMIN ===": {
    token: adminState.token ? "Set" : "Not set",
    subjectsLoaded: adminState.subjects?.length || 0,
    lastTimestamp:
      adminState.admin_last_modified_timestamp?.substring(0, 19) || "None",
  },
  "=== SERVICE WORKER ===": {
    registered: navigator.serviceWorker ? "✓" : "✗",
    active: navigator.serviceWorker?.controller ? "✓" : "✗",
  },
  "=== NETWORK ===": {
    online: navigator.onLine,
    effectiveType: navigator.connection?.effectiveType || "unknown",
  },
  "=== ERRORS ===": {
    consoleErrors: document.querySelectorAll('[class*="error"]').length,
    networkErrors: 0, // Check Network tab
  },
};

Object.entries(diagnostics).forEach(([section, values]) => {
  console.log(section);
  console.table(values);
});

console.log("%c✓ Diagnostics complete", "color:green;font-weight:bold");
```

---

## Quick Copy/Paste - All 15 Scripts

```javascript
// Copy the full block below and paste once, then pick scripts to run

// Script 1: Quick Health Check
(() => {
  const h = {
    app: typeof state != "undefined" && state?.categorySummary?.length > 0,
    sync: syncConnected === true,
    sw: "serviceWorker" in navigator,
    bc: typeof BroadcastChannel != "undefined",
    leader: isLeaderTab || false,
    online: navigator.onLine,
  };
  console.table(h);
  console.log(
    Object.values(h).every((v) => v) ? "✓ HEALTHY" : "⚠ CHECK DETAILS",
  );
})();

// Then run individual scripts from the sections above as needed
```

---

## Troubleshooting Guide

| Symptom                   | Check           | Fix                               |
| ------------------------- | --------------- | --------------------------------- |
| Duplicate loading overlay | See Section D.2 | Already patched in Phase 3        |
| Multiple tabs polling     | Run Script 2    | Only leader should poll           |
| Orphaned 0/0 decks        | Run Script 6    | Run admin cleanup                 |
| Toast not showing         | Run Script 8    | Check DOM for toast container     |
| Admin save fails          | Run Script 11   | Check timestamp, refresh admin    |
| Service Worker inactive   | Run Script 5    | Unregister → Clear cache → Reload |
| Offline not working       | Run Script 10   | Check cache contents              |
| High network usage        | Run Script 3    | Check if 304s returning           |

---

## One-Liner Status Checks

```javascript
// Copy any of these for instant status

// 1. Is everything working?
console.log(
  typeof state != "undefined" &&
    syncConnected &&
    state?.categorySummary?.length > 0
    ? "✓ OK"
    : "✗ ISSUE",
);

// 2. Leader elected?
console.log(isLeaderTab ? "👑 LEADER" : "👤 FOLLOWER");

// 3. Cached data available?
console.log(
  (state?.categorySummary?.length || 0) > 0 ? "💾 Data" : "📡 Needs sync",
);

// 4. Offline ready?
console.log(navigator.serviceWorker?.controller ? "📴 Ready" : "⚠ Not ready");

// 5. Admin ready?
console.log(adminState?.token ? "🔐 Authenticated" : "❌ Not authenticated");
```

---

## Performance Metrics

```javascript
// Copy and run to get performance report
console.log("=== PERFORMANCE METRICS ===");

// Time since load
const perfData = performance.getEntriesByType("navigation")[0];
console.log(
  "DOM Content Loaded:",
  Math.round(
    perfData.domContentLoadedEventEnd - perfData.domContentLoadedEventStart,
  ),
  "ms",
);

// Navigation timing
console.log(
  "First byte (TTFB):",
  Math.round(perfData.responseStart - perfData.requestStart),
  "ms",
);
console.log(
  "Total load time:",
  Math.round(perfData.loadEventEnd - perfData.fetchStart),
  "ms",
);

// Render timing
const paintEntries = performance.getEntriesByType("paint");
paintEntries.forEach((entry) => {
  console.log(entry.name + ":", Math.round(entry.startTime), "ms");
});
```

---

**Save this page in your favorites for quick reference during testing!**
