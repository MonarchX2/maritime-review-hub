const ROOT_FOLDER_ID = "17mLY-shklRGCZWQfq8AbrPkPTRcOUv2z";
const DATABASE_FOLDER_ID = "12bgu_6ljemJOkFBKM_ECzVy47eS2OJvP";
const UUID_SHEET_ID = "18OMUmDf5137YppbynoAbAt65B4R5MLhewjTTlMPJp98";

// Runtime / cache / state limits.
const MAX_RUNTIME_MS = 240000; // 4 minutes (safe buffer below 6-min Apps Script limit).
const CACHE_CHUNK_SIZE = 20000; // Conservative character budget for CacheService.
const CACHE_TTL_SECONDS = 21600; // 6 hours.
const METADATA_CACHE_TTL_MS = 60000;
const SUBJECT_SCHEMA_VERSION = "10";
const BACKEND_PAYLOAD_SCHEMA_VERSION = 2;
const MINIMUM_SUPPORTED_CLIENT_VERSION = "26.10.16-38";
const UUID_SHEET_COLUMN_COUNT = 7;
const BUILDER_LOCK_TIMEOUT_MS = 15000;
const REVIEWER_SESSION_PROPERTY_PREFIX = "MRH_REVIEWER_SESSION_v1_";
const REVIEWER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const REVIEWER_SESSION_LIMIT = 1000;
const REVIEWER_PDF_JOB_PROPERTY_PREFIX = "MRH_REVIEWER_PDF_JOB_v1_";
const REVIEWER_PDF_QUEUE_PROPERTY = "MRH_REVIEWER_PDF_QUEUE_v1";
const REVIEWER_PDF_WORKER_READY_PROPERTY = "MRH_REVIEWER_PDF_WORKER_READY_v1";
const REVIEWER_PDF_WORKER_SCHEDULE_PROPERTY = "MRH_REVIEWER_PDF_WORKER_SCHEDULED_AT";
const REVIEWER_PDF_JOB_TTL_MS = 10 * 60 * 1000;
const REVIEWER_PDF_CLEANUP_RETRY_MS = 60 * 1000;
const REVIEWER_PDF_QUEUE_LIMIT = 3;
const REVIEWER_PDF_WORKER_HANDLER = "processReviewerPdfQueue";
const CACHE_FOLDER_ID_PROPERTY = "MRH_CACHE_FOLDER_ID";
const BUILD_STATE_FILE_NAME = "MRH_BuildState.json";
const FILE_INDEX_FILE_NAME = "MRH_FileIndex.json";
const RESUME_TRIGGER_HANDLER = "resumeBuildDatabaseCache";
const PASSWORD_RATE_LIMIT = 20;
const PASSWORD_RATE_WINDOW_SECONDS = 60;
const PASSWORD_KDF_ITERATIONS = 1500; // Balanced for GAS V8 runtime (~300ms vs ~4000ms at 12000).

var TextUtils = {
  naturalSortStrings: function (left, right) {
    var a = String(left == null ? "" : left)
      .trim()
      .toLowerCase();
    var b = String(right == null ? "" : right)
      .trim()
      .toLowerCase();
    return a.localeCompare(b, undefined, {
      numeric: true,
      sensitivity: "base",
    });
  },
};

var deckMetadataCache = null;
var deckMetadataCacheTime = 0;

/* -------------------------------------------------------------------------- */
/* Generic utilities                                                          */
/* -------------------------------------------------------------------------- */

function scheduledDatabaseSync() {
  try {
    buildDatabaseCache();
  } catch (error) {
    Logger.log("[scheduledDatabaseSync] " + error);
  }
}

function jsonResponse(payload) {
  if (payload === undefined) payload = {};
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function errorResponse(message, code, details) {
  var payload = {
    status: "error",
    code: code || "ERROR",
    message: String(message || "Error"),
  };
  if (details && typeof details === "object") {
    Object.keys(details).forEach(function (key) {
      payload[key] = details[key];
    });
  }
  return jsonResponse(payload);
}

function createBackendCorrelationId_() {
  var correlationId =
    typeof Utilities !== "undefined" &&
    Utilities &&
    typeof Utilities.getUuid === "function"
      ? String(Utilities.getUuid() || "")
      : "";
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      correlationId,
    )
  )
    return correlationId;
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    var r = Math.floor(Math.random() * 16);
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });
}

function logBackendFailure_(handler, requestType, correlationId, error) {
  var safeHandler = /^[A-Za-z0-9_]{1,40}$/.test(String(handler || ""))
    ? String(handler)
    : "unknown";
  var safeRequestType = /^[A-Za-z0-9_]{1,64}$/.test(
    String(requestType || ""),
  )
    ? String(requestType)
    : "unknown";
  var errorName =
    error && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(String(error.name || ""))
      ? String(error.name)
      : "Error";
  var reasonCode =
    error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(String(error.code || ""))
      ? String(error.code)
      : "UNCLASSIFIED";
  Logger.log(
    "[MRH] failure handler=" +
      safeHandler +
      " requestType=" +
      safeRequestType +
      " correlationId=" +
      correlationId +
      " reasonCode=" +
      reasonCode +
      " errorName=" +
      errorName,
  );
}

var RESOURCE_PORTAL_ROOT_FOLDER_ID = "19LoMUsogxTHB5xrI1Gd08NASQv2Zqi6E";
var RESOURCE_DASHBOARD_INDEX_FOLDER_ID =
  "1cP2FBOW-Jryu9eknJgDjUZcxx9qwC22Z";
var RESOURCE_DASHBOARD_INDEX_FILES = {
  MODULES: "modules_combined.json",
  REVIEWERS: "reviewers_combined.json",
  SYLLABUS: "reviewers_combined.json",
};
var RESOURCE_DASHBOARD_CATEGORIES = {
  MODULES: ["PRELIMS", "MIDTERMS", "FINALS"],
  REVIEWERS: ["PRELIMS", "MIDTERMS", "FINALS"],
  SYLLABUS: ["SYLLABUS"],
};
var RESOURCE_PORTAL_PRIVATE_FOLDER_PATTERN =
  /^REVIEWERS v\d{2}\.\d{2}\.\d{2}$/;
var RESOURCE_PORTAL_MAX_ITEMS = 1000;
var RESOURCE_PORTAL_MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
var MRH_REVIEWER_ACL_PRESERVE_PRINCIPALS_PROPERTY =
  "MRH_REVIEWER_ACL_PRESERVE_PRINCIPALS";
