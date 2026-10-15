const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  console,
  JSON,
  Math,
  Date,
  Logger: { log() {} },
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
};
const currentClientVersion = "mrh-release-10.15.26-6";
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("backend/main.js", "utf8"),
  context,
  { filename: "backend/main.js" },
);

assert.equal(
  context.normalizeStoredPassword("test"),
  "test",
  "plaintext UUID-sheet passwords must remain plaintext in memory",
);
assert.equal(
  context.isSupportedClientVersion(currentClientVersion),
  true,
  "the current source release must pass the backend version gate",
);
assert.equal(
  context.isSupportedClientVersion("mrh-10.15.26-5-89f6603f02cb"),
  true,
  "the current deployed release must pass the backend version gate",
);
assert.equal(
  context.isSupportedClientVersion("mrh-10.16.0-c1c3af44770c"),
  true,
  "a SemVer release without a numeric prerelease suffix must pass the backend version gate",
);
assert.equal(
  context.isSupportedClientVersion("mrh-10.15.26-4-89f6603f02cb"),
  false,
  "the previous release must be rejected by the backend version gate",
);
assert.equal(
  context.isSupportedClientVersion(""),
  false,
  "requests without a client version must be rejected",
);

function createIterator(items) {
  let index = 0;
  return {
    hasNext() {
      return index < items.length;
    },
    next() {
      return items[index++];
    },
  };
}

