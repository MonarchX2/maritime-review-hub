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
const legacyAccountRows = [
  accountHeaders,
  [
    "REVIEWER@example.com",
    deviceIdentity.toUpperCase(),
    "Reviewer",
    "Rita",
    "A",
    "TRUE",
  ],
  [
    "second-reviewer@example.com",
    "51234567-89ab-4cde-8fab-0123456789ab",
    "Second",
    "Rae",
    "",
    "TRUE",
  ],
];
let tokenClaims = {};
let tokenStatus = 200;
let tokenFetchCount = 0;
let tokenFetchFailures = 0;
let tokenFetchErrorMessage = "";
const appendedRows = {
  SYLLABUS: [],
  MODULE: [],
  REVIEWERS: [],
  "SIGN-IN": [],
};
const scopesRows = [];
const logSheetRows = {
  SYLLABUS: [],
  MODULE: [logHeaders],
  REVIEWERS: [
    logHeaders,
    [
      "2026-10-01T08:00:00.000Z",
      "reviewer@example.com",
      deviceIdentity,
      "Reviewer",
      "Rita",
      "A",
      "SIGN_IN",
    ],
    [
      "2026-10-01T08:01:00.000Z",
      "reviewer@example.com",
      deviceIdentity,
      "Reviewer",
      "Rita",
      "A",
      "ACCESS",
    ],
  ],
  "SIGN-IN": [],
};
let failLogWrites = false;

function createSheet(headers, getRows) {
  const sheet = {
    getLastRow: () => getRows().length,
    setName(name) {
      const oldName = Object.keys(sheets).find((key) => sheets[key] === sheet);
      if (oldName) delete sheets[oldName];
      sheets[name] = sheet;
      return sheet;
    },
    deleteRows(startRow, count) {
      getRows().splice(startRow - 1, count);
    },
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
          values.forEach((valueRow, rowIndex) => {
            const targetIndex = startRow - 1 + rowIndex;
            if (!getRows()[targetIndex]) getRows()[targetIndex] = [];
            valueRow.forEach((value, columnIndex) => {
              getRows()[targetIndex][startColumn - 1 + columnIndex] = value;
            });
          });
        },
      };
    },
  };
  return sheet;
}

