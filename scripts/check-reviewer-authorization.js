const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const properties = new Map();
const cacheValues = new Map();
const accountHeaders = [
  "Email",
  "Device Identity",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Active",
];
const logHeaders = [
  "Timestamp",
  "Email",
  "Device Identity",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Event",
];
const deviceIdentity = "01234567-89ab-4cde-8fab-0123456789ab";
let accountRows = [
  accountHeaders,
  [
    "reviewer@example.com",
    deviceIdentity,
    "Reviewer",
    "Rita",
    "A",
    "TRUE",
  ],
];
let tokenClaims = {};
let tokenStatus = 200;
let tokenFetchCount = 0;
const appendedRows = { MODULE: [], REVIEWERS: [] };
let failLogWrites = false;

function createSheet(headers, getRows) {
  return {
    getLastRow: () => getRows().length,
    getRange(startRow, startColumn, rowCount, columnCount) {
      return {
        getDisplayValues() {
          return getRows()
            .slice(startRow - 1, startRow - 1 + rowCount)
            .map((row) =>
              row.slice(startColumn - 1, startColumn - 1 + columnCount),
            );
        },
        setValues(values) {
          getRows().splice(
            startRow - 1,
            values.length,
            ...values.map((row) => [...row]),
          );
        },
      };
    },
  };
}