const rootId = context.RESOURCE_PORTAL_ROOT_FOLDER_ID;
const access = {
  ANYONE: "ANYONE",
  ANYONE_WITH_LINK: "ANYONE_WITH_LINK",
  PRIVATE: "PRIVATE",
};
const resourceCache = new Map();
const rootFolder = {
  getId: () => rootId,
  getName: () => "Maritime Resources",
  getParents: () => createIterator([]),
  getSharingAccess: () => access.PRIVATE,
};
const publicFolder = {
  getId: () => "public-folder-id",
  getName: () => "General Resources",
  getParents: () => createIterator([rootFolder]),
  getSharingAccess: () => access.ANYONE_WITH_LINK,
  getUrl: () => "https://drive.google.com/drive/folders/public-folder-id",
};
const privateFolder = {
  getId: () => "private-folder-id",
  getName: () => "Restricted Materials",
  getParents: () => createIterator([rootFolder]),
  getSharingAccess: () => access.PRIVATE,
  getUrl: () => "https://drive.google.com/drive/folders/private-folder-id",
};
const reviewerFolder = {
  getId: () => "reviewer-folder-id",
  getName: () => "REVIEWERS v.01.02.03",
  getParents: () => createIterator([rootFolder]),
  getSharingAccess: () => access.ANYONE,
};
const legacyReviewerFolder = {
  getId: () => "legacy-reviewer-folder-id",
  getName: () => "REVIEWERS v10.13.26",
  getParents: () => createIterator([rootFolder]),
  getSharingAccess: () => access.ANYONE,
};
const publicFile = {
  getId: () => "public-file-id",
  getName: () => "Guidelines.pdf",
  getMimeType: () => "application/pdf",
  getLastUpdated: () => new Date("2026-01-01T00:00:00Z"),
  getUrl: () => "https://drive.google.com/file/d/public-file-id/view",
  getSharingAccess: () => access.ANYONE,
};
const privateFile = {
  getId: () => "private-file-id",
  getName: () => "Restricted.pdf",
  getMimeType: () => "application/pdf",
  getLastUpdated: () => new Date("2026-01-01T00:00:00Z"),
  getUrl: () => "https://drive.google.com/file/d/private-file-id/view",
  getSharingAccess: () => access.PRIVATE,
};
let rootFolderListReads = 0;
let privateFileBlobReads = 0;
rootFolder.getFolders = () => {
  rootFolderListReads += 1;
  return createIterator([
    publicFolder,
    privateFolder,
    reviewerFolder,
    legacyReviewerFolder,
  ]);
};
rootFolder.getFiles = () => createIterator([publicFile, privateFile]);
publicFolder.getFolders = () => createIterator([]);
publicFolder.getFiles = () => createIterator([]);
privateFolder.getFolders = () => createIterator([]);
privateFolder.getFiles = () => createIterator([]);
reviewerFolder.getFolders = () => createIterator([]);
reviewerFolder.getFiles = () => createIterator([]);
legacyReviewerFolder.getFolders = () => createIterator([]);
legacyReviewerFolder.getFiles = () => createIterator([]);
context.DriveApp = {
  Access: access,
  getFolderById(folderId) {
    if (folderId === rootId) return rootFolder;
    if (folderId === "reviewer-folder-id") return reviewerFolder;
    if (folderId === "legacy-reviewer-folder-id") return legacyReviewerFolder;
    return privateFolder;
  },
  getFileById(fileId) {
    if (fileId === "reviewer-file-id") return reviewerDriveFile;
    if (fileId === "legacy-reviewer-file-id") return legacyReviewerDriveFile;
    return privateDriveFile;
  },
};
context.CacheService = {
  getScriptCache() {
    return {
      get(key) {
        return resourceCache.get(key) || null;
      },
      put(key, value) {
        resourceCache.set(key, value);
      },
      remove(key) {
        resourceCache.delete(key);
      },
    };
  },
};
context.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput(text) {
    return {
      text,
      setMimeType() {
        return this;
      },
    };
  },
};
const rootListing = JSON.parse(
  context.handleListPublicResourcesRequest({}).text,
);
assert.equal(
  rootListing.status,
  "success",
  "the configured portal root can be browsed even if the container is not public",
);
assert.deepEqual(
  rootListing.items.map((item) => item.name),
  [
    "General Resources",
    "Restricted Materials",
    "Guidelines.pdf",
    "Restricted.pdf",
  ],
  "the public website includes private Drive contents but omits reviewer folders",
);
assert.equal(
  rootListing.items.find((item) => item.name === "Restricted Materials")
    .isPublic,
  false,
  "private Drive folders are marked for website-proxied access",
);
context.handleListPublicResourcesRequest({ folderId: rootId });
assert.equal(
  rootFolderListReads,
  1,
  "a recent public root listing should be served from cache without relisting Drive items",
);
assert.equal(
  JSON.parse(
    context.handleListPublicResourcesRequest({
      folderId: "private-folder-id",
    }).text,
  ).status,
  "success",
  "a private Drive subfolder within the portal root can be browsed on the public website",
);
assert.equal(
  JSON.parse(
    context.handleListPublicResourcesRequest({
      folderId: "reviewer-folder-id",
    }).text,
  ).code,
  "FORBIDDEN",
  "reviewer-named folders remain inaccessible through the website",
);
assert.equal(
  JSON.parse(
    context.handleListPublicResourcesRequest({
      folderId: "legacy-reviewer-folder-id",
    }).text,
  ).code,
  "FORBIDDEN",
  "reviewer folder names without a dot after v remain inaccessible",
);
const privateDriveFile = {
  getParents: () => createIterator([privateFolder]),
  getMimeType: () => "application/pdf",
  getSize: () => 2,
  getBlob: () => ({
    getBytes: () => {
      privateFileBlobReads += 1;
      return [72, 105];
    },
  }),
  getName: () => "Restricted.pdf",
};
const reviewerDriveFile = {
  getParents: () => createIterator([reviewerFolder]),
};
const legacyReviewerDriveFile = {
  getParents: () => createIterator([legacyReviewerFolder]),
};
const privatePreview = JSON.parse(
  context.handleGetResourcePreviewRequest({ fileId: "private-file-id" }).text,
);
assert.equal(
  privatePreview.status,
  "success",
  "a private Drive file within the portal root can be served to the public website",
);
assert.equal(
  privatePreview.data,
  "SGk=",
  "private file preview data is returned as base64 for an in-site viewer",
);
const cachedPrivatePreview = JSON.parse(
  context.handleGetResourcePreviewRequest({ fileId: "private-file-id" }).text,
);
assert.equal(
  cachedPrivatePreview.data,
  "SGk=",
  "a cached private preview must preserve its file data",
);
assert.equal(
  privateFileBlobReads,
  1,
  "a recent private preview should be served from cache without exporting the file again",
);
assert.equal(
  JSON.parse(
    context.handleGetResourcePreviewRequest({
      fileId: "reviewer-file-id",
    }).text,
  ).code,
  "FORBIDDEN",
  "private files inside reviewer folders cannot be served through the website",
);
assert.equal(
  JSON.parse(
    context.handleGetResourcePreviewRequest({
      fileId: "legacy-reviewer-file-id",
    }).text,
  ).code,
  "FORBIDDEN",
  "private files inside reviewer folders without a dot after v remain blocked",
);