var RESOURCE_PORTAL_LISTING_CACHE_TTL_SECONDS = 30;
var RESOURCE_PORTAL_MAX_CACHED_LISTING_CHARS = 90000;
var RESOURCE_PORTAL_MAX_LIST_PAGES = 10;
var MRH_ACCOUNTS_SHEET_NAME = "ACCOUNTS";
var MRH_LEGACY_ACCOUNTS_SHEET_NAME = "Accounts";
var MRH_SIGN_IN_SHEET_NAME = "SIGN-IN";
var MRH_MODULE_LOG_SHEET_NAME = "MODULES";
var MRH_ACCOUNTS_HEADERS = [
  "Email",
  "Last Name",
  "First Name",
  "Middle Initial",
  "Active",
  "Date",
  "Time",
];
var MRH_ACCESS_LOG_HEADERS = [
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
var MRH_SCOPE_HEADERS = ["OAuth Scope", "Purpose", "Configured In"];
var MRH_REQUIRED_OAUTH_SCOPES = [
  [
    "https://www.googleapis.com/auth/drive",
    "Read and update Drive-backed resources and database cache files.",
    "Apps Script manifest",
  ],
  [
    "https://www.googleapis.com/auth/spreadsheets",
    "Read and update account, access-log, and source spreadsheets.",
    "Apps Script manifest",
  ],
  [
    "https://www.googleapis.com/auth/script.external_request",
    "Verify Google Sign-In ID tokens with Google's token-info service.",
    "Apps Script manifest",
  ],
  [
    "https://www.googleapis.com/auth/script.scriptapp",
    "Create and maintain scheduled/resume triggers.",
    "Apps Script manifest",
  ],
  [
    "https://www.googleapis.com/auth/script.storage",
    "Use Apps Script CacheService for temporary cached data.",
    "Apps Script manifest",
  ],
  [
    "https://www.googleapis.com/auth/script.send_mail",
    "Email verified reviewers when their access is granted or denied.",
    "Apps Script manifest",
  ],
];
var MRH_LOG_HEADER_CACHE_TTL_SECONDS = 60;
var MRH_TOKEN_CACHE_MAX_TTL_SECONDS = 300;
var MRH_RESOURCE_DASHBOARD_CACHE_TTL_SECONDS = 30;
var MRH_RESOURCE_DASHBOARD_VERSION_CACHE_TTL_SECONDS = CACHE_TTL_SECONDS;
var MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS = CACHE_TTL_SECONDS;
var MRH_ACCOUNT_CACHE_TTL_SECONDS = 5;
var MRH_ACCOUNT_CACHE_GENERATION_PROPERTY = "MRH_ACCOUNT_CACHE_GENERATION";
var MRH_REVIEWER_STATUS_NOTIFICATION_PENDING_PREFIX =
  "MRH_REVIEWER_STATUS_NOTIFICATION_PENDING_v1_";
var MRH_REVIEWER_STATUS_NOTIFICATION_BATCH_SIZE = 20;
var MRH_SPREADSHEET_TIME_ZONE = "Asia/Manila";
var MRH_LOG_DEDUPE_TTL_SECONDS = 21600;

function getResourceDashboardFileId(linkUrl) {
  var value = String(linkUrl || "").trim();
  if (!/^https:\/\/(?:drive|docs)\.google\.com(?:\/|$)/i.test(value))
    return "";
  var pathMatch = /\/(?:d|folders)\/([^/?#]+)/i.exec(value);
  var queryMatch = /[?&]id=([^&#]+)/i.exec(value);
  var encodedId = pathMatch ? pathMatch[1] : queryMatch ? queryMatch[1] : "";
  if (!encodedId) return "";
  var fileId;
  try {
    fileId = decodeURIComponent(encodedId);
  } catch (error) {
    return "";
  }
  return /^[A-Za-z0-9_-]{10,}$/.test(fileId) ? fileId : "";
}

function getResourceDashboardCombinedIndex(fileName, file) {
  var parsed;
  try {
    parsed = JSON.parse(file.getBlob().getDataAsString());
  } catch (error) {
    var invalidJsonError = new Error(
      "Resource dashboard index is invalid JSON (" +
        fileName +
        "): " +
        error.message,
    );
    invalidJsonError.code = "RESOURCE_INDEX_INVALID_JSON";
    throw invalidJsonError;
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    typeof parsed.b !== "string" ||
    !parsed.d ||
    typeof parsed.d !== "object" ||
    Array.isArray(parsed.d)
  ) {
    var unsupportedFormatError = new Error(
      "Resource dashboard index has an unsupported format: " + fileName,
    );
    unsupportedFormatError.code = "RESOURCE_INDEX_UNSUPPORTED_FORMAT";
    throw unsupportedFormatError;
  }
  return parsed;
}

function getResourceDashboardExportUrl(item, base, fileName) {
  var rawUrl = String(
    Array.isArray(item)
      ? item[1] || ""
      : item && Object.prototype.hasOwnProperty.call(item, "u")
        ? item.u || ""
        : item && item.url
          ? item.url
          : "",
  ).trim();
  var url = /^https:\/\//i.test(rawUrl)
    ? rawUrl
    : /^[A-Za-z0-9_-]{10,}$/.test(rawUrl)
      ? base + encodeURIComponent(rawUrl)
      : "";
  if (!url || !getResourceDashboardFileId(url)) {
    var invalidLinkError = new Error(
      "Resource dashboard index contains an invalid Drive link: " + fileName,
    );
    invalidLinkError.code = "RESOURCE_INDEX_INVALID_LINK";
    throw invalidLinkError;
  }
  return url;
}

function getResourceDashboardExportMimeType(item, fileName, tabName) {
  var type = "";
  if (Array.isArray(item)) {
    if (tabName === "MODULES") {
      type = "1";
    } else {
      var tuplePriority = Number(item[3]);
      type = ({ 4: "pdf", 3: "gdoc", 2: "docx", 1: "doc" })[
        tuplePriority
      ] || "";
    }
  } else {
    type = String(
      item && Object.prototype.hasOwnProperty.call(item, "t")
        ? item.t
        : item && item.type != null
          ? item.type
          : "",
    ).toLowerCase();
  }
  if (type === "1" || type === "folder") {
    return "application/vnd.google-apps.folder";
  }
  if (type === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (type === "gdoc") {
    return "application/vnd.google-apps.document";
  }
  if (type === "pdf" || /\.pdf$/i.test(fileName)) return "application/pdf";
  return "";
}

function buildResourceDashboardTab(tabName, index) {
  var fileName = RESOURCE_DASHBOARD_INDEX_FILES[tabName];
  var categories = RESOURCE_DASHBOARD_CATEGORIES[tabName];
  if (!fileName || !categories) {
    throw new Error("Unknown resource dashboard index: " + tabName);
  }
  var rowsByKey = Object.create(null);
  var years = Object.keys(index.d)
    .filter(function (year) {
      return /^\d+\.\d+$/.test(year);
    })
    .sort(function (left, right) {
      var leftParts = left.split(".").map(Number);
      var rightParts = right.split(".").map(Number);
      return (
        leftParts[0] - rightParts[0] ||
        leftParts[1] - rightParts[1] ||
        left.localeCompare(right)
      );
    });

  years.forEach(function (year) {
    var yearData = index.d[year];
    if (!yearData || typeof yearData !== "object" || Array.isArray(yearData)) {
      throw new Error(
        "Resource dashboard index has invalid term data: " +
          fileName +
          " (" +
          year +
          ")",
      );
    }
    categories.forEach(function (category) {
      var courseMap = yearData[category];
      if (courseMap == null) return;
      if (
        typeof courseMap !== "object" ||
        Array.isArray(courseMap)
      ) {
        throw new Error(
          "Resource dashboard index has invalid category data: " +
            fileName +
            " (" +
            year +
            "/" +
            category +
            ")",
        );
      }
      Object.keys(courseMap).forEach(function (course) {
        var item = courseMap[course];
        if (!item || typeof item !== "object") {
          throw new Error(
            "Resource dashboard index has an invalid resource: " +
              fileName +
              " (" +
              year +
              "/" +
              category +
              "/" +
              course +
              ")",
          );
        }
        var rowKey = year + "\u0000" + course;
        if (!Object.prototype.hasOwnProperty.call(rowsByKey, rowKey)) {
          rowsByKey[rowKey] = {
            year: year,
            course: course,
            resources: Object.create(null),
          };
        }
        var title = String(
          Array.isArray(item) ? item[0] || course : item.n || item.name || course,
        ).trim();
        rowsByKey[rowKey].resources[category] = {
          title: title,
          url: getResourceDashboardExportUrl(item, index.b, fileName),
          mimeType: getResourceDashboardExportMimeType(item, title, tabName),
        };
      });
    });
  });

  var columns = ["Year", "Course"].concat(
    categories.map(function (category) {
      return category === "SYLLABUS" ? "COURSE SYLLABUS" : category;
    }),
  );
  var rows = Object.keys(rowsByKey)
    .map(function (key) {
      return rowsByKey[key];
    })
    .sort(function (left, right) {
      var yearComparison = left.year.localeCompare(right.year, undefined, {
        numeric: true,
      });
      return (
        yearComparison ||
        left.course.localeCompare(right.course, undefined, {
          numeric: true,
          sensitivity: "base",
        })
      );
    });
  var values = [];
  var links = [];
  var linkTitles = [];
  var linkTypes = [];
  rows.forEach(function (row) {
    var rowValues = [row.year, row.course];
    var rowLinks = ["", ""];
    var rowTitles = ["", ""];
    var rowTypes = ["", ""];
    categories.forEach(function (category) {
      var resource = row.resources[category];
      rowValues.push(resource ? resource.title : "");
      rowLinks.push(resource ? resource.url : "");
      rowTitles.push(resource ? resource.title : "");
      rowTypes.push(resource ? resource.mimeType : "");
    });
    values.push(rowValues);
    links.push(rowLinks);
    linkTitles.push(rowTitles);
    linkTypes.push(rowTypes);
  });

  return {
    columns: columns,
    rows: values,
    links: links,
    linkTitles: linkTitles,
    linkTypes: linkTypes,
    truncated: false,
  };
}

function handleGetResourceDashboardRequest(cachedVersion) {
  var dashboardCache = null;
  try {
    dashboardCache = CacheService.getScriptCache();
    var latestDashboard = dashboardCache.get(
      "mrh_resource_dashboard_latest_v1",
    );
    if (latestDashboard) {
      var parsedLatestDashboard = JSON.parse(latestDashboard);
      if (
        parsedLatestDashboard &&
        parsedLatestDashboard.status === "success" &&
        typeof parsedLatestDashboard.version === "string" &&
        parsedLatestDashboard.tabs &&
        parsedLatestDashboard.tabs.MODULES &&
        parsedLatestDashboard.tabs.SYLLABUS
      ) {
        if (
          cachedVersion &&
          String(cachedVersion) === parsedLatestDashboard.version
        )
          return jsonResponse({
            status: "success",
            notModified: true,
            version: parsedLatestDashboard.version,
          });
        return jsonResponse(parsedLatestDashboard);
      }
      dashboardCache.remove("mrh_resource_dashboard_latest_v1");
    }
  } catch (cacheError) {
    Logger.log("[handleGetResourceDashboardRequest] Latest cache read failed.");
  }
  var folder = DriveApp.getFolderById(RESOURCE_DASHBOARD_INDEX_FOLDER_ID);
  var indexFiles = {};
  var indexFileNames = Object.keys(RESOURCE_DASHBOARD_INDEX_FILES)
    .map(function (name) { return RESOURCE_DASHBOARD_INDEX_FILES[name]; })
    .filter(function (fileName, index, names) {
      return names.indexOf(fileName) === index;
    });
  var versionParts = [];
  indexFileNames.forEach(function (fileName) {
    var files = folder.getFilesByName(fileName);
    if (!files.hasNext()) {
      throw new Error("Resource dashboard index is missing: " + fileName);
    }
    var file = files.next();
    indexFiles[fileName] = file;
    versionParts.push(
      fileName +
        ":" +
        String(file.getId()) +
        ":" +
        String(file.getLastUpdated().getTime()),
    );
  });
  versionParts.push("reviewers-locked-v1");
  var version = versionParts.join("|");
  if (cachedVersion && String(cachedVersion) === version) {
    return jsonResponse({
      status: "success",
      notModified: true,
      version: version,
    });
  }

  var dashboardCacheKey =
    "mrh_resource_dashboard_v1_" + sha256Hex(version);
  try {
    if (!dashboardCache) dashboardCache = CacheService.getScriptCache();
    var cachedDashboard = dashboardCache.get(dashboardCacheKey);
    if (cachedDashboard) {
      var parsedDashboard = JSON.parse(cachedDashboard);
      if (
        parsedDashboard &&
        parsedDashboard.status === "success" &&
        parsedDashboard.version === version &&
        parsedDashboard.tabs &&
        parsedDashboard.tabs.MODULES &&
        parsedDashboard.tabs.SYLLABUS
      )
        return jsonResponse(parsedDashboard);
      dashboardCache.remove(dashboardCacheKey);
    }
  } catch (cacheError) {
    Logger.log("[handleGetResourceDashboardRequest] Dashboard cache read failed.");
  }

  var tabs = {};
  var parsedIndexes = {};
  indexFileNames.forEach(function (fileName) {
    parsedIndexes[fileName] = getResourceDashboardCombinedIndex(
      fileName,
      indexFiles[fileName],
    );
  });
  ["MODULES", "SYLLABUS"].forEach(function (name) {
    var fileName = RESOURCE_DASHBOARD_INDEX_FILES[name];
    var index = parsedIndexes[fileName];
    tabs[name] = buildResourceDashboardTab(name, index);
  });
  tabs.REVIEWERS = {
    columns: [],
    rows: [],
    links: [],
    linkTitles: [],
    linkTypes: [],
    truncated: false,
  };

  var dashboardResponse = {
    status: "success",
    version: version,
    tabs: tabs,
  };
  var dashboardJson = JSON.stringify(dashboardResponse);
  if (dashboardJson.length <= 90000) {
    try {
      if (!dashboardCache) dashboardCache = CacheService.getScriptCache();
      dashboardCache.put(
        dashboardCacheKey,
        dashboardJson,
        MRH_RESOURCE_DASHBOARD_VERSION_CACHE_TTL_SECONDS,
      );
      dashboardCache.put(
        "mrh_resource_dashboard_latest_v1",
        dashboardJson,
        MRH_RESOURCE_DASHBOARD_CACHE_TTL_SECONDS,
      );
    } catch (cacheError) {
      Logger.log("[handleGetResourceDashboardRequest] Dashboard cache write failed.");
    }
  }
  return ContentService.createTextOutput(dashboardJson).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function getReviewerAuthorizationConfig_() {
  var properties = getScriptProps();
  var clientId = String(
    properties.getProperty("MRH_GOOGLE_OAUTH_CLIENT_ID") || "",
  ).trim();
  var spreadsheetId = String(
    properties.getProperty("MRH_ACCOUNTS_SPREADSHEET_ID") || "",
  ).trim();
  var validClientId =
    clientId.length <= 256 &&
    /^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId);
  var validSpreadsheetId = /^[A-Za-z0-9_-]{20,100}$/.test(spreadsheetId);
  return {
    clientId: validClientId ? clientId : "",
    spreadsheetId: validSpreadsheetId ? spreadsheetId : "",
    enabled: validClientId && validSpreadsheetId,
  };
}

function handleGetReviewerAuthorizationConfigRequest() {
  var config = getReviewerAuthorizationConfig_();
  return jsonResponse({
    status: "success",
    enabled: config.enabled,
    clientId: config.clientId,
  });
}

function authorizeMRHReviewerStatusEmails() {
  return MailApp.getRemainingDailyQuota();
}

function initializeMRHAccountsSpreadsheet() {
  var config = getReviewerAuthorizationConfig_();
  if (!config.spreadsheetId)
    throw new Error(
      "Set MRH_ACCOUNTS_SPREADSHEET_ID in Script Properties before setup.",
    );
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  var accounts = spreadsheet.getSheetByName(MRH_ACCOUNTS_SHEET_NAME);
  var legacyAccounts = spreadsheet.getSheetByName(
    MRH_LEGACY_ACCOUNTS_SHEET_NAME,
  );
  var accountSources = [];
  if (accounts)
    accountSources.push({
      name: MRH_ACCOUNTS_SHEET_NAME,
      rows: readMRHWorksheetRows_(
        accounts,
        MRH_ACCOUNTS_HEADERS,
        MRH_ACCOUNTS_SHEET_NAME,
      ),
    });
  if (legacyAccounts)
    accountSources.push({
      name: MRH_LEGACY_ACCOUNTS_SHEET_NAME,
      rows: readMRHWorksheetRows_(
        legacyAccounts,
        MRH_ACCOUNTS_HEADERS,
        MRH_LEGACY_ACCOUNTS_SHEET_NAME,
      ),
    });
  mergeMRHAccountRows_(accountSources);

  var legacyModuleLogSheet = spreadsheet.getSheetByName("MODULE");
  var moduleLogSheet = spreadsheet.getSheetByName(MRH_MODULE_LOG_SHEET_NAME);
  if (legacyModuleLogSheet && moduleLogSheet)
    throw new Error(
      "Both MODULE and MODULES access-log worksheets exist. Merge their rows before setup.",
    );
  if (legacyModuleLogSheet) {
    legacyModuleLogSheet.setName(MRH_MODULE_LOG_SHEET_NAME);
    moduleLogSheet = legacyModuleLogSheet;
  }

  ["SYLLABUS", MRH_MODULE_LOG_SHEET_NAME, "REVIEWERS", MRH_SIGN_IN_SHEET_NAME].forEach(
    function (sheetName) {
      validateMRHAccessLogSheet_(
        spreadsheet.getSheetByName(sheetName),
        sheetName,
      );
    },
  );
  validateMRHScopesWorksheet_(spreadsheet.getSheetByName("SCOPES"));

  ["SYLLABUS", MRH_MODULE_LOG_SHEET_NAME, "REVIEWERS"].forEach(function (sheetName) {
    var sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
    normalizeMRHAccessLogSheet_(sheet, sheetName);
  });
  var signInSheet = spreadsheet.getSheetByName(MRH_SIGN_IN_SHEET_NAME);
  if (!signInSheet)
    signInSheet = spreadsheet.insertSheet(MRH_SIGN_IN_SHEET_NAME);
  normalizeMRHAccessLogSheet_(signInSheet, MRH_SIGN_IN_SHEET_NAME);
  migrateMRHSignInLogs_(spreadsheet, signInSheet);
  if (!accounts)
    accounts = spreadsheet.insertSheet(MRH_ACCOUNTS_SHEET_NAME);
  migrateMRHAccountSheets_(spreadsheet, accounts, legacyAccounts);
  if (typeof spreadsheet.setSpreadsheetTimeZone === "function")
    spreadsheet.setSpreadsheetTimeZone(MRH_SPREADSHEET_TIME_ZONE);
  [MRH_SIGN_IN_SHEET_NAME, "SYLLABUS", MRH_MODULE_LOG_SHEET_NAME, "REVIEWERS"].forEach(
    function (sheetName) {
      var sheet = spreadsheet.getSheetByName(sheetName);
      if (sheet && sheet.getLastRow() > 1) {
        sheet
          .getRange(2, 1, sheet.getLastRow() - 1, 1)
          .setNumberFormat("yyyy-mm-dd");
        sheet
          .getRange(2, 2, sheet.getLastRow() - 1, 1)
          .setNumberFormat("hh:mm:ss");
      }
    },
  );
  ensureMRHScopesWorksheet_(spreadsheet);
  try {
    var cache = CacheService.getScriptCache();
    cache.remove("mrh_accounts_v2_" + sha256Hex(spreadsheet.getId()));
    cache.remove("mrh_accounts_v3_" + sha256Hex(spreadsheet.getId()));
  } catch (cacheError) {
    Logger.log("[initializeMRHAccountsSpreadsheet] Account cache invalidation failed.");
  }
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
  };
}

function readMRHWorksheetRows_(sheet, expectedHeaders, sheetName) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  var lastColumn =
    typeof sheet.getLastColumn === "function"
      ? Math.max(sheet.getLastColumn(), expectedHeaders.length)
      : expectedHeaders.length;
  var values = sheet.getRange(1, 1, lastRow, lastColumn).getDisplayValues();
  var headers = values[0].map(function (header) {
    return String(header || "").trim();
  });
  var indexes = {};
  expectedHeaders.forEach(function (header) {
    indexes[header] = headers.indexOf(header);
  });
  var legacyDeviceColumn =
    headers[0] === "Email" &&
    headers[2] === "Last Name" &&
    headers[3] === "First Name" &&
    headers[4] === "Middle Initial" &&
    headers[5] === "Active";
  if (legacyDeviceColumn)
    return values.slice(1).map(function (row) {
      return [row[0], row[2], row[3], row[4], row[5], "", ""];
    });
  if (
    indexes.Email < 0 ||
    indexes["Last Name"] < 0 ||
    indexes["First Name"] < 0 ||
    indexes.Active < 0
  )
    throw new Error(
      "The " + sheetName + " worksheet is missing required account columns.",
    );
  return values.slice(1).map(function (row) {
    return [
      row[indexes.Email],
      row[indexes["Last Name"]],
      row[indexes["First Name"]],
      indexes["Middle Initial"] < 0 ? "" : row[indexes["Middle Initial"]],
      row[indexes.Active],
      indexes.Date < 0 ? "" : row[indexes.Date],
      indexes.Time < 0 ? "" : row[indexes.Time],
    ];
  });
}

function normalizeMRHAccountStatus_(value, sheetName, rowNumber) {
  var status = String(value || "").trim().toUpperCase();
  if (["TRUE", "YES", "1"].indexOf(status) !== -1) return "TRUE";
  if (["FALSE", "NO", "0", ""].indexOf(status) !== -1) return "FALSE";
  if (status === "DENIED") return "DENIED";
  throw new Error(
    "Invalid Active status in " + sheetName + " row " + rowNumber +
      ". Use FALSE, TRUE, or DENIED.",
  );
}

function normalizeMRHLogTimestamp_(value) {
  var timestamp = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:?\d{2})$/i.test(timestamp))
    return timestamp;
  var date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return timestamp;
  return Utilities.formatDate(
    date,
    MRH_SPREADSHEET_TIME_ZONE,
    "yyyy-MM-dd HH:mm:ss",
  );
}

function mergeMRHAccountRows_(sources) {
  var byEmail = Object.create(null);
  sources.forEach(function (source) {
    source.rows.forEach(function (row, index) {
      if (row.every(function (value) {
        return String(value || "").trim() === "";
      }))
        return;
      var email = String(row[0] || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        throw new Error(
          "Invalid or missing email in " + source.name + " row " + (index + 2) +
            ". Resolve the row before rerunning setup.",
        );
      var normalized = [
        email,
        cleanText(row[1], 100),
        cleanText(row[2], 100),
        cleanText(row[3], 10),
        normalizeMRHAccountStatus_(row[4], source.name, index + 2),
        cleanText(row[5], 40),
        cleanText(row[6], 40),
      ];
      var existing = byEmail[email];
      if (!existing) {
        byEmail[email] = normalized;
        return;
      }
      if (existing[4] !== normalized[4])
        throw new Error(
          "Duplicate account rows for " + email +
            " have conflicting Active statuses. Resolve them before setup; no rows were changed.",
        );
      if (
        existing[1] !== normalized[1] ||
        existing[2] !== normalized[2] ||
        existing[3] !== normalized[3]
      )
        throw new Error(
          "Duplicate account rows for " + email +
            " have conflicting names. Resolve them before setup; no rows were changed.",
        );
      if (!existing[5] && normalized[5]) existing[5] = normalized[5];
      if (!existing[6] && normalized[6]) existing[6] = normalized[6];
    });
  });
  return Object.keys(byEmail)
    .sort()
    .map(function (email) {
      return byEmail[email];
    });
}

function rewriteMRHWorksheet_(sheet, headers, rows) {
  var lastRow = sheet.getLastRow();
  var lastColumn =
    typeof sheet.getLastColumn === "function"
      ? Math.max(sheet.getLastColumn(), headers.length)
      : headers.length;
  if (lastRow > 0)
    sheet.getRange(1, 1, lastRow, lastColumn).clearContent();
  sheet
    .getRange(1, 1, rows.length + 1, headers.length)
    .setValues([headers].concat(rows));
}

function migrateMRHAccountSheets_(spreadsheet, accountsSheet, legacySheet) {
  var sources = [];
  if (accountsSheet)
    sources.push({
      name: MRH_ACCOUNTS_SHEET_NAME,
      rows: readMRHWorksheetRows_(
        accountsSheet,
        MRH_ACCOUNTS_HEADERS,
        MRH_ACCOUNTS_SHEET_NAME,
      ),
    });
  if (legacySheet)
    sources.push({
      name: MRH_LEGACY_ACCOUNTS_SHEET_NAME,
      rows: readMRHWorksheetRows_(
        legacySheet,
        MRH_ACCOUNTS_HEADERS,
        MRH_LEGACY_ACCOUNTS_SHEET_NAME,
      ),
    });
  var mergedRows = mergeMRHAccountRows_(sources);
  rewriteMRHWorksheet_(accountsSheet, MRH_ACCOUNTS_HEADERS, mergedRows);
  if (legacySheet) spreadsheet.deleteSheet(legacySheet);
}

function findFirstEmptyMRHAccountRow_(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 2;
  var rows = sheet
    .getRange(2, 1, lastRow - 1, MRH_ACCOUNTS_HEADERS.length)
    .getDisplayValues();
  for (var index = 0; index < rows.length; index++) {
    if (
      rows[index].every(function (value) {
        return String(value || "").trim() === "";
      })
    )
      return index + 2;
  }
  return lastRow + 1;
}

function normalizeMRHAccessLogSheet_(sheet, sheetName) {
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, MRH_ACCESS_LOG_HEADERS.length)
      .setValues([MRH_ACCESS_LOG_HEADERS]);
    return;
  }
  var lastColumn =
    typeof sheet.getLastColumn === "function"
      ? Math.max(sheet.getLastColumn(), MRH_ACCESS_LOG_HEADERS.length)
      : MRH_ACCESS_LOG_HEADERS.length;
  var values = sheet
    .getRange(1, 1, sheet.getLastRow(), lastColumn)
    .getDisplayValues();
  var headers = values[0].map(function (header) {
    return String(header || "").trim();
  });
  var required = ["Email", "Last Name", "First Name", "Event"];
  var indexes = {};
  required.forEach(function (header) {
    indexes[header] = headers.indexOf(header);
  });
  indexes["Middle Initial"] = headers.indexOf("Middle Initial");
  indexes.Date = headers.indexOf("Date");
  indexes.Time = headers.indexOf("Time");
  indexes.Timestamp = headers.indexOf("Timestamp");
  ["Course", "Year", "Semester", "Category", "Resource"].forEach(
    function (header) {
      indexes[header] = headers.indexOf(header);
    },
  );
  var legacyDeviceColumn =
    headers[0] === "Timestamp" &&
    headers[1] === "Email" &&
    headers[3] === "Last Name" &&
    headers[4] === "First Name" &&
    headers[5] === "Middle Initial" &&
    headers[6] === "Event";
  if (legacyDeviceColumn) {
    indexes.Timestamp = 0;
    indexes.Email = 1;
    indexes["Last Name"] = 3;
    indexes["First Name"] = 4;
    indexes["Middle Initial"] = 5;
    indexes.Event = 6;
  }
  if (required.some(function (header) { return indexes[header] < 0; }) ||
    (indexes.Timestamp < 0 &&
      (indexes.Date < 0 || indexes.Time < 0)))
    throw new Error(
      "The " + sheetName + " worksheet has unexpected access-log headers.",
    );
  var rows = values.slice(1).map(function (row) {
    var date = indexes.Timestamp >= 0
      ? normalizeMRHLogTimestamp_(row[indexes.Timestamp])
      : String(row[indexes.Date] || "").trim();
    var time = indexes.Timestamp >= 0
      ? ""
      : String(row[indexes.Time] || "").trim();
    if (indexes.Timestamp >= 0) {
      var timestampParts = date.match(
        /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/,
      );
      if (timestampParts) {
        date = timestampParts[1];
        time = timestampParts[2];
      }
    }
    var event = String(row[indexes.Event] || "").trim();
    var course = indexes.Course < 0 ? "" : row[indexes.Course];
    var year = indexes.Year < 0 ? "" : row[indexes.Year];
    var semester = indexes.Semester < 0 ? "" : row[indexes.Semester];
    var category = indexes.Category < 0 ? "" : row[indexes.Category];
    var resource = indexes.Resource < 0 ? "" : row[indexes.Resource];
    var legacyFileClick = /^FILE_CLICK:/i.exec(event);
    if (legacyFileClick) {
      var fileClickParts = event.split(":");
      event = "FILE_CLICK";
      category = category || fileClickParts[1] || "";
      resource = resource || fileClickParts.slice(2, -1).join(":");
    } else if (/^ACTION:/i.test(event)) {
      var actionParts = event.split(":");
      event = actionParts[1] || "ACTION";
      var actionDetail = actionParts.slice(2).join(":");
      if (event === "FILTER_YEAR") year = year || actionDetail;
      if (event === "FILTER_SEMESTER")
        semester = semester || actionDetail;
      if (event === "FILTER_CATEGORY")
        category = category || actionDetail;
    }
    var term = normalizeMRHLogTerm_(year, semester);
    return [
      date,
      time,
      row[indexes.Email],
      row[indexes["Last Name"]],
      row[indexes["First Name"]],
      indexes["Middle Initial"] < 0 ? "" : row[indexes["Middle Initial"]],
      event,
      course,
      term.year,
      term.semester,
      category,
      resource,
    ];
  });
  var seen = Object.create(null);
  rows = rows.filter(function (row) {
    var key = JSON.stringify(row);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
  rewriteMRHWorksheet_(sheet, MRH_ACCESS_LOG_HEADERS, rows);
}

function ensureMRHAccessLogSheet_(spreadsheet, sheetName) {
  if (sheetName === MRH_MODULE_LOG_SHEET_NAME) {
    var legacyModuleSheet = spreadsheet.getSheetByName("MODULE");
    var modulesSheet = spreadsheet.getSheetByName(MRH_MODULE_LOG_SHEET_NAME);
    if (legacyModuleSheet && modulesSheet)
      throw new Error(
        "Both MODULE and MODULES access-log worksheets exist. Merge their rows before setup.",
      );
    if (legacyModuleSheet) legacyModuleSheet.setName(MRH_MODULE_LOG_SHEET_NAME);
  }
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) sheet = spreadsheet.insertSheet(sheetName);
  normalizeMRHAccessLogSheet_(sheet, sheetName);
  if (sheetName === MRH_SIGN_IN_SHEET_NAME) {
    ensureMRHAccessLogSheet_(spreadsheet, "REVIEWERS");
    migrateMRHSignInLogs_(spreadsheet, sheet);
  }
  return sheet;
}

function validateMRHAccessLogSheet_(sheet, sheetName) {
  if (!sheet || sheet.getLastRow() === 0) return;
  var lastColumn =
    typeof sheet.getLastColumn === "function"
      ? Math.max(sheet.getLastColumn(), MRH_ACCESS_LOG_HEADERS.length)
      : MRH_ACCESS_LOG_HEADERS.length;
  var headers = sheet
    .getRange(1, 1, 1, lastColumn)
    .getDisplayValues()[0]
    .map(function (header) {
      return String(header || "").trim();
    });
  var hasLegacyDeviceColumn =
    headers[0] === "Timestamp" &&
    headers[1] === "Email" &&
    headers[3] === "Last Name" &&
    headers[4] === "First Name" &&
    headers[5] === "Middle Initial" &&
    headers[6] === "Event";
  var required = ["Email", "Last Name", "First Name", "Event"];
  var hasDateAndTime =
    headers.indexOf("Date") >= 0 && headers.indexOf("Time") >= 0;
  var hasTimestamp = headers.indexOf("Timestamp") >= 0;
  if (
    required.some(function (header) {
      return headers.indexOf(header) < 0;
    }) ||
    (!hasLegacyDeviceColumn && !hasDateAndTime && !hasTimestamp)
  )
    throw new Error(
      "The " + sheetName + " worksheet has unexpected access-log headers.",
    );
}

function migrateMRHSignInLogs_(spreadsheet, signInSheet) {
  var reviewersSheet = spreadsheet.getSheetByName("REVIEWERS");
  if (!reviewersSheet || reviewersSheet.getLastRow() < 2) return;
  getMRHAccountHeaders_(
    reviewersSheet,
    MRH_ACCESS_LOG_HEADERS,
    "REVIEWERS",
  );

  var signInLastRow = signInSheet.getLastRow();
  var existingRows =
    signInLastRow < 2
      ? []
      : signInSheet
          .getRange(
            2,
            1,
            signInLastRow - 1,
            MRH_ACCESS_LOG_HEADERS.length,
          )
          .getDisplayValues();
  var existingCounts = {};
  existingRows.forEach(function (row) {
    var signature = JSON.stringify(row);
    existingCounts[signature] = (existingCounts[signature] || 0) + 1;
  });

  var reviewerLastRow = reviewersSheet.getLastRow();
  var reviewerRows = reviewersSheet
    .getRange(
      2,
      1,
      reviewerLastRow - 1,
      MRH_ACCESS_LOG_HEADERS.length,
    )
    .getDisplayValues();
  var rowsToMigrate = [];
  var rowsToDelete = [];
  reviewerRows.forEach(function (row, index) {
    if (String(row[6] || "").trim().toUpperCase().indexOf("SIGN_IN") !== 0)
      return;
    var sheetRow = index + 2;
    rowsToDelete.push(sheetRow);
    var signature = JSON.stringify(row);
    if (existingCounts[signature]) {
      existingCounts[signature]--;
    } else {
      rowsToMigrate.push(row);
      existingCounts[signature] = 0;
    }
  });

  if (rowsToMigrate.length) {
    var result = Sheets.Spreadsheets.Values.append(
      { values: rowsToMigrate },
      spreadsheet.getId(),
      MRH_SIGN_IN_SHEET_NAME + "!A:G",
      { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" },
    );
    if (
      !result ||
      !result.updates ||
      Number(result.updates.updatedRows) !== rowsToMigrate.length
    )
      throw new Error(
        "Historical sign-in logs could not be copied to the SIGN-IN worksheet.",
      );
  }

  var ranges = [];
  rowsToDelete.forEach(function (rowNumber) {
    var lastRange = ranges[ranges.length - 1];
    if (lastRange && lastRange.end + 1 === rowNumber) {
      lastRange.end = rowNumber;
    } else {
      ranges.push({ start: rowNumber, end: rowNumber });
    }
  });
  ranges.reverse().forEach(function (range) {
    reviewersSheet.deleteRows(range.start, range.end - range.start + 1);
  });
}

function validateMRHScopesWorksheet_(scopesSheet) {
  if (!scopesSheet || scopesSheet.getLastRow() === 0) return;
  var scopeHeaders = scopesSheet
    .getRange(1, 1, 1, MRH_SCOPE_HEADERS.length)
    .getDisplayValues()[0];
  if (
    MRH_SCOPE_HEADERS.some(function (header, index) {
      return String(scopeHeaders[index] || "").trim() !== header;
    })
  )
    throw new Error("The SCOPES worksheet has unexpected headers.");
}

function ensureMRHScopesWorksheet_(spreadsheet) {
  var scopesSheet = spreadsheet.getSheetByName("SCOPES");
  if (!scopesSheet) scopesSheet = spreadsheet.insertSheet("SCOPES");
  if (scopesSheet.getLastRow() === 0) {
    scopesSheet
      .getRange(
        1,
        1,
        MRH_REQUIRED_OAUTH_SCOPES.length + 1,
        MRH_SCOPE_HEADERS.length,
      )
      .setValues([MRH_SCOPE_HEADERS].concat(MRH_REQUIRED_OAUTH_SCOPES));
  } else {
    var scopeHeaders = scopesSheet
      .getRange(1, 1, 1, MRH_SCOPE_HEADERS.length)
      .getDisplayValues()[0];
    if (
      MRH_SCOPE_HEADERS.some(function (header, index) {
        return String(scopeHeaders[index] || "").trim() !== header;
      })
    )
      throw new Error("The SCOPES worksheet has unexpected headers.");
    var scopeRows = scopesSheet
      .getRange(
        2,
        1,
        MRH_REQUIRED_OAUTH_SCOPES.length,
        MRH_SCOPE_HEADERS.length,
      )
      .getDisplayValues();
    var scopesOutOfDate = MRH_REQUIRED_OAUTH_SCOPES.some(function (
      expectedRow,
      rowIndex,
    ) {
      return expectedRow.some(function (value, columnIndex) {
        return String(scopeRows[rowIndex][columnIndex] || "") !== value;
      });
    });
    if (scopesOutOfDate)
      scopesSheet
        .getRange(
          2,
          1,
          MRH_REQUIRED_OAUTH_SCOPES.length,
          MRH_SCOPE_HEADERS.length,
        )
        .setValues(MRH_REQUIRED_OAUTH_SCOPES);
  }
}

function getMRHAccountHeaders_(sheet, expectedHeaders, name) {
  if (!sheet)
    throw new Error(
      "The MRH_Accounts spreadsheet is missing its " + name + " worksheet.",
    );
  if (sheet.getLastRow() === 0)
    throw new Error(
      "Run initializeMRHAccountsSpreadsheet before authorizing accounts.",
    );
  if (name === MRH_ACCOUNTS_SHEET_NAME)
    ensureMRHAccountCreationColumns_(sheet);
  var headers = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getDisplayValues()[0];
  if (
    expectedHeaders.some(function (header, index) {
      return String(headers[index] || "").trim() !== header;
    })
  )
    throw new Error(
      "The " +
        name +
        " worksheet has unexpected headers. Run setup again or restore its headers.",
    );
  return headers;
}

function ensureMRHAccountCreationColumns_(sheet) {
  var expectedBaseHeaders = MRH_ACCOUNTS_HEADERS.slice(0, 5);
  var currentHeaders = sheet
    .getRange(1, 1, 1, expectedBaseHeaders.length)
    .getDisplayValues()[0]
    .map(function (header) {
      return String(header || "").trim();
    });
  if (
    currentHeaders.some(function (header, index) {
      return header !== expectedBaseHeaders[index];
    })
  )
    return;
  var headers = sheet
    .getRange(1, 1, 1, MRH_ACCOUNTS_HEADERS.length)
    .getDisplayValues()[0]
    .map(function (header) {
      return String(header || "").trim();
    });
  if (
    headers[5] === MRH_ACCOUNTS_HEADERS[5] &&
    headers[6] === MRH_ACCOUNTS_HEADERS[6]
  )
    return;
  if (headers[5] || headers[6])
    throw new Error(
      "The ACCOUNTS worksheet has unexpected columns after Active. Resolve them before adding account creation dates.",
    );
  sheet
    .getRange(1, 6, 1, 2)
    .setValues([[MRH_ACCOUNTS_HEADERS[5], MRH_ACCOUNTS_HEADERS[6]]]);
}

function findMRHAccount_(email, bypassCache) {
  var normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return null;
  var config = getReviewerAuthorizationConfig_();
  if (!config.enabled)
    throw new Error("Reviewer account authorization is not configured.");
  var cacheKey =
    "mrh_account_v2_" +
    getMRHAccountCacheGeneration_() +
    "_" +
    sha256Hex(config.spreadsheetId + ":" + normalizedEmail);
  var cache = null;
  if (!bypassCache) {
    try {
      cache = CacheService.getScriptCache();
      var cachedAccount = cache.get(cacheKey);
      if (cachedAccount) {
        var parsedAccount = JSON.parse(cachedAccount);
        if (parsedAccount && parsedAccount.notFound === true) return null;
        if (
          parsedAccount &&
          parsedAccount.email === normalizedEmail &&
          ["TRUE", "FALSE", "DENIED"].indexOf(parsedAccount.accountStatus) >= 0
        )
          return parsedAccount;
        cache.remove(cacheKey);
      }
    } catch (cacheError) {
      Logger.log("[findMRHAccount_] Account cache read failed.");
    }
  }
  var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
  var sheet = spreadsheet.getSheetByName(MRH_ACCOUNTS_SHEET_NAME);
  getMRHAccountHeaders_(sheet, MRH_ACCOUNTS_HEADERS, MRH_ACCOUNTS_SHEET_NAME);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    cacheMRHAccountResult_(cache, cacheKey, null);
    return null;
  }
  var matches = sheet
    .getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(normalizedEmail)
    .matchCase(false)
    .matchEntireCell(true)
    .findAll();
  if (matches.length > 1)
    throw new Error(
      "Duplicate account rows exist for " +
        normalizedEmail +
        ". Resolve them in ACCOUNTS.",
    );
  if (matches.length === 0) {
    cacheMRHAccountResult_(cache, cacheKey, null);
    return null;
  }
  var rowNumber = matches[0].getRow();
  var row = sheet
    .getRange(rowNumber, 1, 1, MRH_ACCOUNTS_HEADERS.length)
    .getDisplayValues()[0];
  var accountEmail = String(row[0] || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail))
    throw new Error(
      "Invalid account email in ACCOUNTS row " + rowNumber + ".",
    );
  var account = {
    email: accountEmail,
    lastName: cleanText(row[1], 100),
    firstName: cleanText(row[2], 100),
    middleInitial: cleanText(row[3], 10),
    rawAccountStatus: String(row[4] || "").trim(),
    rowNumber: rowNumber,
    date: cleanText(row[5], 40),
    time: cleanText(row[6], 40),
    accountStatus: normalizeMRHAccountStatus_(
      row[4],
      MRH_ACCOUNTS_SHEET_NAME,
      rowNumber,
    ),
  };
  cacheMRHAccountResult_(cache, cacheKey, account);
  return account;
}

function cacheMRHAccountResult_(cache, cacheKey, account) {
  try {
    if (!cache) cache = CacheService.getScriptCache();
    cache.put(
      cacheKey,
      JSON.stringify(account || { notFound: true }),
      MRH_ACCOUNT_CACHE_TTL_SECONDS,
    );
  } catch (cacheError) {
    Logger.log("[findMRHAccount_] Account cache write failed.");
  }
}

function invalidateMRHAccountCache_(spreadsheetId, email) {
  try {
    CacheService.getScriptCache().remove(
      "mrh_account_v2_" +
        getMRHAccountCacheGeneration_() +
        "_" +
        sha256Hex(
          String(spreadsheetId || "") +
            ":" +
            String(email || "").trim().toLowerCase(),
        ),
    );
  } catch (cacheError) {
    Logger.log("[invalidateMRHAccountCache_] Account cache invalidation failed.");
  }
}

function getMRHAccountCacheGeneration_() {
  return String(
    getScriptProps().getProperty(MRH_ACCOUNT_CACHE_GENERATION_PROPERTY) || "0",
  );
}

function invalidateMRHAccountCacheAll_() {
  getScriptProps().setProperty(
    MRH_ACCOUNT_CACHE_GENERATION_PROPERTY,
    Utilities.getUuid(),
  );
}

function mrhAccountsEdited(event) {
  if (!event || !event.source || !event.range) return;
  var config = getReviewerAuthorizationConfig_();
  if (
    !config.enabled ||
    String(event.source.getId()) !== String(config.spreadsheetId)
  )
    return;
  var sheet = event.range.getSheet();
  if (
    !sheet ||
    sheet.getName() !== MRH_ACCOUNTS_SHEET_NAME ||
    event.range.getLastRow() < 2 ||
    event.range.getColumn() > MRH_ACCOUNTS_HEADERS.length ||
    event.range.getLastColumn() < 1
  )
    return;
  invalidateMRHAccountCacheAll_();
}

function getMRHLocalDateTime_() {
  var now = new Date();
  return [
    Utilities.formatDate(now, MRH_SPREADSHEET_TIME_ZONE, "yyyy-MM-dd"),
    Utilities.formatDate(now, MRH_SPREADSHEET_TIME_ZONE, "HH:mm:ss"),
  ];
}

function normalizeMRHLogTerm_(year, semester) {
  var normalizedYear = cleanText(year, 40);
  var normalizedSemester = cleanText(semester, 40);
  var combinedTerm = /^(\d+)\s*[./-]\s*(\d+)$/.exec(normalizedYear);
  if (combinedTerm) {
    normalizedYear = combinedTerm[1];
    if (!normalizedSemester) normalizedSemester = combinedTerm[2];
  }
  return { year: normalizedYear, semester: normalizedSemester };
}

function appendMRHAccessLog_(area, account, eventId, eventType, lockAlreadyHeld) {
  if (area !== "SYLLABUS" && area !== MRH_MODULE_LOG_SHEET_NAME && area !== "REVIEWERS")
    throw new Error("Invalid dashboard access-log category.");
  var logSheetName =
    typeof eventType === "string" && eventType.indexOf("SIGN_IN") === 0
    ? MRH_SIGN_IN_SHEET_NAME
    : area;
  var config = getReviewerAuthorizationConfig_();
  if (!config.enabled)
    throw new Error("Reviewer account authorization is not configured.");
  var dedupeKey = "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(eventId || ""))) {
    dedupeKey = "mrh_logged_event_v1_" + sha256Hex(config.spreadsheetId + ":" + eventId.toLowerCase());
    try {
      if (CacheService.getScriptCache().get(dedupeKey)) return false;
    } catch (cacheError) {
      Logger.log("[appendMRHAccessLog_] Event deduplication cache read failed.");
    }
  }
  var lock = lockAlreadyHeld ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(10000))
    throw new Error("Access logging is busy. Please try again.");
  try {
    var cache = null;
    if (dedupeKey) {
      try {
        cache = CacheService.getScriptCache();
        if (cache.get(dedupeKey)) return false;
      } catch (cacheError) {
        Logger.log("[appendMRHAccessLog_] Event deduplication cache read failed.");
      }
    }
    var headerCacheKey =
      "mrh_log_headers_v4_" +
      sha256Hex(config.spreadsheetId + ":" + logSheetName);
    var headersValidated = false;
    try {
      if (!cache) cache = CacheService.getScriptCache();
      headersValidated = cache.get(headerCacheKey) === "valid";
    } catch (cacheError) {
      Logger.log("[appendMRHAccessLog_] Log-header cache read failed.");
    }
    if (!headersValidated) {
      var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
      var sheet = ensureMRHAccessLogSheet_(spreadsheet, logSheetName);
      getMRHAccountHeaders_(sheet, MRH_ACCESS_LOG_HEADERS, logSheetName);
      try {
        if (!cache) cache = CacheService.getScriptCache();
        cache.put(headerCacheKey, "valid", MRH_LOG_HEADER_CACHE_TTL_SECONDS);
      } catch (cacheError) {
        Logger.log("[appendMRHAccessLog_] Log-header cache write failed.");
      }
    }
    var eventRecord =
      eventType && typeof eventType === "object" ? eventType : {};
    var eventName =
      typeof eventType === "string"
        ? eventType
        : String(eventRecord.event || "ACTION");
    var term = normalizeMRHLogTerm_(
      eventRecord.year,
      eventRecord.semester,
    );
    var row = getMRHLocalDateTime_().concat([
      account ? account.email : "",
      account ? account.lastName : "",
      account ? account.firstName : "",
      account ? account.middleInitial : "",
      cleanText(eventName, 80),
      cleanText(eventRecord.course, 160),
      term.year,
      term.semester,
      cleanText(eventRecord.category, 40),
      cleanText(eventRecord.resource, 200),
    ]);
    var result = Sheets.Spreadsheets.Values.append(
      { values: [row] },
      config.spreadsheetId,
      logSheetName + "!A:L",
      { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" },
    );
    if (!result || !result.updates || Number(result.updates.updatedRows) !== 1)
      throw new Error("The dashboard access event could not be recorded.");
    if (dedupeKey && cache) {
      try {
        cache.put(dedupeKey, "logged", MRH_LOG_DEDUPE_TTL_SECONDS);
      } catch (cacheError) {
        Logger.log("[appendMRHAccessLog_] Event deduplication marker could not be saved.");
      }
    }
    return true;
  } finally {
    if (lock) lock.releaseLock();
  }
}

