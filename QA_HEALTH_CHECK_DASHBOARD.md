# QA HEALTH CHECK DASHBOARD

**Maritime Review Hub - Daily Verification Checklist**

**Last Updated:** 2026-08-14  
**Test Environment:** Production  
**Tester:** ******\_\_\_******  
**Date/Time:** ******\_\_\_******

---

## 🚀 PRE-TEST SETUP (2 min)

- [ ] Clear browser cache (optional)
- [ ] Close all tabs except this one
- [ ] Open DevTools (F12)
- [ ] Open 3 new tabs for multi-tab testing
- [ ] Browser Network tab ready (Chrome/Firefox)

---

## ✅ SECTION A: Core Functionality (8 min)

### A.1 App Loads Successfully

**Steps:** Navigate to app URL, wait for load complete  
**Acceptance:** Categories visible, no red errors

- [ ] Categories load (count: **\_**)
- [ ] No console errors (red text)
- [ ] Sync shows "connected"
- [ ] Initial overlay disappears

**Screenshot:**

```
[PASS] / [FAIL] - Details: _____________________
```

---

### A.2 Quiz Launch & Session

**Steps:** Click category → Click deck → Start Quiz → Answer 3 questions → End Session

- [ ] Quiz loads instantly
- [ ] Questions display correctly
- [ ] Answers recordable (radio/checkbox work)
- [ ] Session progress tracked
- [ ] Session ends without errors

**Screenshot:**

```
[PASS] / [FAIL] - Session ID: _________________
```

---

### A.3 Study Mode

**Steps:** Navigate to Study → Pick a deck → Verify no network activity

- [ ] Study loads instantly (should be cached)
- [ ] Page navigation works (next/prev buttons)
- [ ] NO network requests (DevTools Network empty)
- [ ] Questions from cache

**Screenshot:**

```
[PASS] / [FAIL] - Pages loaded: _______________
```

---

### A.4 Discovery/Search

**Steps:** Go to Discovery → Type keyword → Observe instant results

- [ ] Search works instantly (client-side)
- [ ] Results show relevant content
- [ ] NO network requests
- [ ] Clear search resets results

**Screenshot:**

```
[PASS] / [FAIL] - Results found: ______________
```

---

## 📡 SECTION B: Multi-Tab Synchronization (10 min)

### B.1 Leader Election

**Steps:** Check 3 open tabs' leader status

**Tab A Console:**

```javascript
console.log("Tab ID:", window.mrh_tabId, "Is Leader:", isLeaderTab);
```

- [ ] Tab A: Leader (true)
- [ ] Tab B: Follower (false)
- [ ] Tab C: Follower (false)
- [ ] All have unique IDs

**Result:**

```
Tab A ID: ________________  [Leader: YES / NO]
Tab B ID: ________________  [Leader: YES / NO]
Tab C ID: ________________  [Leader: YES / NO]
```

---

### B.2 Polling on Leader Only

**Steps:** Check Network tab for polling requests

**Tab A (Leader) Network:**

- [ ] Observe POST to DB_URL every 25-40 seconds
- [ ] Check for "If-None-Match" header
- [ ] If cache unchanged: Status **304 Not Modified**
- [ ] If cache changed: Status **200 OK**

**Tab B (Follower) Network:**

- [ ] Should be EMPTY (no requests)
- [ ] No cache version checks
- [ ] No polling traffic

**Tab C (Follower) Network:**

- [ ] Should be EMPTY (no requests)

**Result:**

```
Leader (Tab A): Polling [YES] - Every 25-40 seconds
Follower (Tab B): Polling [NO]
Follower (Tab C): Polling [NO]
✓ Traffic reduced ~66%
```

---

### B.3 Cache Invalidation Broadcast

**Steps:** Manually trigger invalidation, watch all tabs

**In Tab A Console:**

```javascript
if (typeof leaderElectionChannel !== "undefined") {
  leaderElectionChannel.postMessage({
    type: "cache_invalidated",
    timestamp: new Date().toISOString(),
    cacheVersion: localCacheVersion + 1,
  });
}
```

