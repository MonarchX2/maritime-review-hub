const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const properties = new Map();
const cacheValues = new Map();
const spreadsheetId = "1234567890123456789012345678901234567890123";
const oldDeviceId = "01234567-89ab-4cde-8fab-0123456789ab";
let tokenClaims = {};
let tokenFetchFailures = 0;
let spreadsheetTimeZone = "";
const accountRows = [
  [
    "Email",
    "Device Identity",
    "Last Name",
    "First Name",
    "Middle Initial",
    "Active",
  ],
  ["reviewer@example.com", oldDeviceId, "Reviewer", "Rita", "A", "TRUE"],
];
const legacyAccountRows = [
  [
    "Email",
    "Device Identity",
    "Last Name",
    "First Name",
    "Middle Initial",
    "Active",
  ],
  [
    "REVIEWER@example.com",
    oldDeviceId.toUpperCase(),
    "Reviewer",
    "Rita",
    "A",
    "TRUE",
  ],
  [
    "second-reviewer@example.com",
    "11234567-89ab-4cde-8fab-0123456789ab",
    "Second",
    "Rae",
    "",
    "FALSE",
  ],
];
const oldLogHeaders = [
  "Timestamp",
  "Email",
  "Device Identity",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Event",
];
const currentLogHeaders = [
  "Timestamp",
  "Email",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Event",
];
const reviewerLogs = [
  oldLogHeaders,
  [
    "2026-10-01T08:00:00.000Z",
    "reviewer@example.com",
    oldDeviceId,
    "Reviewer",
    "Rita",
    "A",
    "SIGN_IN:TRUE",
  ],
  [
    "2026-10-01 16:01:00",
    "reviewer@example.com",
    oldDeviceId,
    "Reviewer",
    "Rita",
    "A",
    "ACCESS",
  ],
];
const appendedRows = {
  SYLLABUS: [],
  MODULE: [],
  REVIEWERS: [],
  "SIGN-IN": [],
};

function createSheet(rows) {
  return {
    getLastRow: () => rows.length,
    getLastColumn: () =>
      rows.reduce((count, row) => Math.max(count, row.length), 0),
    getRange(startRow, startColumn, rowCount, columnCount) {
      return {
        getDisplayValues() {
          return Array.from({ length: rowCount }, (_, rowIndex) =>
            Array.from({ length: columnCount }, (_, columnIndex) =>
              String(
                rows[startRow - 1 + rowIndex]?.[
                  startColumn - 1 + columnIndex
                ] ?? "",
              ),
            ),
          );
        },
        createTextFinder(searchText) {
          let ignoreCase = false;
          let entireCell = false;
          const finder = {
            matchCase(value) {
              ignoreCase = !value;
              return finder;
            },
            matchEntireCell(value) {
              entireCell = value;
              return finder;
            },
            findAll() {
              const expected = ignoreCase
                ? String(searchText).toLowerCase()
                : String(searchText);
              return rows
                .slice(startRow - 1, startRow - 1 + rowCount)
                .flatMap((row, index) => {
                  const actual = String(row[startColumn - 1] ?? "");
                  const candidate = ignoreCase
                    ? actual.toLowerCase()
                    : actual;
                  const matches = entireCell
                    ? candidate === expected
                    : candidate.includes(expected);
                  return matches
                    ? [{ getRow: () => startRow + index }]
                    : [];
                });
            },
          };
          return finder;
        },
        setValues(values) {
          values.forEach((valueRow, rowIndex) => {
            const targetIndex = startRow - 1 + rowIndex;
            if (!rows[targetIndex]) rows[targetIndex] = [];
            valueRow.forEach((value, columnIndex) => {
              rows[targetIndex][startColumn - 1 + columnIndex] = value;
            });
          });
        },
        clearContent() {
          rows.splice(startRow - 1, rowCount);
        },
        setNumberFormat() {},
      };
    },
    deleteRows(startRow, count) {
      rows.splice(startRow - 1, count);
    },
  };
}