const sheets = {
  Accounts: createSheet(accountHeaders, () => accountRows),
  MODULE: createSheet(logHeaders, () => [logHeaders]),
  REVIEWERS: createSheet(logHeaders, () => [logHeaders]),
};
const spreadsheetId = "1234567890123456789012345678901234567890123";
const spreadsheet = {
  getId: () => spreadsheetId,
  getUrl: () => `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  getSheetByName: (name) => sheets[name] || null,
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
          const category = range.split("!")[0];
          assert.equal(options.valueInputOption, "RAW");
          if (category === "Accounts") {
            accountRows.push(...resource.values);
          } else {
            assert.ok(appendedRows[category]);
            if (failLogWrites) throw new Error("simulated log quota failure");
            appendedRows[category].push(...resource.values);
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
  },
  UrlFetchApp: {
    fetch(url, options) {
      tokenFetchCount += 1;
      assert.match(
        url,
        /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/,
      );
      assert.equal(options.muteHttpExceptions, true);
      return {
        getResponseCode: () => tokenStatus,
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
vm.runInContext(
  fs.readFileSync("backend/main.js", "utf8"),
  context,
  { filename: "backend/main.js" },
);

const clientId = "1234567890-example.apps.googleusercontent.com";
const validClaims = (email = "reviewer@example.com") => ({
  aud: clientId,
  iss: "https://accounts.google.com",
  exp: String(Math.floor(Date.now() / 1000) + 300),
  email,
  email_verified: "true",
});
const appVersion = "mrh-release-26.10.15-29";
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
const authRequest = (type, idToken) => ({
  type,
  idToken,
  deviceIdentity,
});

assert.equal(
  post(authRequest("verify_reviewer_access", "unconfigured")).code,
  "FEATURE_DISABLED",
  "authorization must fail closed until configured",
);
assert.equal(tokenFetchCount, 0);

properties.set("MRH_GOOGLE_OAUTH_CLIENT_ID", clientId);
properties.set("MRH_ACCOUNTS_SPREADSHEET_ID", spreadsheetId);
const config = post({ type: "get_reviewer_auth_config" });
assert.equal(config.enabled, true);
assert.equal(config.clientId, clientId);
assert.equal(Object.hasOwn(config, "allowedEmails"), false);
assert.equal(
  context.initializeMRHAccountsSpreadsheet().spreadsheetId,
  spreadsheetId,
  "account setup should recognize the pre-created Accounts, MODULE, and REVIEWERS tabs",
);

tokenClaims = validClaims();
const allowed = post(authRequest("verify_reviewer_access", "signed-token-1"));
assert.deepEqual(
  {
    status: allowed.status,
    email: allowed.email,
    firstName: allowed.firstName,
    middleInitial: allowed.middleInitial,
    lastName: allowed.lastName,
  },
  {
    status: "success",
    email: "reviewer@example.com",
    firstName: "Rita",
    middleInitial: "A",
    lastName: "Reviewer",
  },
);
assert.equal(tokenFetchCount, 1);
assert.equal(
  post(authRequest("verify_reviewer_access", "signed-token-1")).status,
  "success",
);
assert.equal(tokenFetchCount, 1, "verified Google tokens should be briefly cached");

tokenClaims = { ...validClaims(), aud: "attacker-client.apps.googleusercontent.com" };
assert.equal(
  post(authRequest("verify_reviewer_access", "wrong-audience")).code,
  "UNAUTHORIZED",
);
tokenClaims = {
  ...validClaims(),
  exp: String(Math.floor(Date.now() / 1000) - 1),
};
assert.equal(
  post(authRequest("verify_reviewer_access", "expired")).code,
  "UNAUTHORIZED",
);
tokenClaims = { ...validClaims(), email_verified: "false" };
assert.equal(
  post(authRequest("verify_reviewer_access", "unverified-email")).code,
  "UNAUTHORIZED",
);
tokenClaims = { ...validClaims(), iss: "attacker.example.com" };
assert.equal(
  post(authRequest("verify_reviewer_access", "wrong-issuer")).code,
  "UNAUTHORIZED",
);
tokenClaims = validClaims("unlisted@example.com");
assert.equal(
  post(authRequest("verify_reviewer_access", "unlisted-account")).code,
  "FORBIDDEN",
  "an active spreadsheet account must match both verified email and device ID",
);
const unregisteredRecovery = post({
  type: "request_reviewer_enrollment",
  idToken: "unlisted-recovery",
  deviceIdentity: "31234567-89ab-4cde-8fab-0123456789ab",
});
assert.equal(unregisteredRecovery.status, "success");
assert.equal(unregisteredRecovery.requiresEnrollment, true);
tokenClaims = validClaims("new-reviewer@example.com");
const enrollment = post({
  type: "request_reviewer_enrollment",
  idToken: "new-reviewer-token",
  deviceIdentity: "11234567-89ab-4cde-8fab-0123456789ab",
  lastName: "New",
  firstName: "Reviewer",
  middleInitial: "B",
});
assert.deepEqual(
  {
    status: enrollment.status,
    active: enrollment.active,
    existing: enrollment.existing,
    deviceIdentity: enrollment.deviceIdentity,
    row: Array.from(accountRows[accountRows.length - 1]),
  },
  {
    status: "success",
    active: false,
    existing: false,
    deviceIdentity: "11234567-89ab-4cde-8fab-0123456789ab",
    row: [
      "new-reviewer@example.com",
      "11234567-89ab-4cde-8fab-0123456789ab",
      "New",
      "Reviewer",
      "B",
      "FALSE",
    ],
  },
  "new accounts must be recorded as pending and never self-activated",
);
const duplicateEnrollment = post({
  type: "request_reviewer_enrollment",
  idToken: "new-reviewer-token",
  deviceIdentity: "21234567-89ab-4cde-8fab-0123456789ab",
  lastName: "Changed",
  firstName: "Name",
});
assert.equal(duplicateEnrollment.existing, true);
assert.equal(duplicateEnrollment.active, false);
assert.equal(
  duplicateEnrollment.deviceIdentity,
  "11234567-89ab-4cde-8fab-0123456789ab",
  "re-enrollment must recover the account's stored device identity rather than rotate it",
);
assert.equal(accountRows.length, 3, "duplicate email must not add a row");
tokenClaims = validClaims("reviewer@example.com");
const recoveredDevice = post({
  type: "request_reviewer_enrollment",
  idToken: "reviewer-recovery",
  deviceIdentity: "41234567-89ab-4cde-8fab-0123456789ab",
});
assert.equal(recoveredDevice.status, "success");
assert.equal(recoveredDevice.active, true);
assert.equal(recoveredDevice.existing, true);
assert.equal(
  recoveredDevice.deviceIdentity,
  deviceIdentity,
  "clearing browser storage must recover the server-registered device identity",
);
tokenClaims = validClaims("reviewer@example.com");
assert.equal(
  post({ type: "verify_reviewer_access", idToken: "missing-device" }).code,
  "UNAUTHORIZED",
);
assert.equal(
  post({
    ...authRequest("verify_reviewer_access", "wrong-device"),
    deviceIdentity: "11234567-89ab-4cde-8fab-0123456789ab",
  }).code,
  "FORBIDDEN",
  "a registered email must still match the registered device identity",
);
accountRows[1][5] = "FALSE";
cacheValues.clear();
assert.equal(
  post(authRequest("verify_reviewer_access", "inactive-account")).code,
  "FORBIDDEN",
  "inactive account rows must not authorize a user",
);
accountRows[1][5] = "TRUE";
cacheValues.clear();

let reviewerIndexReadCount = 0;
context.DriveApp = {
  getFolderById: () => ({
    getFilesByName: () => ({
      hasNext: () => true,
      next: () => {
        reviewerIndexReadCount += 1;
        return {
          getId: () => "reviewer-index-id",
          getLastUpdated: () => new Date(2000),
          getBlob: () => ({ getDataAsString: () => "{}" }),
        };
      },
    }),
  }),
};
context.getResourceDashboardCombinedIndex = () => ({ reviewerIndex: true });
context.buildResourceDashboardTab = (_name, index) => ({
  columns: ["Year"],
  rows: [["3"]],
  sourceIndex: index.reviewerIndex,
});
tokenClaims = validClaims("unlisted@example.com");
assert.equal(
  post(authRequest("get_reviewer_dashboard", "not-allowlisted")).code,
  "FORBIDDEN",
);
assert.equal(
  reviewerIndexReadCount,
  0,
  "unauthorized requests must not read the protected reviewer index",
);

tokenClaims = validClaims();
const reviewerDashboard = post(
  authRequest("get_reviewer_dashboard", "signed-token-1"),
);
assert.equal(reviewerDashboard.status, "success");
assert.equal(reviewerDashboard.email, "reviewer@example.com");
assert.equal(reviewerDashboard.tab.sourceIndex, true);
assert.equal(appendedRows.REVIEWERS.length, 1);
assert.deepEqual(Array.from(appendedRows.REVIEWERS[0].slice(1)), [
  "reviewer@example.com",
  deviceIdentity,
  "Reviewer",
  "Rita",
  "A",
  "ACCESS",
]);
failLogWrites = true;
assert.equal(
  post(authRequest("get_reviewer_dashboard", "signed-token-1")).code,
  "SERVER_ERROR",
  "reviewer data must not be returned when its access log cannot be recorded",
);
failLogWrites = false;

assert.equal(
  post(authRequest("log_module_access", "signed-token-1")).status,
  "success",
);
assert.equal(appendedRows.MODULE.length, 1);

assert.equal(
  context.recordResourceDashboardAccess_({
    deviceIdentity,
  }),
  null,
);
assert.equal(appendedRows.MODULE.length, 2);
assert.equal(appendedRows.MODULE[1][1], "");
assert.equal(appendedRows.MODULE[1][6], "ANONYMOUS_ACCESS");

tokenStatus = 503;
assert.equal(
  post(authRequest("verify_reviewer_access", "provider-failure")).code,
  "AUTH_PROVIDER_UNAVAILABLE",
  "Google verification outages must not authorize users",
);

properties.set("MRH_ACCOUNTS_SPREADSHEET_ID", "");
assert.equal(
  post(authRequest("verify_reviewer_access", "disabled")).code,
  "FEATURE_DISABLED",
  "missing account spreadsheet configuration must disable sign-in",
);

console.log("Reviewer account authorization and access logging checks passed.");
