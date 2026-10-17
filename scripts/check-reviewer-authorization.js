const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const properties = new Map();
const cacheValues = new Map();
const cacheExpirations = new Map();
const backendLogs = [];
let cacheNowMs = 0;
function clearTestCache() {
  cacheValues.clear();
  cacheExpirations.clear();
}
const spreadsheetId = "1234567890123456789012345678901234567890123";
const oldDeviceId = "01234567-89ab-4cde-8fab-0123456789ab";
let tokenClaims = {};
let tokenFetchFailures = 0;
let uuidSequence = 0;
let spreadsheetTimeZone = "";
let spreadsheetOpenCount = 0;
let accountCacheTtlSeconds = 0;
let reviewerDriveLookupCount = 0;
let reviewerIndexReadCount = 0;
let reviewerIndexModifiedAt = 1000;
let scriptLockAcquisitionCount = 0;
const driveFiles = new Map();
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
  [
    "2026-10-01T08:02:00.000Z",
    "reviewer@example.com",
    oldDeviceId,
    "Reviewer",
    "Rita",
    "A.",
    "ACTION:FILTER_YEAR:3.1",
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
  Logger: {
    log(message) {
      backendLogs.push(String(message));
    },
  },
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
      get(key) {
        const expiresAt = cacheExpirations.get(key);
        if (expiresAt !== undefined && expiresAt <= cacheNowMs) {
          cacheValues.delete(key);
          cacheExpirations.delete(key);
          return null;
        }
        return cacheValues.get(key) || null;
      },
      put: (key, value, ttlSeconds) => {
        accountCacheTtlSeconds = ttlSeconds;
        cacheValues.set(key, value);
        cacheExpirations.set(key, cacheNowMs + ttlSeconds * 1000);
      },
      remove(key) {
        cacheValues.delete(key);
        cacheExpirations.delete(key);
      },
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
                getLastUpdated: () => new Date(reviewerIndexModifiedAt),
                getBlob: () => ({
                  getDataAsString: () => {
                    reviewerIndexReadCount += 1;
                    return JSON.stringify({
                      b: "https://drive.google.com/open?id=",
                      d: {
                        "3.2": {
                          PRELIMS: {
                            NAV6: {
                              n: "Reviewer.pdf",
                              t: "pdf",
                              u: "https://drive.google.com/file/d/reviewerPdf_123456/view",
                            },
                          },
                        },
                      },
                    });
                  },
                }),
              };
            },
          };
        },
      };
    },
  },
  Drive: {
    Files: {
      get(id) {
        return driveFiles.get(String(id)) || null;
      },
    },
  },
  LockService: {
    getUserLock: () => ({
      tryLock: () => true,
      releaseLock() {},
    }),
    getScriptLock: () => {
      scriptLockAcquisitionCount += 1;
      return {
        tryLock: () => true,
        releaseLock() {},
      };
    },
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
const notificationPropertyKey =
  context.getReviewerStatusNotificationPropertyKey_("reviewer@example.com");
properties.set(notificationPropertyKey, "TRUE");
const lockCountBeforeUnchangedStatus =
  scriptLockAcquisitionCount;
context.updateReviewerStatusNotification_("reviewer@example.com", "TRUE");
assert.equal(
  scriptLockAcquisitionCount,
  lockCountBeforeUnchangedStatus,
  "unchanged reviewer account status checks should not contend on the global script lock",
);
assert.equal(
  context.authorizeMRHReviewerStatusEmails(),
  100,
  "the owner should be able to authorize the send-mail permission explicitly",
);
const resourceRootId = context.RESOURCE_PORTAL_ROOT_FOLDER_ID;
driveFiles.set("valid-reviewer-pdf", {
  id: "valid-reviewer-pdf",
  name: "Reviewer.pdf",
  mimeType: "application/pdf",
  parents: ["private-reviewer-folder"],
  size: "100",
});
driveFiles.set("private-reviewer-folder", {
  id: "private-reviewer-folder",
  name: "REVIEWERS v26.10.17",
  mimeType: "application/vnd.google-apps.folder",
  parents: [resourceRootId],
});
driveFiles.set(resourceRootId, {
  id: resourceRootId,
  name: "Resources",
  mimeType: "application/vnd.google-apps.folder",
  parents: [],
});
assert.equal(
  context.getReviewerPdfDriveHierarchy_("valid-reviewer-pdf").insideRoot,
  true,
  "Reviewer PDFs in a versioned private folder under the resource portal root must be accepted",
);
driveFiles.set("public-resource-pdf", {
  id: "public-resource-pdf",
  name: "Public.pdf",
  mimeType: "application/pdf",
  parents: ["public-resource-folder"],
  size: "100",
});
driveFiles.set("public-resource-folder", {
  id: "public-resource-folder",
  name: "MODULES v26.10.17",
  mimeType: "application/vnd.google-apps.folder",
  parents: [resourceRootId],
});
assert.equal(
  context.getReviewerPdfDriveHierarchy_("public-resource-pdf").insideRoot,
  false,
  "a resource outside a versioned private Reviewer folder must be rejected",
);
driveFiles.set("unrelated-root-pdf", {
  id: "unrelated-root-pdf",
  name: "Reviewer.pdf",
  mimeType: "application/pdf",
  parents: ["unrelated-private-folder"],
  size: "100",
});
driveFiles.set("unrelated-private-folder", {
  id: "unrelated-private-folder",
  name: "REVIEWERS v26.10.17",
  mimeType: "application/vnd.google-apps.folder",
  parents: ["unrelated-database-root"],
});
driveFiles.set("unrelated-database-root", {
  id: "unrelated-database-root",
  name: "Database",
  mimeType: "application/vnd.google-apps.folder",
  parents: [],
});
assert.equal(
  context.getReviewerPdfDriveHierarchy_("unrelated-root-pdf").insideRoot,
  false,
  "a Reviewer PDF beneath the database root must not count as part of the resource hierarchy",
);

const clientId = "1234567890-example.apps.googleusercontent.com";
const appVersion = JSON.parse(
  fs.readFileSync("version.json", "utf8"),
).buildVersion;
assert.equal(
  context.isSupportedClientVersion(appVersion),
  true,
  "the current local client release must be accepted by the backend",
);
assert.equal(
  context.isSupportedClientVersion("mrh-26.10.19-6be1abf21b37"),
  true,
  "the verified production client release must remain compatible with the deployed backend",
);
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
const installedEditTriggers = [];
context.ScriptApp = {
  getProjectTriggers: () => [],
  newTrigger(handler) {
    const trigger = { handler, spreadsheetId: "", schedule: "" };
    return {
      forSpreadsheet(id) {
        trigger.spreadsheetId = id;
        return this;
      },
      onEdit() {
        trigger.schedule = "edit";
        return this;
      },
      timeBased() {
        trigger.schedule = "time";
        return this;
      },
      everyMinutes(minutes) {
        trigger.intervalMinutes = minutes;
        return this;
      },
      create() {
        installedEditTriggers.push(trigger);
        return trigger;
      },
    };
  },
};
assert.equal(context.setupTriggers().status, "success");
assert.ok(
  installedEditTriggers.some(
    (trigger) =>
      trigger.handler === "mrhAccountsEdited" &&
      trigger.spreadsheetId === spreadsheetId &&
      trigger.schedule === "edit",
  ),
  "backend setup should install the ACCOUNTS edit trigger that keeps cached statuses fresh",
);
assert.ok(
  installedEditTriggers.some(
    (trigger) =>
      trigger.handler === "scheduledDatabaseSync" &&
      trigger.intervalMinutes === 5,
  ),
  "account cache trigger setup should preserve the five-minute deck safety sync",
);
assert.ok(
  installedEditTriggers.some(
    (trigger) =>
      trigger.handler === "processReviewerStatusNotifications" &&
      trigger.intervalMinutes === 1,
  ),
  "reviewer status emails should use an independent one-minute background worker",
);
const notificationRetryEmail = "notification-retry@example.com";
const notificationRetryStateKey =
  context.getReviewerStatusNotificationPropertyKey_(notificationRetryEmail);
const notificationRetryPendingKey =
  context.getReviewerStatusNotificationPendingKey_(notificationRetryEmail);
properties.set(notificationRetryStateKey, "TRUE");
context.updateReviewerStatusNotification_(notificationRetryEmail, "DENIED");
const sendNotification = context.MailApp.sendEmail;
let failNotificationOnce = true;
context.MailApp.sendEmail = (message) => {
  if (failNotificationOnce) {
    failNotificationOnce = false;
    throw new Error("simulated mail outage");
  }
  sentReviewerEmails.push(message);
};
const failedNotificationAttempt =
  context.processReviewerStatusNotifications();
assert.equal(failedNotificationAttempt.status, "success");
assert.equal(
  failedNotificationAttempt.processed,
  0,
  "failed notification delivery should remain queued for automatic retry",
);
assert.equal(properties.has(notificationRetryPendingKey), true);
const recoveredNotificationAttempt =
  context.processReviewerStatusNotifications();
assert.equal(recoveredNotificationAttempt.status, "success");
assert.equal(
  recoveredNotificationAttempt.processed,
  1,
  "the notification worker should recover on its next attempt",
);
assert.equal(properties.has(notificationRetryPendingKey), false);
assert.equal(
  sentReviewerEmails.at(-1)?.subject,
  "Maritime Review Hub resource access denied",
);
context.MailApp.sendEmail = sendNotification;
sentReviewerEmails.length = 0;
context.initializeMRHAccountsSpreadsheet();
assert.deepEqual(
  Array.from(accountRows[0]),
  ["Email", "Last Name", "First Name", "Middle Initial", "Active", "Date", "Time"],
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
  "",
  "",
]);
assert.equal(accountRows[2][0], "second-reviewer@example.com");
assert.equal(sheets.Accounts, undefined);
assert.equal(sheets.MODULE, undefined);
assert.equal(sheets.MODULES !== undefined, true);
assert.deepEqual(
  sheets.ACCOUNTS.getRange(1, 1, 1, 7).getDisplayValues()[0],
  ["Email", "Last Name", "First Name", "Middle Initial", "Active", "Date", "Time"],
  "the ACCOUNTS tab should include separate creation Date and Time fields",
);
accountRows[0] = [
  "Email",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Active",
  "",
  "",
];
context.findMRHAccount_("reviewer@example.com", true);
assert.deepEqual(
  Array.from(accountRows[0]),
  ["Email", "Last Name", "First Name", "Middle Initial", "Active", "Date", "Time"],
  "the backend should lazily add creation columns to an existing ACCOUNTS sheet",
);
assert.equal(spreadsheetTimeZone, "Asia/Manila");
assert.deepEqual(Array.from(reviewerLogs[0]), currentLogHeaders);
assert.equal(
  reviewerLogs.some((row) => String(row[6] || "").startsWith("SIGN_IN")),
  false,
  "legacy sign-in events should be moved out of REVIEWERS",
);
assert.equal(
  reviewerLogs.some(
    (row) => row[6] === "FILTER_YEAR" && row[8] === "3" && row[9] === "1",
  ),
  true,
  "legacy combined year/semester activity should migrate into separate columns",
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
  sheets.SCOPES.getRange(2, 1, 7, 1)
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
  context.authorizeReviewerPdfRequest_({ sessionId: approved.sessionId })
    .account.rawAccountStatus,
  "TRUE",
  "Reviewer PDF authorization must read the exact Active value from ACCOUNTS",
);
const originalApprovedStatus = accountRows[1][4];
accountRows[1][4] = "YES";
assert.equal(
  context.findMRHAccount_("reviewer@example.com", true).rawAccountStatus,
  "YES",
  "the fresh account lookup must retain the original Active cell value",
);
const pdfAliasAuthorization = context.authorizeReviewerPdfRequest_({
  sessionId: approved.sessionId,
});
assert.equal(
  JSON.parse(pdfAliasAuthorization.error.getContent()).code,
  "ACCOUNT_PENDING",
  JSON.stringify(pdfAliasAuthorization),
);
accountRows[1][4] = originalApprovedStatus;
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
const reusableAccountRow = Array(7).fill("");
accountRows.splice(2, 0, reusableAccountRow);
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
assert.deepEqual(Array.from(reusableAccountRow.slice(0, 5)), [
  "new-reviewer@example.com",
  "Reviewer",
  "New",
  "P.",
  "FALSE",
]);
assert.match(reusableAccountRow[5], /^\d{4}-\d{2}-\d{2}$/);
assert.match(reusableAccountRow[6], /^\d{2}:\d{2}:\d{2}$/);
assert.equal(
  accountRows.at(-1)[0],
  "second-reviewer@example.com",
  "a new account should reuse the first blank row instead of appending below existing accounts",
);
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
  0,
  "account status responses must not wait for email delivery",
);
context.processReviewerStatusNotifications();
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
    "Maritime Review Hub resource access pending",
    "Maritime Review Hub",
  ],
);
assert.match(
  sentReviewerEmails[0]?.body || "",
  /^Dear Maritime Review Hub user,[\s\S]*pending administrator review[\s\S]*Sincerely,\nMaritime Review Hub$/,
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
  Array.from(accountRows.find((row) => row[0] === "new-reviewer@example.com").slice(0, 5)),
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
clearTestCache();
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "new-user-token",
  }).accountStatus,
  "DENIED",
  "polling should observe administrator denial without stale account caching",
);
assert.equal(
  sentReviewerEmails.length,
  1,
  "DENIED status propagation must return before mail delivery",
);
context.processReviewerStatusNotifications();
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
    "Maritime Review Hub resource access denied",
    "Maritime Review Hub",
  ],
  "an administrator denial should email the verified account once",
);
assert.match(
  sentReviewerEmails[1]?.body || "",
  /^Dear Maritime Review Hub user,[\s\S]*unable to approve[\s\S]*Sincerely,\nMaritime Review Hub$/,
  "denial notifications should use formal language and a branded sender name",
);
clearTestCache();
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
  reusableAccountRow[5],
  reusableAccountRow[6],
]);
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "new-user-token",
  }).accountStatus,
  "FALSE",
  "a corrected denied profile must return to pending review",
);
context.processReviewerStatusNotifications();
assert.deepEqual(
  [
    sentReviewerEmails.length,
    sentReviewerEmails[2]?.to,
    sentReviewerEmails[2]?.subject,
  ],
  [
    3,
    "new-reviewer@example.com",
    "Maritime Review Hub resource access pending",
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
  Array.from(
    accountRows
      .find((row) => row[0] === "admin-added@example.com")
      .slice(0, 5),
  ),
  ["admin-added@example.com", "Added", "Admin", "A.", "FALSE"],
  "a fresh account match must update the correct row and reset approval",
);

tokenClaims = validClaims();
const existingReviewerRow = accountRows.findIndex(
  (row) => row[0] === "reviewer@example.com",
);
clearTestCache();
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
clearTestCache();
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "approved-token",
  }).accountStatus,
  "TRUE",
  "administrator approval should restore access after an edited profile is confirmed",
);
context.processReviewerStatusNotifications();
assert.deepEqual(
  [
    sentReviewerEmails.length,
    sentReviewerEmails.at(-1)?.to,
    sentReviewerEmails.at(-1)?.subject,
    sentReviewerEmails.at(-1)?.name,
  ],
  [
    5,
    "reviewer@example.com",
    "Maritime Review Hub resource access granted",
    "Maritime Review Hub",
  ],
  "an administrator grant should email the verified account",
);
assert.match(
  sentReviewerEmails.at(-1)?.body || "",
  /^Dear Maritime Review Hub user,[\s\S]*access request has been approved[\s\S]*Sincerely,\nMaritime Review Hub$/,
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
assert.equal(
  reviewerDashboard.tab.links[0][2],
  "mrh-reviewer-pdf:reviewerPdf_123456",
  "reviewer PDF URLs should be converted to protected file references",
);
const cachedReviewerDashboard = reviewerDashboardRequest();
assert.deepEqual(
  [
    cachedReviewerDashboard.status,
    cachedReviewerDashboard.tab.links[0][2],
  ],
  ["success", "mrh-reviewer-pdf:reviewerPdf_123456"],
  "cached reviewer PDF references should remain valid when the dashboard is served again",
);
assert.equal(
  reviewerDriveLookupCount,
  2,
  "each authorized dashboard request should verify the current Drive index version",
);
assert.equal(
  reviewerIndexReadCount,
  1,
  "an unchanged Drive index version should reuse its cached dashboard payload",
);
reviewerIndexModifiedAt += 1;
assert.equal(
  reviewerDashboardRequest().status,
  "success",
  "the dashboard should recover after a source index edit",
);
assert.equal(
  reviewerIndexReadCount,
  2,
  "a changed Drive index timestamp must not reuse a stale dashboard cache entry",
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
const combinedTermFileLog = post({
  type: "log_resource_file_click",
  resourceArea: "MODULES",
  fileId: "112345678901234567890",
  fileName: "NAV6 Final Review",
  course: "NAV6",
  year: "3.1",
  eventId: eventId("f"),
});
assert.equal(combinedTermFileLog.status, "success");
assert.deepEqual(
  Array.from(appendedRows.MODULES.at(-1).slice(6, 10)),
  ["FILE_CLICK", "NAV6", "3", "1"],
  "combined year/semester values should be split into their matching log columns",
);
assert.equal(
  appendedRows.MODULES.at(-1)[7],
  "NAV6",
  "the Course column should contain the course, not the Event column",
);
assert.equal(
  appendedRows.MODULES.at(-1)[8],
  "3",
  "the Year column should contain only the year level",
);
assert.equal(
  appendedRows.MODULES.at(-1)[9],
  "1",
  "the Semester column should contain only the semester",
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
clearTestCache();
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
clearTestCache();
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

clearTestCache();
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
  Array.from(
    accountRows.find((row) => row[0] === "reviewer@example.com").slice(0, 5),
  ),
  ["reviewer@example.com", "Reviewer", "Correct", "C.", "FALSE"],
  "profile edits must use a fresh account row after sheet rows move",
);
assert.deepEqual(
  Array.from(interveningAccount),
  ["intervening@example.com", "Unchanged", "Account", "", "FALSE"],
  "profile edits must not overwrite another account after sheet rows move",
);

const originalDashboardHandler = context.handleGetReviewerDashboardRequest;
context.handleGetReviewerDashboardRequest = () => {
  const error = new Error(
    "private-token@example.com and sensitive-account-data",
  );
  error.code = "REVIEWER_INDEX_MISSING";
  throw error;
};
const backendLogCountBeforeFailure = backendLogs.length;
const failedDashboardResponse = post({
  type: "get_reviewer_dashboard",
  eventId: eventId("a"),
  requestId: eventId("b"),
  idToken: "private-id-token-not-for-logs",
  sessionId: "private-session-not-for-logs",
});
context.handleGetReviewerDashboardRequest = originalDashboardHandler;
assert.equal(failedDashboardResponse.code, "SERVER_ERROR");
assert.equal(
  failedDashboardResponse.correlationId,
  eventId("b"),
  "server errors should return the request correlation ID supplied by the client",
);
assert.match(
  failedDashboardResponse.correlationId || "",
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  "server failures should return a safe correlation ID",
);
const loggedFailure = backendLogs.slice(backendLogCountBeforeFailure).join("\n");
assert.match(loggedFailure, /requestType=get_reviewer_dashboard/);
assert.match(loggedFailure, new RegExp(failedDashboardResponse.correlationId));
assert.match(loggedFailure, /reasonCode=REVIEWER_INDEX_MISSING/);
assert.doesNotMatch(
  loggedFailure,
  /private-token|private-id-token|private-session|sensitive-account-data/,
  "backend failure logs must not contain tokens, sessions, account details, or raw error messages",
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

const liveAccount = accountRows.find(
  (row) => row[0] === "reviewer@example.com",
);
tokenClaims = validClaims("reviewer@example.com");
liveAccount[4] = "FALSE";
clearTestCache();
const spreadsheetOpensBeforeStatusPoll = spreadsheetOpenCount;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "fresh-status-token",
  }).accountStatus,
  "FALSE",
);
const spreadsheetOpensAfterFirstStatusPoll = spreadsheetOpenCount;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "fresh-status-token",
  }).accountStatus,
  "FALSE",
);
assert.equal(
  spreadsheetOpenCount,
  spreadsheetOpensAfterFirstStatusPoll,
  "repeated approval polls should use the shared account cache instead of reopening the spreadsheet",
);
assert.ok(spreadsheetOpensAfterFirstStatusPoll > spreadsheetOpensBeforeStatusPoll);
assert.equal(
  accountCacheTtlSeconds,
  5,
  "approval status cache should expire quickly even when an account edit trigger is unavailable",
);
liveAccount[4] = "TRUE";
cacheNowMs += 5001;
const spreadsheetOpensBeforeCacheExpiryPoll = spreadsheetOpenCount;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "fresh-status-token",
  }).accountStatus,
  "TRUE",
  "approval changes must become visible after the short cache expires without relying on an edit trigger",
);
assert.equal(
  spreadsheetOpenCount,
  spreadsheetOpensBeforeCacheExpiryPoll + 1,
  "cache expiry should perform one fresh account lookup",
);
liveAccount[4] = "FALSE";
const generationBeforeAccountEdit = context.getMRHAccountCacheGeneration_();
context.mrhAccountsEdited({
  source: { getId: () => spreadsheetId },
  range: {
    getSheet: () => ({ getName: () => "ACCOUNTS" }),
    getLastRow: () => 2,
    getColumn: () => 5,
    getLastColumn: () => 5,
  },
});
assert.notEqual(
  context.getMRHAccountCacheGeneration_(),
  generationBeforeAccountEdit,
  "an ACCOUNTS edit should invalidate all account-status snapshots",
);
const spreadsheetOpensBeforeInvalidatedStatusPoll = spreadsheetOpenCount;
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "fresh-status-token",
  }).accountStatus,
  "FALSE",
  "status polling must immediately observe an administrator revocation after the ACCOUNTS edit trigger invalidates the cache",
);
assert.equal(
  spreadsheetOpenCount,
  spreadsheetOpensBeforeInvalidatedStatusPoll + 1,
  "an ACCOUNTS edit should force exactly one fresh lookup for the next status poll",
);
for (const editedColumn of [1, 2, 3, 4, 5, 6, 7]) {
  const generationBeforeFieldEdit = context.getMRHAccountCacheGeneration_();
  context.mrhAccountsEdited({
    source: { getId: () => spreadsheetId },
    range: {
      getSheet: () => ({ getName: () => "ACCOUNTS" }),
      getLastRow: () => 2,
      getColumn: () => editedColumn,
      getLastColumn: () => editedColumn,
    },
  });
  assert.notEqual(
    context.getMRHAccountCacheGeneration_(),
    generationBeforeFieldEdit,
    `edits to ACCOUNTS column ${editedColumn} must invalidate cached account data`,
  );
}
const generationBeforeIrrelevantEdit = context.getMRHAccountCacheGeneration_();
context.mrhAccountsEdited({
  source: { getId: () => "different-spreadsheet" },
  range: {
    getSheet: () => ({ getName: () => "ACCOUNTS" }),
    getLastRow: () => 2,
    getColumn: () => 5,
    getLastColumn: () => 5,
  },
});
context.mrhAccountsEdited({
  source: { getId: () => spreadsheetId },
  range: {
    getSheet: () => ({ getName: () => "OTHER" }),
    getLastRow: () => 2,
    getColumn: () => 5,
    getLastColumn: () => 5,
  },
});
context.mrhAccountsEdited({
  source: { getId: () => spreadsheetId },
  range: {
    getSheet: () => ({ getName: () => "ACCOUNTS" }),
    getLastRow: () => 1,
    getColumn: () => 5,
    getLastColumn: () => 5,
  },
});
assert.equal(
  context.getMRHAccountCacheGeneration_(),
  generationBeforeIrrelevantEdit,
  "unrelated spreadsheets, sheets, and header-only edits must not invalidate account snapshots",
);
assert.equal(
  post({
    type: "get_reviewer_account_status",
    idToken: "fresh-status-token",
  }).accountStatus,
  "FALSE",
  "the account cache should be warm before measuring a concurrent polling burst",
);
const spreadsheetOpensBeforeConcurrentStatusBurst = spreadsheetOpenCount;
const burstStartedAt = performance.now();
Promise.all(
  Array.from({ length: 32 }, () =>
    Promise.resolve().then(() =>
      post({
        type: "get_reviewer_account_status",
        idToken: "fresh-status-token",
      }),
    ),
  ),
).then((statusBurst) => {
  const statusBurstElapsedMs = performance.now() - burstStartedAt;
  assert.ok(
    statusBurst.every((result) => result.accountStatus === "FALSE"),
    "concurrent status requests must all observe the same authorized state",
  );
  assert.equal(
    spreadsheetOpenCount,
    spreadsheetOpensBeforeConcurrentStatusBurst,
    "a burst of status polls should reuse a fresh shared account cache entry",
  );
  console.log(
    JSON.stringify({
      test: "account status cached request burst",
      requests: statusBurst.length,
      elapsedMs: Math.round(statusBurstElapsedMs),
      additionalSpreadsheetOpens: 0,
      environment: "local Apps Script API simulation, not production GAS",
    }),
  );
  console.log("Reviewer authorization and approval lifecycle checks passed.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