const sheets = {
  ACCOUNTS: createSheet(accountRows),
  Accounts: createSheet(legacyAccountRows),
  SYLLABUS: createSheet([currentLogHeaders]),
  MODULE: createSheet([currentLogHeaders]),
  REVIEWERS: createSheet(reviewerLogs),
};
const spreadsheet = {
  getId: () => spreadsheetId,
  getUrl: () => `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  getSheetByName: (name) => sheets[name] || null,
  insertSheet(name) {
    const rows = name === "ACCOUNTS" ? accountRows : [];
    sheets[name] = createSheet(rows);
    return sheets[name];
  },
  deleteSheet(sheet) {
    const name = Object.keys(sheets).find((key) => sheets[key] === sheet);
    if (name) delete sheets[name];
  },
  setSpreadsheetTimeZone(timeZone) {
    spreadsheetTimeZone = timeZone;
  },
};

const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || "",
      setProperty: (key, value) => properties.set(key, String(value)),
    }),
  },
  CacheService: {
    getScriptCache: () => ({
      get: (key) => cacheValues.get(key) || null,
      put: (key, value) => cacheValues.set(key, value),
      remove: (key) => cacheValues.delete(key),
    }),
  },
  SpreadsheetApp: {
    openById(id) {
      assert.equal(id, spreadsheetId);
      return spreadsheet;
    },
  },
  LockService: {
    getScriptLock: () => ({
      tryLock: () => true,
      releaseLock() {},
    }),
  },
  Sheets: {
    Spreadsheets: {
      Values: {
        append(resource, id, range, options) {
          assert.equal(id, spreadsheetId);
          assert.equal(options.valueInputOption, "RAW");
          const sheetName = range.split("!")[0];
          if (sheetName === "ACCOUNTS") accountRows.push(...resource.values);
          else {
            assert.ok(appendedRows[sheetName], `unexpected log sheet ${sheetName}`);
            appendedRows[sheetName].push(...resource.values);
            const targetRows =
              sheetName === "REVIEWERS" ? reviewerLogs : null;
            if (targetRows) targetRows.push(...resource.values);
          }
          return { updates: { updatedRows: resource.values.length } };
        },
      },
    },
  },
  Utilities: {
    DigestAlgorithm: { SHA_256: "SHA_256" },
    Charset: { UTF_8: "UTF_8" },
    computeDigest(_algorithm, value) {
      return Array.from(
        crypto.createHash("sha256").update(String(value), "utf8").digest(),
        (byte) => (byte > 127 ? byte - 256 : byte),
      );
    },
    base64Encode(value) {
      return Buffer.from(value).toString("base64");
    },
    formatDate(date, timeZone, format) {
      assert.equal(timeZone, "Asia/Manila");
      assert.equal(format, "yyyy-MM-dd HH:mm:ss");
      return new Date(
        new Date(date).getTime() + 8 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
    },
  },
  UrlFetchApp: {
    fetch(url, options) {
      assert.match(url, /^https:\/\/(?:oauth2\.googleapis\.com\/tokeninfo|www\.googleapis\.com\/oauth2\/v3\/tokeninfo)\?id_token=/);
      assert.equal(options.muteHttpExceptions, true);
      if (tokenFetchFailures > 0) {
        tokenFetchFailures -= 1;
        throw new Error("simulated endpoint outage");
      }
      return {
        getResponseCode: () => 200,
        getContentText: () => JSON.stringify(tokenClaims),
      };
    },
  },
  ContentService: {
    MimeType: { JSON: "application/json" },
    createTextOutput(text) {
      return {
        setMimeType() {
          return this;
        },
        getContent: () => text,
      };
    },
  },
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("backend/main.js", "utf8"), context, {
  filename: "backend/main.js",
});

const clientId = "1234567890-example.apps.googleusercontent.com";
const appVersion = "mrh-release-26.10.16-24";
const validClaims = (email) => ({
  aud: clientId,
  iss: "https://accounts.google.com",
  exp: String(Math.floor(Date.now() / 1000) + 300),
  email: email || "reviewer@example.com",
  email_verified: "true",
  picture: "https://lh3.googleusercontent.com/a/example-profile",
});
const post = (data) =>
  JSON.parse(
    context
      .doPost({
        postData: {
          contents: JSON.stringify({ ...data, appVersion }),
        },
      })
      .getContent(),
  );
const eventId = (digit) =>
  `${digit}1234567-89ab-4cde-8fab-0123456789ab`;
const authRequest = (type, idToken, id) => ({
  type,
  idToken,
  eventId: id || eventId("0"),
});

assert.equal(
  post(authRequest("verify_reviewer_access", "unconfigured")).code,
  "FEATURE_DISABLED",
  "authorization must fail closed until configured",
);
assert.equal(
  post({
    type: "verify_reviewer_access",
    idToken: "missing-event-id",
  }).code,
  "BAD_REQUEST",
  "the backend should require an event ID so auth events can be deduplicated",
);
properties.set("MRH_GOOGLE_OAUTH_CLIENT_ID", clientId);
properties.set("MRH_ACCOUNTS_SPREADSHEET_ID", spreadsheetId);
assert.equal(
  post({ type: "get_reviewer_auth_config" }).enabled,
  true,
);
context.initializeMRHAccountsSpreadsheet();
assert.deepEqual(
  Array.from(accountRows[0]),
  ["Email", "Last Name", "First Name", "Middle Initial", "Active"],
  "account setup should remove the legacy device identity column",
);
assert.equal(
  accountRows.length,
  3,
  "account setup should consolidate matching email rows without duplicates",
);
assert.deepEqual(Array.from(accountRows[1]), [
  "reviewer@example.com",
  "Reviewer",
  "Rita",
  "A",
  "TRUE",
]);
assert.equal(accountRows[2][0], "second-reviewer@example.com");
assert.equal(sheets.Accounts, undefined);
assert.equal(spreadsheetTimeZone, "Asia/Manila");
assert.deepEqual(Array.from(reviewerLogs[0]), currentLogHeaders);
assert.equal(
  reviewerLogs.some((row) => String(row[5] || "").startsWith("SIGN_IN")),
  false,
  "legacy sign-in events should be moved out of REVIEWERS",
);
assert.equal(
  appendedRows["SIGN-IN"].length,
  1,
  "setup should migrate legacy sign-in history",
);
assert.equal(
  appendedRows["SIGN-IN"][0].length,
  currentLogHeaders.length,
  "migrated logs must omit device identity values",
);
assert.equal(
  appendedRows["SIGN-IN"][0][0],
  "2026-10-01 16:00:00",
  "historical UTC timestamps should be migrated to Philippine local time",
);
assert.equal(
  sheets.SCOPES !== undefined,
  true,
  "setup should create the OAuth scope-monitoring worksheet",
);
const accountRowsBeforeConflict = accountRows.map((row) => Array.from(row));
const reviewerLogsBeforeConflict = reviewerLogs.map((row) => Array.from(row));
accountRows.push([
  "reviewer@example.com",
  "Conflicting",
  "Rita",
  "A",
  "TRUE",
]);
assert.throws(
  () => context.initializeMRHAccountsSpreadsheet(),
  /conflicting names/,
  "conflicting duplicate account data should stop setup before changing sheets",
);
accountRows.pop();
assert.deepEqual(
  accountRows.map((row) => Array.from(row)),
  accountRowsBeforeConflict,
  "failed account migration preflight must preserve all account rows",
);
assert.deepEqual(
  reviewerLogs.map((row) => Array.from(row)),
  reviewerLogsBeforeConflict,
  "failed account migration preflight must not partially rewrite access logs",
);

tokenClaims = validClaims();
const approved = post(
  authRequest("verify_reviewer_access", "approved-token", eventId("1")),
);
assert.deepEqual(
  {
    status: approved.status,
    accountStatus: approved.accountStatus,
    email: approved.email,
    firstName: approved.firstName,
    middleInitial: approved.middleInitial,
    lastName: approved.lastName,
  },
  {
    status: "success",
    accountStatus: "TRUE",
    email: "reviewer@example.com",
    firstName: "Rita",
    middleInitial: "A",
    lastName: "Reviewer",
  },
);
assert.equal(appendedRows["SIGN-IN"][1][5], "SIGN_IN:TRUE");
assert.equal(appendedRows["SIGN-IN"][1].length, 6);
const beforeStatusCheck = appendedRows["SIGN-IN"].length;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "approved-token",
  }).accountStatus,
  "TRUE",
);
assert.equal(
  appendedRows["SIGN-IN"].length,
  beforeStatusCheck,
  "status polling should not create duplicate sign-in events",
);
assert.equal(
  context.authorizeReviewerRequest_({ idToken: "approved-token" }).account
    .accountStatus,
  "TRUE",
  "an administrator-approved account should be authorized",
);

tokenClaims = validClaims("new-reviewer@example.com");
const notFound = post(
  authRequest("verify_reviewer_access", "new-user-token", eventId("2")),
);
assert.equal(notFound.accountStatus, "NOT_FOUND");
const submission = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("3"),
  lastName: "Dela Cruz",
  firstName: "Maria",
  middleInitial: "P",
});
assert.deepEqual(
  [submission.status, submission.accountStatus, submission.active],
  ["success", "FALSE", false],
  "new enrollment must start pending and not grant access",
);
assert.deepEqual(Array.from(accountRows.at(-1)), [
  "new-reviewer@example.com",
  "Dela Cruz",
  "Maria",
  "P",
  "FALSE",
]);
assert.equal(
  post({
    type: "log_module_access",
    idToken: "new-user-token",
    eventId: eventId("4"),
  }).code,
  "ACCOUNT_PENDING",
  "pending users must not access protected modules",
);
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "new-user-token",
  }).accountStatus,
  "FALSE",
  "pending status should be visible to polling",
);
const duplicatePending = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("5"),
  lastName: "Changed",
  firstName: "Name",
});
assert.equal(duplicatePending.accountStatus, "FALSE");
assert.equal(
  accountRows.filter((row) => row[0] === "new-reviewer@example.com").length,
  1,
  "repeat pending submissions must not duplicate account rows",
);

const newUserRow = accountRows.findIndex(
  (row) => row[0] === "new-reviewer@example.com",
);
accountRows[newUserRow][4] = "DENIED";
cacheValues.clear();
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "new-user-token",
  }).accountStatus,
  "DENIED",
  "polling should observe administrator denial without stale account caching",
);
assert.equal(
  post({
    type: "get_reviewer_dashboard",
    idToken: "new-user-token",
    eventId: eventId("6"),
  }).code,
  "ACCOUNT_DENIED",
  "denied users must not access reviewer resources",
);
const deniedSubmission = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("7"),
  lastName: "Dela Cruz",
  firstName: "Maria",
  middleInitial: "",
});
assert.equal(deniedSubmission.accountStatus, "FALSE");
assert.deepEqual(Array.from(accountRows[newUserRow]), [
  "new-reviewer@example.com",
  "Dela Cruz",
  "Maria",
  "",
  "FALSE",
]);
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "new-user-token",
  }).accountStatus,
  "FALSE",
  "a corrected denied profile must return to pending review",
);

tokenClaims = validClaims();
const existingReviewerRow = accountRows.findIndex(
  (row) => row[0] === "reviewer@example.com",
);
accountRows[existingReviewerRow][4] = "FALSE";
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "approved-token",
  }).accountStatus,
  "FALSE",
  "polling should promptly observe an administrator changing approval to FALSE",
);
assert.equal(
  post({
    type: "log_module_access",
    idToken: "approved-token",
    eventId: eventId("9"),
  }).code,
  "ACCOUNT_PENDING",
  "revoked approval must stop protected access",
);
accountRows[existingReviewerRow][4] = "DENIED";
assert.equal(accountRows[existingReviewerRow][4], "DENIED");
assert.equal(
  context.findMRHAccount_("reviewer@example.com").accountStatus,
  "DENIED",
);
assert.equal(
  post({
    type: "verify_reviewer_access",
    idToken: "approved-token",
    eventId: eventId("8"),
  }).accountStatus,
  "DENIED",
);

const allLogRows = Object.values(appendedRows).flat();
assert.equal(
  allLogRows.every((row) => row.length === currentLogHeaders.length),
  true,
  "new account and resource logs must not contain device identity columns",
);
assert.equal(
  allLogRows
    .filter((row) => row[0] !== "2026-10-01 16:00:00")
    .every((row) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row[0])),
  true,
  "new access-log timestamps should be formatted in Philippine local time",
);

tokenClaims = validClaims("fallback@example.com");
tokenFetchFailures = 1;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "fallback-endpoint-token",
  }).accountStatus,
  "NOT_FOUND",
  "the alternate Google token-info endpoint should recover from an outage",
);

console.log("Reviewer authorization and approval lifecycle checks passed.");
