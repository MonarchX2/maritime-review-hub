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
let uuidSequence = 0;
let spreadsheetTimeZone = "";
let spreadsheetOpenCount = 0;
let reviewerDriveLookupCount = 0;
const accountRows = [
  [
    "Email",
    "Device Identity",
    "Last Name",
    "First Name",
    "Middle Initial",
    "Active",
  ],
  ["reviewer@example.com", oldDeviceId, "Reviewer", "Rita", "A.", "TRUE"],
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
    "A.",
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
  "Date",
  "Time",
  "Email",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Event",
  "Course",
  "Year",
  "Semester",
  "Category",
  "Resource",
];
const previousLogHeaders = [
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
    "A.",
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
  MODULES: [],
  REVIEWERS: [],
  "SIGN-IN": [],
};
const sentReviewerEmails = [];

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
    setName(name) {
      const oldName = Object.keys(sheets).find(
        (sheetName) => sheets[sheetName] === this,
      );
      if (oldName) {
        delete sheets[oldName];
        sheets[name] = this;
      }
      return this;
    },
  };
}

const sheets = {
  ACCOUNTS: createSheet(accountRows),
  Accounts: createSheet(legacyAccountRows),
  SYLLABUS: createSheet([previousLogHeaders]),
  MODULE: createSheet([previousLogHeaders]),
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
  MailApp: {
    getRemainingDailyQuota: () => 100,
    sendEmail(message) {
      sentReviewerEmails.push(message);
    },
  },
  PropertiesService: {
    getScriptProperties: () => ({
      getProperty: (key) => properties.get(key) || "",
      setProperty: (key, value) => properties.set(key, String(value)),
      getProperties: () => Object.fromEntries(properties),
      deleteProperty: (key) => properties.delete(key),
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
      spreadsheetOpenCount += 1;
      assert.equal(id, spreadsheetId);
      return spreadsheet;
    },
  },
  DriveApp: {
    getFolderById(id) {
      assert.equal(id, "1cP2FBOW-Jryu9eknJgDjUZcxx9qwC22Z");
      return {
        getFilesByName(name) {
          assert.equal(name, "reviewers_combined.json");
          reviewerDriveLookupCount += 1;
          let hasFile = true;
          return {
            hasNext: () => hasFile,
            next: () => {
              hasFile = false;
              return {
                getId: () => "reviewer-index-file",
                getLastUpdated: () => new Date(1000),
                getBlob: () => ({
                  getDataAsString: () =>
                    JSON.stringify({
                      b: "https://drive.google.com/open?id=",
                      d: {},
                    }),
                }),
              };
            },
          };
        },
      };
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
    getUuid() {
      uuidSequence += 1;
      return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, "0")}`;
    },
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
      assert.ok(
        ["yyyy-MM-dd", "HH:mm:ss", "yyyy-MM-dd HH:mm:ss"].includes(format),
      );
      const localTimestamp = new Date(
        new Date(date).getTime() + 8 * 60 * 60 * 1000,
      )
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      if (format === "yyyy-MM-dd") return localTimestamp.slice(0, 10);
      if (format === "HH:mm:ss") return localTimestamp.slice(11);
      return localTimestamp;
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
assert.equal(
  context.authorizeMRHReviewerStatusEmails(),
  100,
  "the owner should be able to authorize the send-mail permission explicitly",
);

const clientId = "1234567890-example.apps.googleusercontent.com";
const appVersion = JSON.parse(
  fs.readFileSync("version.json", "utf8"),
).buildVersion;
const appsScriptManifest = JSON.parse(
  fs.readFileSync("backend/appsscript.json", "utf8"),
);
assert.ok(
  appsScriptManifest.oauthScopes.includes(
    "https://www.googleapis.com/auth/script.send_mail",
  ),
  "reviewer status notification email requires the explicit Apps Script mail scope",
);
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
const spreadsheetOpensBeforeConfig = spreadsheetOpenCount;
assert.equal(
  post({ type: "get_reviewer_auth_config" }).enabled,
  true,
);
assert.equal(
  spreadsheetOpenCount,
  spreadsheetOpensBeforeConfig,
  "fetching sign-in configuration should not open the account spreadsheet",
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
  "A.",
  "TRUE",
]);
assert.equal(accountRows[2][0], "second-reviewer@example.com");
assert.equal(sheets.Accounts, undefined);
assert.equal(sheets.MODULE, undefined);
assert.equal(sheets.MODULES !== undefined, true);
assert.deepEqual(
  sheets.ACCOUNTS.getRange(1, 1, 1, 5).getDisplayValues()[0],
  ["Email", "Last Name", "First Name", "Middle Initial", "Active"],
  "the ACCOUNTS tab must remain free of date and time fields",
);
assert.equal(spreadsheetTimeZone, "Asia/Manila");
assert.deepEqual(Array.from(reviewerLogs[0]), currentLogHeaders);
assert.equal(
  reviewerLogs.some((row) => String(row[6] || "").startsWith("SIGN_IN")),
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
  "2026-10-01",
  "historical UTC timestamps should be migrated to the Philippine local date",
);
assert.equal(
  appendedRows["SIGN-IN"][0][1],
  "16:00:00",
  "historical UTC timestamps should be migrated to Philippine local time",
);
assert.equal(
  sheets.SCOPES !== undefined,
  true,
  "setup should create the OAuth scope-monitoring worksheet",
);
assert.ok(
  sheets.SCOPES.getRange(2, 1, 6, 1)
    .getDisplayValues()
    .some(
      (row) => row[0] === "https://www.googleapis.com/auth/script.send_mail",
    ),
  "the OAuth scope worksheet should document reviewer notification email",
);
const accountRowsBeforeConflict = accountRows.map((row) => Array.from(row));
const reviewerLogsBeforeConflict = reviewerLogs.map((row) => Array.from(row));
accountRows.push([
  "reviewer@example.com",
  "Conflicting",
  "Rita",
  "A.",
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
assert.equal(approved.status, "success", JSON.stringify(approved));
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
    middleInitial: "A.",
    lastName: "Reviewer",
  },
);
assert.match(approved.sessionId, /^[a-f0-9]{96}$/);
assert.equal(
  approved.expiresAt > Date.now(),
  true,
  "successful Google sign-in should create a bounded application session",
);
assert.equal(
  post({
    type: "restore_reviewer_session",
    sessionId: approved.sessionId,
  }).accountStatus,
  "TRUE",
  "a saved application session should restore without a Google ID token",
);
assert.equal(
  post({
    type: "get_reviewer_account_status",
    sessionId: approved.sessionId,
  }).email,
  "reviewer@example.com",
  "account status polling should validate an application session",
);
assert.equal(
  sentReviewerEmails.length,
  0,
  "the first observed status should establish a baseline without sending email",
);
assert.equal(appendedRows["SIGN-IN"][1][6], "SIGN_IN:TRUE");
assert.equal(appendedRows["SIGN-IN"][1].length, currentLogHeaders.length);
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
assert.equal(
  context.authorizeReviewerRequest_({ sessionId: approved.sessionId }).account
    .accountStatus,
  "TRUE",
  "protected reviewer authorization should accept the validated application session",
);
assert.equal(
  post({ type: "sign_out_reviewer", sessionId: approved.sessionId }).status,
  "success",
  "explicit sign-out should revoke the application session server-side",
);
assert.equal(
  post({
    type: "restore_reviewer_session",
    sessionId: approved.sessionId,
  }).code,
  "SESSION_INVALID",
  "a revoked application session must no longer restore",
);
tokenClaims = validClaims();
const expiredSession = post(
  authRequest("verify_reviewer_access", "expiring-session-token", eventId("e")),
);
const expiredSessionKey =
  "MRH_REVIEWER_SESSION_v1_" +
  crypto.createHash("sha256").update(expiredSession.sessionId).digest("hex");
properties.set(
  expiredSessionKey,
  JSON.stringify({
    email: "reviewer@example.com",
    picture: "",
    expiresAt: Date.now() - 1,
  }),
);
assert.equal(
  post({
    type: "restore_reviewer_session",
    sessionId: expiredSession.sessionId,
  }).code,
  "SESSION_EXPIRED",
  "an expired application session must be rejected and removed",
);
assert.equal(
  properties.has(expiredSessionKey),
  false,
  "expired application session records should be deleted server-side",
);

tokenClaims = {
  ...validClaims(),
  aud: "another-client.apps.googleusercontent.com",
};
assert.equal(
  post(
    authRequest("verify_reviewer_access", "wrong-audience-token", eventId("f")),
  ).code,
  "UNAUTHORIZED",
  "Google credentials for another OAuth client must be rejected",
);
tokenClaims = { ...validClaims(), iss: "https://attacker.example.com" };
assert.equal(
  post(
    authRequest("verify_reviewer_access", "wrong-issuer-token", eventId("f")),
  ).code,
  "UNAUTHORIZED",
  "Google credentials from an unexpected issuer must be rejected",
);
tokenClaims = { ...validClaims(), email_verified: "false" };
assert.equal(
  post(
    authRequest("verify_reviewer_access", "unverified-email-token", eventId("f")),
  ).code,
  "UNAUTHORIZED",
  "Google credentials without a verified email must be rejected",
);
tokenClaims = {
  ...validClaims(),
  exp: String(Math.floor(Date.now() / 1000) - 1),
};
assert.equal(
  post(
    authRequest("verify_reviewer_access", "expired-google-token", eventId("f")),
  ).code,
  "UNAUTHORIZED",
  "expired Google credentials must be rejected",
);
tokenClaims = null;
assert.equal(
  post(
    authRequest("verify_reviewer_access", "malformed-google-response-token", eventId("f")),
  ).code,
  "AUTH_PROVIDER_UNAVAILABLE",
  "malformed successful responses from Google must be reported as provider failures",
);

tokenClaims = validClaims("new-reviewer@example.com");
const notFound = post(
  authRequest("verify_reviewer_access", "new-user-token", eventId("2")),
);
assert.equal(notFound.accountStatus, "NOT_FOUND");
const invalidMiddleInitial = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("3"),
  lastName: "Reviewer",
  firstName: "New",
  middleInitial: "PP",
});
assert.equal(
  invalidMiddleInitial.code,
  "BAD_REQUEST",
  "the backend must reject a middle initial that is not one letter and a period",
);
const mismatchedNameSubmission = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("4"),
  lastName: "Dela Cruz",
  firstName: "Maria",
  middleInitial: "P.",
});
assert.equal(
  mismatchedNameSubmission.code,
  "EMAIL_NAME_MISMATCH",
  "a substantially mismatched name and verified email should be rejected",
);
assert.equal(
  accountRows.some((row) => row[0] === "new-reviewer@example.com"),
  false,
  "a mismatched name must not be saved for administrator review",
);
const submission = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("5"),
  lastName: "Reviewer",
  firstName: "New",
  middleInitial: "p.",
});
assert.deepEqual(
  [submission.status, submission.accountStatus, submission.active],
  ["success", "FALSE", false],
  "new enrollment must start pending and not grant access",
);
assert.deepEqual(Array.from(accountRows.at(-1)), [
  "new-reviewer@example.com",
  "Reviewer",
  "New",
  "P.",
  "FALSE",
]);
assert.equal(
  post({
    type: "log_module_access",
    idToken: "new-user-token",
    eventId: eventId("5"),
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
assert.equal(
  sentReviewerEmails.length,
  1,
  "a new enrollment should email the verified address that access is pending",
);
assert.deepEqual(
  [
    sentReviewerEmails[0]?.to,
    sentReviewerEmails[0]?.subject,
    sentReviewerEmails[0]?.name,
  ],
  [
    "new-reviewer@example.com",
    "Maritime Review Hub reviewer access pending",
    "Maritime Review Hub",
  ],
);
assert.match(
  sentReviewerEmails[0]?.body || "",
  /^Dear Reviewer,[\s\S]*pending administrator review[\s\S]*Sincerely,\nMaritime Review Hub$/,
  "pending notifications should use a formal message and the Maritime Review Hub sender name",
);
const duplicatePending = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("6"),
  lastName: "Reviewer",
  firstName: "Changed",
  middleInitial: "P.",
});
assert.equal(duplicatePending.accountStatus, "FALSE");
assert.deepEqual(
  Array.from(accountRows.find((row) => row[0] === "new-reviewer@example.com")),
  ["new-reviewer@example.com", "Reviewer", "Changed", "P.", "FALSE"],
  "a pending user can edit their name while remaining unapproved",
);
assert.equal(
  accountRows.filter((row) => row[0] === "new-reviewer@example.com").length,
  1,
  "repeat pending submissions must not duplicate account rows",
);
const pendingProfileEdit = post({
  type: "request_reviewer_enrollment",
  idToken: "new-user-token",
  eventId: eventId("a"),
  lastName: "Reviewer",
  firstName: "New",
  middleInitial: "Q.",
});
assert.equal(
  pendingProfileEdit.status,
  "success",
  JSON.stringify(pendingProfileEdit),
);
assert.deepEqual(
  [
    pendingProfileEdit.accountStatus,
    pendingProfileEdit.profileUpdated,
    accountRows.find((row) => row[0] === "new-reviewer@example.com")[3],
  ],
  ["FALSE", true, "Q."],
  "a pending user may edit their saved name without gaining access",
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
assert.deepEqual(
  [
    sentReviewerEmails.length,
    sentReviewerEmails[1]?.to,
    sentReviewerEmails[1]?.subject,
    sentReviewerEmails[1]?.name,
  ],
  [
    2,
    "new-reviewer@example.com",
    "Maritime Review Hub reviewer access denied",
    "Maritime Review Hub",
  ],
  "an administrator denial should email the verified account once",
);
assert.match(
  sentReviewerEmails[1]?.body || "",
  /^Dear Reviewer,[\s\S]*unable to approve[\s\S]*Sincerely,\nMaritime Review Hub$/,
  "denial notifications should use formal language and a branded sender name",
);
cacheValues.clear();
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "new-user-token",
  }).accountStatus,
  "DENIED",
);
assert.equal(
  sentReviewerEmails.length,
  2,
  "repeated status polling must not resend a denial email",
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
  lastName: "Reviewer",
  firstName: "New",
  middleInitial: "P.",
});
assert.equal(deniedSubmission.accountStatus, "FALSE");
assert.deepEqual(Array.from(accountRows[newUserRow]), [
  "new-reviewer@example.com",
  "Reviewer",
  "New",
  "P.",
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
assert.deepEqual(
  [
    sentReviewerEmails.length,
    sentReviewerEmails[2]?.to,
    sentReviewerEmails[2]?.subject,
  ],
  [
    3,
    "new-reviewer@example.com",
    "Maritime Review Hub reviewer access pending",
  ],
  "a corrected denied profile should email that access is pending again",
);

tokenClaims = validClaims("admin-added@example.com");
assert.equal(
  post(
    authRequest(
      "verify_reviewer_access",
      "admin-added-token",
      eventId("a"),
    ),
  ).accountStatus,
  "NOT_FOUND",
);
accountRows.push([
  "admin-added@example.com",
  "Existing",
  "Account",
  "",
  "TRUE",
]);
const cachedNotFoundSubmission = post({
  type: "request_reviewer_enrollment",
  idToken: "admin-added-token",
  eventId: eventId("b"),
  lastName: "Added",
  firstName: "Admin",
  middleInitial: "A.",
});
assert.equal(cachedNotFoundSubmission.accountStatus, "FALSE");
assert.equal(
  accountRows.filter((row) => row[0] === "admin-added@example.com").length,
  1,
  "enrollment must recheck a cached account miss before appending a duplicate",
);
assert.deepEqual(
  Array.from(accountRows.find((row) => row[0] === "admin-added@example.com")),
  ["admin-added@example.com", "Added", "Admin", "A.", "FALSE"],
  "a fresh account match must update the correct row and reset approval",
);

tokenClaims = validClaims();
const existingReviewerRow = accountRows.findIndex(
  (row) => row[0] === "reviewer@example.com",
);
cacheValues.clear();
const unchangedApprovedProfile = post({
  type: "request_reviewer_enrollment",
  idToken: "approved-token",
  eventId: eventId("b"),
  lastName: "Reviewer",
  firstName: "Rita",
  middleInitial: "A.",
});
assert.equal(
  unchangedApprovedProfile.accountStatus,
  "TRUE",
  "submitting an unchanged approved profile must preserve approval",
);
const approvedProfileEdit = post({
  type: "request_reviewer_enrollment",
  idToken: "approved-token",
  eventId: eventId("c"),
  lastName: "Reviewer",
  firstName: "Updated",
  middleInitial: "A.",
});
assert.deepEqual(
  [
    approvedProfileEdit.accountStatus,
    approvedProfileEdit.profileUpdated,
    accountRows[existingReviewerRow][2],
    accountRows[existingReviewerRow][4],
  ],
  ["FALSE", true, "Updated", "FALSE"],
  "changing an approved user's name must save the edit and revoke access pending approval",
);
assert.equal(
  post({
    type: "get_reviewer_dashboard",
    idToken: "approved-token",
    eventId: eventId("d"),
  }).code,
  "ACCOUNT_PENDING",
  "an edited name must immediately lose reviewer access",
);
accountRows[existingReviewerRow][4] = "TRUE";
cacheValues.clear();
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "approved-token",
  }).accountStatus,
  "TRUE",
  "administrator approval should restore access after an edited profile is confirmed",
);
assert.deepEqual(
  [
    sentReviewerEmails.length,
    sentReviewerEmails.at(-1)?.to,
    sentReviewerEmails.at(-1)?.subject,
    sentReviewerEmails.at(-1)?.name,
  ],
  [
    6,
    "reviewer@example.com",
    "Maritime Review Hub reviewer access granted",
    "Maritime Review Hub",
  ],
  "an administrator grant should email the verified account",
);
assert.match(
  sentReviewerEmails.at(-1)?.body || "",
  /^Dear Reviewer,[\s\S]*access request has been approved[\s\S]*Sincerely,\nMaritime Review Hub$/,
  "approval notifications should use formal language and a branded sender name",
);
const reviewerDashboardRequest = () =>
  post({
    type: "get_reviewer_dashboard",
    idToken: "approved-token",
    eventId: eventId("e"),
  });
const reviewerDashboard = reviewerDashboardRequest();
assert.deepEqual(
  [reviewerDashboard.status, reviewerDashboard.tab.columns[0]],
  ["success", "Year"],
  "an approved account should receive the reviewer payload",
);
reviewerDashboardRequest();
assert.equal(
  reviewerDriveLookupCount,
  1,
  "authorized reviewer payload cache hits should skip Drive metadata lookups",
);
for (const [resourceArea, eventSuffix] of [
  ["SYLLABUS", "a"],
  ["MODULES", "b"],
  ["REVIEWERS", "c"],
]) {
  const response = post({
    type: "log_resource_dashboard_action",
    resourceArea,
    action: "TAB_OPEN",
    eventId: eventId(eventSuffix),
    ...(resourceArea === "REVIEWERS" ? { idToken: "approved-token" } : {}),
  });
  assert.equal(response.status, "success");
  assert.equal(
    appendedRows[resourceArea].at(-1)[6],
    "TAB_OPEN",
    `${resourceArea} tab visits should be recorded in their matching log sheet`,
  );
}
const moduleFilterLog = post({
  type: "log_resource_dashboard_action",
  resourceArea: "MODULES",
  action: "FILTER_YEAR",
  detail: "3",
  course: "NAV6",
  semester: "2",
  category: "FINALS",
  eventId: eventId("d"),
});
assert.equal(moduleFilterLog.status, "success");
assert.deepEqual(
  Array.from(appendedRows.MODULES.at(-1).slice(6, 11)),
  ["FILTER_YEAR", "NAV6", "3", "2", "FINALS"],
  "resource activity should store event, course, year, semester, and category separately",
);
const syllabusFileLog = post({
  type: "log_resource_file_click",
  resourceArea: "SYLLABUS",
  fileId: "012345678901234567890",
  fileName: "NAV6 Course Syllabus",
  course: "NAV6",
  year: "3",
  semester: "2",
  category: "SYLLABUS",
  eventId: eventId("e"),
});
assert.equal(syllabusFileLog.status, "success");
assert.deepEqual(
  Array.from(appendedRows.SYLLABUS.at(-1).slice(6)),
  ["FILE_CLICK", "NAV6", "3", "2", "SYLLABUS", "NAV6 Course Syllabus"],
  "syllabus clicks should record their context without storing private Drive IDs",
);
accountRows[existingReviewerRow][4] = "FALSE";
cacheValues.clear();
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
cacheValues.clear();
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

cacheValues.clear();
post({
  type: "get_reviewer_account_status",
  idToken: "approved-token",
});
const interveningAccount = [
  "intervening@example.com",
  "Unchanged",
  "Account",
  "",
  "FALSE",
];
accountRows.splice(1, 0, interveningAccount);
const shiftedAccountEdit = post({
  type: "request_reviewer_enrollment",
  idToken: "approved-token",
  eventId: eventId("c"),
  lastName: "Reviewer",
  firstName: "Correct",
  middleInitial: "C.",
});
assert.equal(shiftedAccountEdit.accountStatus, "FALSE");
assert.deepEqual(
  Array.from(accountRows.find((row) => row[0] === "reviewer@example.com")),
  ["reviewer@example.com", "Reviewer", "Correct", "C.", "FALSE"],
  "profile edits must use a fresh account row after sheet rows move",
);
assert.deepEqual(
  Array.from(interveningAccount),
  ["intervening@example.com", "Unchanged", "Account", "", "FALSE"],
  "profile edits must not overwrite another account after sheet rows move",
);

const allLogRows = Object.values(appendedRows).flat();
assert.equal(
  allLogRows.every((row) => row.length === currentLogHeaders.length),
  true,
  "new account and resource logs must not contain device identity columns",
);
assert.equal(
  allLogRows
    .filter((row) => row[0] !== "2026-10-01")
    .every(
      (row) =>
        /^\d{4}-\d{2}-\d{2}$/.test(row[0]) &&
        /^\d{2}:\d{2}:\d{2}$/.test(row[1]),
    ),
  true,
  "access-log dates and times should be stored in separate Philippine-local columns",
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
tokenClaims = validClaims("unavailable@example.com");
tokenFetchFailures = 2;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "provider-unavailable-token",
  }).code,
  "AUTH_PROVIDER_UNAVAILABLE",
  "temporary outages at both Google verification endpoints must fail explicitly",
);

console.log("Reviewer authorization and approval lifecycle checks passed.");