**Expected Behavior (All 3 Tabs):**

- [ ] Toast notification appears: "Deck settings updated by admin..."
- [ ] Toast disappears after 2-3 seconds
- [ ] Database silently syncs (NO page reload)
- [ ] Categories may refresh if admin changed them

**Result:**

```
Tab A Toast: [APPEARED / MISSING]
Tab B Toast: [APPEARED / MISSING]
Tab C Toast: [APPEARED / MISSING]

All toasts synchronized: [YES / NO]
```

---

### B.4 BroadcastChannel Fallback

**Steps:** Check if BroadcastChannel supported

**Console Check:**

```javascript
console.log(
  "BroadcastChannel:",
  typeof BroadcastChannel !== "undefined" ? "Supported" : "Fallback",
);
```

- [ ] Chrome: ✓ Supported
- [ ] Firefox: ✓ Supported
- [ ] Safari: ✓ Supported
- [ ] Edge: ✓ Supported
- [ ] If unsupported: Single-tab mode activates

**Result:**

```
BroadcastChannel: [SUPPORTED / FALLBACK]
```

---

## 🛡️ SECTION C: Service Worker & Offline (8 min)

### C.1 Service Worker Active

**Steps:** DevTools → Application → Service Workers

- [ ] Status: "activated and running"
- [ ] Registration: Active
- [ ] Offline: Support verified

**DevTools View:**

```
Status: [activated and running]
Scope: https://[domain]/
Running: [active]
```

---

### C.2 Cache Storage Contents

**Steps:** DevTools → Application → Cache Storage → Expand cache

**Expected Cached Files:**

- [ ] index.html
- [ ] app-core.js
- [ ] admin.js
- [ ] styles.css
- [ ] Tailwind CSS (CDN)
- [ ] FontAwesome (CDN)
- [ ] Chart.js (CDN)

**Cache Name:** `mrh-app-shell-v1` (or current version)

```
Cache: mrh-app-shell-v1
├─ index.html ............ [Size: ____ KB]
├─ app-core.js ........... [Size: ____ KB]
├─ admin.js .............. [Size: ____ KB]
├─ styles.css ............ [Size: ____ KB]
└─ CDN assets ............ [Count: ____]
```

---

### C.3 Offline Mode Test

**Steps:** DevTools Network → Throttle to "Offline"

**Before Going Offline:**

- [ ] App loaded with data
- [ ] Categories visible

**Go Offline:**

1. DevTools → Network → Offline checkbox
2. Refresh page (Cmd+R or F5)
3. Observe

**Expected:**

- [ ] App shell loads from Service Worker cache
- [ ] Categories still visible (cached)
- [ ] No network errors
- [ ] Graceful offline message (if any)

**Result:**

```
Offline load: [SUCCESS / FAILED]
Cached content visible: [YES / NO]
Error messages: [NONE / ___________]
```

**Go Online Again:**

1. DevTools → Network → Offline unchecked
2. Observe app attempts to reconnect

- [ ] Sync resumes within 10 seconds
- [ ] Toast or status shows "reconnected"
- [ ] Fresh data loads

---

## 🔐 SECTION D: Admin Panel & Conflict Detection (6 min)

### D.1 Admin Login

**Steps:** Navigate to admin panel, login

- [ ] Admin panel loads
- [ ] Token input visible
- [ ] Login button functional

**Result:**

```
Admin panel accessible: [YES / NO]
```

---

### D.2 Optimistic UI Lock During Save

**Steps:** Make change → Click "Save Layout" → Observe UI immediately

**During Save (First 1-2 seconds):**