assert.equal(
  context.passwordMatches("test", "test"),
  true,
  "a plaintext UUID-sheet password must match the value entered on the website",
);
assert.equal(
  context.passwordMatches("test ", "test"),
  false,
  "password comparison must preserve exact whitespace",
);
assert.equal(
  context.passwordMatches(
    "test",
    "sha256i$1500$41ba38ac-d185-4a8f-93a6-59dc216090da$b054ecf509de3038f955b79468f0ef2b5230f0a433714b3f8136ca1e5605833a",
  ),
  true,
  "existing iterated password hashes must remain verifiable",
);
assert.equal(
  context.passwordMatches(
    "test",
    "sha256i$1500$41ba38ac-d185-4a8f-93a6-59dc216090da$b7f62bd56d0fabe86e860c6cecc8eac8fcd00921ebeb17e2f20f4e89f9418245",
  ),
  false,
  "invalid hashes must not be accepted for a plaintext password",
);
let writtenUUIDRows;
const sheetTextFormats = [];
const sheetWriteEvents = [];
context.getOrInitializeUUIDSheet = () => ({
  getLastRow: () => 1,
  getRange() {
    return {
      setValues(values) {
        writtenUUIDRows = values;
        sheetWriteEvents.push("values");
      },
      setNumberFormat(format) {
        sheetTextFormats.push(format);
        sheetWriteEvents.push("format");
      },
    };
  },
});
context.writeUUIDRecords([
  { uuid: "deck-1", subject: "TEST", password: "test" },
  { uuid: "deck-2", subject: "FORMULA-LIKE", password: "=literal" },
]);
assert.equal(
  writtenUUIDRows.find((row) => row[1] === "TEST")[3],
  "test",
  "UUID sheet writes must preserve the plaintext password rather than replace it with a hash",
);
assert.equal(
  writtenUUIDRows.find((row) => row[1] === "FORMULA-LIKE")[3],
  "=literal",
  "UUID sheet writes must preserve formula-like passwords exactly",
);
assert.equal(
  sheetTextFormats[0],
  "@",
  "UUID sheet password cells must be formatted as text before writing",
);
assert.equal(
  sheetWriteEvents[0],
  "format",
  "UUID password cells must be text-formatted before password values are written",
);
context.loadDeckMetadataMap = () => Object.create(null);

assert.equal(
  context.filterSummaryDataByAccess("{ invalid json"),
  null,
  "malformed summary data must be distinguished from a valid empty summary",
);
assert.equal(
  context.filterSummaryDataByAccess(JSON.stringify({ v: 2, p: [], d: [] })),
  null,
  "unsupported summary encodings must trigger recovery",
);
assert.deepEqual(
  JSON.parse(context.filterSummaryDataByAccess("[]")),
  { v: 1, p: [], d: [], h: [] },
  "a valid empty summary must remain a successful empty result",
);
assert.equal(
  context.filterSummaryDataByAccess(JSON.stringify([{ Subject: "STALE" }])),
  null,
  "legacy non-empty summaries without payload fingerprints must trigger recovery",
);

const response = {
  content: "",
  setMimeType() {
    return this;
  },
};
const properties = new Map([
  ["MRH_SUBJECT_SCHEMA_VERSION", "10"],
  ["LAST_CACHE_BUILD_SUCCESS", "2026-10-14T00:00:00.000Z"],
]);
context.ContentService = {
  MimeType: { JSON: "application/json" },
  createTextOutput(content) {
    return { ...response, content };
  },
};
context.getScriptProps = () => ({
  getProperty: (key) => properties.get(key) || null,
  setProperty: (key, value) => properties.set(key, value),
});
context.jsonResponse = (payload) => payload;
context.generateCacheKey = () => "summary";
context.cacheGetChunked = () => "{ invalid cached json";
context.cachePutChunked = () => {};
context.loadDeckMetadataMap = () => ({
  COLREGS: { uuid: "deck-1", password: "", hidden: false },
});
context.getOrCreateCacheFolder = () => ({});

const validPersistentSummary = JSON.stringify({
  v: 1,
  p: [""],
  d: [[0, "COLREGS", 1, "MC", 0]],
  h: ["a".repeat(64)],
});
context.findCacheFilesByName = () => ({
  hasNext: () => true,
  next: () => ({
    getBlob: () => ({ getDataAsString: () => validPersistentSummary }),
  }),
});
const recoveredResponse = context.doGetInternal({
  parameter: { v: currentClientVersion },
});
assert.deepEqual(
  JSON.parse(recoveredResponse.content),
  {
    v: 1,
    p: [""],
    d: [[0, "COLREGS", 1, "MC", 0]],
    h: ["a".repeat(64)],
  },
  "a corrupt cache entry must fall back to the valid persistent summary",
);

let rebuildScheduled = false;
context.getScriptProps = () => ({
  getProperty: (key) => properties.get(key) || null,
  setProperty: (key, value) => properties.set(key, value),
});
context.ensureResumeBuildTrigger = () => {
  rebuildScheduled = true;
};
context.findCacheFilesByName = () => ({
  hasNext: () => true,
  next: () => ({ getBlob: () => ({ getDataAsString: () => "{ broken" }) }),
});
const coldStartResponse = context.doGetInternal({
  parameter: { v: currentClientVersion },
});
assert.deepEqual(
  JSON.parse(JSON.stringify(coldStartResponse)),
  { isColdStart: true, subjects: [] },
  "two invalid summary copies must report cold start instead of a successful empty list",
);
assert.equal(properties.get("FORCE_REBUILD"), "true");
assert.equal(rebuildScheduled, true);

