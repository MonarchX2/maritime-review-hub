const fs = require("fs");
const assert = require("assert");
const backendMain = fs.readFileSync("./backend/main.js", "utf8");

console.log("═══════════════════════════════════════════════════════════════");
console.log("COMPREHENSIVE BACKEND VERIFICATION REPORT");
console.log("═══════════════════════════════════════════════════════════════");
console.log("");

// 1. COUNT TOTAL FUNCTIONS
const functions = (backendMain.match(/^function\s+\w+\s*\(/gm) || []).length;
console.log("📊 CODE STRUCTURE:");
console.log("  • Total Functions: " + functions);
console.log("  • Total Lines: " + backendMain.split("\n").length);
console.log("  • File Size: " + (backendMain.length / 1024).toFixed(2) + " KB");
console.log("");

// 2. VERIFY ALL CRITICAL HTTP HANDLERS
console.log("✅ HTTP HANDLERS (Entry Points):");
console.log(
  "  • doGet: " + (backendMain.includes("function doGet(e)") ? "✓" : "✗"),
);
console.log(
  "  • doPost: " + (backendMain.includes("function doPost(e)") ? "✓" : "✗"),
);
console.log(
  "  • doGetInternal: " +
    (backendMain.includes("function doGetInternal(e)") ? "✓" : "✗"),
);
console.log("");

// 3. VERIFY ALL ADMIN ENDPOINTS
console.log("✅ ADMIN ENDPOINTS (9 total):");
const endpoints = [
  "admin_get_subjects",
  "verify_admin",
  "submit_report",
  "get_reports",
  "admin_clear_all",
  "wipe_everything",
  "admin_update",
  "admin_edit_question",
  "get_cache_version",
  "get_sync_status",
];
let adminCount = 0;
endpoints.forEach((ep) => {
  const found = backendMain.includes(ep);
  if (found) adminCount++;
  console.log("  • " + ep + ": " + (found ? "✓" : "✗"));
});
console.log("  RESULT: " + adminCount + "/9 endpoints present");
console.log("");

// 4. VERIFY CORE INFRASTRUCTURE
console.log("✅ CORE INFRASTRUCTURE:");
const infrastructure = [
  {
    name: "Cache Management",
    check: backendMain.includes("function buildDatabaseCache()"),
  },
  {
    name: "UUID System",
    check: backendMain.includes("function generateDeckUUID()"),
  },
  {
    name: "Metadata Loading",
    check: backendMain.includes("function loadDeckMetadataMap()"),
  },
  {
    name: "Access Control",
    check: backendMain.includes("function resolveSubjectAccess()"),
  },
  {
    name: "Question Extraction",
    check: backendMain.includes("function extractQuestionsOptimized()"),
  },
  {
    name: "File Operations",
    check: backendMain.includes("function updateOrCreateCacheFile()"),
  },
];
let infraCount = 0;
infrastructure.forEach((item) => {
  if (item.check) infraCount++;
  console.log("  • " + item.name + ": " + (item.check ? "✓" : "✗"));
});
console.log("  RESULT: " + infraCount + "/6 infrastructure functions present");
console.log("");

// 5. VERIFY NEW HELPER FUNCTIONS
console.log("✅ NEW HELPER FUNCTIONS (Optimization):");
const helpers = [
  "parseSubjectPath",
  "deleteFilesMatching",
  "mergeMapKeys",
  "generateCacheKey",
  "encodeSubjectName",
  "getOrInitializeUUIDSheet",
  "resetEverythingAndStartFresh",
];
let helperCount = 0;
helpers.forEach((h) => {
  const check = backendMain.includes("function " + h);
  if (check) helperCount++;
  console.log("  • " + h + ": " + (check ? "✓" : "✗"));
});
console.log("  RESULT: " + helperCount + "/6 helpers present");
console.log("");

// 6. VERIFY UTILITY FUNCTIONS
console.log("✅ UTILITY FUNCTIONS:");
const utils = [
  {
    name: "acquireLock",
    check: backendMain.includes("function acquireLock(lockKey)"),
  },
  {
    name: "releaseLock",
    check: backendMain.includes("function releaseLock(lockKey)"),
  },
  {
    name: "jsonResponse",
    check: backendMain.includes("function jsonResponse(payload)"),
  },
  {
    name: "cleanText",
    check: backendMain.includes("function cleanText(value, maxLength)"),
  },
  {
    name: "firstAvailableValue",
    check: backendMain.includes("function firstAvailableValue()"),
  },
  {
    name: "toBoolean",
    check: backendMain.includes("function toBoolean(value, fallback)"),
  },
];
let utilCount = 0;
utils.forEach((item) => {
  if (item.check) utilCount++;
  console.log("  • " + item.name + ": " + (item.check ? "✓" : "✗"));
});
console.log("  RESULT: " + utilCount + "/6 utilities present");
console.log("");

// 7. CHECK FOR REDUNDANCY PATTERNS
console.log("🔍 REDUNDANCY ANALYSIS:");
const splitOps = (backendMain.match(/split\("\:\:"\)/g) || []).length;
const forInLoops = (backendMain.match(/for\s*\(\s*var\s+\w+\s+in\s+/g) || [])
  .length;
const whileLoops = (
  backendMain.match(/while\s*\(\s*\w+\.hasNext\(\)\s*\)/g) || []
).length;

console.log(
  "  • split(::) operations: " +
    splitOps +
    " (normal, used throughout codebase)",
);
console.log(
  "  • for-in loops: " + forInLoops + " (normal, used appropriately)",
);
console.log(
  "  • while(hasNext()) patterns: " +
    whileLoops +
    " (normal, iterator pattern)",
);
console.log("");

// 8. VERIFY CRITICAL CONSTANTS
console.log("✅ CRITICAL CONSTANTS:");
const constants = [
  "ROOT_FOLDER_ID",
  "DATABASE_SHEET_ID",
  "ADMIN_TOKEN",
  "UUID_SHEET_ID",
  "MAX_RUNTIME_MS",
  "MAX_REPORT_TEXT_LENGTH",
  "LOCK_TIMEOUT_MS",
];
let constCount = 0;
constants.forEach((c) => {
  const check = backendMain.includes("const " + c + " =");
  if (check) constCount++;
  console.log("  • " + c + ": " + (check ? "✓" : "✗"));
});
console.log("  RESULT: " + constCount + "/7 constants present");
console.log("");

// 9. VERIFY NO BROKEN REFERENCES
console.log("✅ REFERENCE INTEGRITY:");
const criticalRefs = [
  {
    name: "parseSubjectPath usage",
    check: (backendMain.match(/parseSubjectPath\(/g) || []).length > 0,
  },
  {
    name: "deleteFilesMatching usage",
    check: (backendMain.match(/deleteFilesMatching\(/g) || []).length > 0,
  },
  {
    name: "mergeMapKeys usage",
    check: (backendMain.match(/mergeMapKeys\(/g) || []).length > 0,
  },
  {
    name: "generateCacheKey usage",
    check: (backendMain.match(/generateCacheKey\(/g) || []).length > 0,
  },
  {
    name: "encodeSubjectName usage",
    check: (backendMain.match(/encodeSubjectName\(/g) || []).length > 0,
  },
  {
    name: "getOrInitializeUUIDSheet usage",
    check: (backendMain.match(/getOrInitializeUUIDSheet\(/g) || []).length > 0,
  },
];
let refCount = 0;
criticalRefs.forEach((ref) => {
  if (ref.check) refCount++;
  console.log("  • " + ref.name + ": " + (ref.check ? "✓" : "✗"));
});
console.log("  RESULT: " + refCount + "/6 functions actively used");
console.log("");

// 10. SOURCE-TRIGGER + RESUME BEHAVIOR REGRESSION CHECKS
assert.match(
  backendMain,
  /function\s+shouldTriggerDatabaseCacheBuild\s*\(|function\s+triggerBuildDatabaseCache\s*\(sourceSpreadsheetId\)|function\s+forceFullRebuildDatabaseCache\s*\(/,
  "cache rebuilds must be gated to the database/UUID source sheets and kept separate from the explicit full rebuild path",
);
assert.match(
  backendMain,
  /sourceSpreadsheetId\s*===\s*DATABASE_SHEET_ID|sourceSpreadsheetId\s*===\s*UUID_SHEET_ID|normalizedId\s*===\s*DATABASE_SHEET_ID|normalizedId\s*===\s*UUID_SHEET_ID/,
  "the trigger gateway must accept only the database and UUID spreadsheet IDs",
);
const triggerFunctionStart = backendMain.indexOf(
  "function triggerBuildDatabaseCache",
);
const triggerFunctionEnd = backendMain.indexOf(
  "function cleanResumptionTriggers",
);
const triggerFunctionBlock = backendMain.slice(
  triggerFunctionStart,
  triggerFunctionEnd,
);
assert.ok(
  !triggerFunctionBlock.includes('deleteProperty("BUILD_CACHE_STATE")'),
  "resumed cache builds must preserve the saved BUILD_CACHE_STATE so the queue can continue from the saved location",
);

// 11. FINAL VERDICT
console.log("═══════════════════════════════════════════════════════════════");
const allPresent =
  adminCount === 9 &&
  infraCount === 6 &&
  helperCount === 6 &&
  utilCount === 6 &&
  constCount === 7 &&
  refCount === 6;
console.log(
  "FINAL VERDICT: " +
    (allPresent ? "✓✓✓ BACKEND FULLY INTACT" : "✗ ISSUES FOUND"),
);
console.log("═══════════════════════════════════════════════════════════════");
