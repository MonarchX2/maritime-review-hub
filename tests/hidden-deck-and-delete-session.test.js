const assert = require("assert");
const fs = require("fs");
const path = require("path");

const appCore = fs.readFileSync(path.join(__dirname, "../app-core.js"), "utf8");
const backendMain = fs.readFileSync(
  path.join(__dirname, "../backend/main.js"),
  "utf8",
);
const textUtils = fs.readFileSync(
  path.join(__dirname, "../text-utils.js"),
  "utf8",
);

const parserStart = backendMain.indexOf("function parsePagination(data)");
const parserEnd = backendMain.indexOf(
  "/* -------------------------------------------------------------------------- */",
  parserStart,
);
const parserBlock = backendMain.slice(parserStart, parserEnd);
assert.match(parserBlock, /function\s+parsePagination\(data\)/);
assert.doesNotMatch(parserBlock, /pagination\s*=\s*parsePagination\(data\)/);
assert.match(
  backendMain,
  /function\s+handleGetReports\(data\)[\s\S]*?var\s+pagination;/,
);
assert.match(backendMain, /reportCache\.put\(duplicateKey/);
assert.match(backendMain, /"submit_report"/);
assert.match(
  backendMain,
  /function\s+buildSummaryArrayFromAccessState[\s\S]*?isSubjectHiddenByHierarchy\(normalized,\s*metadata\)/,
);
assert.match(
  backendMain,
  /function\s+generateDeckFileName\(subject\)[\s\S]*?return\s+"deck-"\s*\+\s*record\.uuid\s*\+\s*"\.json"/,
);

assert.match(appCore, /removeStoredItem\("saved_session"\)/);
assert.match(appCore, /rebuildQuestionIndex\(\)/);
assert.match(textUtils, /function\s+isSafeImageURL\(value\)/);

console.log("hidden/deck cleanup regression checks passed");