function verifyReviewerIdentityToken_(idToken, expectedClientId) {
  var token = String(idToken || "").trim();
  if (!token || token.length > 8192)
    return { valid: false, code: "UNAUTHORIZED" };

  var tokenCacheKey = "mrh_google_token_v1_" + sha256Hex(token);
  var tokenCache = null;
  var cachedIdentity = null;
  try {
    tokenCache = CacheService.getScriptCache();
    cachedIdentity = tokenCache.get(tokenCacheKey);
  } catch (cacheError) {
    Logger.log("[verifyReviewerIdentityToken_] Token cache read failed.");
  }
  if (cachedIdentity) {
    try {
      var cachedClaims = JSON.parse(cachedIdentity);
      if (
        cachedClaims &&
        cachedClaims.clientId === expectedClientId &&
        Number(cachedClaims.expiresAt) > Math.floor(Date.now() / 1000) &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(cachedClaims.email || ""))
      )
        return {
          valid: true,
          email: String(cachedClaims.email).toLowerCase(),
          picture: getVerifiedGooglePicture_(cachedClaims.picture),
        };
    } catch (cacheError) {
      Logger.log("[verifyReviewerIdentityToken_] Removed invalid token cache data.");
    }
    try {
      tokenCache.remove(tokenCacheKey);
    } catch (cacheError) {
      Logger.log("[verifyReviewerIdentityToken_] Invalid token cache entry could not be removed.");
    }
  }

  var response = null;
  var responseCode = 0;
  var fetchFailure = "";
  var fetchDiagnostic = "";
  var tokenInfoEndpoints = [
    "https://oauth2.googleapis.com/tokeninfo?id_token=",
    "https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=",
  ];
  for (
    var endpointIndex = 0;
    endpointIndex < tokenInfoEndpoints.length;
    endpointIndex++
  ) {
    try {
      response = UrlFetchApp.fetch(
        tokenInfoEndpoints[endpointIndex] + encodeURIComponent(token),
        { muteHttpExceptions: true },
      );
      responseCode = response.getResponseCode();
      if (responseCode !== 429 && responseCode < 500) break;
      fetchFailure = "HTTP_" + responseCode;
      Logger.log(
        "[verifyReviewerIdentityToken_] Google token verification endpoint returned a transient error.",
      );
    } catch (error) {
      Logger.log(
        "[verifyReviewerIdentityToken_] Google token verification endpoint was unreachable.",
      );
      var errorMessage = String(error && error.message || "");
      if (
        /permission|authorization required/i.test(errorMessage) ||
        /auth\/script\.external_request/i.test(errorMessage)
      )
        return { valid: false, code: "AUTH_PERMISSION_REQUIRED" };
      fetchFailure = "FETCH_EXCEPTION";
      fetchDiagnostic = errorMessage
        .replace(token, "[redacted]")
        .replace(/id_token=[^&\s]+/gi, "id_token=[redacted]")
        .replace(/\s+/g, " ")
        .substring(0, 180);
    }
  }
  if (!response || responseCode >= 500 || responseCode === 429)
    return {
      valid: false,
      code: "AUTH_PROVIDER_UNAVAILABLE",
      verificationFailure: fetchFailure || "NO_RESPONSE",
      verificationDiagnostic: fetchDiagnostic,
    };
  if (responseCode !== 200)
    return { valid: false, code: "UNAUTHORIZED" };

  var claims;
  try {
    claims = JSON.parse(response.getContentText());
  } catch (error) {
    Logger.log("[verifyReviewerIdentityToken_] Google returned invalid token data.");
    return { valid: false, code: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    Logger.log("[verifyReviewerIdentityToken_] Google returned invalid token data.");
    return { valid: false, code: "AUTH_PROVIDER_UNAVAILABLE" };
  }
  var issuer = String(claims.iss || "");
  var expiresAt = Number(claims.exp);
  var email = String(claims.email || "")
    .trim()
    .toLowerCase();
  var picture = getVerifiedGooglePicture_(claims.picture);
  if (
    String(claims.aud || "") !== expectedClientId ||
    (issuer !== "accounts.google.com" &&
      issuer !== "https://accounts.google.com") ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Math.floor(Date.now() / 1000) ||
    String(claims.email_verified || "").toLowerCase() !== "true" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { valid: false, code: "UNAUTHORIZED" };
  }
  var tokenCacheTtl = Math.min(
    MRH_TOKEN_CACHE_MAX_TTL_SECONDS,
    expiresAt - Math.floor(Date.now() / 1000),
  );
  if (tokenCacheTtl > 0) {
    try {
      if (!tokenCache) tokenCache = CacheService.getScriptCache();
      tokenCache.put(
        tokenCacheKey,
        JSON.stringify({
          email: email,
          picture: picture,
          clientId: expectedClientId,
          expiresAt: expiresAt,
        }),
        tokenCacheTtl,
      );
    } catch (cacheError) {
      Logger.log("[verifyReviewerIdentityToken_] Token cache write failed.");
    }
  }
  return { valid: true, email: email, picture: picture };
}

function getVerifiedGooglePicture_(value) {
  var picture = String(value || "").trim();
  return /^https:\/\/lh[3-6]\.googleusercontent\.com\/[A-Za-z0-9_./?=&%-]+$/.test(
    picture,
  )
    ? picture
    : "";
}

function getReviewerAccountStatusResponse_(identity) {
  var account = findMRHAccount_(identity.email, false);
  var accountStatus = account ? account.accountStatus : "NOT_FOUND";
  updateReviewerStatusNotification_(identity.email, accountStatus);
  return {
    status: "success",
    email: identity.email,
    picture: identity.picture,
    accountStatus: accountStatus,
    active: Boolean(account && accountStatus === "TRUE"),
    lastName: account ? account.lastName : "",
    firstName: account ? account.firstName : "",
    middleInitial: account ? account.middleInitial : "",
  };
}

function getReviewerStatusNotificationPropertyKey_(email) {
  return (
    "MRH_REVIEWER_STATUS_NOTIFICATION_v1_" +
    sha256Hex(String(email || "").trim().toLowerCase())
  );
}

function getReviewerStatusNotificationPendingKey_(email) {
  return (
    MRH_REVIEWER_STATUS_NOTIFICATION_PENDING_PREFIX +
    sha256Hex(String(email || "").trim().toLowerCase())
  );
}

function updateReviewerStatusNotification_(
  email,
  accountStatus,
  lockAlreadyHeld,
) {
  var normalizedEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) return;
  var propertyKey = getReviewerStatusNotificationPropertyKey_(email);
  var properties = getScriptProps();
  if (properties.getProperty(propertyKey) === accountStatus) return;
  var lock = lockAlreadyHeld ? null : LockService.getScriptLock();
  if (lock && !lock.tryLock(500)) {
    Logger.log(JSON.stringify({
      event: "reviewer_status_notification_deferred",
      reasonCode: "STATUS_NOTIFICATION_LOCK_BUSY",
    }));
    return;
  }
  try {
    var previousStatus = properties.getProperty(propertyKey);
    if (!previousStatus) {
      properties.setProperty(propertyKey, accountStatus);
      return;
    }
    if (previousStatus === accountStatus) return;

    if (
      accountStatus === "TRUE" ||
      accountStatus === "FALSE" ||
      accountStatus === "DENIED"
    ) {
      properties.setProperty(propertyKey, accountStatus);
      properties.setProperty(
        getReviewerStatusNotificationPendingKey_(normalizedEmail),
        JSON.stringify({ email: normalizedEmail, status: accountStatus }),
      );
    }
  } finally {
    if (lock) lock.releaseLock();
  }
}

function processReviewerStatusNotifications() {
  var workerLock = LockService.getUserLock();
  if (!workerLock.tryLock(1000))
    return { status: "busy", processed: 0 };
  try {
    var properties = getScriptProps();
    var pending = properties.getProperties();
    var keys = Object.keys(pending).filter(function (key) {
      return key.indexOf(MRH_REVIEWER_STATUS_NOTIFICATION_PENDING_PREFIX) === 0;
    }).slice(0, MRH_REVIEWER_STATUS_NOTIFICATION_BATCH_SIZE);
    var subjectByStatus = {
      TRUE: "Maritime Review Hub resource access granted",
      FALSE: "Maritime Review Hub resource access pending",
      DENIED: "Maritime Review Hub resource access denied",
    };
    var bodyByStatus = {
      TRUE:
        "Dear Maritime Review Hub user,\n\nYour resource access request has been approved. The requested materials are now available. Please sign in to your profile to continue.\n\nSincerely,\nMaritime Review Hub",
      FALSE:
        "Dear Maritime Review Hub user,\n\nThis message confirms that your resource access request has been received and is pending administrator review. We will notify you by email when a decision has been made.\n\nSincerely,\nMaritime Review Hub",
      DENIED:
        "Dear Maritime Review Hub user,\n\nAfter review, we are unable to approve your resource access request at this time. If you believe your submitted name details need correction, please sign in to your profile, update them, and resubmit your request for review.\n\nSincerely,\nMaritime Review Hub",
    };
    var sent = 0;
    keys.forEach(function (key) {
      var notification;
      try {
        notification = JSON.parse(pending[key]);
        if (
          !notification ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(notification.email || "")) ||
          !subjectByStatus[notification.status]
        )
          throw new Error("Invalid reviewer status notification.");
        MailApp.sendEmail({
          to: notification.email,
          subject: subjectByStatus[notification.status],
          body: bodyByStatus[notification.status],
          name: "Maritime Review Hub",
        });
      } catch (error) {
        Logger.log(JSON.stringify({
          event: "reviewer_status_notification_failed",
          reasonCode: "MAIL_DELIVERY_FAILED",
          errorName: String(error && error.name || "Error"),
        }));
        return;
      }
      var lock = LockService.getScriptLock();
      if (!lock.tryLock(10000)) return;
      try {
        if (properties.getProperty(key) === pending[key]) {
          properties.deleteProperty(key);
          sent += 1;
        }
      } finally {
        lock.releaseLock();
      }
    });
    return { status: "success", processed: sent };
  } finally {
    workerLock.releaseLock();
  }
}

function verifyReviewerRequestIdentity_(data) {
  var config = getReviewerAuthorizationConfig_();
  if (!config.enabled)
    return {
      error: errorResponse(
        "Reviewer account authorization is not configured.",
        "FEATURE_DISABLED",
      ),
    };
  var sessionId = String(data && data.sessionId || "").trim();
  var identity = sessionId
    ? verifyReviewerSession_(sessionId)
    : verifyReviewerIdentityToken_(data && data.idToken, config.clientId);
  if (!identity.valid) {
    var providerUnavailable = identity.code === "AUTH_PROVIDER_UNAVAILABLE";
    return {
      error: errorResponse(
        providerUnavailable
          ? "Google sign-in verification is temporarily unavailable."
          : identity.code === "SESSION_EXPIRED"
            ? "Your access session has expired. Sign in with Google again."
            : identity.code === "SESSION_INVALID"
              ? "Your access session is no longer valid. Sign in with Google again."
              : identity.code === "AUTH_PERMISSION_REQUIRED"
                ? "The reviewer sign-in service needs Apps Script external-request permission. The script owner must run initializeMRHAccountsSpreadsheet() and approve the requested access."
                : "A valid Google sign-in is required.",
        identity.code,
        providerUnavailable
          ? {
              verificationFailure: identity.verificationFailure,
              verificationDiagnostic: identity.verificationDiagnostic,
            }
          : undefined,
      ),
    };
  }
  return { identity: identity };
}

function getReviewerSessionPropertyKey_(sessionId) {
  return REVIEWER_SESSION_PROPERTY_PREFIX + sha256Hex(sessionId);
}

function createReviewerSession_(identity) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return {
      error: errorResponse(
        "Reviewer sign-in is busy. Please try again.",
        "SESSION_BUSY",
      ),
    };
  try {
    var properties = getScriptProps();
    var allProperties = properties.getProperties();
    var activeSessions = [];
    var now = Date.now();
    Object.keys(allProperties).forEach(function (key) {
      if (key.indexOf(REVIEWER_SESSION_PROPERTY_PREFIX) !== 0) return;
      var session = null;
      try {
        session = JSON.parse(allProperties[key]);
      } catch (error) {
        Logger.log("[createReviewerSession_] Removed malformed session record.");
      }
      if (
        !session ||
        !Number.isFinite(Number(session.expiresAt)) ||
        Number(session.expiresAt) <= now
      ) {
        properties.deleteProperty(key);
        return;
      }
      activeSessions.push(key);
    });
    if (activeSessions.length >= REVIEWER_SESSION_LIMIT)
      return {
        error: errorResponse(
          "The access session service is at capacity. Please try again later.",
          "SESSION_CAPACITY",
        ),
      };

    var sessionId = [
      Utilities.getUuid(),
      Utilities.getUuid(),
      Utilities.getUuid(),
    ].join("").replace(/-/g, "").toLowerCase();
    var expiresAt = now + REVIEWER_SESSION_TTL_MS;
    properties.setProperty(
      getReviewerSessionPropertyKey_(sessionId),
      JSON.stringify({
        email: identity.email,
        picture: identity.picture,
        createdAt: now,
        expiresAt: expiresAt,
      }),
    );
    return { sessionId: sessionId, expiresAt: expiresAt };
  } finally {
    lock.releaseLock();
  }
}

function verifyReviewerSession_(sessionId) {
  if (!/^[a-f0-9]{96}$/.test(sessionId))
    return { valid: false, code: "SESSION_INVALID" };
  var propertyKey = getReviewerSessionPropertyKey_(sessionId);
  var properties = getScriptProps();
  var rawSession = properties.getProperty(propertyKey);
  if (!rawSession) return { valid: false, code: "SESSION_INVALID" };
  var session = null;
  try {
    session = JSON.parse(rawSession);
  } catch (error) {
    Logger.log("[verifyReviewerSession_] Removed malformed session record.");
  }
  if (
    !session ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(session.email || ""))
  ) {
    properties.deleteProperty(propertyKey);
    return { valid: false, code: "SESSION_INVALID" };
  }
  if (
    !Number.isFinite(Number(session.expiresAt)) ||
    Number(session.expiresAt) <= Date.now()
  ) {
    properties.deleteProperty(propertyKey);
    return { valid: false, code: "SESSION_EXPIRED" };
  }
  return {
    valid: true,
    email: String(session.email).toLowerCase(),
    picture: getVerifiedGooglePicture_(session.picture),
  };
}

function revokeReviewerSession_(sessionId) {
  if (!/^[a-f0-9]{96}$/.test(sessionId)) return false;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return false;
  try {
    getScriptProps().deleteProperty(getReviewerSessionPropertyKey_(sessionId));
    return true;
  } finally {
    lock.releaseLock();
  }
}

function handleReviewerSignInRequest(data) {
  var verified = verifyReviewerRequestIdentity_(data);
  if (verified.error) return verified.error;
  var response = getReviewerAccountStatusResponse_(verified.identity);
  var account = response.accountStatus === "NOT_FOUND"
    ? { email: response.email }
    : {
        email: response.email,
        lastName: response.lastName,
        firstName: response.firstName,
        middleInitial: response.middleInitial,
      };
  appendMRHAccessLog_(
    "REVIEWERS",
    account,
    data && data.eventId,
    "SIGN_IN:" + response.accountStatus,
  );
  var session = createReviewerSession_(verified.identity);
  if (session.error) return session.error;
  response.sessionId = session.sessionId;
  response.expiresAt = session.expiresAt;
  return jsonResponse(response);
}

function handleRestoreReviewerSessionRequest(data) {
  var verified = verifyReviewerRequestIdentity_(data);
  if (verified.error) return verified.error;
  return jsonResponse(getReviewerAccountStatusResponse_(verified.identity));
}

function handleRevokeReviewerSessionRequest(data) {
  var sessionId = String(data && data.sessionId || "").trim();
  var cleanup = null;
  try {
    cleanup = cleanupReviewerPdfJobsForSession_(sessionId);
  } catch (cleanupError) {
    Logger.log(JSON.stringify({
      event: "reviewer_pdf_signout_cleanup_failed",
      reasonCode: "PDF_CLEANUP_FAILED",
    }));
  }
  if (!cleanup || cleanup.status !== "success")
    Logger.log(JSON.stringify({
      event: "reviewer_pdf_signout_cleanup_pending",
      reasonCode: "PDF_CLEANUP_PENDING",
    }));
  if (!revokeReviewerSession_(sessionId))
    return errorResponse(
      "The access session could not be revoked right now. Try signing out again.",
      "SESSION_REVOKE_FAILED",
    );
  return jsonResponse({ status: "success" });
}

function handleGetReviewerAccountStatusRequest(data) {
  var verified = verifyReviewerRequestIdentity_(data);
  if (verified.error) return verified.error;
  return jsonResponse(getReviewerAccountStatusResponse_(verified.identity));
}

function authorizeReviewerRequest_(data, bypassAccountCache) {
  var verified = verifyReviewerRequestIdentity_(data);
  if (verified.error) return { error: verified.error };
  var account = findMRHAccount_(
    verified.identity.email,
    bypassAccountCache === true,
  );
  if (!account)
    return {
      error: errorResponse(
        "Submit your profile details for administrator review before accessing these materials.",
        "ACCOUNT_PENDING",
      ),
    };
  if (account.accountStatus === "DENIED")
    return {
      error: errorResponse(
        "Invalid credentials. Please enter your correct and proper name, then resubmit for administrator review.",
        "ACCOUNT_DENIED",
      ),
    };
  if (account.accountStatus !== "TRUE")
    return {
      error: errorResponse(
        "Your profile is waiting for administrator approval. Access remains disabled until approval.",
        "ACCOUNT_PENDING",
      ),
    };
  return {
    email: verified.identity.email,
    picture: verified.identity.picture,
    account: account,
  };
}

function authorizeReviewerPdfRequest_(data) {
  var authorization = authorizeReviewerRequest_(data, true);
  if (
    authorization.error ||
    authorization.account.rawAccountStatus !== "TRUE"
  )
    return {
      error: authorization.error || errorResponse(
        "PDF access requires an account explicitly approved as TRUE.",
        "ACCOUNT_PENDING",
      ),
    };
  return authorization;
}

function handleReviewerEnrollmentRequest(data) {
  var verified = verifyReviewerRequestIdentity_(data);
  if (verified.error) return verified.error;
  var lastName = cleanText(data && data.lastName, 100);
  var firstName = cleanText(data && data.firstName, 100);
  var middleInitial = cleanText(data && data.middleInitial, 10);
  if (!lastName || !firstName)
    return errorResponse("Enter your last name and first name.", "BAD_REQUEST");
  if (!/^[A-Za-z]\.$/.test(middleInitial))
    return errorResponse(
      "Middle Initial must be exactly one letter followed by a period.",
      "BAD_REQUEST",
    );
  middleInitial = middleInitial.toUpperCase();
  if (
    !reviewerEmailMatchesName_(
      verified.identity.email,
      firstName,
      middleInitial,
      lastName,
    )
  )
    return errorResponse(
      "The signed-in Google email does not appear to match this name. Use an email containing part of your first or last name, or matching initials.",
      "EMAIL_NAME_MISMATCH",
    );

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return errorResponse(
      "Account submission is busy. Please try again.",
      "ENROLLMENT_BUSY",
    );
  try {
    var config = getReviewerAuthorizationConfig_();
    var spreadsheet = SpreadsheetApp.openById(config.spreadsheetId);
    var sheet = spreadsheet.getSheetByName(MRH_ACCOUNTS_SHEET_NAME);
    getMRHAccountHeaders_(sheet, MRH_ACCOUNTS_HEADERS, MRH_ACCOUNTS_SHEET_NAME);
    var matchingAccount = findMRHAccount_(verified.identity.email, true);
    if (
      matchingAccount &&
      (matchingAccount.accountStatus === "TRUE" ||
        matchingAccount.accountStatus === "FALSE")
    ) {
      var profileChanged =
        matchingAccount.lastName !== lastName ||
        matchingAccount.firstName !== firstName ||
        matchingAccount.middleInitial !== middleInitial;
      if (!profileChanged)
        return jsonResponse({
          status: "success",
          accountStatus: matchingAccount.accountStatus,
          active: matchingAccount.accountStatus === "TRUE",
          email: verified.identity.email,
          lastName: matchingAccount.lastName,
          firstName: matchingAccount.firstName,
          middleInitial: matchingAccount.middleInitial,
        });

      sheet.getRange(
        matchingAccount.rowNumber,
        1,
        1,
        MRH_ACCOUNTS_HEADERS.length,
      ).setValues([[
        verified.identity.email,
        lastName,
        firstName,
        middleInitial,
        "FALSE",
        matchingAccount.date,
        matchingAccount.time,
      ]]);
      invalidateMRHAccountCache_(config.spreadsheetId, verified.identity.email);
      updateReviewerStatusNotification_(
        verified.identity.email,
        "FALSE",
        true,
      );
      appendMRHAccessLog_(
        "REVIEWERS",
        {
          email: verified.identity.email,
          lastName: lastName,
          firstName: firstName,
          middleInitial: middleInitial,
        },
        data && data.eventId,
        "PROFILE_UPDATED",
        true,
      );
      return jsonResponse({
        status: "success",
        accountStatus: "FALSE",
        active: false,
        email: verified.identity.email,
        lastName: lastName,
        firstName: firstName,
        middleInitial: middleInitial,
        profileUpdated: true,
      });
    }

    var accountCreatedAt = matchingAccount
      ? [matchingAccount.date, matchingAccount.time]
      : getMRHLocalDateTime_();
    var accountValues = [
      verified.identity.email,
      lastName,
      firstName,
      middleInitial,
      "FALSE",
      accountCreatedAt[0],
      accountCreatedAt[1],
    ];
    if (matchingAccount && matchingAccount.accountStatus === "DENIED") {
      sheet.getRange(
        matchingAccount.rowNumber,
        1,
        1,
        MRH_ACCOUNTS_HEADERS.length,
      )
        .setValues([accountValues]);
    } else {
      var targetRow = findFirstEmptyMRHAccountRow_(sheet);
      if (targetRow <= sheet.getLastRow()) {
        sheet
          .getRange(targetRow, 1, 1, MRH_ACCOUNTS_HEADERS.length)
          .setValues([accountValues]);
      } else {
        var appendResult = Sheets.Spreadsheets.Values.append(
          { values: [accountValues] },
          config.spreadsheetId,
          MRH_ACCOUNTS_SHEET_NAME + "!A:G",
          { valueInputOption: "RAW", insertDataOption: "INSERT_ROWS" },
        );
        if (
          !appendResult ||
          !appendResult.updates ||
          Number(appendResult.updates.updatedRows) !== 1
        )
          throw new Error("The account review request could not be saved.");
      }
    }
    invalidateMRHAccountCache_(config.spreadsheetId, verified.identity.email);
    updateReviewerStatusNotification_(verified.identity.email, "FALSE", true);
    var account = {
      email: verified.identity.email,
      lastName: lastName,
      firstName: firstName,
      middleInitial: middleInitial,
    };
    appendMRHAccessLog_(
      "REVIEWERS",
      account,
      data && data.eventId,
      "APPLICATION_SUBMITTED",
      true,
    );
    return jsonResponse({
      status: "success",
      accountStatus: "FALSE",
      active: false,
      email: verified.identity.email,
      lastName: lastName,
      firstName: firstName,
      middleInitial: middleInitial,
    });
  } finally {
    lock.releaseLock();
  }
}

function handleGetReviewerDashboardRequest(data) {
  var authorization = authorizeReviewerRequest_(data, false);
  if (authorization.error) return authorization.error;

  var folder = DriveApp.getFolderById(RESOURCE_DASHBOARD_INDEX_FOLDER_ID);
  var fileName = RESOURCE_DASHBOARD_INDEX_FILES.REVIEWERS;
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext()) {
    var missingIndexError = new Error(
      "Resource dashboard index is missing: " + fileName,
    );
    missingIndexError.code = "REVIEWER_INDEX_MISSING";
    throw missingIndexError;
  }
  var file = files.next();
  var reviewerCacheKey =
    "mrh_reviewer_dashboard_v2_" +
    sha256Hex(
      String(file.getId()) + ":" + String(file.getLastUpdated().getTime()),
    );

  var reviewerCache = null;
  try {
    reviewerCache = CacheService.getScriptCache();
    var cachedTab = reviewerCache.get(reviewerCacheKey);
    if (cachedTab) {
      var parsedTab = JSON.parse(cachedTab);
      if (
        parsedTab &&
        Array.isArray(parsedTab.columns) &&
        Array.isArray(parsedTab.rows) &&
        parsedTab.rows.every(Array.isArray)
      )
        return jsonResponse({
          status: "success",
          email: authorization.email,
          lastName: authorization.account.lastName,
          firstName: authorization.account.firstName,
          middleInitial: authorization.account.middleInitial,
          tab: protectReviewerDashboardTab_(parsedTab),
        });
      reviewerCache.remove(reviewerCacheKey);
    }
  } catch (cacheError) {
    Logger.log("[handleGetReviewerDashboardRequest] Reviewer cache read failed.");
  }

  var index = getResourceDashboardCombinedIndex(fileName, file);
  var reviewerTab = buildResourceDashboardTab("REVIEWERS", index);
  reviewerTab = protectReviewerDashboardTab_(reviewerTab);
  var reviewerJson = JSON.stringify(reviewerTab);
  if (reviewerJson.length <= 90000) {
    try {
      if (!reviewerCache) reviewerCache = CacheService.getScriptCache();
      reviewerCache.put(
        reviewerCacheKey,
        reviewerJson,
        MRH_REVIEWER_DASHBOARD_VERSION_CACHE_TTL_SECONDS,
      );
    } catch (cacheError) {
      Logger.log("[handleGetReviewerDashboardRequest] Reviewer cache write failed.");
    }
  }
  reviewerTab = protectReviewerDashboardTab_(reviewerTab);
  return jsonResponse({
    status: "success",
    email: authorization.email,
    lastName: authorization.account.lastName,
    firstName: authorization.account.firstName,
    middleInitial: authorization.account.middleInitial,
    tab: reviewerTab,
  });
}

function protectReviewerDashboardTab_(tab) {
  var protectedTab = JSON.parse(JSON.stringify(tab));
  if (!Array.isArray(protectedTab.links)) return protectedTab;
  protectedTab.links.forEach(function (row, rowIndex) {
    if (!Array.isArray(row)) return;
    row.forEach(function (url, columnIndex) {
      var linkType = String(
        protectedTab.linkTypes &&
          protectedTab.linkTypes[rowIndex] &&
          protectedTab.linkTypes[rowIndex][columnIndex] || "",
      ).toLowerCase();
      var protectedFileId = /^mrh-reviewer-pdf:([A-Za-z0-9_-]{10,200})$/.exec(
        String(url || ""),
      );
      var linkTitle = String(
        protectedTab.linkTitles &&
          protectedTab.linkTitles[rowIndex] &&
          protectedTab.linkTitles[rowIndex][columnIndex] || "",
      );
      if (linkType !== "application/pdf" && !/\.pdf$/i.test(linkTitle))
        return;
      if (protectedFileId) return;
      var fileId = getResourceDashboardFileId(url);
      if (!fileId)
        throw new Error(
          "Reviewer PDF index contains a link that cannot be protected.",
        );
      row[columnIndex] = "mrh-reviewer-pdf:" + fileId;
    });
  });
  return protectedTab;
}

function getReviewerPdfIndexEntries_() {
  var folder = DriveApp.getFolderById(RESOURCE_DASHBOARD_INDEX_FOLDER_ID);
  var fileName = RESOURCE_DASHBOARD_INDEX_FILES.REVIEWERS;
  var files = folder.getFilesByName(fileName);
  if (!files.hasNext())
    throw new Error("Reviewer PDF index is missing: " + fileName);
  var indexFile = files.next();
  var cacheKey =
    "mrh_reviewer_pdf_index_v1_" +
    sha256Hex(
      String(indexFile.getId()) + ":" +
        String(indexFile.getLastUpdated().getTime()),
    );
  var cache = null;
  try {
    cache = CacheService.getScriptCache();
    var cachedEntries = cache.get(cacheKey);
    if (cachedEntries) {
      var parsedEntries = JSON.parse(cachedEntries);
      if (
        Array.isArray(parsedEntries) &&
        parsedEntries.every(function (entry) {
          return (
            entry &&
            /^[A-Za-z0-9_-]{10,200}$/.test(String(entry.fileId || "")) &&
            typeof entry.title === "string"
          );
        })
      )
        return parsedEntries;
      cache.remove(cacheKey);
    }
  } catch (cacheError) {
    Logger.log("[getReviewerPdfIndexEntries_] Index cache read failed.");
  }
  var index = getResourceDashboardCombinedIndex(fileName, indexFile);
  var tab = buildResourceDashboardTab("REVIEWERS", index);
  var entries = [];
  tab.rows.forEach(function (row, rowIndex) {
    row.forEach(function (value, columnIndex) {
      var linkType = String(
        tab.linkTypes[rowIndex] && tab.linkTypes[rowIndex][columnIndex] || "",
      ).toLowerCase();
      var title = String(
        tab.linkTitles[rowIndex] && tab.linkTitles[rowIndex][columnIndex] ||
          value || "",
      ).trim();
      if (linkType !== "application/pdf" && !/\.pdf$/i.test(title)) return;
      var fileId = getResourceDashboardFileId(
        tab.links[rowIndex] && tab.links[rowIndex][columnIndex],
      );
      if (!fileId)
        throw new Error("Reviewer PDF index contains an invalid Drive ID.");
      entries.push({
        fileId: fileId,
        title: title,
        row: rowIndex,
        column: columnIndex,
      });
    });
  });
  try {
    if (!cache) cache = CacheService.getScriptCache();
    var serializedEntries = JSON.stringify(entries);
    if (serializedEntries.length <= 90000)
    cache.put(cacheKey, serializedEntries, CACHE_TTL_SECONDS);
  } catch (cacheError) {
    Logger.log("[getReviewerPdfIndexEntries_] Index cache write failed.");
  }
  return entries;
}