const sheets = {
  ACCOUNTS: createSheet(accountHeaders, () => accountRows),
  Accounts: createSheet(accountHeaders, () => legacyAccountRows),
  MODULE: createSheet(logHeaders, () => logSheetRows.MODULE),
  REVIEWERS: createSheet(logHeaders, () => logSheetRows.REVIEWERS),
  SCOPES: createSheet([], () => scopesRows),
};
const spreadsheetId = "1234567890123456789012345678901234567890123";
const spreadsheet = {
  getId: () => spreadsheetId,
  getUrl: () => `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  getSheetByName: (name) => sheets[name] || null,
  insertSheet(name) {
    const rows =
      name === "SCOPES"
        ? scopesRows
        : name === "ACCOUNTS"
          ? accountRows
          : logSheetRows[name] || [];
    sheets[name] = createSheet([], () => rows);
    return sheets[name];
  },
  deleteSheet(sheet) {
    const name = Object.keys(sheets).find((key) => sheets[key] === sheet);
    if (name) delete sheets[name];
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
          const category = range.split("!")[0];
          assert.equal(options.valueInputOption, "RAW");
          if (category === "ACCOUNTS") {
            accountRows.push(...resource.values);
          } else {
            assert.ok(appendedRows[category]);
            if (failLogWrites) throw new Error("simulated log quota failure");
            appendedRows[category].push(...resource.values);
            logSheetRows[category].push(...resource.values);
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
        /^https:\/\/(?:oauth2\.googleapis\.com\/tokeninfo|www\.googleapis\.com\/oauth2\/v3\/tokeninfo)\?id_token=/,
      );
      assert.equal(options.muteHttpExceptions, true);
      if (tokenFetchFailures > 0) {
        tokenFetchFailures -= 1;
        throw new Error(tokenFetchErrorMessage || "simulated endpoint outage");
      }
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
  picture: "https://lh3.googleusercontent.com/a/example-profile",
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
  "account setup should migrate and initialize account, sign-in, access-log, and scope worksheets",
);
assert.equal(sheets.ACCOUNTS !== undefined, true);
assert.deepEqual(
  Array.from(logSheetRows.SYLLABUS[0]),
  logHeaders,
  "account setup should create the syllabus file-click log worksheet",
);
assert.equal(sheets.Accounts, undefined, "the legacy account worksheet should be removed after merging");
assert.equal(accountRows.length, 3, "legacy account rows should merge without duplicating matching accounts");
assert.equal(accountRows[2][0], "second-reviewer@example.com");
assert.equal(sheets["SIGN-IN"] !== undefined, true);
assert.equal(
  logSheetRows["SIGN-IN"].length,
  2,
  "setup should move legacy sign-in rows out of REVIEWERS",
);
assert.equal(
  logSheetRows.REVIEWERS.length,
  2,
  "setup should retain reviewer-access rows while migrating sign-ins",
);
context.initializeMRHAccountsSpreadsheet();
assert.equal(
  logSheetRows["SIGN-IN"].length,
  2,
  "re-running setup should not duplicate migrated sign-in history",
);
assert.deepEqual(
  scopesRows[0],
  ["OAuth Scope", "Purpose", "Configured In"],
  "setup should create a scope-monitoring worksheet",
);
assert.equal(
  scopesRows.some(
    (row) =>
      row[0] === "https://www.googleapis.com/auth/script.external_request",
  ),
  true,
  "the scope worksheet should list token-verification access",
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
    picture: allowed.picture,
  },
  {
    status: "success",
    email: "reviewer@example.com",
    firstName: "Rita",
    middleInitial: "A",
    lastName: "Reviewer",
    picture: "https://lh3.googleusercontent.com/a/example-profile",
  },
);
assert.equal(tokenFetchCount, 1);
assert.equal(appendedRows["SIGN-IN"][0][6], "SIGN_IN");
assert.equal(
  post(authRequest("verify_reviewer_access", "signed-token-1")).status,
  "success",
);
assert.equal(tokenFetchCount, 1, "verified Google tokens should be briefly cached");
assert.equal(appendedRows["SIGN-IN"][1][6], "SIGN_IN");

tokenClaims = validClaims();
tokenFetchFailures = 1;
assert.equal(
  post(authRequest("verify_reviewer_access", "fallback-endpoint-token")).status,
  "success",
  "the alternate Google token-info endpoint should recover from a primary endpoint outage",
);
assert.equal(tokenFetchFailures, 0);

tokenFetchErrorMessage = "Authorization required for UrlFetchApp.fetch";
tokenFetchFailures = 2;
assert.equal(
  post(authRequest("verify_reviewer_access", "missing-external-scope")).code,
  "AUTH_PERMISSION_REQUIRED",
  "missing external-request authorization should be reported distinctly",
);
tokenFetchErrorMessage =
  "Wala kang pahintulot. Mga kinakailangang pahintulot: https://www.googleapis.com/auth/script.external_request";
tokenFetchFailures = 2;
assert.equal(
  post(authRequest("verify_reviewer_access", "localized-missing-scope")).code,
  "AUTH_PERMISSION_REQUIRED",
  "the missing external-request scope should be recognized from localized Apps Script errors",
);
tokenFetchErrorMessage = "";

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
tokenClaims = {
  ...validClaims(),
  picture: "https://attacker.example/profile.png",
};
const untrustedPicture = post(
  authRequest("verify_reviewer_access", "untrusted-profile-picture"),
);
assert.equal(
  untrustedPicture.picture,
  "",
  "profile pictures must only be returned from trusted Google-hosted URLs",
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
    active: true,
    existing: false,
    deviceIdentity: "11234567-89ab-4cde-8fab-0123456789ab",
    row: [
      "new-reviewer@example.com",
      "11234567-89ab-4cde-8fab-0123456789ab",
      "New",
      "Reviewer",
      "B",
      "TRUE",
    ],
  },
  "new Google-authenticated accounts should be enabled immediately",
);
const duplicateEnrollment = post({
  type: "request_reviewer_enrollment",
  idToken: "new-reviewer-token",
  deviceIdentity: "21234567-89ab-4cde-8fab-0123456789ab",
  lastName: "Changed",
  firstName: "Name",
});
assert.equal(duplicateEnrollment.existing, true);
assert.equal(duplicateEnrollment.active, true);
assert.equal(
  duplicateEnrollment.deviceIdentity,
  "11234567-89ab-4cde-8fab-0123456789ab",
  "re-enrollment must recover the account's stored device identity rather than rotate it",
);
assert.equal(accountRows.length, 4, "duplicate email must not add a row");
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
  post(authRequest("verify_reviewer_access", "inactive-account")).status,
  "success",
  "a Google-authenticated account should not be denied because its legacy Active flag is false",
);
assert.equal(accountRows[1][5], "TRUE");
cacheValues.clear();
appendedRows.REVIEWERS.length = 0;
appendedRows["SIGN-IN"].length = 0;

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
  post({
    type: "log_resource_file_click",
    resourceArea: "SYLLABUS",
    fileName: "Course\nSyllabus|PDF",
    fileId: "012345678901234567890",
  }).status,
  "success",
);
assert.equal(appendedRows.SYLLABUS.length, 1);
assert.equal(appendedRows.SYLLABUS[0][1], "");
assert.equal(
  appendedRows.SYLLABUS[0][6],
  "FILE_CLICK:SYLLABUS:Course Syllabus PDF:012345678901234567890",
  "syllabus clicks should record a normalized filename and Drive file ID",
);
assert.equal(
  post({
    type: "log_resource_file_click",
    resourceArea: "MODULES",
    fileName: "Module 1.pdf",
    fileId: "112345678901234567890",
    deviceIdentity,
  }).status,
  "success",
);
assert.equal(appendedRows.MODULE.length, 2);
assert.equal(
  appendedRows.MODULE[1][6],
  "FILE_CLICK:MODULES:Module 1.pdf:112345678901234567890",
);
assert.equal(
  post({
    type: "log_resource_file_click",
    resourceArea: "REVIEWERS",
    fileName: "Reviewer file.pdf",
    fileId: "212345678901234567890",
  }).code,
  "UNAUTHORIZED",
  "reviewer file clicks must require account authorization",
);
assert.equal(
  post({
    ...authRequest("log_resource_file_click", "signed-token-1"),
    resourceArea: "REVIEWERS",
    fileName: "Reviewer file.pdf",
    fileId: "212345678901234567890",
  }).status,
  "success",
);
assert.equal(
  appendedRows.REVIEWERS.at(-1)[6],
  "FILE_CLICK:REVIEWERS:Reviewer file.pdf:212345678901234567890",
);
assert.equal(
  post({
    type: "log_resource_file_click",
    resourceArea: "MODULE",
    fileName: "Invalid area",
    fileId: "012345678901234567890",
  }).code,
  "BAD_REQUEST",
);
assert.equal(
  post({
    type: "log_resource_file_click",
    resourceArea: "MODULES",
    fileName: "Invalid file id",
    fileId: "not-valid",
  }).code,
  "BAD_REQUEST",
);

assert.equal(
  context.recordResourceDashboardAccess_({
    deviceIdentity,
  }),
  null,
);
assert.equal(appendedRows.MODULE.length, 3);
assert.equal(appendedRows.MODULE[2][1], "");
assert.equal(appendedRows.MODULE[2][6], "ANONYMOUS_ACCESS");

tokenStatus = 503;
const providerFailure = post(
  authRequest("verify_reviewer_access", "provider-failure"),
);
assert.equal(
  providerFailure.code,
  "AUTH_PROVIDER_UNAVAILABLE",
  "Google verification outages must not authorize users after both endpoints fail",
);
assert.equal(providerFailure.verificationFailure, "HTTP_503");
tokenStatus = 200;
tokenFetchFailures = 2;
tokenFetchErrorMessage = "Failed URL token id_token=secret-token-value";
const fetchFailure = post(
  authRequest("verify_reviewer_access", "fetch-failure"),
);
assert.equal(fetchFailure.verificationFailure, "FETCH_EXCEPTION");
assert.equal(fetchFailure.verificationDiagnostic.includes("secret-token-value"), false);
tokenFetchErrorMessage = "";

properties.set("MRH_ACCOUNTS_SPREADSHEET_ID", "");
assert.equal(
  post(authRequest("verify_reviewer_access", "disabled")).code,
  "FEATURE_DISABLED",
  "missing account spreadsheet configuration must disable sign-in",
);

console.log("Reviewer account authorization and access logging checks passed.");