- [ ] Button text changes to: ⏳ "Syncing with cloud..."
- [ ] Button disabled (can't click again)
- [ ] All inputs disabled (grayed out)
- [ ] Inputs show opacity-50 effect

**Console Verification:**

```javascript
console.log("Admin save in progress:", adminSaveInProgress);
console.log("Inputs locked:", adminInputsLocked);
```

- [ ] Both show: `true`

**After Save (1.5 seconds):**

- [ ] Button shows: ✓ "Saved ✓"
- [ ] Button turns green
- [ ] Inputs re-enabled
- [ ] State resets

**Result:**

```
Optimistic UI Lock: [WORKING / BROKEN]
Save time: ________ seconds
```

---

### D.3 Concurrent Admin Conflict Detection

**Steps:** Two browser windows with admin panel

**Window 1:**

1. Load admin panel → Note timestamp
2. Make a change BUT DON'T SAVE

**Window 2:**

1. Load admin panel → Note same timestamp
2. Make a DIFFERENT change
3. Click "Save Layout" → Should succeed ✓

**Window 1:**

1. Click "Save Layout"
2. Should see alert: "Conflict detected: Another admin has made changes..."

**Result:**

```
Conflict detected: [YES / NO]
Alert message: [SHOWN / MISSING]
Refresh action: [AVAILABLE / MISSING]
```

---

## 💾 SECTION E: Data Integrity (5 min)

### E.1 No Orphaned References (0/0 decks)

**Steps:** Run console script

**Console Script:**

```javascript
const appSubjects = new Set(
  (state.categorySummary || []).map((c) => c.Subject),
);
const adminSubjects = new Set(
  (adminState.subjects || []).map((s) => s.Subject),
);
const orphaned = [...adminSubjects].filter((s) => !appSubjects.has(s));
console.log("Orphaned entries:", orphaned.length, orphaned);
```

- [ ] Orphaned entries: 0
- [ ] All subjects in both lists
- [ ] No "0/0" decks in admin panel

**Result:**

```
Total orphaned: ________ [Should be 0]
Sample orphaned: _______________________
```

---

### E.2 Question Index Integrity

**Steps:** Verify no duplicate questions

**Console Script:**

```javascript
const index = ensureQuestionIndex?.();
const questions = state.db || [];
const ids = new Set();
let dups = 0;
questions.forEach((q) => {
  if (q?.id) {
    if (ids.has(q.id)) dups++;
    ids.add(q.id);
  }
});
console.log(
  "Total:",
  questions.length,
  "Unique:",
  ids.size,
  "Duplicates:",
  dups,
);
```

- [ ] Duplicates: 0
- [ ] All questions unique
- [ ] No missing IDs

**Result:**

```
Total questions: ________
Unique IDs: ________
Duplicates: ________ [Should be 0]
```

---

### E.3 Progress Persistence

**Steps:** Complete quiz → End session → Reload page

**Before Reload:**

```javascript
console.log("Completed questions:", state.stats?.completedQs?.length || 0);
console.log("Mistakes:", state.stats?.mistakes?.length || 0);
```

**After Page Reload:**

```javascript
console.log("Completed questions:", state.stats?.completedQs?.length || 0);
console.log("Mistakes:", state.stats?.mistakes?.length || 0);
```

- [ ] Counts match before/after
- [ ] Progress saved to localStorage
- [ ] No data loss

**Result:**

```
Progress preserved: [YES / NO]
Before reload: Completed _____, Mistakes _____
After reload: Completed _____, Mistakes _____
```

---

## 🚀 SECTION F: Performance (4 min)

### F.1 Initial Load Speed

**Steps:** Use DevTools Lighthouse or monitor timeline

- [ ] First Contentful Paint (FCP): < 2s
- [ ] Largest Contentful Paint (LCP): < 3s
- [ ] Time to Interactive (TTI): < 3s
- [ ] Database sync: < 5s

**Result:**

```
FCP: ________ ms [Target: < 2000]
LCP: ________ ms [Target: < 3000]
TTI: ________ ms [Target: < 3000]
Sync: ________ ms [Target: < 5000]
```

---

### F.2 ETag/304 Response Efficiency

**Steps:** Monitor polling requests in Network tab (wait 30s)

**First Request (will be 200):**

- [ ] Status: 200 OK
- [ ] Response size: ~8-12 KB
- [ ] Time: ~500ms

**Second Request (should be 304):**

- [ ] Status: 304 Not Modified
- [ ] Response size: ~0 KB (0 bytes body)
- [ ] Time: ~50ms
- [ ] Bandwidth saved: ~99%

**Result:**

```
First poll (200): Size _____ KB, Time _____ ms
Second poll (304): Size _____ KB, Time _____ ms
Savings: ~99% bandwidth on unchanged cache ✓
```

---

### F.3 Network Requests Summary

**Steps:** Open DevTools Network tab, perform full user journey

**Expected Counts:**

- [ ] HTML: 1
- [ ] JS (app): ~5-8
- [ ] CSS: ~2-3
- [ ] API calls (DB_URL): ~2-5 (depending on polling)

```
Total requests: ________
Total size: ________ MB
Cached requests: ________ (should be >50%)
```

---

## 🌐 SECTION G: Browser Compatibility (3 min)

### Test Each Browser

#### Chrome

- [ ] App loads
- [ ] Quiz works
- [ ] Multi-tab sync works
- [ ] Service Worker active
- [ ] No errors

**Result:** [PASS / FAIL] **********\_\_\_**********

#### Firefox

- [ ] App loads
- [ ] Quiz works
- [ ] Multi-tab sync works
- [ ] Service Worker active
- [ ] No errors

**Result:** [PASS / FAIL] **********\_\_\_**********

#### Safari

- [ ] App loads
- [ ] Quiz works
- [ ] Falls back to single-tab mode (no BroadcastChannel)
- [ ] Service Worker active
- [ ] No errors

**Result:** [PASS / FAIL] **********\_\_\_**********

#### Edge

- [ ] App loads
- [ ] Quiz works
- [ ] Multi-tab sync works
- [ ] Service Worker active
- [ ] No errors

**Result:** [PASS / FAIL] **********\_\_\_**********

---

## 📊 FINAL SUMMARY

### Overall Status

| Category           | Status      | Issues       |
| ------------------ | ----------- | ------------ |
| Core Functionality | [PASS/FAIL] | ****\_\_**** |
| Multi-Tab Sync     | [PASS/FAIL] | ****\_\_**** |
| Service Worker     | [PASS/FAIL] | ****\_\_**** |
| Data Integrity     | [PASS/FAIL] | ****\_\_**** |
| Admin Panel        | [PASS/FAIL] | ****\_\_**** |
| Performance        | [PASS/FAIL] | ****\_\_**** |
| Compatibility      | [PASS/FAIL] | ****\_\_**** |

### Test Coverage

- [ ] **A.1-A.4:** Core Functionality ✓
- [ ] **B.1-B.4:** Multi-Tab Sync ✓
- [ ] **C.1-C.3:** Service Worker ✓
- [ ] **D.1-D.3:** Admin Panel ✓
- [ ] **E.1-E.3:** Data Integrity ✓
- [ ] **F.1-F.3:** Performance ✓
- [ ] **G:** Browser Compatibility ✓

### Sign-Off

**Tester Name:** ************\_\_\_************  
**Date:** ************\_\_\_************  
**Overall Status:**

```
[✓ ALL PASS] [⚠ SOME ISSUES] [✗ CRITICAL FAILURES]
```

**Issues Found:**

```
1. ________________________________________
2. ________________________________________
3. ________________________________________
```

**Recommendations:**

```
________________________________________
________________________________________
________________________________________
```

---

## 🔄 After-Fix Verification Checklist

If issues found, verify fixes with:

- [ ] **A.1** Core load ✓
- [ ] **B.2** No redundant polling ✓
- [ ] **B.3** All tabs sync ✓
- [ ] **C.1** Service Worker status ✓
- [ ] **D.2** Optimistic UI lock ✓
- [ ] **E.1** No orphaned data ✓
- [ ] **F.2** 304 responses ✓

---

## 🔗 Reference Links

- Full Test Plan: [QA_TEST_PLAN_PHASE3.md](QA_TEST_PLAN_PHASE3.md)
- Quick Reference: [QA_QUICK_REFERENCE.md](QA_QUICK_REFERENCE.md)
- Verification Report: [PHASE3_VERIFICATION_REPORT.md](PHASE3_VERIFICATION_REPORT.md)

---

**Print this checklist and bring to QA sessions!**