async function runReviewerPdfWatermarkProofOfConcept() {
  var email = String(
    Session.getEffectiveUser().getEmail() || "",
  ).trim().toLowerCase();
  var account = email ? findMRHAccount_(email, true) : null;
  if (!account || account.accountStatus !== "TRUE")
    throw new Error(
      "The Apps Script execution identity must be an active ACCOUNTS user to run this proof of concept.",
    );
  if (typeof PDFLib === "undefined" || !PDFLib.PDFDocument)
    throw new Error("The locally bundled PDF library has not been installed.");

  var document = await PDFLib.PDFDocument.create();
  var font = await document.embedFont(PDFLib.StandardFonts.Helvetica);
  var alphabet =
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  var seed = 984231;
  function nextProofCharacter() {
    seed = (seed * 48271) % 2147483647;
    return alphabet.charAt(seed % alphabet.length);
  }
  var proofText = "";
  for (var characterIndex = 0; characterIndex < 30000; characterIndex++)
    proofText += nextProofCharacter();
  for (var pageIndex = 0; pageIndex < 20; pageIndex++) {
    var page = document.addPage(
      pageIndex % 2 === 0 ? [612, 792] : [792, 612],
    );
    page.drawText("Private Apps Script PDF watermark proof page " + (pageIndex + 1), {
      x: 24,
      y: 700,
      size: 14,
      font: font,
    });
    page.drawText(proofText, {
      x: 18,
      y: 420,
      size: 2,
      font: font,
    });
  }
  var generatedSource = await document.save({ useObjectStreams: false });
  if (
    !generatedSource.length ||
    generatedSource.length > MRH_REVIEWER_PDF_MAX_BYTES
  )
    throw new Error(
      "The generated proof PDF does not fit the current 2 MiB source limit.",
    );

  var signedSource = Array.prototype.map.call(generatedSource, function (byte) {
    return byte > 127 ? byte - 256 : byte;
  });
  var fileName =
    "MRH private Reviewer PDF proof " + Utilities.getUuid() + ".pdf";
  var sourceFile = DriveApp.createFile(
    Utilities.newBlob(signedSource, "application/pdf", fileName),
  );
  var startedAt = Date.now();
  var sourceHashBefore = "";
  var sourceHashAfter = "";
  try {
    var sourcePermissions = listReviewerPdfPermissions_(sourceFile.getId());
    var hasUnexpectedAccess = sourcePermissions.some(function (permission) {
      return (
        permission.type !== "user" ||
        (permission.emailAddress || "").toLowerCase() !== email ||
        permission.role !== "owner"
      );
    });
    if (hasUnexpectedAccess)
      throw new Error(
        "The temporary proof source is not private to the Apps Script execution identity.",
      );
    var sourceBytes = sourceFile.getBlob().getBytes();
    sourceHashBefore = sha256Hex(
      Utilities.base64Encode(sourceBytes),
    );
    var identity = reviewerPdfWatermarkIdentity_(account, email);
    var derivative = await watermarkReviewerPdfBytes_(sourceBytes, identity);
    var verification = await verifyReviewerPdfWatermarks_(
      derivative.bytes,
      identity,
    );
    if (
      verification.pageCount !== 20 ||
      verification.pagesWithWatermarks !== 20
    )
      throw new Error(
        "The proof derivative does not contain a verified watermark on every page.",
      );
    sourceHashAfter = sha256Hex(
      Utilities.base64Encode(sourceFile.getBlob().getBytes()),
    );
    if (sourceHashBefore !== sourceHashAfter)
      throw new Error("The private source PDF changed during watermarking.");
    return {
      status: "success",
      library: "pdf-lib 1.17.1 (MIT)",
      inputBytes: sourceBytes.length,
      outputBytes: derivative.bytes.length,
      pageCount: verification.pageCount,
      pagesWithWatermarks: verification.pagesWithWatermarks,
      sourceUnchanged: true,
      tempSourceTrashed: true,
      executionMs: Date.now() - startedAt,
      memoryUseBytes: null,
      watermarkedPdfBase64: Utilities.base64Encode(derivative.bytes),
    };
  } finally {
    sourceFile.setTrashed(true);
  }
}

function listReviewerPdfPermissions_(fileId) {
  var permissions = [];
  var pageToken = "";
  do {
    var options = {
      pageSize: 100,
      fields: "nextPageToken,permissions(id,type,role,emailAddress,domain,deleted,permissionDetails(inherited,inheritedFrom,permissionType,role))",
      supportsAllDrives: true,
    };
    if (pageToken) options.pageToken = pageToken;
    var response = Drive.Permissions.list(fileId, options);
    permissions = permissions.concat(response.permissions || []);
    pageToken = String(response.nextPageToken || "");
  } while (pageToken);
  return permissions;
}

function getReviewerPdfDriveHierarchy_(fileId) {
  var queue = [{ id: fileId, path: [] }];
  var visited = Object.create(null);
  var resources = [];
  while (queue.length && Object.keys(visited).length < 100) {
    var current = queue.shift();
    if (visited[current.id]) continue;
    visited[current.id] = true;
    var file = Drive.Files.get(current.id, {
      fields: "id,name,mimeType,parents,trashed,size,modifiedTime,headRevisionId,md5Checksum",
      supportsAllDrives: true,
    });
    if (!file || file.trashed)
      return { insideRoot: false, path: resources };
    var resource = {
      id: String(file.id),
      name: String(file.name || ""),
      mimeType: String(file.mimeType || ""),
      size: Number(file.size || 0),
      parents: (file.parents || []).map(String),
      modifiedTime: String(file.modifiedTime || ""),
      headRevisionId: String(file.headRevisionId || ""),
      md5Checksum: String(file.md5Checksum || ""),
    };
    var path = current.path.concat([resource]);
    resources.push(resource);
    if (String(file.id) === RESOURCE_PORTAL_ROOT_FOLDER_ID)
      return {
        insideRoot: path.some(function (item) {
          return (
            item.mimeType === "application/vnd.google-apps.folder" &&
            isPrivateResourceFolderName(item.name)
          );
        }),
        path: path,
      };
    (file.parents || []).forEach(function (parentId) {
      if (!visited[parentId])
        queue.push({ id: String(parentId), path: path });
    });
  }
  return { insideRoot: false, path: resources };
}

function getReviewerPdfSource_(fileId) {
  var entry = getReviewerPdfIndexEntries_().filter(function (candidate) {
    return candidate.fileId === fileId;
  })[0];
  if (!entry)
    return {
      error: {
        code: "RESOURCE_NOT_AUTHORIZED",
        message: "This PDF is not listed in the current Reviewer index.",
      },
    };
  var hierarchy = getReviewerPdfDriveHierarchy_(fileId);
  if (!hierarchy.insideRoot)
    return {
      error: {
        code: "RESOURCE_NOT_AUTHORIZED",
        message: "This PDF is outside the protected resource hierarchy.",
      },
    };
  var driveFile = hierarchy.path[0];
  if (
    !driveFile ||
    driveFile.trashed ||
    String(driveFile.mimeType || "").toLowerCase() !== "application/pdf"
  )
    return {
      error: {
        code: "INVALID_RESOURCE",
        message: "The selected resource is not a PDF.",
      },
    };
  if (driveFile.size > MRH_REVIEWER_PDF_MAX_BYTES)
    return {
      error: {
        code: "FILE_TOO_LARGE",
        message: "This PDF exceeds the 2 MiB Apps Script processing limit.",
      },
    };
  return {
    entry: entry,
    driveFile: driveFile,
    sourceVersion: reviewerPdfSourceVersion_(driveFile),
  };
}

function reviewerPdfSourceVersion_(driveFile) {
  return sha256Hex(
    [
      driveFile.id,
      driveFile.size,
      driveFile.modifiedTime,
      driveFile.headRevisionId,
      driveFile.md5Checksum,
      driveFile.parents.slice().sort().join(","),
    ].join("\n"),
  );
}

function reviewerPdfFailure_(data, startedAt, code, message) {
  Logger.log(JSON.stringify({
    event: "reviewer_pdf_request_denied",
    correlationId: String(data && data.eventId || ""),
    reasonCode: code,
    durationMs: Date.now() - startedAt,
  }));
  return errorResponse(message, code);
}

function reviewerPdfJobPropertyKey_(jobId) {
  return REVIEWER_PDF_JOB_PROPERTY_PREFIX + jobId;
}

function reviewerPdfQueueConfigured_() {
  return getScriptProps().getProperty(REVIEWER_PDF_WORKER_READY_PROPERTY) === "true";
}

function scheduleReviewerPdfWorkerLocked_(delayMs) {
  var properties = getScriptProps();
  var now = Date.now();
  var delay = Math.max(10000, Number(delayMs) || 10000);
  var desiredAt = now + delay;
  var scheduledAt = Number(
    properties.getProperty(REVIEWER_PDF_WORKER_SCHEDULE_PROPERTY) || 0,
  );
  var triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === REVIEWER_PDF_WORKER_HANDLER;
  });
  if (
    triggers.length &&
    scheduledAt > now - 60 * 1000 &&
    scheduledAt <= desiredAt + 5000
  )
    return true;
  triggers.forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger(REVIEWER_PDF_WORKER_HANDLER)
    .timeBased()
    .after(delay)
    .create();
  properties.setProperty(
    REVIEWER_PDF_WORKER_SCHEDULE_PROPERTY,
    String(desiredAt),
  );
  return true;
}