context.errorResponse = (message, code, details = {}) => ({
  status: "error",
  code,
  message,
  ...details,
});
context.loadDeckMetadataMap = () => Object.create(null);
context.getEffectivePassword = () => "";
context.isSubjectHiddenByHierarchy = () => false;
assert.equal(
  context.doGetInternal({
    parameter: { subject: "MISSING", v: currentClientVersion },
  }).status,
  "error",
  "GET deck errors must use the network client's recognized error envelope",
);

context.loadDeckMetadataMap = () => ({
  LOCKED: { uuid: "deck-locked", password: "protected" },
});
context.getEffectivePassword = () => "protected";
assert.equal(
  context.doGetInternal({
    parameter: { subject: "LOCKED", v: currentClientVersion },
  }).code,
  "PASSWORD_REQUIRED",
);

context.loadDeckMetadataMap = () => ({
  HIDDEN: { uuid: "deck-hidden", password: "" },
});
context.getEffectivePassword = () => "";
context.isSubjectHiddenByHierarchy = () => true;
assert.equal(
  context.doGetInternal({
    parameter: { subject: "HIDDEN", v: currentClientVersion },
  }).code,
  "FORBIDDEN",
);

assert.equal(
  context.doGetInternal({ parameter: { subject: "COLREGS" } }).code,
  "CLIENT_UPDATE_REQUIRED",
  "GET requests without a client version must be rejected",
);
assert.equal(
  context.doGetInternal({
    parameter: { subject: "COLREGS", v: "mrh-10.15.26-4-4daaf03c73b6" },
  }).code,
  "CLIENT_UPDATE_REQUIRED",
  "GET requests from an older app release must be rejected",
);
context.handleSyncStatus = () => ({ status: "ok" });
assert.equal(
  context.doPost({
    postData: { contents: JSON.stringify({ type: "get_sync_status" }) },
  }).code,
  "CLIENT_UPDATE_REQUIRED",
  "POST requests without a client version must be rejected",
);
assert.equal(
  context.clientVersionRequired("mrh-10.15.26-4-4daaf03c73b69520")
    .purgeClientData,
  true,
  "the backend must tell compatible stale clients to purge their app-owned data",
);
assert.equal(
  context.doPost({
    postData: {
      contents: JSON.stringify({
        type: "get_sync_status",
        appVersion: "mrh-10.15.26-4-4daaf03c73b6",
      }),
    },
  }).code,
  "CLIENT_UPDATE_REQUIRED",
  "POST requests from an older app release must be rejected",
);
assert.equal(
  context.doPost({
    postData: {
      contents: JSON.stringify({
        type: "get_sync_status",
        appVersion: currentClientVersion,
      }),
    },
  }).status,
  "ok",
  "the current app release must retain backend access",
);

const rateLimitValues = new Map();
let rateLimitLockHeld = false;
let canAcquireRateLimitLock = true;
let rateLimitLockReleases = 0;
context.LockService = {
  getUserLock() {
    return {
      tryLock(timeoutMs) {
        assert.equal(timeoutMs, 5000);
        if (!canAcquireRateLimitLock || rateLimitLockHeld) return false;
        rateLimitLockHeld = true;
        return true;
      },
      releaseLock() {
        assert.equal(rateLimitLockHeld, true);
        rateLimitLockHeld = false;
        rateLimitLockReleases += 1;
      },
    };
  },
};
context.CacheService = {
  getScriptCache() {
    return {
      get(key) {
        assert.equal(
          rateLimitLockHeld,
          true,
          "rate-limit reads must be protected by the user lock",
        );
        return rateLimitValues.get(key) || null;
      },
      put(key, value, ttlSeconds) {
        assert.equal(
          rateLimitLockHeld,
          true,
          "rate-limit writes must be protected by the same user lock",
        );
        assert.equal(ttlSeconds, 60);
        rateLimitValues.set(key, value);
      },
    };
  },
};
assert.equal(context.incrementRateLimit("password", 2, 60), true);
assert.equal(context.incrementRateLimit("password", 2, 60), true);
assert.equal(context.incrementRateLimit("password", 2, 60), false);
assert.equal(rateLimitValues.get("password"), "2");
assert.equal(rateLimitLockReleases, 3);

canAcquireRateLimitLock = false;
assert.equal(
  context.incrementRateLimit("contended", 2, 60),
  false,
  "rate-limit updates must fail closed when the lock cannot be acquired",
);
assert.equal(rateLimitValues.has("contended"), false);
assert.equal(rateLimitLockReleases, 3);

console.log("Backend cache recovery checks passed.");