function setupReviewerPdfDelivery() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    throw new Error("Reviewer PDF delivery setup is busy. Try again.");
  try {
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === REVIEWER_PDF_WORKER_HANDLER)
        ScriptApp.deleteTrigger(trigger);
    });
    getScriptProps().setProperty(REVIEWER_PDF_WORKER_READY_PROPERTY, "true");
    getScriptProps().deleteProperty(REVIEWER_PDF_WORKER_SCHEDULE_PROPERTY);
    scheduleReviewerPdfWorkerLocked_();
    return {
      status: "success",
      message: "Reviewer PDF background processor is initialized.",
    };
  } catch (error) {
    getScriptProps().deleteProperty(REVIEWER_PDF_WORKER_READY_PROPERTY);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function handleGetReviewerPdfPreviewRequest_(data) {
  var startedAt = Date.now();
  var authorization = authorizeReviewerPdfRequest_(data);
  if (authorization.error) return authorization.error;
  var fileId = String(data && data.fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    return reviewerPdfFailure_(
      data,
      startedAt,
      "BAD_REQUEST",
      "A valid PDF ID is required.",
    );
  var source = getReviewerPdfSource_(fileId);
  if (source.error)
    return reviewerPdfFailure_(
      data,
      startedAt,
      source.error.code,
      source.error.message,
    );
  var sourceBytes = DriveApp.getFileById(fileId).getBlob().getBytes();
  if (
    !sourceBytes.length ||
    sourceBytes.length > MRH_REVIEWER_PDF_MAX_BYTES ||
    !sourceBytes.slice(0, 1024).some(function (byte, index, bytes) {
      return String.fromCharCode(byte) === "%" &&
        String.fromCharCode(bytes[index + 1] || 0) === "P" &&
        String.fromCharCode(bytes[index + 2] || 0) === "D" &&
        String.fromCharCode(bytes[index + 3] || 0) === "F" &&
        String.fromCharCode(bytes[index + 4] || 0) === "-";
    })
  )
    return reviewerPdfFailure_(
      data,
      startedAt,
      "INVALID_PDF",
      "The source PDF is invalid or too large.",
    );
  var latestFile = Drive.Files.get(fileId, {
    fields: "id,mimeType,parents,trashed,size,modifiedTime,headRevisionId,md5Checksum",
    supportsAllDrives: true,
  });
  var latestSourceVersion =
    latestFile &&
    !latestFile.trashed &&
    String(latestFile.mimeType || "").toLowerCase() === "application/pdf"
      ? reviewerPdfSourceVersion_({
          id: String(latestFile.id),
          size: Number(latestFile.size || 0),
          modifiedTime: String(latestFile.modifiedTime || ""),
          headRevisionId: String(latestFile.headRevisionId || ""),
          md5Checksum: String(latestFile.md5Checksum || ""),
          parents: (latestFile.parents || []).map(String),
        })
      : "";
  if (latestSourceVersion !== source.sourceVersion)
    return reviewerPdfFailure_(
      data,
      startedAt,
      "PDF_SOURCE_CHANGED",
      "The PDF changed while the preview was being loaded. Try again.",
    );
  var identity;
  try {
    identity = reviewerPdfWatermarkIdentity_(
      authorization.account,
      authorization.email,
    );
  } catch (error) {
    return reviewerPdfFailure_(
      data,
      startedAt,
      String(error && error.code || "BAD_REQUEST"),
      String(error && error.message || "Verified account details are required."),
    );
  }
  Logger.log(JSON.stringify({
    event: "reviewer_pdf_preview_delivered",
    correlationId: String(data.eventId || ""),
    durationMs: Date.now() - startedAt,
    sourceBytes: sourceBytes.length,
  }));
  return jsonResponse({
    status: "success",
    mimeType: "application/pdf",
    sourceVersion: source.sourceVersion,
    fullName: identity.fullName,
    email: identity.email,
    data: Utilities.base64Encode(sourceBytes),
  });
}

function cleanReviewerPdfJobs_(properties, now) {
  var allProperties = properties.getProperties();
  var queuedById = Object.create(null);
  var recoveredQueue = [];
  var queuedIds = [];
  try {
    queuedIds = JSON.parse(
      allProperties[REVIEWER_PDF_QUEUE_PROPERTY] || "[]",
    );
  } catch (error) {
    throw new Error("Reviewer PDF job queue is invalid.");
  }
  if (!Array.isArray(queuedIds))
    throw new Error("Reviewer PDF job queue is invalid.");

  Object.keys(allProperties).forEach(function (key) {
    if (key.indexOf(REVIEWER_PDF_JOB_PROPERTY_PREFIX) !== 0) return;
    var job = null;
    try {
      job = JSON.parse(allProperties[key]);
    } catch (error) {
      properties.deleteProperty(key);
      return;
    }
    if (!job || !Number.isFinite(Number(job.expiresAt)) || job.expiresAt <= now) {
      if (job && job.outputFileId) {
        try {
          permanentlyDeleteReviewerPdfOutput_(job.outputFileId);
        } catch (error) {
          Logger.log("[cleanReviewerPdfJobs_] Expired output cleanup failed.");
          return;
        }
      }
      properties.deleteProperty(key);
      return;
    }
    if (job.status === "queued") queuedById[job.jobId] = true;
    if (
      job.status === "processing" &&
      Number(job.processingAt || 0) < now - 6.5 * 60 * 1000
    ) {
      job.status = "queued";
      delete job.processingAt;
      properties.setProperty(key, JSON.stringify(job));
      queuedById[job.jobId] = true;
      recoveredQueue.push(job.jobId);
    }
  });

  var retainedQueue = [];
  queuedIds.forEach(function (jobId) {
    if (queuedById[jobId] && retainedQueue.indexOf(jobId) < 0)
      retainedQueue.push(jobId);
  });
  recoveredQueue.forEach(function (jobId) {
    if (retainedQueue.indexOf(jobId) < 0) retainedQueue.push(jobId);
  });
  properties.setProperty(
    REVIEWER_PDF_QUEUE_PROPERTY,
    JSON.stringify(retainedQueue),
  );
  return retainedQueue;
}

function permanentlyDeleteReviewerPdfOutput_(fileId) {
  var normalizedId = String(fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(normalizedId))
    throw new Error("The temporary PDF output ID is invalid.");
  if (
    typeof Drive === "undefined" ||
    !Drive.Files ||
    typeof Drive.Files.delete !== "function"
  )
    throw new Error("Permanent deletion is unavailable for temporary PDFs.");
  Drive.Files.delete(normalizedId, { supportsAllDrives: true });
}

function enqueueReviewerPdfRequest_(data) {
  if (!/^[a-f0-9]{96}$/i.test(String(data && data.sessionId || "")))
    return errorResponse(
      "A valid access session is required for PDF delivery.",
      "SESSION_INVALID",
    );
  var authorization = authorizeReviewerPdfRequest_(data);
  if (authorization.error) return authorization.error;
  if (!reviewerPdfQueueConfigured_())
    return errorResponse(
      "PDF downloads are not configured. The script administrator must install the background processor.",
      "PDF_PROCESSOR_NOT_CONFIGURED",
    );

  var fileId = String(data && data.fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    return errorResponse("A valid PDF ID is required.", "BAD_REQUEST");
  var source = getReviewerPdfSource_(fileId);
  if (source.error)
    return errorResponse(source.error.message, source.error.code);

  var now = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return errorResponse("PDF preparation is busy. Please try again.", "PDF_QUEUE_BUSY");
  try {
    var properties = getScriptProps();
    var queue = cleanReviewerPdfJobs_(properties, now);
    var allProperties = properties.getProperties();
    var activeCount = Object.keys(allProperties).filter(function (key) {
      if (key.indexOf(REVIEWER_PDF_JOB_PROPERTY_PREFIX) !== 0) return false;
      var job = null;
      try {
        job = JSON.parse(allProperties[key]);
      } catch (error) {
        return false;
      }
      return job && (job.status === "queued" || job.status === "processing");
    }).length;
    if (activeCount >= REVIEWER_PDF_QUEUE_LIMIT)
      return errorResponse(
        "PDF preparation is at capacity. Please try again shortly.",
        "PDF_QUEUE_FULL",
      );

    var jobId = [
      Utilities.getUuid(),
      Utilities.getUuid(),
      Utilities.getUuid(),
    ].join("").replace(/-/g, "").toLowerCase();
    var job = {
      jobId: jobId,
      sessionId: String(data.sessionId || ""),
      eventId: String(data.eventId || ""),
      fileId: fileId,
      sourceVersion: source.sourceVersion,
      status: "queued",
      createdAt: now,
      expiresAt: now + REVIEWER_PDF_JOB_TTL_MS,
    };
    properties.setProperty(reviewerPdfJobPropertyKey_(jobId), JSON.stringify(job));
    queue.push(jobId);
    properties.setProperty(REVIEWER_PDF_QUEUE_PROPERTY, JSON.stringify(queue));
    try {
      scheduleReviewerPdfWorkerLocked_();
    } catch (error) {
      properties.deleteProperty(reviewerPdfJobPropertyKey_(jobId));
      queue.pop();
      properties.setProperty(REVIEWER_PDF_QUEUE_PROPERTY, JSON.stringify(queue));
      Logger.log("[enqueueReviewerPdfRequest_] Could not schedule the PDF worker.");
      return errorResponse(
        "PDF preparation could not be scheduled. Please try again.",
        "PDF_PROCESSOR_UNAVAILABLE",
      );
    }
    return jsonResponse({ status: "pending", jobId: jobId });
  } finally {
    lock.releaseLock();
  }
}

function getReviewerPdfJobStatus_(data) {
  if (!/^[a-f0-9]{96}$/i.test(String(data && data.sessionId || "")))
    return errorResponse(
      "A valid access session is required for PDF delivery.",
      "SESSION_INVALID",
    );
  var authorization = authorizeReviewerPdfRequest_(data);
  if (authorization.error) return authorization.error;
  var jobId = String(data && data.jobId || "").trim();
  if (!/^[a-f0-9]{96}$/.test(jobId))
    return errorResponse("A valid PDF job ID is required.", "BAD_REQUEST");

  var job = null;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return errorResponse("PDF delivery is busy. Please retry.", "PDF_QUEUE_BUSY");
  try {
    var properties = getScriptProps();
    cleanReviewerPdfJobs_(properties, Date.now());
    var propertyKey = reviewerPdfJobPropertyKey_(jobId);
    var rawJob = properties.getProperty(propertyKey);
    if (rawJob) {
      try {
        job = JSON.parse(rawJob);
      } catch (error) {
        properties.deleteProperty(propertyKey);
      }
    }
    if (
      !job ||
      job.sessionId !== String(data.sessionId || "") ||
      !Number.isFinite(Number(job.expiresAt)) ||
      job.expiresAt <= Date.now()
    )
      return errorResponse("PDF job was not found or has expired.", "PDF_JOB_NOT_FOUND");
  } finally {
    lock.releaseLock();
  }

  var currentSource = getReviewerPdfSource_(job.fileId);
  if (
    currentSource.error ||
    currentSource.sourceVersion !== job.sourceVersion
  )
    return errorResponse(
      "The PDF source changed or is no longer authorized. Request it again.",
      "PDF_SOURCE_CHANGED",
    );

  if (job.status === "queued" || job.status === "processing") {
    if (
      job.status === "queued" ||
      Number(job.processingAt || 0) < Date.now() - 6.5 * 60 * 1000
    ) {
      var scheduleLock = LockService.getScriptLock();
      if (scheduleLock.tryLock(10000)) {
        try {
          scheduleReviewerPdfWorkerLocked_();
        } catch (error) {
          Logger.log("[getReviewerPdfJobStatus_] Could not reschedule PDF worker.");
          return errorResponse(
            "PDF processing could not be rescheduled. Please try again.",
            "PDF_PROCESSOR_UNAVAILABLE",
          );
        } finally {
          scheduleLock.releaseLock();
        }
      }
    }
    return jsonResponse({ status: "pending", jobId: jobId });
  }
  if (job.status === "failed")
    return errorResponse(
      job.message || "The PDF could not be prepared safely.",
      job.code || "PDF_PROCESSING_FAILED",
    );
  if (job.status !== "complete" || !job.outputFileId)
    return errorResponse("PDF job has an invalid state.", "PDF_JOB_INVALID");

  var outputFile;
  try {
    outputFile = DriveApp.getFileById(job.outputFileId);
    if (
      outputFile.isTrashed() ||
      outputFile.getMimeType() !== "application/pdf" ||
      outputFile.getSize() > MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES
    )
      throw new Error("The prepared PDF is unavailable or exceeds the delivery limit.");
    var outputBytes = outputFile.getBlob().getBytes();
    if (
      !outputBytes.length ||
      outputBytes.length > MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES ||
      String.fromCharCode.apply(null, outputBytes.slice(0, 5)) !== "%PDF-"
    )
      throw new Error("The prepared PDF is invalid.");
    var encodedOutput = Utilities.base64Encode(outputBytes);
    var cleanupLock = LockService.getScriptLock();
    if (!cleanupLock.tryLock(10000))
      throw new Error("The downloaded PDF cleanup is busy.");
    try {
      var currentJobRaw = getScriptProps().getProperty(
        reviewerPdfJobPropertyKey_(job.jobId),
      );
      var currentJob = currentJobRaw ? JSON.parse(currentJobRaw) : null;
      if (
        !currentJob ||
        currentJob.sessionId !== String(data.sessionId || "") ||
        currentJob.outputFileId !== job.outputFileId
      )
        throw new Error("The PDF download session ended before delivery.");
      permanentlyDeleteReviewerPdfOutput_(job.outputFileId);
      getScriptProps().deleteProperty(reviewerPdfJobPropertyKey_(job.jobId));
    } finally {
      cleanupLock.releaseLock();
    }
    return jsonResponse({
      status: "success",
      mimeType: "application/pdf",
      data: encodedOutput,
    });
  } catch (error) {
    Logger.log("[getReviewerPdfJobStatus_] Output delivery failed: " + String(
      error && error.name || "Error",
    ));
    return errorResponse(
      "The prepared PDF could not be delivered safely. Please request it again.",
      "PDF_DELIVERY_FAILED",
    );
  }
}

function cleanupReviewerPdfJobsForSession_(sessionId) {
  var normalizedSessionId = String(sessionId || "").trim();
  if (!/^[a-f0-9]{96}$/i.test(normalizedSessionId))
    return { status: "error", cleaned: 0 };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000))
    return { status: "error", cleaned: 0 };
  var properties = getScriptProps();
  var removedJobIds = [];
  var cancelledJobIds = [];
  var retryDelayMs = REVIEWER_PDF_CLEANUP_RETRY_MS;
  var cleanupFailed = false;
  try {
    var allProperties = properties.getProperties();
    var queue;
    try {
      queue = JSON.parse(
        allProperties[REVIEWER_PDF_QUEUE_PROPERTY] || "[]",
      );
    } catch (error) {
      throw new Error("Reviewer PDF job queue is invalid.");
    }
    if (!Array.isArray(queue))
      throw new Error("Reviewer PDF job queue is invalid.");
    Object.keys(allProperties).forEach(function (key) {
      if (key.indexOf(REVIEWER_PDF_JOB_PROPERTY_PREFIX) !== 0) return;
      var job;
      try {
        job = JSON.parse(allProperties[key]);
      } catch (error) {
        return;
      }
      if (!job || job.sessionId !== normalizedSessionId) return;
      if (job.outputFileId) {
        try {
          permanentlyDeleteReviewerPdfOutput_(job.outputFileId);
        } catch (error) {
          var retryAt = Date.now() + REVIEWER_PDF_CLEANUP_RETRY_MS;
          var expiresAt = Number(job.expiresAt);
          job.status = "cancelled";
          delete job.processingAt;
          job.expiresAt = Number.isFinite(expiresAt) && expiresAt > 0
            ? Math.min(expiresAt, retryAt)
            : retryAt;
          properties.setProperty(key, JSON.stringify(job));
          cancelledJobIds.push(String(job.jobId || ""));
          retryDelayMs = Math.min(
            retryDelayMs,
            Math.max(10000, job.expiresAt - Date.now()),
          );
          cleanupFailed = true;
          Logger.log(JSON.stringify({
            event: "reviewer_pdf_session_cleanup_failed",
            reasonCode: "DRIVE_DELETE_FAILED",
          }));
          return;
        }
      }
      if (job.status === "processing") {
        job.status = "cancelled";
        delete job.processingAt;
        properties.setProperty(key, JSON.stringify(job));
      } else {
        properties.deleteProperty(key);
      }
      removedJobIds.push(String(job.jobId || ""));
      cancelledJobIds.push(String(job.jobId || ""));
    });
    properties.setProperty(
      REVIEWER_PDF_QUEUE_PROPERTY,
      JSON.stringify(
        queue.filter(function (jobId) {
          return cancelledJobIds.indexOf(String(jobId)) < 0;
        }),
      ),
    );
    if (cleanupFailed) {
      try {
        scheduleReviewerPdfWorkerLocked_(retryDelayMs);
      } catch (error) {
        Logger.log(JSON.stringify({
          event: "reviewer_pdf_session_cleanup_retry_schedule_failed",
          reasonCode: "WORKER_SCHEDULE_FAILED",
        }));
      }
    }
  } finally {
    lock.releaseLock();
  }
  return {
    status: cleanupFailed ? "partial" : "success",
    cleaned: removedJobIds.length,
  };
}

function cleanupReviewerPdfJobsRequest_(data) {
  var authorization = authorizeReviewerPdfRequest_(data);
  if (authorization.error) return authorization.error;
  var result = cleanupReviewerPdfJobsForSession_(data.sessionId);
  if (result.status === "error")
    return errorResponse(
      "Temporary PDF cleanup could not finish. It will be retried automatically.",
      "PDF_CLEANUP_PENDING",
    );
  return jsonResponse(result);
}

async function processReviewerPdfQueue(event) {
  var workerStartedAt = Date.now();
  var startupLock = LockService.getScriptLock();
  if (!startupLock.tryLock(10000)) return;
  try {
    if (event && event.triggerUid) {
      ScriptApp.getProjectTriggers().forEach(function (trigger) {
        if (
          trigger.getHandlerFunction() === REVIEWER_PDF_WORKER_HANDLER &&
          trigger.getUniqueId() === String(event.triggerUid)
        )
          ScriptApp.deleteTrigger(trigger);
      });
    }
    getScriptProps().deleteProperty(REVIEWER_PDF_WORKER_SCHEDULE_PROPERTY);
  } finally {
    startupLock.releaseLock();
  }
  while (Date.now() - workerStartedAt < 210000) {
    var job = null;
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return;
    try {
      var properties = getScriptProps();
      var queue = cleanReviewerPdfJobs_(properties, Date.now());
      if (!queue.length) break;
      var jobId = queue.shift();
      var propertyKey = reviewerPdfJobPropertyKey_(jobId);
      var rawJob = properties.getProperty(propertyKey);
      if (!rawJob) {
        properties.setProperty(REVIEWER_PDF_QUEUE_PROPERTY, JSON.stringify(queue));
        continue;
      }
      job = JSON.parse(rawJob);
      if (job.status !== "queued") {
        properties.setProperty(REVIEWER_PDF_QUEUE_PROPERTY, JSON.stringify(queue));
        continue;
      }
      job.status = "processing";
      job.processingAt = Date.now();
      properties.setProperty(propertyKey, JSON.stringify(job));
      properties.setProperty(REVIEWER_PDF_QUEUE_PROPERTY, JSON.stringify(queue));
    } finally {
      lock.releaseLock();
    }

    var outputFile = null;
    try {
      var result = await handleGetReviewerPdfRequest({
        sessionId: job.sessionId,
        eventId: job.eventId,
        fileId: job.fileId,
      }, job.sourceVersion);
      var response = JSON.parse(result.getContent());
      if (
        !response ||
        response.status !== "success" ||
        response.mimeType !== "application/pdf" ||
        response.sourceVersion !== job.sourceVersion ||
        typeof response.data !== "string"
      )
        throw reviewerPdfError_(
          response && response.message || "The PDF could not be prepared safely.",
          response && response.code || "PDF_PROCESSING_FAILED",
        );
      var latestAuthorization = authorizeReviewerPdfRequest_({
        sessionId: job.sessionId,
        eventId: job.eventId,
      });
      if (latestAuthorization.error)
        throw reviewerPdfError_(
          "The active session ended before the PDF download completed.",
          "SESSION_INVALID",
        );
      var outputBytes = Utilities.base64Decode(response.data);
      if (
        !outputBytes.length ||
        outputBytes.length > MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES ||
        String.fromCharCode.apply(null, outputBytes.slice(0, 5)) !== "%PDF-"
      )
        throw reviewerPdfError_("The PDF processor returned invalid output.", "PDF_PROCESSING_FAILED");

      outputFile = DriveApp.createFile(
        Utilities.newBlob(outputBytes, "application/pdf", "MRH PDF " + job.jobId + ".pdf"),
      );
      var outputPermissions = listReviewerPdfPermissions_(outputFile.getId());
      var outputOwner = String(Session.getEffectiveUser().getEmail() || "").toLowerCase();
      if (
        !outputOwner ||
        outputPermissions.length !== 1 ||
        outputPermissions.some(function (permission) {
          return permission.type !== "user" ||
            String(permission.emailAddress || "").toLowerCase() !== outputOwner ||
            permission.role !== "owner";
        })
      )
        throw reviewerPdfError_("The temporary derivative is not private.", "PDF_OUTPUT_NOT_PRIVATE");

      var completionLock = LockService.getScriptLock();
      if (!completionLock.tryLock(10000))
        throw new Error("The PDF job completion lock is busy.");
      var completed = false;
      var cancelled = false;
      try {
        var updatedJobRaw = getScriptProps().getProperty(
          reviewerPdfJobPropertyKey_(job.jobId),
        );
        var updatedJob = updatedJobRaw ? JSON.parse(updatedJobRaw) : null;
        if (
          updatedJob &&
          updatedJob.status === "processing" &&
          updatedJob.sessionId === job.sessionId
        ) {
          updatedJob.status = "complete";
          delete updatedJob.processingAt;
          updatedJob.outputFileId = outputFile.getId();
          updatedJob.pageCount = Number(response.pageCount || 0);
          getScriptProps().setProperty(
            reviewerPdfJobPropertyKey_(job.jobId),
            JSON.stringify(updatedJob),
          );
          completed = true;
        } else {
          cancelled = Boolean(updatedJob && updatedJob.status === "cancelled");
          if (cancelled)
            getScriptProps().deleteProperty(
              reviewerPdfJobPropertyKey_(job.jobId),
            );
        }
      } finally {
        completionLock.releaseLock();
      }
      if (!completed) {
        permanentlyDeleteReviewerPdfOutput_(outputFile.getId());
        outputFile = null;
        if (!cancelled)
          Logger.log(JSON.stringify({
            event: "reviewer_pdf_job_cancelled",
            correlationId: job.eventId,
          }));
        continue;
      }
      outputFile = null;
    } catch (error) {
      if (outputFile) {
        try {
          permanentlyDeleteReviewerPdfOutput_(outputFile.getId());
          outputFile = null;
        } catch (cleanupError) {
          Logger.log("[processReviewerPdfQueue] Failed derivative cleanup failed.");
        }
      }
      var failedJob = job;
      var currentJobRaw = getScriptProps().getProperty(
        reviewerPdfJobPropertyKey_(job.jobId),
      );
      if (!currentJobRaw) {
        Logger.log(JSON.stringify({
          event: "reviewer_pdf_job_cancelled",
          correlationId: job.eventId,
        }));
        continue;
      }
      try {
        failedJob = JSON.parse(currentJobRaw);
      } catch (readError) {
        Logger.log("[processReviewerPdfQueue] Could not read failed job state.");
      }
      if (failedJob.status === "cancelled") {
        getScriptProps().deleteProperty(
          reviewerPdfJobPropertyKey_(job.jobId),
        );
        continue;
      }
      failedJob.status = "failed";
      delete failedJob.processingAt;
      if (outputFile) failedJob.outputFileId = outputFile.getId();
      failedJob.code = error && error.reviewerPdfSafe
        ? String(error.code || "PDF_PROCESSING_FAILED")
        : "PDF_PROCESSING_FAILED";
      failedJob.message = error && error.reviewerPdfSafe
        ? String(error.message || "The PDF could not be prepared safely.").slice(0, 240)
        : "The PDF could not be prepared safely. Please try again.";
      getScriptProps().setProperty(
        reviewerPdfJobPropertyKey_(job.jobId),
        JSON.stringify(failedJob),
      );
      Logger.log(JSON.stringify({
        event: "reviewer_pdf_job_failed",
        correlationId: job.eventId,
        reasonCode: failedJob.code,
        errorName: String(error && error.name || "Error"),
      }));
    }
  }
  var finishLock = LockService.getScriptLock();
  if (!finishLock.tryLock(10000)) return;
  try {
    var properties = getScriptProps();
    var remainingQueue = cleanReviewerPdfJobs_(properties, Date.now());
    if (remainingQueue.length) {
      scheduleReviewerPdfWorkerLocked_();
    } else {
      var allProperties = properties.getProperties();
      var nextCleanupAt = 0;
      Object.keys(allProperties).forEach(function (key) {
        if (key.indexOf(REVIEWER_PDF_JOB_PROPERTY_PREFIX) !== 0) return;
        var job = null;
        try {
          job = JSON.parse(allProperties[key]);
        } catch (error) {
          return;
        }
        if (
          job &&
          (job.outputFileId || job.status === "cancelled") &&
          Number(job.expiresAt) > 0
        ) {
          var cleanupAt = job.status === "cancelled"
            ? Number(job.expiresAt) > Date.now()
              ? Math.min(
                Date.now() + REVIEWER_PDF_CLEANUP_RETRY_MS,
                Number(job.expiresAt),
              )
              : Date.now() + REVIEWER_PDF_CLEANUP_RETRY_MS
            : Number(job.expiresAt) <= Date.now()
              ? Date.now() + REVIEWER_PDF_CLEANUP_RETRY_MS
              : Number(job.expiresAt);
          if (!nextCleanupAt || cleanupAt < nextCleanupAt)
            nextCleanupAt = cleanupAt;
        }
      });
      if (nextCleanupAt)
        scheduleReviewerPdfWorkerLocked_(nextCleanupAt - Date.now());
    }
  } finally {
    finishLock.releaseLock();
  }
}

async function handleGetReviewerPdfRequest(data, expectedSourceVersion) {
  var startedAt = Date.now();
  var authorization = authorizeReviewerPdfRequest_(data);
  if (authorization.error) {
    Logger.log(JSON.stringify({
      event: "reviewer_pdf_request_denied",
      correlationId: String(data && data.eventId || ""),
      reasonCode: "AUTHORIZATION_FAILED",
      durationMs: Date.now() - startedAt,
    }));
    return authorization.error;
  }

  var fileId = String(data && data.fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    return reviewerPdfFailure_(
      data,
      startedAt,
      "BAD_REQUEST",
      "A valid PDF ID is required.",
    );
  var source = getReviewerPdfSource_(fileId);
  if (source.error)
    return reviewerPdfFailure_(
      data,
      startedAt,
      source.error.code,
      source.error.message,
    );
  if (
    expectedSourceVersion &&
    expectedSourceVersion !== source.sourceVersion
  )
    return reviewerPdfFailure_(
      data,
      startedAt,
      "PDF_SOURCE_CHANGED",
      "The PDF source changed before processing. Request it again.",
    );
  var entry = source.entry;

  var sourceBytes = DriveApp.getFileById(fileId).getBlob().getBytes();
  if (
    !sourceBytes.length ||
    sourceBytes.length > MRH_REVIEWER_PDF_MAX_BYTES ||
    !sourceBytes.slice(0, 1024).some(function (byte, index, bytes) {
      return String.fromCharCode(byte) === "%" &&
        String.fromCharCode(bytes[index + 1] || 0) === "P" &&
        String.fromCharCode(bytes[index + 2] || 0) === "D" &&
        String.fromCharCode(bytes[index + 3] || 0) === "F" &&
        String.fromCharCode(bytes[index + 4] || 0) === "-";
    })
  )
    return reviewerPdfFailure_(
      data,
      startedAt,
      "INVALID_PDF",
      "The source PDF is invalid or too large.",
    );
  var correlationId = String(data.eventId || "").trim();
  var processed;
  try {
    var watermarkIdentity = reviewerPdfWatermarkIdentity_(
      authorization.account,
      authorization.email,
    );
    processed = watermarkReviewerPdfBytes_(
      sourceBytes,
      watermarkIdentity,
    );
    processed = await processed;
    var verification = await verifyReviewerPdfWatermarks_(
      processed.bytes,
      watermarkIdentity,
    );
    if (
      verification.pageCount !== processed.pageCount ||
      verification.pagesWithWatermarks !== processed.pageCount
    )
      throw reviewerPdfError_(
        "The watermark could not be verified on every page.",
        "WATERMARK_VERIFICATION_FAILED",
      );
  } catch (error) {
    Logger.log(JSON.stringify({
      event: "reviewer_pdf_watermark_failed",
      correlationId: correlationId,
      reasonCode: String(error && error.code || "PDF_PROCESSING_FAILED"),
      errorName: String(error && error.name || "Error"),
      durationMs: Date.now() - startedAt,
    }));
    return errorResponse(
      "This PDF could not be safely watermarked for portal viewing.",
      String(error && error.code || "PDF_PROCESSING_FAILED"),
    );
  }
  if (
    !processed ||
    !Array.isArray(processed.bytes) ||
    processed.bytes.length > MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES
  )
    return reviewerPdfFailure_(
      data,
      startedAt,
      "PDF_PROCESSING_FAILED",
      "The watermarked PDF exceeds the safe delivery limit.",
    );
  var outputBytes = processed.bytes;
  if (
    !outputBytes.length ||
    outputBytes.length > MRH_REVIEWER_PDF_MAX_OUTPUT_BYTES ||
    !outputBytes.slice(0, 1024).some(function (byte, index, bytes) {
      return String.fromCharCode(byte) === "%" &&
        String.fromCharCode(bytes[index + 1] || 0) === "P" &&
        String.fromCharCode(bytes[index + 2] || 0) === "D" &&
        String.fromCharCode(bytes[index + 3] || 0) === "F" &&
        String.fromCharCode(bytes[index + 4] || 0) === "-";
    })
  )
    return reviewerPdfFailure_(
      data,
      startedAt,
      "PDF_PROCESSING_FAILED",
      "The watermark service returned an invalid PDF.",
    );
  var sourceAfterProcessing = getReviewerPdfSource_(fileId);
  if (
    sourceAfterProcessing.error ||
    sourceAfterProcessing.sourceVersion !== source.sourceVersion
  )
    return reviewerPdfFailure_(
      data,
      startedAt,
      "PDF_SOURCE_CHANGED",
      "The PDF source changed during processing.",
    );
  appendMRHAccessLog_(
    "REVIEWERS",
    authorization.account,
    correlationId,
    {
      event: "PROTECTED_PDF_VIEW",
      category: "REVIEWERS",
      resource: entry.title + " | " + fileId,
    },
  );
  Logger.log(JSON.stringify({
    event: "reviewer_pdf_delivered",
    correlationId: correlationId,
    durationMs: Date.now() - startedAt,
    outputBytes: outputBytes.length,
    pages: processed.pageCount,
  }));
  return jsonResponse({
    status: "success",
    mimeType: "application/pdf",
    sourceVersion: source.sourceVersion,
    data: Utilities.base64Encode(outputBytes),
  });
}

function auditReviewerPdfDrivePermissions() {
  var entries = getReviewerPdfIndexEntries_();
  var files = Object.create(null);
  entries.forEach(function (entry) {
    var hierarchy = getReviewerPdfDriveHierarchy_(entry.fileId);
    hierarchy.path.forEach(function (item, itemIndex) {
      if (!files[item.id]) {
        files[item.id] = {
          id: item.id,
          name: item.name,
          mimeType: item.mimeType,
          insideRoot: hierarchy.insideRoot,
          reviewerTitles: [],
          ancestorIds: [],
        };
      }
      if (
        item.id === entry.fileId &&
        files[item.id].reviewerTitles.indexOf(entry.title) < 0
      )
        files[item.id].reviewerTitles.push(entry.title);
      if (!hierarchy.insideRoot) files[item.id].insideRoot = false;
      files[item.id].ancestorIds = hierarchy.path
        .slice(itemIndex + 1)
        .map(function (resource) { return resource.id; });
    });
  });
  var reportFiles = Object.keys(files).map(function (fileId) {
    var file = files[fileId];
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      insideRoot: file.insideRoot,
      reviewerTitles: file.reviewerTitles,
      _ancestorIds: file.ancestorIds,
      permissions: listReviewerPdfPermissions_(fileId).map(function (permission) {
        var details = permission.permissionDetails || [];
        return {
          id: String(permission.id || ""),
          type: String(permission.type || ""),
          role: String(permission.role || ""),
          emailAddress: String(permission.emailAddress || ""),
          domain: String(permission.domain || ""),
          deleted: permission.deleted === true,
          inherited: details.some(function (detail) {
            return detail.inherited === true;
          }),
          inheritedFrom: details.map(function (detail) {
            return String(detail.inheritedFrom || "");
          }).filter(Boolean),
          permissionDetails: details,
        };
      }),
    };
  });
  var permissionIndexes = Object.create(null);
  reportFiles.forEach(function (file) {
    permissionIndexes[file.id] = Object.create(null);
    file.permissions.forEach(function (permission) {
      permissionIndexes[file.id][permission.id] = permission;
    });
  });
  reportFiles.forEach(function (file) {
    file.permissions.forEach(function (permission) {
      if (permission.inherited) return;
      var inheritedFrom = file._ancestorIds.filter(function (ancestorId) {
        return Boolean(
          permissionIndexes[ancestorId] &&
          permissionIndexes[ancestorId][permission.id],
        );
      });
      if (inheritedFrom.length) {
        permission.inherited = true;
        permission.inheritedFrom = inheritedFrom;
      }
    });
    delete file._ancestorIds;
  });
  var report = {
    scope: "Reviewer PDFs and their ancestor folders only",
    protectedRootId: ROOT_FOLDER_ID,
    preservePrincipalsConfigured: Boolean(
      PropertiesService.getScriptProperties().getProperty(
        MRH_REVIEWER_ACL_PRESERVE_PRINCIPALS_PROPERTY,
      ),
    ),
    files: reportFiles,
  };
  Logger.log(JSON.stringify({
    event: "reviewer_pdf_acl_dry_run",
    protectedRootId: ROOT_FOLDER_ID,
    fileCount: reportFiles.length,
  }));
  reportFiles.forEach(function (file) {
    Logger.log("REVIEWER_PDF_ACL_REPORT " + JSON.stringify(file));
  });
  return report;
}

function applyReviewedReviewerPdfPermissionRevocations(
  reviewedPermissions,
  confirmation,
  dryRun,
) {
  var isDryRun = dryRun !== false;
  if (
    !isDryRun &&
    confirmation !== "REVOKE THE REVIEWED REVIEWER PDF SHARES"
  )
    throw new Error("Explicit ACL revocation confirmation is required.");
  if (!Array.isArray(reviewedPermissions) || !reviewedPermissions.length)
    throw new Error("Provide the exact reviewed file and permission IDs.");
  var preserveSetting = String(
    PropertiesService.getScriptProperties().getProperty(
      MRH_REVIEWER_ACL_PRESERVE_PRINCIPALS_PROPERTY,
    ) || "",
  );
  var preserve = preserveSetting.split(/[,\s;]+/).filter(Boolean).map(function (email) {
    return email.toLowerCase();
  });
  var effectiveEmail = String(
    Session.getEffectiveUser().getEmail() || "",
  ).toLowerCase();
  if (!preserveSetting || !effectiveEmail || preserve.indexOf(effectiveEmail) < 0)
    throw new Error(
      "Configure the ACL preserve-principals property, including the Apps Script execution identity, before revocation.",
    );
  var report = auditReviewerPdfDrivePermissions();
  var permissionsByKey = Object.create(null);
  report.files.forEach(function (file) {
    file.permissions.forEach(function (permission) {
      permissionsByKey[file.id + ":" + permission.id] = {
        file: file,
        permission: permission,
      };
    });
  });
  var pendingRevocations = [];
  var seenRevocations = Object.create(null);
  reviewedPermissions.forEach(function (reviewed) {
    var fileId = String(reviewed && reviewed.fileId || "");
    var permissionId = String(reviewed && reviewed.permissionId || "");
    var key = fileId + ":" + permissionId;
    if (seenRevocations[key])
      throw new Error("A permission was listed for revocation more than once.");
    seenRevocations[key] = true;
    var record = permissionsByKey[fileId + ":" + permissionId];
    if (!record)
      throw new Error("A reviewed permission no longer exists in the audit.");
    if (record.permission.deleted)
      throw new Error("A deleted permission cannot be revoked again.");
    if (record.permission.inherited)
      throw new Error(
        "Inherited access must be reviewed and changed at its source folder.",
      );
    if (record.permission.role === "owner")
      throw new Error("Owner permissions cannot be revoked by this workflow.");
    if (
      record.permission.emailAddress &&
      preserve.indexOf(record.permission.emailAddress.toLowerCase()) >= 0
    )
      throw new Error("A configured protected principal cannot be revoked.");
    if (!record.file.insideRoot)
      throw new Error(
        "A permission outside the protected root cannot be changed by this workflow.",
      );
    if (
      record.file.mimeType !== "application/pdf" ||
      !record.file.reviewerTitles.length
    )
      throw new Error(
        "Ancestor-folder permissions are report-only so Modules and Syllabus access is not changed.",
      );
    pendingRevocations.push({
      fileId: fileId,
      permissionId: permissionId,
    });
  });
  if (isDryRun) {
    Logger.log(JSON.stringify({
      event: "reviewer_pdf_acl_revocation",
      action: "DRY_RUN",
      plannedCount: pendingRevocations.length,
    }));
    return {
      dryRun: true,
      planned: pendingRevocations,
      revoked: [],
      audit: report,
    };
  }
  var revoked = [];
  pendingRevocations.forEach(function (reviewed) {
    var record = permissionsByKey[
      reviewed.fileId + ":" + reviewed.permissionId
    ];
    try {
      Drive.Permissions.delete(reviewed.fileId, reviewed.permissionId, {
        supportsAllDrives: true,
      });
    } catch (error) {
      Logger.log(JSON.stringify({
        event: "reviewer_pdf_acl_revocation",
        fileId: reviewed.fileId,
        permissionId: reviewed.permissionId,
        permissionType: record.permission.type,
        role: record.permission.role,
        action: "DELETE",
        result: "FAILED",
        errorName: String(error && error.name || "Error"),
      }));
      throw error;
    }
    Logger.log(JSON.stringify({
      event: "reviewer_pdf_acl_revocation",
      fileId: reviewed.fileId,
      permissionId: reviewed.permissionId,
      permissionType: record.permission.type,
      role: record.permission.role,
      action: "DELETE",
      result: "SUCCESS",
    }));
    revoked.push(reviewed);
  });
  return {
    dryRun: false,
    revoked: revoked,
    audit: auditReviewerPdfDrivePermissions(),
  };
}

function handleLogModuleAccessRequest(data) {
  var authorization = authorizeReviewerRequest_(data);
  if (authorization.error) return authorization.error;
  appendMRHAccessLog_(
    MRH_MODULE_LOG_SHEET_NAME,
    authorization.account,
    data.eventId,
    "ACCESS",
  );
  return jsonResponse({ status: "success" });
}

function handleLogResourceFileClickRequest(data) {
  var area = String(data && data.resourceArea || "")
    .trim()
    .toUpperCase();
  var logSheetByArea = {
    SYLLABUS: "SYLLABUS",
    MODULES: MRH_MODULE_LOG_SHEET_NAME,
    REVIEWERS: "REVIEWERS",
  };
  if (!logSheetByArea[area])
    return errorResponse("Invalid resource category.", "BAD_REQUEST");

  var fileId = String(data && data.fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    return errorResponse("A valid resource file ID is required.", "BAD_REQUEST");
  var fileName = cleanText(data && data.fileName, 200)
    .replace(/[\r\n\t|]/g, " ")
    .trim();
  if (!fileName)
    return errorResponse("A resource file name is required.", "BAD_REQUEST");

  var token = String(data && data.idToken || "").trim();
  var sessionId = String(data && data.sessionId || "").trim();
  var account = null;
  if (area === "REVIEWERS" || token || sessionId) {
    var authorization = authorizeReviewerRequest_(data);
    if (authorization.error) return authorization.error;
    account = authorization.account;
  }

  appendMRHAccessLog_(
    logSheetByArea[area],
    account,
    data.eventId,
    {
      event: "FILE_CLICK",
      course: cleanText(data && data.course, 160),
      year: cleanText(data && data.year, 40),
      semester: cleanText(data && data.semester, 40),
      category: cleanText(data && data.category, 40) || area,
      resource: fileName,
    },
  );
  return jsonResponse({ status: "success" });
}

function handleLogResourceDashboardActionRequest(data) {
  var area = String(data && data.resourceArea || "")
    .trim()
    .toUpperCase();
  var logSheetByArea = {
    SYLLABUS: "SYLLABUS",
    MODULES: MRH_MODULE_LOG_SHEET_NAME,
    REVIEWERS: "REVIEWERS",
  };
  if (!logSheetByArea[area])
    return errorResponse("Invalid resource category.", "BAD_REQUEST");
  var action = String(data && data.action || "")
    .trim()
    .toUpperCase();
  if (
    ["TAB_OPEN", "FILTER_YEAR", "FILTER_SEMESTER", "FILTER_CATEGORY"]
      .indexOf(action) < 0
  )
    return errorResponse("Invalid resource action.", "BAD_REQUEST");
  var detail = cleanText(data && data.detail, 32)
    .replace(/[\r\n\t|:]/g, " ")
    .trim();
  if (action !== "TAB_OPEN" && !detail)
    return errorResponse("A filter value is required.", "BAD_REQUEST");

  var token = String(data && data.idToken || "").trim();
  var sessionId = String(data && data.sessionId || "").trim();
  var account = null;
  if (area === "REVIEWERS" || token || sessionId) {
    var authorization = authorizeReviewerRequest_(data);
    if (authorization.error) return authorization.error;
    account = authorization.account;
  }
  appendMRHAccessLog_(
    logSheetByArea[area],
    account,
    data.eventId,
    {
      event: action,
      course: cleanText(data && data.course, 160),
      year:
        action === "FILTER_YEAR"
          ? detail
          : cleanText(data && data.year, 40),
      semester:
        action === "FILTER_SEMESTER"
          ? detail
          : cleanText(data && data.semester, 40),
      category:
        action === "FILTER_CATEGORY"
          ? detail
          : cleanText(data && data.category, 40) || area,
    },
  );
  return jsonResponse({ status: "success" });
}

function isPrivateResourceFolderName(name) {
  return RESOURCE_PORTAL_PRIVATE_FOLDER_PATTERN.test(String(name || ""));
}

function getResourceFolderBreadcrumbs(folder) {
  var breadcrumbs = [];
  var visited = Object.create(null);
  var current = folder;

  for (var depth = 0; depth < 100; depth++) {
    var currentId = current.getId();
    if (visited[currentId]) return null;
    visited[currentId] = true;

    var currentName = current.getName();
    if (isPrivateResourceFolderName(currentName)) return null;
    breadcrumbs.unshift({ id: currentId, name: currentName });

    if (currentId === RESOURCE_PORTAL_ROOT_FOLDER_ID) return breadcrumbs;

    var parents = current.getParents();
    if (!parents.hasNext()) return null;
    current = parents.next();
  }

  return null;
}

function getResourceListingCacheKey(folderId) {
  return "mrh_resource_listing_v1_" + sha256Hex(String(folderId || ""));
}

function handleListPublicResourcesRequest(data) {
  var requestedFolderId = cleanText(data.folderId, 200);
  var folderId = requestedFolderId || RESOURCE_PORTAL_ROOT_FOLDER_ID;
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(folderId))
    return errorResponse("Invalid folder ID.", "BAD_REQUEST");
  var folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (error) {
    return errorResponse("This folder is unavailable.", "NOT_FOUND");
  }

  var breadcrumbs = getResourceFolderBreadcrumbs(folder);
  if (!breadcrumbs)
    return errorResponse("This folder is not available.", "FORBIDDEN");

  var cacheKey = getResourceListingCacheKey(folderId);
  var cache;
  var cachedListing = null;
  try {
    cache = CacheService.getScriptCache();
    var cachedValue = cache.get(cacheKey);
    if (cachedValue) {
      var parsedListing = JSON.parse(cachedValue);
      if (
        parsedListing &&
        parsedListing.status === "success" &&
        parsedListing.folder &&
        parsedListing.folder.id === folderId &&
        Array.isArray(parsedListing.items) &&
        typeof parsedListing.truncated === "boolean"
      ) {
        cachedListing = parsedListing;
      } else {
        cache.remove(cacheKey);
        Logger.log(
          "[handleListPublicResourcesRequest] Removed malformed listing cache entry.",
        );
      }
    }
  } catch (cacheError) {
    Logger.log(
      "[handleListPublicResourcesRequest] Listing cache read failed: " +
        cacheError,
    );
  }

  if (cachedListing) {
    cachedListing.folder = breadcrumbs[breadcrumbs.length - 1];
    cachedListing.breadcrumbs = breadcrumbs;
    return jsonResponse(cachedListing);
  }

  var items = [];
  var truncated = false;
  var pageToken = "";
  var pageCount = 0;
  do {
    var driveResponse = Drive.Files.list({
      q: "'" + folderId + "' in parents and trashed = false",
      pageSize: RESOURCE_PORTAL_MAX_ITEMS,
      pageToken: pageToken || undefined,
      fields: "nextPageToken,files(id,name,mimeType,modifiedTime)",
      corpora: "user",
    });
    if (!driveResponse || !Array.isArray(driveResponse.files))
      throw new Error("Drive returned an invalid resource listing.");

    for (var i = 0; i < driveResponse.files.length; i++) {
      var driveItem = driveResponse.files[i];
      var mimeType = String(driveItem.mimeType || "");
      if (mimeType === "application/vnd.google-apps.shortcut") continue;
      var isFolder = mimeType === "application/vnd.google-apps.folder";
      var itemName = String(driveItem.name || "");
      if (isFolder && isPrivateResourceFolderName(itemName)) continue;
      if (items.length >= RESOURCE_PORTAL_MAX_ITEMS) {
        truncated = true;
        break;
      }

      var item = {
        id: String(driveItem.id || ""),
        name: itemName,
        type: isFolder ? "folder" : "file",
        mimeType: mimeType,
      };
      if (!isFolder && driveItem.modifiedTime)
        item.modifiedTime = String(driveItem.modifiedTime);
      items.push(item);
    }

    pageToken = String(driveResponse.nextPageToken || "");
    pageCount += 1;
    if (truncated) break;
    if (pageToken && items.length >= RESOURCE_PORTAL_MAX_ITEMS) {
      truncated = true;
      break;
    }
    if (
      pageToken &&
      pageCount >= RESOURCE_PORTAL_MAX_LIST_PAGES
    ) {
      truncated = true;
      break;
    }
  } while (pageToken);

  items.sort(function (left, right) {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return TextUtils.naturalSortStrings(left.name, right.name);
  });

  var listing = {
    status: "success",
    folder: breadcrumbs[breadcrumbs.length - 1],
    breadcrumbs: breadcrumbs,
    items: items,
    truncated: truncated,
  };
  var responseText = JSON.stringify(listing);
  if (responseText.length <= RESOURCE_PORTAL_MAX_CACHED_LISTING_CHARS) {
    try {
      if (!cache) cache = CacheService.getScriptCache();
      cache.put(
        cacheKey,
        responseText,
        RESOURCE_PORTAL_LISTING_CACHE_TTL_SECONDS,
      );
    } catch (cacheError) {
      Logger.log(
        "[handleListPublicResourcesRequest] Listing cache write failed: " +
          cacheError,
      );
    }
  }
  return ContentService.createTextOutput(responseText).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function getResourceFileBreadcrumbs(file) {
  var parents = file.getParents();
  if (!parents.hasNext()) return null;

  var breadcrumbs = null;
  while (parents.hasNext()) {
    var parentBreadcrumbs = getResourceFolderBreadcrumbs(parents.next());
    if (!parentBreadcrumbs) return null;
    if (!breadcrumbs) breadcrumbs = parentBreadcrumbs;
  }
  return breadcrumbs;
}

function handleGetResourcePreviewRequest(data) {
  var fileId = cleanText(data.fileId, 200);
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId))
    return errorResponse("Invalid file ID.", "BAD_REQUEST");

  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (error) {
    return errorResponse("This file is unavailable.", "NOT_FOUND");
  }
  if (!getResourceFileBreadcrumbs(file))
    return errorResponse("This file is not available.", "FORBIDDEN");

  var mimeType = file.getMimeType();
  var blob;
  var isGoogleWorkspaceFile =
    [
      "application/vnd.google-apps.document",
      "application/vnd.google-apps.spreadsheet",
      "application/vnd.google-apps.presentation",
    ].indexOf(mimeType) !== -1;
  if (!isGoogleWorkspaceFile && file.getSize() > RESOURCE_PORTAL_MAX_PREVIEW_BYTES)
    return errorResponse(
      "This file is larger than the 5 MB in-site preview limit.",
      "FILE_TOO_LARGE",
    );

  if (isGoogleWorkspaceFile) {
    blob = file.getAs("application/pdf");
    mimeType = "application/pdf";
  } else {
    blob = file.getBlob();
  }

  var bytes = blob.getBytes();
  if (bytes.length > RESOURCE_PORTAL_MAX_PREVIEW_BYTES)
    return errorResponse(
      "This file is larger than the 5 MB in-site preview limit.",
      "FILE_TOO_LARGE",
    );

  var preview = {
    status: "success",
    name: file.getName(),
    mimeType: mimeType,
    data: Utilities.base64Encode(bytes),
  };
  return jsonResponse(preview);
}

function isSupportedClientVersion(value) {
  var match = String(value || "")
    .trim()
    .match(
      /^mrh-(?:release-)?(\d+)\.(\d+)\.(\d+)(?:-(\d+))?(?:-[a-f0-9]{7,40})?$/i,
    );
  if (!match) return false;

  var clientParts = [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4] || 0),
  ];
  var minimumParts = MINIMUM_SUPPORTED_CLIENT_VERSION.split(/[.-]/).map(Number);
  for (var i = 0; i < minimumParts.length; i++) {
    if (clientParts[i] > minimumParts[i]) return true;
    if (clientParts[i] < minimumParts[i]) return false;
  }
  return true;
}

function clientVersionRequired(version) {
  return isSupportedClientVersion(version)
    ? null
    : errorResponse(
        "This app version is no longer supported. Reload the current website to continue.",
        "CLIENT_UPDATE_REQUIRED",
      );
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).trim().substring(0, maxLength);
}

function normalizeReviewerIdentityText_(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function reviewerEmailMatchesName_(email, firstName, middleInitial, lastName) {
  var localPart = normalizeReviewerIdentityText_(
    String(email || "").split("@")[0],
  );
  var nameParts = [firstName, middleInitial, lastName]
    .map(normalizeReviewerIdentityText_)
    .filter(function (part) {
      return part.length >= 3;
    });
  if (
    nameParts.some(function (part) {
      return localPart.indexOf(part) !== -1;
    })
  )
    return true;
  var initials = [firstName, middleInitial, lastName]
    .map(normalizeReviewerIdentityText_)
    .filter(Boolean)
    .map(function (part) {
      return part.charAt(0);
    })
    .join("");
  return initials.length >= 2 && localPart.indexOf(initials) !== -1;
}

function sheetCellText(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function safeCellText(value, maxLength) {
  var text = cleanText(value, maxLength);
  if (/^[=+\-@]/.test(text)) return "'" + text;
  return text;
}

function toBoolean(value, fallback) {
  if (value === null || value === undefined) return !!fallback;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    var normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].indexOf(normalized) !== -1) return true;
    if (["false", "0", "no", "n", "off", ""].indexOf(normalized) !== -1)
      return false;
  }
  return !!fallback;
}

function normalizeSubjectFromPath(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .map(function (part) {
      return String(part || "").trim();
    })
    .filter(function (part) {
      return Boolean(part);
    })
    .join("::");
}

function normalizeSubject(subject) {
  return normalizeSubjectFromPath(String(subject || "").split("::"));
}

function buildSpreadsheetSubject(
  pathPrefix,
  fileName,
  sheetName,
  isSingleSheet,
) {
  var prefix = normalizeSubject(pathPrefix);
  var file = String(fileName == null ? "" : fileName).trim();
  var sheet = String(sheetName == null ? "" : sheetName).trim();

  if (!file) return prefix;
  if (!prefix) return isSingleSheet || !sheet ? file : file + "::" + sheet;

  if (isSingleSheet) {
    var parts = prefix.split("::");
    var parentFolderName = String(parts[parts.length - 1] || "").trim();
    if (
      parentFolderName &&
      parentFolderName.toLowerCase() === file.toLowerCase()
    ) {
      return prefix;
    }
    return prefix + "::" + file;
  }

  if (!sheet) return prefix + "::" + file;
  return prefix + "::" + file + "::" + sheet;
}

function compareSubjectHierarchy(left, right) {
  var leftParts = String(left || "")
    .split("::")
    .filter(Boolean);
  var rightParts = String(right || "")
    .split("::")
    .filter(Boolean);
  if (leftParts.length !== rightParts.length)
    return leftParts.length - rightParts.length;
  return TextUtils.naturalSortStrings(left, right);
}

function invalidateMetadataCache() {
  deckMetadataCache = null;
  deckMetadataCacheTime = 0;
}

function getScriptProps() {
  return PropertiesService.getScriptProperties();
}

function sha256Hex(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value || ""),
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (b) {
      var v = b < 0 ? b + 256 : b;
      return (v < 16 ? "0" : "") + v.toString(16);
    })
    .join("");
}

function hashPasswordWithSalt(password, salt, iterations) {
  var normalized = String(password == null ? "" : password);
  var effectiveSalt = String(salt || Utilities.getUuid());
  var rounds = Number(iterations || PASSWORD_KDF_ITERATIONS);
  if (!Number.isFinite(rounds) || rounds < 500)
    rounds = PASSWORD_KDF_ITERATIONS;
  if (rounds > 50000) rounds = 50000;

  var hash = sha256Hex(effectiveSalt + ":" + normalized);
  for (var i = 1; i < rounds; i++) hash = sha256Hex(effectiveSalt + ":" + hash);

  return "sha256i$" + rounds + "$" + effectiveSalt + "$" + hash;
}

function isLegacyPasswordHash(value) {
  return /^sha256\$[^\$]+\$[a-f0-9]{64}$/i.test(String(value || ""));
}

function isIteratedPasswordHash(value) {
  return /^sha256i\$\d+\$[^\$]+\$[a-f0-9]{64}$/i.test(String(value || ""));
}

function normalizeStoredPassword(value) {
  var raw = String(value == null ? "" : value);
  var trimmed = raw.trim();
  if (!trimmed) return "";
  if (isLegacyPasswordHash(trimmed) || isIteratedPasswordHash(trimmed))
    return trimmed;
  return raw;
}

function passwordMatches(providedPassword, storedValue) {
  var provided = String(providedPassword == null ? "" : providedPassword);
  var stored = normalizeStoredPassword(storedValue);
  if (!stored) return true;

  if (isIteratedPasswordHash(stored)) {
    var ip = stored.split("$");
    var rounds = Number(ip[1]);
    if (!Number.isFinite(rounds) || rounds < 500 || rounds > 50000)
      return false;
    return constantTimeEqual(
      hashPasswordWithSalt(provided, ip[2], rounds),
      stored,
    );
  }

  if (isLegacyPasswordHash(stored)) {
    var lp = stored.split("$");
    return constantTimeEqual(
      "sha256$" + lp[1] + "$" + sha256Hex(lp[1] + ":" + provided),
      stored,
    );
  }

  return constantTimeEqual(provided, stored);
}

function constantTimeEqual(left, right) {
  left = String(left || "");
  right = String(right || "");
  var length = Math.max(left.length, right.length);
  var result = left.length ^ right.length;
  for (var i = 0; i < length; i++) {
    var a = i < left.length ? left.charCodeAt(i) : 0;
    var b = i < right.length ? right.charCodeAt(i) : 0;
    result |= a ^ b;
  }
  return result === 0;
}

/* -------------------------------------------------------------------------- */
/* Cache versioning / chunked CacheService                                    */
/* -------------------------------------------------------------------------- */

function getCacheInvalidationVersion() {
  var version =
    getScriptProps().getProperty("MRH_CACHE_VERSION") ||
    getScriptProps().getProperty("CACHE_VER") ||
    "0";
  return String(version);
}

function setCacheVersionProperties(versionValue) {
  var value = String(versionValue || Date.now());
  var props = getScriptProps();
  props.setProperty("MRH_CACHE_VERSION", value);
  props.setProperty("CACHE_VER", value);
  props.setProperty("MRH_CACHE_VERSION_TIMESTAMP", new Date().toISOString());
  return value;
}

function getLastModificationTimestamp() {
  return getScriptProps().getProperty("LAST_MODIFICATION_TIMESTAMP") || "";
}

function generateCacheKey(input) {
  var version = getCacheInvalidationVersion();
  return "mrh_" + sha256Hex(String(input || "") + "::v" + version);
}

function buildDeckCacheKey(subject, accessMode) {
  var normalized = normalizeSubject(subject);
  var mode = String(accessMode || "authorized").trim() || "authorized";
  var version = getCacheInvalidationVersion();
  return "mrh_deck_" + sha256Hex(normalized + "::" + mode + "::v5::" + version);
}

function cachePutChunked(baseKey, content) {
  var cache = CacheService.getScriptCache();
  var text = String(content || "");
  var chunkCount = Math.max(1, Math.ceil(text.length / CACHE_CHUNK_SIZE));
  // The count key also consumes one of CacheService's 1,000 entries.
  if (chunkCount >= 1000) {
    Logger.log(
      "[cachePutChunked] Skipping oversized cache payload (" +
        chunkCount +
        " chunks).",
    );
    return false;
  }

  var values = Object.create(null);
  values[baseKey + "_count"] = String(chunkCount);
  for (var i = 0; i < chunkCount; i++) {
    values[baseKey + "_" + i] = text.substring(
      i * CACHE_CHUNK_SIZE,
      (i + 1) * CACHE_CHUNK_SIZE,
    );
  }
  cache.putAll(values, CACHE_TTL_SECONDS);
  return true;
}

function cacheGetChunked(baseKey) {
  var cache = CacheService.getScriptCache();
  var countValue = cache.get(baseKey + "_count");
  if (!countValue) return null;
  var count = parseInt(countValue, 10);
  if (!Number.isFinite(count) || count < 1 || count > 1000) return null;

  var keys = [];
  for (var i = 0; i < count; i++) keys.push(baseKey + "_" + i);
  var chunks = cache.getAll(keys);
  var result = "";
  for (var j = 0; j < count; j++) {
    var chunk = chunks[keys[j]];
    if (chunk === undefined || chunk === null) return null;
    result += chunk;
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Rate limiting / authorization                                              */
/* -------------------------------------------------------------------------- */

function incrementRateLimit(key, limit, windowSeconds) {
  var lock = LockService.getUserLock();
  if (!lock.tryLock(5000)) return false;
  try {
    var cache = CacheService.getScriptCache();
    var current = Number(cache.get(key) || 0);
    if (!Number.isFinite(current)) current = 0;
    if (current >= limit) return false;
    cache.put(key, String(current + 1), windowSeconds);
    return true;
  } finally {
    lock.releaseLock();
  }
}

/* -------------------------------------------------------------------------- */
/* UUID / access metadata                                                     */
/* -------------------------------------------------------------------------- */

function getOrInitializeUUIDSheet() {
  var ss = SpreadsheetApp.openById(UUID_SHEET_ID);
  var sheet = ss.getSheetByName("UUID") || ss.insertSheet("UUID");
  var header = [
    "UUID",
    "Subject",
    "Hidden",
    "Password",
    "CreatedAt",
    "SourceType",
    "SourceId",
  ];

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, UUID_SHEET_COLUMN_COUNT).setValues([header]);
  } else {
    var existingHeader = sheet
      .getRange(1, 1, 1, UUID_SHEET_COLUMN_COUNT)
      .getValues()[0];
    var headerMismatch = false;
    for (var h = 0; h < header.length; h++) {
      if (String(existingHeader[h] || "") !== header[h]) {
        headerMismatch = true;
        break;
      }
    }
    if (sheet.getLastColumn() < UUID_SHEET_COLUMN_COUNT || headerMismatch) {
      sheet.getRange(1, 1, 1, UUID_SHEET_COLUMN_COUNT).setValues([header]);
    }
  }

  return sheet;
}

function generateDeckUUID() {
  return Utilities.getUuid().toUpperCase();
}

function readUUIDRecords() {
  var sheet = getOrInitializeUUIDSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return [];

  var rows = sheet
    .getRange(2, 1, lastRow - 1, UUID_SHEET_COLUMN_COUNT)
    .getValues();
  var bySubject = Object.create(null);
  var byUUID = Object.create(null);

  for (var i = 0; i < rows.length; i++) {
    var uuid = String(rows[i][0] || "").trim();
    var subject = normalizeSubject(rows[i][1]);
    if (!subject) continue;

    if (!uuid) uuid = "M-" + sha256Hex(subject).substring(0, 32).toUpperCase();
    if (bySubject[subject]) continue;
    if (byUUID[uuid]) {
      var correctedUuid =
        "M-" + sha256Hex(subject + "::collision").substring(0, 30).toUpperCase();
      if (byUUID[correctedUuid]) correctedUuid = generateDeckUUID();
      Logger.log(
        "[readUUIDRecords] UUID collision detected for subject '" +
          subject +
          "'; deterministic replacement assigned.",
      );
      uuid = correctedUuid;
    }

    byUUID[uuid] = true;
    bySubject[subject] = {
      uuid: uuid,
      subject: subject,
      hidden: toBoolean(rows[i][2], false),
      password: normalizeStoredPassword(rows[i][3]),
      createdAt: rows[i][4] || new Date().toISOString(),
      sourceType: String(rows[i][5] || "")
        .trim()
        .toLowerCase(),
      sourceId: String(rows[i][6] || "").trim(),
    };
  }

  return Object.keys(bySubject).map(function (subject) {
    return bySubject[subject];
  });
}

/**
 * Atomic write: Overwrites existing rows first, then clears only the excess trailing rows.
 * Prevents reading an empty sheet if another thread executes between clear and write.
 */
function writeUUIDRecords(records) {
  var sheet = getOrInitializeUUIDSheet();
  var clean = [];
  var subjects = Object.create(null);
  var uuids = Object.create(null);

  for (var i = 0; i < records.length; i++) {
    var r = records[i] || {};
    var subject = normalizeSubject(r.subject);
    if (!subject || subjects[subject]) continue;

    var uuid = String(r.uuid || "").trim() || generateDeckUUID();
    if (uuids[uuid]) uuid = generateDeckUUID();

    subjects[subject] = true;
    uuids[uuid] = true;

    clean.push({
      uuid: uuid,
      subject: subject,
      hidden: !!r.hidden,
      password: normalizeStoredPassword(r.password),
      createdAt: r.createdAt || new Date().toISOString(),
      sourceType: String(r.sourceType || "")
        .trim()
        .toLowerCase(),
      sourceId: String(r.sourceId || "").trim(),
    });
  }

  clean.sort(function (a, b) {
    return TextUtils.naturalSortStrings(a.subject, b.subject);
  });

  var values = [
    [
      "UUID",
      "Subject",
      "Hidden",
      "Password",
      "CreatedAt",
      "SourceType",
      "SourceId",
    ],
  ];
  for (var j = 0; j < clean.length; j++) {
    values.push([
      safeCellText(clean[j].uuid, 100),
      safeCellText(clean[j].subject, 500),
      clean[j].hidden ? "true" : "",
      clean[j].password,
      clean[j].createdAt,
      safeCellText(clean[j].sourceType, 30),
      safeCellText(clean[j].sourceId, 200),
    ]);
  }

  var currentLastRow = sheet.getLastRow();
  sheet.getRange("D:D").setNumberFormat("@");
  // 1. Write content directly over existing cells
  sheet
    .getRange(1, 1, values.length, UUID_SHEET_COLUMN_COUNT)
    .setValues(values);

  // 2. Clear only remaining obsolete rows below
  if (currentLastRow > values.length) {
    sheet
      .getRange(
        values.length + 1,
        1,
        currentLastRow - values.length,
        UUID_SHEET_COLUMN_COUNT,
      )
      .clearContent();
  }

  sheet.getRange("A:A").setNumberFormat("@");
  sheet.getRange("C:C").setNumberFormat("@");
  sheet.getRange("F:G").setNumberFormat("@");
  return clean;
}

function normalizeUUIDSheetParentSubjects() {
  var base = readUUIDRecords();
  var bySubject = Object.create(null);

  for (var i = 0; i < base.length; i++) bySubject[base[i].subject] = base[i];

  var originals = base.slice();
  for (var j = 0; j < originals.length; j++) {
    var parts = originals[j].subject.split("::");
    var current = "";
    for (var p = 0; p < parts.length - 1; p++) {
      current = current ? current + "::" + parts[p] : parts[p];
      if (!bySubject[current]) {
        bySubject[current] = {
          uuid: generateDeckUUID(),
          subject: current,
          hidden: false,
          password: "",
          createdAt: new Date().toISOString(),
          sourceType: "container",
          sourceId: "",
        };
      }
    }
  }

  return writeUUIDRecords(
    Object.keys(bySubject).map(function (key) {
      return bySubject[key];
    }),
  );
}

function loadDeckMetadataMap(forceRefresh) {
  var now = Date.now();
  if (
    !forceRefresh &&
    deckMetadataCache &&
    now - deckMetadataCacheTime < METADATA_CACHE_TTL_MS
  )
    return deckMetadataCache;

  var records = readUUIDRecords();
  var map = Object.create(null);
  for (var i = 0; i < records.length; i++) map[records[i].subject] = records[i];
  deckMetadataCache = map;
  deckMetadataCacheTime = now;
  return map;
}

function getDeckMetadata(subject) {
  var normalized = normalizeSubject(subject);
  if (!normalized) return null;
  return loadDeckMetadataMap()[normalized] || null;
}

function getEffectivePassword(subject, metadataMap) {
  var normalized = normalizeSubject(subject);
  if (!normalized) return "";

  var map = metadataMap || loadDeckMetadataMap();
  var parts = normalized.split("::");
  var current = "";
  var inherited = "";

  for (var i = 0; i < parts.length; i++) {
    current = current ? current + "::" + parts[i] : parts[i];
    var record = map[current];
    if (record && String(record.password || "").trim())
      inherited = String(record.password || "").trim();
  }
  return inherited;
}

function isSubjectHiddenByHierarchy(subject, metadataMap) {
  var normalized = normalizeSubject(subject);
  if (!normalized) return false;

  var parts = normalized.split("::");
  var current = "";
  for (var i = 0; i < parts.length; i++) {
    current = current ? current + "::" + parts[i] : parts[i];
    var record = metadataMap[current];
    if (record && record.hidden === true) return true;
  }
  return false;
}

function ensureDeckUUID(subject, sourceType, sourceId) {
  var normalized = normalizeSubject(subject);
  if (!normalized)
    throw new Error("Cannot generate a UUID for an empty subject.");

  var map = loadDeckMetadataMap();
  if (map[normalized] && map[normalized].uuid) {
    if (
      sourceType &&
      sourceId &&
      (!map[normalized].sourceType || !map[normalized].sourceId)
    ) {
      var existingRecords = readUUIDRecords();
      for (var i = 0; i < existingRecords.length; i++) {
        if (existingRecords[i].subject === normalized) {
          existingRecords[i].sourceType = sourceType;
          existingRecords[i].sourceId = sourceId;
          writeUUIDRecords(existingRecords);
          invalidateMetadataCache();
          break;
        }
      }
    }
    return map[normalized].uuid;
  }

  if (sourceType && sourceId) {
    var recordsBySource = readUUIDRecords();
    for (var s = 0; s < recordsBySource.length; s++) {
      if (
        recordsBySource[s].sourceType === sourceType &&
        recordsBySource[s].sourceId === sourceId
      ) {
        recordsBySource[s].subject = normalized;
        writeUUIDRecords(recordsBySource);
        invalidateMetadataCache();
        return recordsBySource[s].uuid;
      }
    }
  }

  var sheet = getOrInitializeUUIDSheet();
  var uuid = generateDeckUUID();
  sheet.appendRow([
    uuid,
    normalized,
    "",
    "",
    new Date().toISOString(),
    sourceType || "",
    sourceId || "",
  ]);
  invalidateMetadataCache();
  return uuid;
}

function generateDeckFileName(subject) {
  var record = getDeckMetadata(subject);
  if (!record || !record.uuid)
    throw new Error(
      "Deck metadata not found for subject: " + normalizeSubject(subject),
    );
  return "deck-" + record.uuid + ".json";
}

function normalizeMetadataRecordUUIDs(records) {
  var seen = Object.create(null);
  for (var i = 0; i < records.length; i++) {
    if (!records[i].uuid || seen[records[i].uuid])
      records[i].uuid = generateDeckUUID();
    seen[records[i].uuid] = true;
  }
}

function getSourceKey(sourceType, sourceId) {
  return (
    String(sourceType || "")
      .trim()
      .toLowerCase() +
    "::" +
    String(sourceId || "").trim()
  );
}

function dedupeLiveSubjects(liveSources) {
  var seen = Object.create(null);
  var deduped = [];
  var duplicates = [];
  for (var i = 0; i < liveSources.length; i++) {
    var subject = normalizeSubject(liveSources[i].subject);
    if (!subject) continue;
    if (seen[subject]) {
      if (duplicates.indexOf(subject) === -1) duplicates.push(subject);
      continue;
    }
    seen[subject] = true;
    deduped.push(liveSources[i]);
  }
  return { deduped: deduped, duplicates: duplicates };
}

function recordDuplicateSubjectWarning(duplicates) {
  var props = getScriptProps();
  if (duplicates.length) {
    Logger.log(
      "[reconcileMetadataToLiveSources] Duplicate logical subject(s) detected: " +
        duplicates.slice(0, 10).join(", ") +
        (duplicates.length > 10 ? " ..." : ""),
    );
    try {
      props.setProperty(
        "MRH_DUPLICATE_SUBJECTS",
        JSON.stringify(duplicates.slice(0, 50)),
      );
    } catch (persistError) {
      Logger.log(
        "[reconcileMetadataToLiveSources] failed to persist duplicate warning: " +
          persistError,
      );
    }
  } else {
    props.deleteProperty("MRH_DUPLICATE_SUBJECTS");
  }
}

function reconcileMetadataToLiveSources(liveSources) {
  var dedupeResult = dedupeLiveSubjects(liveSources);
  recordDuplicateSubjectWarning(dedupeResult.duplicates);
  liveSources = dedupeResult.deduped;

  var records = readUUIDRecords();
  var bySource = Object.create(null);
  var bySubject = Object.create(null);
  var result = [];
  var consumed = Object.create(null);

  for (var i = 0; i < records.length; i++) {
    var record = records[i];
    bySubject[record.subject] = record;
    if (record.sourceType && record.sourceId)
      bySource[getSourceKey(record.sourceType, record.sourceId)] = record;
  }

  for (var j = 0; j < liveSources.length; j++) {
    var live = liveSources[j];
    var key = getSourceKey(live.sourceType, live.sourceId);
    var existing = bySource[key] || null;
    if (!existing) existing = bySubject[live.subject] || null;

    if (existing) {
      result.push({
        uuid: existing.uuid,
        subject: live.subject,
        hidden: !!existing.hidden,
        password: String(existing.password || ""),
        createdAt: existing.createdAt || new Date().toISOString(),
        sourceType: live.sourceType,
        sourceId: live.sourceId,
      });
      consumed[existing.uuid] = true;
    } else {
      result.push({
        uuid: generateDeckUUID(),
        subject: live.subject,
        hidden: false,
        password: "",
        createdAt: new Date().toISOString(),
        sourceType: live.sourceType,
        sourceId: live.sourceId,
      });
    }
  }

  // Preserve explicit containers that still have live descendants.
  for (var k = 0; k < records.length; k++) {
    var old = records[k];
    if (consumed[old.uuid]) continue;
    if (old.sourceType === "container" || !old.sourceType) {
      var prefix = old.subject + "::";
      var hasLiveChild = false;
      for (var m = 0; m < liveSources.length; m++) {
        if (liveSources[m].subject.indexOf(prefix) === 0) {
          hasLiveChild = true;
          break;
        }
      }
      if (hasLiveChild) result.push(old);
    }
  }

  normalizeMetadataRecordUUIDs(result);

  var before = records
    .map(function (r) {
      return [
        r.uuid,
        r.subject,
        !!r.hidden,
        String(r.password || ""),
        r.createdAt || "",
        r.sourceType || "",
        r.sourceId || "",
      ].join("\u001f");
    })
    .sort()
    .join("\u001e");
  var after = result
    .map(function (r) {
      return [
        r.uuid,
        r.subject,
        !!r.hidden,
        String(r.password || ""),
        r.createdAt || "",
        r.sourceType || "",
        r.sourceId || "",
      ].join("\u001f");
    })
    .sort()
    .join("\u001e");

  if (before !== after) writeUUIDRecords(result);
  invalidateMetadataCache();
  return loadDeckMetadataMap(true);
}

/* -------------------------------------------------------------------------- */
/* Summary encoding                                                           */
/* -------------------------------------------------------------------------- */

function analyzeQuestionTypes(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return "ID";
  var hasIdent = false;
  var hasMC = false;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    if (q && q.t) {
      if (q.t === "ID") hasIdent = true;
      if (q.t === "MC") hasMC = true;
    }
  }
  if (hasIdent && hasMC) return "MX";
  if (hasMC) return "MC";
  return "ID";
}

function hasUsableExplanation(questions) {
  return (
    Array.isArray(questions) &&
    questions.some(function (question) {
      return (
        question &&
        typeof question.e === "string" &&
        question.e.trim() !== ""
      );
    })
  );
}

function buildSummaryArrayFromAccessState(state) {
  var metadata = loadDeckMetadataMap();
  var entries = [];
  var seen = Object.create(null);
  var summaryMap = state.summaryMap || {};

  for (var subject in summaryMap) {
    if (!Object.prototype.hasOwnProperty.call(summaryMap, subject)) continue;
    var normalized = normalizeSubject(subject);
    if (!normalized || seen[normalized]) continue;

    var record = metadata[normalized];
    if (!record) continue;
    if (isSubjectHiddenByHierarchy(normalized, metadata)) continue;

    var questionType =
      (state.questionTypes && state.questionTypes[subject]) || "ID";
    var hasExplanations = Boolean(
      state.hasExplanations && state.hasExplanations[subject],
    );
    seen[normalized] = true;
    entries.push({
      s: normalized,
      c: Number(summaryMap[subject] || 0),
      t: questionType,
      l: getEffectivePassword(subject, metadata) ? "t" : "f",
      e: hasExplanations ? "t" : "f",
      h: String((state.payloadVersions && state.payloadVersions[subject]) || ""),
    });
  }

  entries.sort(function (a, b) {
    return compareSubjectHierarchy(a.s, b.s);
  });
  return encodeSummaryDictionary(entries);
}

function encodeSummaryDictionary(entries) {
  var prefixes = [];
  var prefixIndexes = Object.create(null);
  var rows = [];
  var payloadVersions = [];

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i] || {};
    var subject = String(entry.s || "");
    var separatorIndex = subject.indexOf("::");
    var prefix =
      separatorIndex === -1 ? "" : subject.substring(0, separatorIndex);
    var suffix =
      separatorIndex === -1 ? subject : subject.substring(separatorIndex + 2);

    if (prefixIndexes[prefix] === undefined) {
      prefixIndexes[prefix] = prefixes.length;
      prefixes.push(prefix);
    }

    var row = [
      prefixIndexes[prefix],
      suffix,
      Number(entry.c || 0),
      entry.t || "ID",
    ];
    row.push(entry.l === "t" || entry.l === true ? 1 : 0);
    if (entry.e === "t" || entry.e === true) row.push(1);
    rows.push(row);
    payloadVersions.push(String(entry.h || ""));
  }
  return { v: 1, p: prefixes, d: rows, h: payloadVersions };
}

function decodeSummaryDictionary(data) {
  if (Array.isArray(data)) return data.length === 0 ? data : null;
  if (!data || data.v !== 1 || !Array.isArray(data.p) || !Array.isArray(data.d))
    return null;
  if (
    !Array.isArray(data.h) ||
    data.h.length !== data.d.length ||
    data.p.some(function (prefix) {
      return typeof prefix !== "string";
    }) ||
    data.h.some(function (fingerprint) {
      return !/^[a-f0-9]{64}$/i.test(String(fingerprint || ""));
    })
  )
    return null;

  var entries = [];
  for (var i = 0; i < data.d.length; i++) {
    var row = data.d[i];
    var prefixIndex = row && row[0];
    if (
      !Array.isArray(row) ||
      row.length < 5 ||
      row.length > 6 ||
      typeof prefixIndex !== "number" ||
      !Number.isInteger(prefixIndex) ||
      prefixIndex < 0 ||
      prefixIndex >= data.p.length ||
      typeof row[1] !== "string" ||
      !row[1].trim() ||
      typeof row[2] !== "number" ||
      !Number.isInteger(row[2]) ||
      row[2] < 0 ||
      typeof row[3] !== "string" ||
      !row[3].trim() ||
      (row[4] !== 0 && row[4] !== 1) ||
      (row.length === 6 && row[5] !== 1)
    )
      return null;
    var prefix = String(data.p[prefixIndex] || "");
    var suffix = row[1];
    entries.push({
      s: prefix ? prefix + "::" + suffix : suffix,
      c: row[2],
      t: row[3] || "ID",
      l: row[4] ? "t" : "f",
      e: row.length > 5 ? "t" : "f",
      h: Array.isArray(data.h) ? String(data.h[i] || "") : "",
    });
  }
  return entries;
}

/* -------------------------------------------------------------------------- */
/* Drive / database indexing & file storage helpers                           */
/* -------------------------------------------------------------------------- */

function getOrCreateCacheFolder(alreadyLocked) {
  var props = getScriptProps();
  var storedId = String(
    props.getProperty(CACHE_FOLDER_ID_PROPERTY) || "",
  ).trim();
  if (storedId) {
    try {
      return DriveApp.getFolderById(storedId);
    } catch (e) {
      props.deleteProperty(CACHE_FOLDER_ID_PROPERTY);
    }
  }

  var lock = null;
  var acquired = false;
  if (!alreadyLocked) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS))
      throw new Error("Could not acquire cache-folder lock.");
    acquired = true;
  }
  try {
    storedId = String(props.getProperty(CACHE_FOLDER_ID_PROPERTY) || "").trim();
    if (storedId) {
      try {
        return DriveApp.getFolderById(storedId);
      } catch (e2) {
        props.deleteProperty(CACHE_FOLDER_ID_PROPERTY);
      }
    }

    var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
    var folders = root.getFoldersByName("MRH_Caches");
    if (folders.hasNext()) {
      var existing = folders.next();
      props.setProperty(CACHE_FOLDER_ID_PROPERTY, existing.getId());
      return existing;
    }

    var created = root.createFolder("MRH_Caches");
    props.setProperty(CACHE_FOLDER_ID_PROPERTY, created.getId());
    return created;
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

function findCacheFilesByName(folder, fileName) {
  return folder.getFilesByName(fileName);
}

function readPersistentSummaryContent(cacheFolder) {
  try {
    var summaryFiles = findCacheFilesByName(cacheFolder, "MRH_Summary.json");
    if (!summaryFiles.hasNext()) return null;

    var content = String(summaryFiles.next().getBlob().getDataAsString() || "");
    if (!content.trim()) return null;

    var parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return content;
    if (
      parsed &&
      parsed.v === 1 &&
      Array.isArray(parsed.p) &&
      Array.isArray(parsed.d)
    ) {
      return content;
    }

    return null;
  } catch (error) {
    Logger.log("[readPersistentSummaryContent] invalid summary: " + error);
    return null;
  }
}

function updateOrCreateCacheFile(folder, fileName, contentStr) {
  var files = findCacheFilesByName(folder, fileName);
  var file = files.hasNext() ? files.next() : null;
  var content = String(contentStr || "");

  if (!file) return folder.createFile(fileName, content, MimeType.PLAIN_TEXT);

  try {
    if (String(file.getBlob().getDataAsString() || "") === content) {
      while (files.hasNext()) hardDeleteFile(files.next());
      return file;
    }
  } catch (e) {
    Logger.log("[updateOrCreateCacheFile] read failed: " + e);
  }

  file.setContent(content);
  while (files.hasNext()) hardDeleteFile(files.next());
  return file;
}

function hardDeleteFile(file) {
  if (!file) return;
  try {
    if (typeof Drive !== "undefined" && Drive.Files && Drive.Files.remove) {
      Drive.Files.remove(file.getId());
      return;
    }
  } catch (e) {
    // Fall back to setTrashed below.
  }
  try {
    file.setTrashed(true);
  } catch (ignored) {
    Logger.log("[hardDeleteFile] " + ignored);
  }
}

/**
 * Storage helpers for large file indices: avoids hitting ScriptProperties 9KB limit.
 */
function readPersistentFileIndex(cacheFolder) {
  try {
    var files = findCacheFilesByName(cacheFolder, FILE_INDEX_FILE_NAME);
    if (!files.hasNext()) return { timestamps: {}, metadata: {} };
    var raw = files.next().getBlob().getDataAsString();
    var parsed = JSON.parse(raw);
    return {
      timestamps: parsed.timestamps || {},
      metadata: parsed.metadata || {},
    };
  } catch (e) {
    Logger.log("[readPersistentFileIndex] Failed to read file index: " + e);
    return { timestamps: {}, metadata: {} };
  }
}

function writePersistentFileIndex(cacheFolder, timestamps, metadata) {
  try {
    var payload = JSON.stringify({
      timestamps: timestamps || {},
      metadata: metadata || {},
    });
    updateOrCreateCacheFile(cacheFolder, FILE_INDEX_FILE_NAME, payload);
  } catch (e) {
    Logger.log("[writePersistentFileIndex] Failed to write file index: " + e);
  }
}

/* -------------------------------------------------------------------------- */
/* Question extraction (safely bound columns & formats)                       */
/* -------------------------------------------------------------------------- */

function normalizeSheetColor(value, fallback) {
  var v = String(value || fallback || "")
    .toLowerCase()
    .trim();
  if (v === "#fff") return "#ffffff";
  if (v === "#000") return "#000000";
  return v;
}

function detectAnswerIndex(backgrounds, fontWeights, fontColors, rowIndex) {
  var backgroundCandidates = [];
  var boldCandidates = [];
  var colorCandidates = [];

  var rowBg = (backgrounds && backgrounds[rowIndex]) || [];
  var rowWeight = (fontWeights && fontWeights[rowIndex]) || [];
  var rowColor = (fontColors && fontColors[rowIndex]) || [];

  for (var i = 0; i < 4; i++) {
    var bg = normalizeSheetColor(rowBg[i + 1], "#ffffff");
    var weight = String(rowWeight[i + 1] || "").toLowerCase();
    var color = normalizeSheetColor(rowColor[i + 1], "#000000");
    if (bg !== "#ffffff" && bg !== "transparent") backgroundCandidates.push(i);
    if (weight === "bold") boldCandidates.push(i);
    if (color !== "#000000" && color !== "#ffffff") colorCandidates.push(i);
  }

  if (backgroundCandidates.length === 1) return backgroundCandidates[0];
  if (boldCandidates.length === 1) return boldCandidates[0];
  if (colorCandidates.length === 1) return colorCandidates[0];
  return -1;
}

function answerTokenToIndex(value) {
  var token = String(value == null ? "" : value)
    .trim()
    .toUpperCase();

  if (!token) return -1;

  // Accept a plain letter token and tolerate a trailing period/parenthesis.
  token = token.replace(/[.)]$/, "");
  if (!/^[A-Z]+$/.test(token)) return -1;

  // A=0, B=1, ..., Z=25, AA=26, AB=27, ...
  var index = 0;
  for (var i = 0; i < token.length; i++) {
    index = index * 26 + (token.charCodeAt(i) - 64);
  }
  return index - 1;
}

function extractQuestionsOptimized(sheet, subjectName, warnings) {
  var db = [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return db;

  // Fixed layout:
  // A = Question
  // B-E = legacy choices A-D
  // F = Explanation
  // G = ImageURL
  // H = Answer letter (read-only; never modified)
  // I onward = additional choices E, F, G, H, ...
  var maxCols = sheet.getMaxColumns();
  if (maxCols < 8) {
    sheet.insertColumnsAfter(maxCols, 8 - maxCols);
  }

  // Read through the last populated column so I onward can contain additional choices.
  // getLastColumn() is content-based; formatting alone does not expand it.
  var readColumnCount = Math.max(8, sheet.getLastColumn());
  var range = sheet.getRange(1, 1, lastRow, readColumnCount);
  var data = range.getValues();
  var backgrounds = range.getBackgrounds();
  var fontWeights = range.getFontWeights();
  var fontColors = range.getFontColors();

  for (var j = 1; j < data.length; j++) {
    var row = data[j];
    if (!row || sheetCellText(row[0]) === "") continue;

    // Legacy choices remain B-E.
    var originalChoices = [
      sheetCellText(row[1]),
      sheetCellText(row[2]),
      sheetCellText(row[3]),
      sheetCellText(row[4]),
    ];

    // Additional choices are I onward. F/G/H are deliberately skipped.
    var hasExtraChoices = false;
    for (var extraCol = 8; extraCol < row.length; extraCol++) {
      var extraChoice = sheetCellText(row[extraCol]);
      originalChoices.push(extraChoice);
      if (extraChoice !== "") hasExtraChoices = true;
    }

    var answerIndex = -1;

    if (!hasExtraChoices) {
      // EXACT LEGACY PATH:
      // Preserve the existing B-E formatting-based answer detection for all
      // current four-choice / identification sheets.
      answerIndex = detectAnswerIndex(
        backgrounds,
        fontWeights,
        fontColors,
        j,
      );

      // AUTO-FALLBACK FOR IDENTIFICATION:
      // If no format marker (bold/color/bg) was found, but exactly 1 choice exists
      // in B-E, automatically treat that non-empty choice as the answer.
      if (answerIndex < 0) {
        var nonEmptyChoiceIndices = [];
        for (var k = 0; k < originalChoices.length; k++) {
          if (originalChoices[k] !== "")
            nonEmptyChoiceIndices.push(k);
        }
        if (nonEmptyChoiceIndices.length === 1) {
          answerIndex = nonEmptyChoiceIndices[0];
        }
      }
    } else {
      // EXTENDED PATH (5+ choices):
      // H is the answer LETTER only. It is read, never written, and is never
      // treated as a choice column.
      answerIndex = answerTokenToIndex(row[7]);

      if (answerIndex < 0 || answerIndex >= originalChoices.length) {
        var extendedMsg =
          "Invalid Answer letter '" +
          String(row[7] || "") +
          "' for " +
          subjectName +
          " row " +
          (j + 1) +
          "; expected A-" +
          String.fromCharCode(64 + Math.min(originalChoices.length, 26)) +
          ". Skipping row.";

        Logger.log("[extractQuestionsOptimized] " + extendedMsg);
        if (Array.isArray(warnings))
          warnings.push({
            subject: subjectName,
            row: j + 1,
            reason: extendedMsg,
          });
        continue;
      }
    }

    if (answerIndex < 0) {
      var msg1 =
        "Invalid answer marker for " +
        subjectName +
        " row " +
        (j + 1) +
        "; skipping row.";
      Logger.log("[extractQuestionsOptimized] " + msg1);
      if (Array.isArray(warnings))
        warnings.push({ subject: subjectName, row: j + 1, reason: msg1 });
      continue;
    }

    // Remove empty choice cells while preserving the logical answer index.
    var choices = [];
    var mappedAnswerIndex = -1;
    for (var c = 0; c < originalChoices.length; c++) {
      if (originalChoices[c] === "") continue;
      if (c === answerIndex) mappedAnswerIndex = choices.length;
      choices.push(originalChoices[c]);
    }

    if (!choices.length || mappedAnswerIndex < 0) {
      var msg2 =
        "Answer marker points to an empty choice for " +
        subjectName +
        " row " +
        (j + 1) +
        "; skipping row.";
      Logger.log("[extractQuestionsOptimized] " + msg2);
      if (Array.isArray(warnings))
        warnings.push({ subject: subjectName, row: j + 1, reason: msg2 });
      continue;
    }

    var questionType = choices.length <= 1 ? "ID" : "MC";
    var question = {
      i: j,
      q: sheetCellText(row[0]),
      c: choices,
      a: mappedAnswerIndex,
      t: questionType,
    };

    // F = Explanation; G = ImageURL.
    // H remains an external/read-only answer-letter source for 5+ choice rows.
    var explanation = sheetCellText(row[5]);
    var imageUrl = sheetCellText(row[6]);
    if (explanation) question.e = explanation;
    if (imageUrl) question.u = imageUrl;
    db.push(question);
  }

  return db;
}

function encodeDeckQuestions(questions) {
  return (Array.isArray(questions) ? questions : []).map(function (question) {
    var row = [question.i, question.q, question.c, question.a, question.t];
    if (question.e || question.u) row.push(question.e || null);
    if (question.u) row.push(question.u);
    while (row.length > 5 && row[row.length - 1] === null) row.pop();
    return row;
  });
}

/* -------------------------------------------------------------------------- */
/* Pagination & Deck Retrieval                                                */
/* -------------------------------------------------------------------------- */

function getDeckJsonContent(subject) {
  var folder = getOrCreateCacheFolder();
  var fileName = generateDeckFileName(subject);
  var files = findCacheFilesByName(folder, fileName);
  if (!files.hasNext()) return null;
  return files.next().getBlob().getDataAsString();
}

function checkPasswordRateLimit(subject) {
  var normalized = normalizeSubject(subject);
  var key = "mrh_pwrl_" + sha256Hex(normalized);
  return incrementRateLimit(
    key,
    PASSWORD_RATE_LIMIT,
    PASSWORD_RATE_WINDOW_SECONDS,
  );
}

function handleGetDeckRequest(data) {
  var subject = normalizeSubject(data.subject || "");
  if (!subject) return errorResponse("Subject is required.", "BAD_REQUEST");

  var metadataMap = loadDeckMetadataMap();
  if (isSubjectHiddenByHierarchy(subject, metadataMap))
    return errorResponse("This deck is not available.", "FORBIDDEN");
  if (!metadataMap[subject])
    return errorResponse("This deck was not found.", "NOT_FOUND");

  var requiredPassword = getEffectivePassword(subject, metadataMap);
  if (requiredPassword) {
    if (!passwordMatches(data.password, requiredPassword)) {
      if (!checkPasswordRateLimit(subject))
        return errorResponse(
          "Too many access attempts. Please try again later.",
          "RATE_LIMITED",
        );
      return errorResponse("Incorrect Password.", "UNAUTHORIZED");
    }
  }

  var baseKey = buildDeckCacheKey(subject, "authorized");
  var cached = cacheGetChunked(baseKey);
  if (cached !== null) {
    return ContentService.createTextOutput(cached).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  var content = getDeckJsonContent(subject);
  if (content === null)
    return errorResponse("Deck data is not available yet.", "NOT_READY");

  cachePutChunked(baseKey, content);
  return ContentService.createTextOutput(content).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function handleVerifyAccessRequest(data) {
  var subject = normalizeSubject(data.subject || "");
  if (!subject) return errorResponse("Subject is required.", "BAD_REQUEST");

  var metadataMap = loadDeckMetadataMap();
  if (isSubjectHiddenByHierarchy(subject, metadataMap))
    return errorResponse("This deck is not available.", "FORBIDDEN");
  if (!metadataMap[subject])
    return errorResponse("This deck was not found.", "NOT_FOUND");

  var requiredPassword = getEffectivePassword(subject, metadataMap);
  if (requiredPassword) {
    if (!passwordMatches(data.password, requiredPassword)) {
      if (!checkPasswordRateLimit(subject))
        return errorResponse(
          "Too many access attempts. Please try again later.",
          "RATE_LIMITED",
        );
      return errorResponse("Incorrect Password.", "UNAUTHORIZED");
    }
  }

  return jsonResponse({ status: "success", subject: subject });
}

/* -------------------------------------------------------------------------- */
/* Public GET API                                                             */
/* -------------------------------------------------------------------------- */

function doGet(e) {
  try {
    return doGetInternal(e || { parameter: {} });
  } catch (error) {
    var correlationId = createBackendCorrelationId_();
    logBackendFailure_("doGet", "get", correlationId, error);
    return errorResponse(
      "Server error. Reference: " + correlationId + ".",
      "SERVER_ERROR",
      {
        correlationId: correlationId,
      },
    );
  }
}

function doGetInternal(e) {
  var params = e && e.parameter ? e.parameter : {};
  var versionError = clientVersionRequired(params.v || params.appVersion);
  if (versionError) return versionError;
  if (String(params.sync || "") === "1") {
    return handleDeckSyncSnapshot_(
      String(params.since || ""),
      String(params.sinceCacheVersion || ""),
    );
  }
  var requestedSubject = normalizeSubject(params.subject || "");

  if (requestedSubject) {
    var metadataMap = loadDeckMetadataMap();
    var metadata = metadataMap[requestedSubject];
    var effectivePassword = getEffectivePassword(requestedSubject, metadataMap);

    if (effectivePassword) {
      return errorResponse(
        "Password-protected decks require a POST request.",
        "PASSWORD_REQUIRED",
      );
    }
    if (isSubjectHiddenByHierarchy(requestedSubject, metadataMap))
      return errorResponse("This deck is not available.", "FORBIDDEN");
    if (!metadata) return errorResponse("This deck was not found.", "NOT_FOUND");

    var publicKey = buildDeckCacheKey(requestedSubject, "authorized");
    var publicCached = cacheGetChunked(publicKey);
    if (publicCached !== null)
      return ContentService.createTextOutput(publicCached).setMimeType(
        ContentService.MimeType.JSON,
      );

    var publicContent = getDeckJsonContent(requestedSubject);
    if (publicContent === null)
      return errorResponse("Deck data is not available yet.", "NOT_READY");

    cachePutChunked(publicKey, publicContent);
    return ContentService.createTextOutput(publicContent).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  var props = getScriptProps();
  if (props.getProperty("MRH_SUBJECT_SCHEMA_VERSION") !== SUBJECT_SCHEMA_VERSION) {
    props.setProperty("FORCE_REBUILD", "true");
    try {
      ensureResumeBuildTrigger();
    } catch (triggerError) {
      Logger.log("[doGet] schema rebuild trigger failed: " + triggerError);
    }
    return jsonResponse({ isColdStart: true, subjects: [] });
  }

  var summaryKey = generateCacheKey("summary");
  var cachedSummary = cacheGetChunked(summaryKey);
  if (cachedSummary !== null) {
    var filteredCachedSummary = filterSummaryDataByAccess(cachedSummary);
    if (filteredCachedSummary !== null) {
      return ContentService.createTextOutput(
        filteredCachedSummary,
      ).setMimeType(ContentService.MimeType.JSON);
    }
  }

  var cacheFolder = getOrCreateCacheFolder();
  var summaryFiles = findCacheFilesByName(cacheFolder, "MRH_Summary.json");
  if (summaryFiles.hasNext()) {
    var summaryContent = summaryFiles.next().getBlob().getDataAsString();
    var filtered = filterSummaryDataByAccess(summaryContent);
    if (filtered !== null) {
      cachePutChunked(summaryKey, summaryContent);
      return ContentService.createTextOutput(filtered).setMimeType(
        ContentService.MimeType.JSON,
      );
    }
  }

  props.setProperty("FORCE_REBUILD", "true");
  try {
    ensureResumeBuildTrigger();
  } catch (triggerError) {
    Logger.log("[doGet] cache rebuild trigger failed: " + triggerError);
  }
  return jsonResponse({ isColdStart: true, subjects: [] });
}

function handleDeckSyncSnapshot_(knownTimestamp, knownCacheVersion) {
  var props = getScriptProps();
  var schemaMismatch =
    props.getProperty("MRH_SUBJECT_SCHEMA_VERSION") !== SUBJECT_SCHEMA_VERSION;
  var hasSummary = Boolean(props.getProperty("LAST_CACHE_BUILD_SUCCESS"));
  var buildStatus = props.getProperty("BUILD_STATUS") || "IDLE";
  var timestamp =
    props.getProperty("MRH_CACHE_VERSION_TIMESTAMP") ||
    props.getProperty("LAST_CACHE_UPDATE") ||
    "";
  var cacheVersion = getCacheInvalidationVersion();

  if (schemaMismatch || !hasSummary) {
    try {
      if (schemaMismatch) props.setProperty("FORCE_REBUILD", "true");
      ensureResumeBuildTrigger();
    } catch (triggerError) {
      Logger.log("[handleDeckSyncSnapshot_] rebuild trigger failed: " + triggerError);
    }
    return jsonResponse({
      status: "ok",
      payloadSchemaVersion: BACKEND_PAYLOAD_SCHEMA_VERSION,
      syncTimestamp: timestamp,
      cacheVersion: cacheVersion,
      hasSummary: hasSummary,
      isColdStart: true,
      buildStatus: buildStatus,
    });
  }

  if (
    knownTimestamp &&
    knownTimestamp === timestamp &&
    knownCacheVersion &&
    knownCacheVersion === cacheVersion
  ) {
    return jsonResponse({
      status: "ok",
      notModified: true,
      payloadSchemaVersion: BACKEND_PAYLOAD_SCHEMA_VERSION,
      syncTimestamp: timestamp,
      cacheVersion: cacheVersion,
      hasSummary: true,
      isColdStart: false,
      buildStatus: buildStatus,
    });
  }

  var summaryKey = generateCacheKey("summary");
  var summaryContent = cacheGetChunked(summaryKey);
  var filtered = summaryContent === null
    ? null
    : filterSummaryDataByAccess(summaryContent);
  if (filtered === null) {
    var cacheFolder = getOrCreateCacheFolder();
    var summaryFiles = findCacheFilesByName(cacheFolder, "MRH_Summary.json");
    if (summaryFiles.hasNext()) {
      summaryContent = summaryFiles.next().getBlob().getDataAsString();
      filtered = filterSummaryDataByAccess(summaryContent);
      if (filtered !== null) cachePutChunked(summaryKey, summaryContent);
    }
  }
  if (filtered === null) {
    return jsonResponse({
      status: "ok",
      payloadSchemaVersion: BACKEND_PAYLOAD_SCHEMA_VERSION,
      syncTimestamp: timestamp,
      cacheVersion: cacheVersion,
      hasSummary: false,
      isColdStart: true,
      buildStatus: buildStatus,
    });
  }

  var latestTimestamp =
    props.getProperty("MRH_CACHE_VERSION_TIMESTAMP") ||
    props.getProperty("LAST_CACHE_UPDATE") ||
    "";
  var latestCacheVersion = getCacheInvalidationVersion();
  if (latestTimestamp !== timestamp || latestCacheVersion !== cacheVersion) {
    return jsonResponse({
      status: "error",
      code: "SYNC_RACE",
      message: "The database changed while its summary was being read.",
    });
  }

  return jsonResponse({
    status: "ok",
    payloadSchemaVersion: BACKEND_PAYLOAD_SCHEMA_VERSION,
    syncTimestamp: timestamp,
    cacheVersion: cacheVersion,
    hasSummary: true,
    isColdStart: false,
    buildStatus: buildStatus,
    summary: JSON.parse(filtered),
  });
}

function filterSummaryDataByAccess(summaryJsonString) {
  var data;
  try {
    data = JSON.parse(summaryJsonString);
  } catch (e) {
    return null;
  }
  var entries = decodeSummaryDictionary(data);
  if (!entries) return null;

  var metadata = loadDeckMetadataMap();
  var output = [];
  var seen = Object.create(null);

  for (var i = 0; i < entries.length; i++) {
    var item = entries[i];
    if (!item) continue;
    var rawSubject = item.s !== undefined ? item.s : item.Subject;
    if (!rawSubject) continue;

    var subject = normalizeSubject(rawSubject);
    if (!subject || seen[subject]) continue;

    var record = metadata[subject];
    if (!record) continue;
    if (isSubjectHiddenByHierarchy(subject, metadata)) continue;

    var questionType =
      item.t !== undefined ? item.t : item.QuestionType || "ID";
    seen[subject] = true;
    var compactEntry = {
      s: subject,
      c: Number(item.c !== undefined ? item.c : item.QuestionCount || 0),
      t: questionType,
      h: String(item.h || ""),
      e:
        item.e === "t" ||
        item.e === true ||
        item.HasExplanations === true
          ? "t"
          : "f",
    };
    if (getEffectivePassword(subject, metadata)) compactEntry.l = "t";
    output.push(compactEntry);
  }

  output.sort(function (a, b) {
    return compareSubjectHierarchy(a.s, b.s);
  });
  return JSON.stringify(encodeSummaryDictionary(output));
}

/* -------------------------------------------------------------------------- */
/* POST / API handlers                                                        */
/* -------------------------------------------------------------------------- */

function doPost(e) {
  var requestType = "unknown";
  var correlationId = createBackendCorrelationId_();
  try {
    if (!e || !e.postData || !e.postData.contents)
      return errorResponse("Request body is required.", "BAD_REQUEST");

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (parseError) {
      return errorResponse("Invalid JSON request body.", "BAD_JSON");
    }

    if (!data || typeof data !== "object" || Array.isArray(data))
      return errorResponse("Invalid request body.", "BAD_REQUEST");

    var versionError = clientVersionRequired(data.appVersion);
    if (versionError) return versionError;

    requestType = String(data.type || "unknown");
    if (
      [
        "verify_reviewer_access",
        "request_reviewer_enrollment",
        "get_reviewer_dashboard",
        "get_reviewer_pdf_preview",
        "get_reviewer_pdf",
        "get_reviewer_pdf_job",
        "cleanup_reviewer_pdf_jobs",
        "log_module_access",
        "log_resource_file_click",
        "log_resource_dashboard_action",
        "get_resource_dashboard",
      ].indexOf(requestType) !== -1 &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        String(data.eventId || ""),
      )
    )
      return errorResponse(
        "A valid event ID is required for this request.",
        "BAD_REQUEST",
      );
    if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(data.requestId || ""),
    )
    )
    correlationId = String(data.requestId).toLowerCase();
    else if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(data.eventId || ""),
    )
    )
    correlationId = String(data.eventId).toLowerCase();
    if (requestType === "get_reviewer_auth_config")
      return handleGetReviewerAuthorizationConfigRequest();
    if (requestType === "verify_reviewer_access")
      return handleReviewerSignInRequest(data);
    if (requestType === "restore_reviewer_session")
      return handleRestoreReviewerSessionRequest(data);
    if (requestType === "sign_out_reviewer")
      return handleRevokeReviewerSessionRequest(data);
    if (requestType === "get_reviewer_account_status")
      return handleGetReviewerAccountStatusRequest(data);
    if (requestType === "request_reviewer_enrollment")
      return handleReviewerEnrollmentRequest(data);
    if (requestType === "get_reviewer_dashboard")
      return handleGetReviewerDashboardRequest(data);
    if (requestType === "get_reviewer_pdf_preview")
      return handleGetReviewerPdfPreviewRequest_(data);
    if (requestType === "get_reviewer_pdf")
      return enqueueReviewerPdfRequest_(data);
    if (requestType === "get_reviewer_pdf_job")
      return getReviewerPdfJobStatus_(data);
    if (requestType === "cleanup_reviewer_pdf_jobs")
      return cleanupReviewerPdfJobsRequest_(data);
    if (requestType === "log_module_access")
      return handleLogModuleAccessRequest(data);
    if (requestType === "log_resource_file_click")
      return handleLogResourceFileClickRequest(data);
    if (requestType === "log_resource_dashboard_action")
      return handleLogResourceDashboardActionRequest(data);
    if (requestType === "get_resource_dashboard")
      return handleGetResourceDashboardRequest(data.version);
    if (requestType === "list_public_resources")
      return errorResponse(
        "Drive resource scanning is disabled.",
        "FEATURE_DISABLED",
      );
    if (requestType === "get_resource_preview")
      return errorResponse(
        "Drive resource previews are disabled.",
        "FEATURE_DISABLED",
      );
    if (requestType === "get_deck") return handleGetDeckRequest(data);
    if (
      requestType === "verify_folder_access" ||
      requestType === "verify_access"
    )
      return handleVerifyAccessRequest(data);
    if (requestType === "get_cache_version") {
      return jsonResponse({
        version: getCacheInvalidationVersion(),
        timestamp: getLastModificationTimestamp(),
      });
    }
    if (requestType === "get_sync_status") return handleSyncStatus();

    return errorResponse("Unknown request type.", "UNKNOWN_REQUEST");
  } catch (error) {
    logBackendFailure_("doPost", requestType, correlationId, error);
    return errorResponse(
      "Server error. Reference: " + correlationId + ".",
      "SERVER_ERROR",
      {
        correlationId: correlationId,
      },
    );
  }
}

function handleSyncStatus() {
  var props = getScriptProps();
  var lastCacheUpdate =
    props.getProperty("MRH_CACHE_VERSION_TIMESTAMP") ||
    props.getProperty("LAST_CACHE_UPDATE") ||
    "";
  var hasSummary = Boolean(props.getProperty("LAST_CACHE_BUILD_SUCCESS"));
  var buildStatus = props.getProperty("BUILD_STATUS") || "IDLE";
  var schemaMismatch =
    props.getProperty("MRH_SUBJECT_SCHEMA_VERSION") !== SUBJECT_SCHEMA_VERSION;

  if (schemaMismatch) {
    props.setProperty("FORCE_REBUILD", "true");
    try {
      ensureResumeBuildTrigger();
    } catch (triggerError) {
      Logger.log("[handleSyncStatus] schema rebuild trigger failed: " + triggerError);
    }
  }

  return jsonResponse({
    status: "ok",
    payloadSchemaVersion: BACKEND_PAYLOAD_SCHEMA_VERSION,
    syncTimestamp: lastCacheUpdate,
    cacheVersion: getCacheInvalidationVersion(),
    hasSummary: hasSummary,
    isColdStart: !hasSummary || schemaMismatch,
    serverTime: new Date().toISOString(),
    subjectSchemaVersion: SUBJECT_SCHEMA_VERSION,
    driveAuthoritative: true,
    buildStatus: buildStatus,
  });
}

/* -------------------------------------------------------------------------- */
/* Builder / resumable queue                                                  */
/* -------------------------------------------------------------------------- */

function onEdit(e) {
  // Intentionally empty; UUID edits handled by uuidSheetEdited.
}

function uuidSheetEdited(e) {
  if (!e || !e.source || String(e.source.getId()) !== String(UUID_SHEET_ID))
    return;
  var props = getScriptProps();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS)) return;
  try {
    if (props.getProperty("REBUILD_QUEUED") === "true") return;
    props.setProperty("REBUILD_QUEUED", "true");
    props.setProperty("FORCE_REBUILD", "true");
    deleteBuildStateFile();
    buildDatabaseCache(true);
  } catch (error) {
    Logger.log("[uuidSheetEdited] " + error);
  } finally {
    props.deleteProperty("REBUILD_QUEUED");
    lock.releaseLock();
  }
}

function setupTriggers() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS))
    throw new Error("Could not acquire setup lock.");
  try {
    var reviewerConfig = getReviewerAuthorizationConfig_();
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      var handler = triggers[i].getHandlerFunction();
      if (
        handler === "scheduledDatabaseSync" ||
        handler === "uuidSheetEdited" ||
        handler === "mrhAccountsEdited" ||
        handler === "processReviewerStatusNotifications" ||
        handler === "onEdit" ||
        handler === RESUME_TRIGGER_HANDLER
      ) {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }

    ScriptApp.newTrigger("uuidSheetEdited")
      .forSpreadsheet(UUID_SHEET_ID)
      .onEdit()
      .create();
    if (reviewerConfig.enabled) {
      ScriptApp.newTrigger("mrhAccountsEdited")
        .forSpreadsheet(reviewerConfig.spreadsheetId)
        .onEdit()
        .create();
      ScriptApp.newTrigger("processReviewerStatusNotifications")
        .timeBased()
        .everyMinutes(1)
        .create();
    }
    ScriptApp.newTrigger("scheduledDatabaseSync")
      .timeBased()
      .everyMinutes(5)
      .create();

    return {
      status: "success",
      message:
        "Database triggers installed: UUID and account edit triggers, reviewer status notifications, and 5-minute safety sync.",
    };
  } finally {
    lock.releaseLock();
  }
}

function triggerBuildDatabaseCache(sourceSpreadsheetId) {
  return buildDatabaseCache();
}

function forceFullRebuildDatabaseCache() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS))
    throw new Error("Another database build is currently running.");
  try {
    var props = getScriptProps();
    props.deleteProperty("MRH_SUBJECT_SCHEMA_VERSION");
    props.setProperty("FORCE_REBUILD", "true");
    invalidateMetadataCache();
    return buildDatabaseCache(true);
  } finally {
    lock.releaseLock();
  }
}

function resumeBuildDatabaseCache() {
  return buildDatabaseCache();
}

function ensureResumeBuildTrigger(alreadyLocked) {
  var lock = null;
  var acquired = false;

  if (!alreadyLocked) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS)) return false;
    acquired = true;
  }

  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === RESUME_TRIGGER_HANDLER)
        ScriptApp.deleteTrigger(triggers[i]);
    }
    ScriptApp.newTrigger(RESUME_TRIGGER_HANDLER)
      .timeBased()
      .after(10000)
      .create();
    return true;
  } finally {
    if (acquired && lock) lock.releaseLock();
  }
}

function getBuildStateFile(alreadyLocked) {
  var folder = getOrCreateCacheFolder(!!alreadyLocked);
  var files = folder.getFilesByName(BUILD_STATE_FILE_NAME);
  return files.hasNext() ? files.next() : null;
}

function readBuildState() {
  var file = getBuildStateFile(true);
  if (!file) return null;
  try {
    return JSON.parse(file.getBlob().getDataAsString());
  } catch (error) {
    Logger.log("[readBuildState] invalid state file: " + error);
    return null;
  }
}

function writeBuildState(state) {
  var folder = getOrCreateCacheFolder(true);
  var json = JSON.stringify(state);
  var files = folder.getFilesByName(BUILD_STATE_FILE_NAME);
  if (files.hasNext()) {
    var file = files.next();
    file.setContent(json);
    while (files.hasNext()) hardDeleteFile(files.next());
  } else {
    folder.createFile(BUILD_STATE_FILE_NAME, json, MimeType.PLAIN_TEXT);
  }
}

function deleteBuildStateFile() {
  try {
    var file = getBuildStateFile(true);
    if (file) hardDeleteFile(file);
  } catch (error) {
    Logger.log("[deleteBuildStateFile] " + error);
  }
}

function isValidBuildState(state, cacheFolderId) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.subjectSchemaVersion !== SUBJECT_SCHEMA_VERSION ||
    String(state.cacheFolderId || "") !== String(cacheFolderId || "") ||
    !Array.isArray(state.folderQueue) ||
    state.folderQueue.length === 0 ||
    !Array.isArray(state.liveSources)
  )
    return false;

  for (var i = 0; i < state.folderQueue.length; i++) {
    var folder = state.folderQueue[i];
    if (
      !folder ||
      typeof folder !== "object" ||
      !String(folder.id || "").trim() ||
      typeof folder.pathPrefix !== "string"
    )
      return false;
  }

  var objectFields = [
    "summaryMap",
    "questionTypes",
    "payloadVersions",
    "oldPayloadVersions",
    "seenSubjects",
    "newFileTimestamps",
    "newFileMetadata",
    "oldSummaryMap",
    "oldQuestionTypes",
    "oldFileTimestamps",
    "oldFileMetadata",
  ];
  for (var j = 0; j < objectFields.length; j++) {
    var value = state[objectFields[j]];
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
  }

  return true;
}

/**
 * Main optimized cache builder.
 */
function buildDatabaseCache(alreadyLocked) {
  var lock = null;
  var acquiredHere = false;

  if (!alreadyLocked) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS)) {
      Logger.log(
        "[buildDatabaseCache] Another build/mutation is already running.",
      );
      return false;
    }
    acquiredHere = true;
  }

  var startTime = Date.now();
  var props = getScriptProps();
  props.setProperty("BUILD_STATUS", "RUNNING");

  try {
    invalidateMetadataCache();

    var storedSchema = props.getProperty("MRH_SUBJECT_SCHEMA_VERSION") || "";
    var schemaChanged = storedSchema !== SUBJECT_SCHEMA_VERSION;
    if (schemaChanged) {
      deleteBuildStateFile();
      props.setProperty("FORCE_REBUILD", "true");
    }

    var force = props.getProperty("FORCE_REBUILD") === "true" || schemaChanged;
    var state = readBuildState();

    if (state && state.subjectSchemaVersion !== SUBJECT_SCHEMA_VERSION) {
      state = null;
      deleteBuildStateFile();
      force = true;
    }

    var cacheFolder = getOrCreateCacheFolder(true);
    if (state && !isValidBuildState(state, cacheFolder.getId())) {
      Logger.log(
        "[buildDatabaseCache] Discarding invalid or stale build state.",
      );
      state = null;
      deleteBuildStateFile();
      force = true;
      props.setProperty("FORCE_REBUILD", "true");
    }

    var oldSummaryMap = Object.create(null);
    var oldQuestionTypes = Object.create(null);
    var oldExplanationMap = Object.create(null);
    var oldPayloadVersions = Object.create(null);

    // Read stored file index from cache folder (avoids 9KB ScriptProperties quota).
    var persistentIndex = readPersistentFileIndex(cacheFolder);
    var oldFileTimestamps = persistentIndex.timestamps || {};
    var oldFileMetadata = persistentIndex.metadata || {};

    if (!state) {
      if (!force) {
        var summaryFiles = findCacheFilesByName(
          cacheFolder,
          "MRH_Summary.json",
        );
        if (summaryFiles.hasNext()) {
          try {
            var parsedSummary = JSON.parse(
              summaryFiles.next().getBlob().getDataAsString(),
            );
            var priorEntries = decodeSummaryDictionary(parsedSummary);
            if (priorEntries) {
              for (var s = 0; s < priorEntries.length; s++) {
                if (priorEntries[s] && priorEntries[s].s) {
                  var priorSubject = normalizeSubject(priorEntries[s].s);
                  oldSummaryMap[priorSubject] = Number(priorEntries[s].c || 0);
                  oldQuestionTypes[priorSubject] = priorEntries[s].t || "ID";
                  oldExplanationMap[priorSubject] =
                    priorEntries[s].e === "t" || priorEntries[s].e === true;
                  oldPayloadVersions[priorSubject] =
                    String(priorEntries[s].h || "");
                }
              }
            }
          } catch (summaryError) {
            force = true;
          }
        } else {
          force = true;
        }
      }

      state = {
        subjectSchemaVersion: SUBJECT_SCHEMA_VERSION,
        folderQueue: [{ id: DATABASE_FOLDER_ID, pathPrefix: "" }],
        summaryMap: Object.create(null),
        questionTypes: Object.create(null),
        seenSubjects: Object.create(null), // Track first-occurrence winning subjects
        liveSources: [],
        newFileTimestamps: Object.create(null),
        newFileMetadata: Object.create(null),
        oldSummaryMap: oldSummaryMap,
        oldQuestionTypes: oldQuestionTypes,
        oldExplanationMap: oldExplanationMap,
        oldPayloadVersions: oldPayloadVersions,
        payloadVersions: Object.create(null),
        hasExplanations: Object.create(null),
        oldFileTimestamps: oldFileTimestamps,
        oldFileMetadata: oldFileMetadata,
        cacheFolderId: cacheFolder.getId(),
        isFullRebuild: force,
      };
    }

    state.summaryMap = Object.assign(
      Object.create(null),
      state.summaryMap || {},
    );
    state.questionTypes = Object.assign(
      Object.create(null),
      state.questionTypes || {},
    );
    state.payloadVersions = Object.assign(
      Object.create(null),
      state.payloadVersions || {},
    );
    state.seenSubjects = Object.assign(
      Object.create(null),
      state.seenSubjects || {},
    );
    state.newFileTimestamps = Object.assign(
      Object.create(null),
      state.newFileTimestamps || {},
    );
    state.newFileMetadata = Object.assign(
      Object.create(null),
      state.newFileMetadata || {},
    );
    state.oldSummaryMap = Object.assign(
      Object.create(null),
      state.oldSummaryMap || {},
    );
    state.oldQuestionTypes = Object.assign(
      Object.create(null),
      state.oldQuestionTypes || {},
    );
    state.oldExplanationMap = Object.assign(
      Object.create(null),
      state.oldExplanationMap || {},
    );
    state.oldPayloadVersions = Object.assign(
      Object.create(null),
      state.oldPayloadVersions || {},
    );
    state.hasExplanations = Object.assign(
      Object.create(null),
      state.hasExplanations || {},
    );
    state.oldFileTimestamps = Object.assign(
      Object.create(null),
      state.oldFileTimestamps || {},
    );
    state.oldFileMetadata = Object.assign(
      Object.create(null),
      state.oldFileMetadata || {},
    );
    state.liveSources = Array.isArray(state.liveSources)
      ? state.liveSources
      : [];
    state.folderQueue = Array.isArray(state.folderQueue)
      ? state.folderQueue
      : [];
    state.extractionWarnings = Array.isArray(state.extractionWarnings)
      ? state.extractionWarnings
      : [];

    state.cacheFolderId = cacheFolder.getId();

    while (state.folderQueue.length) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        writeBuildState(state);
        ensureResumeBuildTrigger(true);
        return false;
      }

      var current = state.folderQueue.pop();
      var folder;
      try {
        folder = DriveApp.getFolderById(current.id);
      } catch (folderError) {
        deleteBuildStateFile();
        throw new Error(
          "Unable to access database folder '" +
            String(current.pathPrefix || current.id) +
            "': " +
            folderError,
        );
      }

      var pathPrefix = current.pathPrefix || "";
      if (pathPrefix) {
        state.liveSources.push({
          sourceType: "folder",
          sourceId: folder.getId(),
          subject: pathPrefix,
        });
      }

      var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (files.hasNext()) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) {
          state.folderQueue.push(current);
          writeBuildState(state);
          ensureResumeBuildTrigger(true);
          return false;
        }

        var file = files.next();
        var fileId = file.getId();
        var fileName = file.getName();

        if (
          fileName === "MRH_Passwords" ||
          fileName === "MRH_Access" ||
          fileName === "MRH_Access.json" ||
          /^deck-[A-F0-9-]+\.json$/i.test(fileName)
        )
          continue;

        var updated = file.getLastUpdated().getTime();
        state.newFileTimestamps[fileId] = updated;

        var previousTimestamp = Number(state.oldFileTimestamps[fileId] || 0);
        var cachedMeta = state.oldFileMetadata[fileId];

        // -------------------------------------------------------------------
        // PERFORMANCE OPTIMIZATION:
        // Skip SpreadsheetApp.open() completely if the file is unmodified.
        // -------------------------------------------------------------------
        var isUnmodified =
          !state.isFullRebuild &&
          updated <= previousTimestamp &&
          cachedMeta &&
          Array.isArray(cachedMeta.subjects) &&
          cachedMeta.subjects.length > 0 &&
          cachedMeta.pathPrefix === pathPrefix &&
          cachedMeta.fileName === fileName;

        if (isUnmodified) {
          var canReuse = true;
          for (var u = 0; u < cachedMeta.subjects.length; u++) {
            var subj = cachedMeta.subjects[u];
            if (state.oldSummaryMap[subj] === undefined) {
              canReuse = false;
              break;
            }
          }

          if (canReuse) {
            for (var k = 0; k < cachedMeta.subjects.length; k++) {
              var sName = cachedMeta.subjects[k];
              var sId = cachedMeta.sourceIds[k];

              // Enforce first-occurrence precedence
              if (!state.seenSubjects[sName]) {
                state.seenSubjects[sName] = true;
                state.summaryMap[sName] = state.oldSummaryMap[sName];
                state.questionTypes[sName] =
                  state.oldQuestionTypes[sName] || "ID";
                state.hasExplanations[sName] = Boolean(
                  state.oldExplanationMap[sName],
                );
                state.payloadVersions[sName] =
                  state.oldPayloadVersions[sName] || "";
                state.liveSources.push({
                  sourceType: "deck",
                  sourceId: sId,
                  subject: sName,
                });
              }
            }
            state.newFileMetadata[fileId] = cachedMeta;
            continue; // Skipped opening spreadsheet entirely!
          }
        }

        // File modified or full rebuild required: Open spreadsheet.
        var ss = SpreadsheetApp.open(file);
        var sheets = ss.getSheets();
        var isSingle = sheets.length === 1;
        var currentSubjects = [];
        var currentSourceIds = [];

        for (var sh = 0; sh < sheets.length; sh++) {
          var sheet = sheets[sh];
          var subject = buildSpreadsheetSubject(
            pathPrefix,
            fileName,
            sheet.getName(),
            isSingle,
          );
          var sourceId = isSingle ? fileId : fileId + "::" + sheet.getSheetId();

          currentSubjects.push(subject);
          currentSourceIds.push(sourceId);

          if (!state.seenSubjects[subject]) {
            state.seenSubjects[subject] = true;
            state.liveSources.push({
              sourceType: "deck",
              sourceId: sourceId,
              subject: subject,
            });
          }
        }

        state.newFileMetadata[fileId] = {
          pathPrefix: pathPrefix,
          fileName: fileName,
          subjects: currentSubjects,
          sourceIds: currentSourceIds,
        };

        // Extract and cache questions
        for (var sh2 = 0; sh2 < sheets.length; sh2++) {
          if (Date.now() - startTime > MAX_RUNTIME_MS) {
            state.folderQueue.push(current);
            writeBuildState(state);
            ensureResumeBuildTrigger(true);
            return false;
          }

          var activeSheet = sheets[sh2];
          var activeSubject = currentSubjects[sh2];
          var activeSourceId = currentSourceIds[sh2];

          // If another sheet earlier claimed this subject, skip duplicate extraction
          if (
            state.summaryMap[activeSubject] !== undefined &&
            !state.isFullRebuild
          ) {
            continue;
          }

          var qData = extractQuestionsOptimized(
            activeSheet,
            activeSubject,
            state.extractionWarnings,
          );
          if (state.extractionWarnings.length > 500)
            state.extractionWarnings = state.extractionWarnings.slice(-500);

          state.summaryMap[activeSubject] = qData.length;
          state.questionTypes[activeSubject] = analyzeQuestionTypes(qData);
          state.hasExplanations[activeSubject] =
            hasUsableExplanation(qData);

          var deckUUID = ensureDeckUUID(activeSubject, "deck", activeSourceId);
          if (qData.length > 0) {
            var encodedDeck = JSON.stringify(encodeDeckQuestions(qData));
            updateOrCreateCacheFile(
              cacheFolder,
              "deck-" + deckUUID + ".json",
              encodedDeck,
            );
            state.payloadVersions[activeSubject] = sha256Hex(encodedDeck);
          } else {
            state.payloadVersions[activeSubject] = sha256Hex("[]");
            var emptyFiles = findCacheFilesByName(
              cacheFolder,
              "deck-" + deckUUID + ".json",
            );
            while (emptyFiles.hasNext()) hardDeleteFile(emptyFiles.next());
          }
        }
      }

      var subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        var child = subFolders.next();
        var nextPath = pathPrefix
          ? pathPrefix + "::" + child.getName()
          : child.getName();
        state.folderQueue.push({ id: child.getId(), pathPrefix: nextPath });
      }
    }

    // Deduplicate live source identities accumulated across resumed iterations.
    var uniqueLive = Object.create(null);
    var dedupedLiveSources = [];
    for (var li = 0; li < state.liveSources.length; li++) {
      var liveSource = state.liveSources[li];
      var liveKey = getSourceKey(liveSource.sourceType, liveSource.sourceId);
      if (!uniqueLive[liveKey]) {
        uniqueLive[liveKey] = true;
        dedupedLiveSources.push(liveSource);
      }
    }
    state.liveSources = dedupedLiveSources;

    var liveDedupeResult = dedupeLiveSubjects(state.liveSources);
    if (liveDedupeResult.duplicates.length) {
      state.liveSources = liveDedupeResult.deduped;
    }
    reconcileMetadataToLiveSources(state.liveSources);
    normalizeUUIDSheetParentSubjects();
    invalidateMetadataCache();

    for (var lsi = 0; lsi < state.liveSources.length; lsi++) {
      if (state.liveSources[lsi].sourceType !== "deck") continue;
      ensureDeckUUID(
        state.liveSources[lsi].subject,
        "deck",
        state.liveSources[lsi].sourceId,
      );
    }
    invalidateMetadataCache();

    var compactSummary = buildSummaryArrayFromAccessState(state);
    var summaryJson = JSON.stringify(compactSummary);

    updateOrCreateCacheFile(cacheFolder, "MRH_Summary.json", summaryJson);

    var version = setCacheVersionProperties(
      String(Date.now()) +
        "-" +
        Utilities.getUuid().replace(/-/g, "").slice(0, 8),
    );

    props.setProperty("LAST_CACHE_BUILD_SUCCESS", new Date().toISOString());
    props.setProperty("LAST_MODIFICATION_TIMESTAMP", new Date().toISOString());

    var extractionWarnings = state.extractionWarnings || [];
    if (extractionWarnings.length) {
      updateOrCreateCacheFile(
        cacheFolder,
        "MRH_ExtractionWarnings.json",
        JSON.stringify(extractionWarnings.slice(-500)),
      );
      props.setProperty(
        "MRH_EXTRACTION_WARNING_COUNT",
        String(extractionWarnings.length),
      );
    } else {
      var staleWarningFiles = findCacheFilesByName(
        cacheFolder,
        "MRH_ExtractionWarnings.json",
      );
      while (staleWarningFiles.hasNext())
        hardDeleteFile(staleWarningFiles.next());
      props.deleteProperty("MRH_EXTRACTION_WARNING_COUNT");
    }

    // Purge orphaned deck cache files
    var liveUUIDs = Object.create(null);
    var metadataFinal = loadDeckMetadataMap(true);
    for (var cachedSubject in state.summaryMap) {
      if (
        !Object.prototype.hasOwnProperty.call(state.summaryMap, cachedSubject)
      )
        continue;
      if (Number(state.summaryMap[cachedSubject] || 0) <= 0) continue;
      if (metadataFinal[cachedSubject] && metadataFinal[cachedSubject].uuid)
        liveUUIDs[metadataFinal[cachedSubject].uuid] = true;
    }

    var cachedFiles = cacheFolder.getFiles();
    while (cachedFiles.hasNext()) {
      var cFile = cachedFiles.next();
      var cName = cFile.getName();
      var match = /^deck-([A-F0-9-]+)\.json$/i.exec(cName);
      if (match && !liveUUIDs[match[1]]) hardDeleteFile(cFile);
      if (/^SUBJ_/.test(cName)) hardDeleteFile(cFile);
      if (
        [
          "MRH_Access",
          "MRH_Access.json",
          "MRH_Passwords",
          "MRH_Passwords.json",
        ].indexOf(cName) !== -1
      )
        hardDeleteFile(cFile);
    }

    // Persist large file index to Drive cache folder (avoids 9KB ScriptProperties quota)
    writePersistentFileIndex(
      cacheFolder,
      state.newFileTimestamps,
      state.newFileMetadata,
    );

    props.setProperty("PERM_FOLDER_ID", cacheFolder.getId());
    props.setProperty("MRH_SUBJECT_SCHEMA_VERSION", SUBJECT_SCHEMA_VERSION);
    props.setProperty("BUILD_STATUS", "IDLE");
    props.setProperty("LAST_CACHE_BUILD_VERSION", version);
    props.deleteProperty("BUILD_CACHE_STATE");
    props.deleteProperty("FORCE_REBUILD");
    deleteBuildStateFile();

    clearResumeTriggers();
    return true;
  } catch (error) {
    Logger.log(
      "[buildDatabaseCache] ERROR: " +
        (error && error.stack ? error.stack : error),
    );
    props.setProperty("BUILD_STATUS", "FAILED");
    props.setProperty(
      "BUILD_LAST_ERROR",
      cleanText(error && error.message ? error.message : error, 1000),
    );
    clearResumeTriggers(); // Ensure triggers do not spin indefinitely on fatal errors
    return false;
  } finally {
    if (acquiredHere && lock) lock.releaseLock();
  }
}

function clearResumeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === RESUME_TRIGGER_HANDLER)
      ScriptApp.deleteTrigger(triggers[i]);
  }
}

/* -------------------------------------------------------------------------- */
/* Full reset                                                                 */
/* -------------------------------------------------------------------------- */

function resetEverythingAndStartFresh() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(BUILDER_LOCK_TIMEOUT_MS))
    throw new Error("Another database operation is currently running.");

  var props = getScriptProps();
  try {
    var uuidSheet = getOrInitializeUUIDSheet();
    if (uuidSheet.getLastRow() > 1)
      uuidSheet.deleteRows(2, uuidSheet.getLastRow() - 1);

    var cacheFolder = getOrCreateCacheFolder(true);
    var files = cacheFolder.getFiles();
    while (files.hasNext()) hardDeleteFile(files.next());

    var keys = props.getKeys();
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (
        key.indexOf("PERM_FILE_ID_") === 0 ||
        [
          "PERM_FOLDER_ID",
          "BUILD_CACHE_STATE",
          "FORCE_REBUILD",
          "MRH_CACHE_VERSION",
          "MRH_CACHE_VERSION_TIMESTAMP",
          "CACHE_VER",
          "BUILD_CACHE_REBUILD_INPROGRESS",
          "MRH_FILE_TIMESTAMPS",
          "MRH_FILE_SUBJECTS",
          "MRH_LEGACY_SUBJECT_MIGRATED",
          "MRH_SUBJECT_SCHEMA_VERSION",
          "LAST_CACHE_BUILD_SUCCESS",
          "LAST_CACHE_BUILD_VERSION",
          "BUILD_STATUS",
          "BUILD_LAST_ERROR",
          "LAST_MODIFICATION_TIMESTAMP",
          "MRH_DUPLICATE_SUBJECTS",
          "MRH_EXTRACTION_WARNING_COUNT",
        ].indexOf(key) !== -1
      )
        props.deleteProperty(key);
    }

    props.setProperty("FORCE_REBUILD", "true");
    invalidateMetadataCache();
    var rebuilt = buildDatabaseCache(true);
    var version = getCacheInvalidationVersion();

    return {
      status: "success",
      message: rebuilt
        ? "All metadata and caches were reset and the database was rebuilt."
        : "All metadata and caches were reset; rebuild is pending.",
      buildCacheTriggered: rebuilt,
      cacheVersion: version,
    };
  } catch (error) {
    Logger.log("[resetEverythingAndStartFresh] " + error);
    throw new Error("Failed to reset: " + error.toString());
  } finally {
    lock.releaseLock();
  }
}
