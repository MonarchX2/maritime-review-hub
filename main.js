const ROOT_FOLDER_ID = "17mLY-shklRGCZWQfq8AbrPkPTRcOUv2z";

const ADMIN_TOKEN =
  PropertiesService.getScriptProperties().getProperty("ADMIN_TOKEN");
const REPORTS_SHEET_ID = "1ayMYqK47eoYkXU9D2OwHa2X13d4sJUuDo9GDUIjkTbs";
const PASSWORDS_SHEET_ID = "1t_qiGOe5GaYLgmxWwV2Muu5dZaJxL6RYzPsEFK42Xj4";

// MAX RUNTIME SAFEGUARD: Stop execution at 4.5 minutes (270,000 ms) to avoid 6-min hard limit
const MAX_RUNTIME_MS = 270000;
const MAX_REPORT_TEXT_LENGTH = 10000;
const MAX_FEEDBACK_LENGTH = 10000;

function jsonResponse(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function cleanText(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).trim().substring(0, maxLength);
}

function isAdminTokenValid(data) {
  return Boolean(ADMIN_TOKEN) && data && data.token === ADMIN_TOKEN;
}

// ==========================================
// 1. HTTP GET - SERVE DATA FAST FROM SPLIT CACHE
// ==========================================
function doGet(e) {
  var requestedSubject = e.parameter.subject || "";
  var providedPassword = e.parameter.password || "";

  var cache = CacheService.getScriptCache();
  var props = PropertiesService.getScriptProperties();

  var cacheVer = props.getProperty("CACHE_VER") || "1";
  var rawKeyStr = requestedSubject + "::" + providedPassword + "::v" + cacheVer;
  var baseKey =
    "mrh_" +
    Utilities.base64EncodeWebSafe(
      Utilities.newBlob(rawKeyStr).getBytes(),
    ).substring(0, 150);

  var chunkCountStr = cache.get(baseKey + "_count");
  if (chunkCountStr) {
    var chunkCount = parseInt(chunkCountStr, 10);
    var keys = [];
    for (var i = 0; i < chunkCount; i++) keys.push(baseKey + "_" + i);

    var chunks = cache.getAll(keys);
    var fullData = "";
    var allFound = true;
    for (var i = 0; i < chunkCount; i++) {
      if (chunks[baseKey + "_" + i]) {
        fullData += chunks[baseKey + "_" + i];
      } else {
        allFound = false;
        break;
      }
    }
    if (allFound) {
      return ContentService.createTextOutput(fullData).setMimeType(
        ContentService.MimeType.JSON,
      );
    }
  }

  var responseString = "[]";

  function getFileContent(fileName) {
    var fileIdKey = "PERM_FILE_ID_" + fileName;
    var savedFileId = props.getProperty(fileIdKey);

    if (savedFileId) {
      try {
        return DriveApp.getFileById(savedFileId).getBlob().getDataAsString();
      } catch (err) {
        props.deleteProperty(fileIdKey);
      }
    }

    var cacheFolderId = props.getProperty("PERM_FOLDER_ID");
    var cacheFolder;

    if (cacheFolderId) {
      try {
        cacheFolder = DriveApp.getFolderById(cacheFolderId);
      } catch (err) {
        cacheFolder = null;
        props.deleteProperty("PERM_FOLDER_ID");
      }
    }

    if (!cacheFolder) {
      var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
      var cacheFolders = rootFolder.searchFolders(
        "title='MRH_Caches' and trashed=false",
      );
      if (!cacheFolders.hasNext()) return null;

      cacheFolder = cacheFolders.next();
      props.setProperty("PERM_FOLDER_ID", cacheFolder.getId());
    }

    var files = cacheFolder.searchFiles(
      "title='" + fileName + "' and trashed=false",
    );
    if (files.hasNext()) {
      var file = files.next();
      props.setProperty(fileIdKey, file.getId());
      return file.getBlob().getDataAsString();
    }
    return null;
  }

  if (requestedSubject) {
    var passDataStr = getFileContent("MRH_Passwords.json");
    if (passDataStr) {
      try {
        var passData = JSON.parse(passDataStr);
        for (var i = 0; i < passData.length; i++) {
          if (passData[i].Subject === requestedSubject) {
            var requiredPassword = passData[i].password;
            if (
              requiredPassword !== "" &&
              providedPassword !== requiredPassword
            ) {
              return ContentService.createTextOutput(
                JSON.stringify({ error: "Incorrect Password." }),
              ).setMimeType(ContentService.MimeType.JSON);
            }
            break;
          }
        }
      } catch (err) {
        return ContentService.createTextOutput(
          JSON.stringify({ error: "Internal Security Error" }),
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    var safeName = Utilities.base64EncodeWebSafe(
      Utilities.newBlob(requestedSubject).getBytes(),
    );
    var subjContent = getFileContent("SUBJ_" + safeName + ".json");
    if (subjContent) responseString = subjContent;
  } else {
    var summaryContent = getFileContent("MRH_Summary.json");
    if (summaryContent) responseString = summaryContent;
  }

  try {
    var maxStr = 90000;
    if (responseString.length > 0) {
      var chunksTotal = Math.ceil(responseString.length / maxStr);
      var cacheObj = {};
      cacheObj[baseKey + "_count"] = chunksTotal.toString();
      for (var c = 0; c < chunksTotal; c++) {
        cacheObj[baseKey + "_" + c] = responseString.substring(
          c * maxStr,
          (c + 1) * maxStr,
        );
      }
      cache.putAll(cacheObj, 21600);
    }
  } catch (err) {}

  return ContentService.createTextOutput(responseString).setMimeType(
    ContentService.MimeType.JSON,
  );
}

// ==========================================
// 2. HTTP POST - ADMIN & TELEMETRY
// ==========================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({
        status: "error",
        message: "Request body is required.",
      });
    }

    var data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return jsonResponse({
        status: "error",
        message: "Invalid request body.",
      });
    }
    var requestType = data.type || "telemetry";

    if (requestType === "telemetry") {
      var cache = CacheService.getScriptCache();
      var lock = LockService.getScriptLock();
      if (lock.tryLock(3000)) {
        var currentCache = cache.get("TELEMETRY_QUEUE");
        var queue = currentCache ? JSON.parse(currentCache) : [];
        queue.push([
          new Date().toISOString(),
          data.userId,
          data.action,
          data.details,
        ]);
        cache.put("TELEMETRY_QUEUE", JSON.stringify(queue), 21600);
        lock.releaseLock();
      }
      return ContentService.createTextOutput(
        JSON.stringify({ status: "success", route: "telemetry" }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "admin_get_subjects") {
      if (!isAdminTokenValid(data))
        return jsonResponse({
          status: "error",
          message: "Unauthorized access.",
        });

      var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
      var cacheFolders = rootFolder.searchFolders(
        "title='MRH_Caches' and trashed=false",
      );
      if (!cacheFolders.hasNext())
        return ContentService.createTextOutput(JSON.stringify([])).setMimeType(
          ContentService.MimeType.JSON,
        );

      var cacheFolder = cacheFolders.next();
      var summaryFiles = cacheFolder.searchFiles(
        "title='MRH_Summary.json' and trashed=false",
      );
      var passFiles = cacheFolder.searchFiles(
        "title='MRH_Passwords.json' and trashed=false",
      );

      var summaryData = [];
      var passMap = {};

      if (summaryFiles.hasNext()) {
        try {
          summaryData = JSON.parse(
            summaryFiles.next().getBlob().getDataAsString(),
          );
        } catch (err) {}
      }
      if (passFiles.hasNext()) {
        try {
          var passData = JSON.parse(
            passFiles.next().getBlob().getDataAsString(),
          );
          for (var i = 0; i < passData.length; i++) {
            passMap[passData[i].Subject] = passData[i].password;
          }
        } catch (err) {}
      }

      var combined = summaryData.map(function (item) {
        var p = passMap[item.Subject] || "";
        return {
          Subject: item.Subject,
          QuestionCount: item.QuestionCount,
          Locked: item.Locked,
          Password: p,
          password: p,
          IsFolder: item.IsFolder || false,
        };
      });
      return ContentService.createTextOutput(
        JSON.stringify(combined),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "verify_admin") {
      return jsonResponse({
        status: isAdminTokenValid(data) ? "success" : "error",
      });
    }

    if (requestType === "verify_user") {
      var cache = CacheService.getScriptCache();
      var cachedUsers = cache.get("MRH_USERS_CACHE");
      var userData;

      if (cachedUsers) {
        userData = JSON.parse(cachedUsers);
      } else {
        var userSs = SpreadsheetApp.openById(PASSWORDS_SHEET_ID);
        var userSheet = userSs.getSheetByName("USERS");
        if (!userSheet)
          return ContentService.createTextOutput(
            JSON.stringify({
              status: "error",
              message: "USERS sheet not found in database.",
            }),
          ).setMimeType(ContentService.MimeType.JSON);

        userData = userSheet.getDataRange().getValues();
        cache.put("MRH_USERS_CACHE", JSON.stringify(userData), 900);
      }

      for (var u = 1; u < userData.length; u++) {
        if (
          userData[u][0] === data.username &&
          userData[u][1] === data.password
        ) {
          return ContentService.createTextOutput(
            JSON.stringify({ status: "success" }),
          ).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(
        JSON.stringify({ status: "error", message: "Invalid credentials." }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "admin_update_password") {
      if (!isAdminTokenValid(data))
        return jsonResponse({
          status: "error",
          message: "Unauthorized access.",
        });

      var passSs = SpreadsheetApp.openById(PASSWORDS_SHEET_ID);
      var passSheet =
        passSs.getSheetByName("DECK") || passSs.insertSheet("DECK");

      var passData = passSheet.getDataRange().getValues();
      var updated = false;

      for (var p = 1; p < passData.length; p++) {
        if (passData[p][0] === data.deck) {
          passSheet.getRange(p + 1, 2).setValue(data.password);
          updated = true;
          break;
        }
      }
      if (!updated) passSheet.appendRow([data.deck, data.password]);

      triggerBuildDatabaseCache();
      return ContentService.createTextOutput(
        JSON.stringify({ status: "success" }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "submit_report") {
      var reportChoices = data.choices || {};
      var reportQuestionId = cleanText(data.questionId, 200);
      var reportSubject = cleanText(data.subject, 500);
      var reportQuestionText = cleanText(
        data.questionText,
        MAX_REPORT_TEXT_LENGTH,
      );
      var reportErrorType = cleanText(data.errorType, 200);
      if (
        !reportQuestionId ||
        !reportSubject ||
        !reportQuestionText ||
        !reportErrorType
      ) {
        return jsonResponse({
          status: "error",
          message: "Question, subject, and error type are required.",
        });
      }

      var ss = SpreadsheetApp.openById(REPORTS_SHEET_ID);
      var sheet =
        ss.getSheetByName("MRH_Reports") || ss.insertSheet("MRH_Reports");
      sheet.appendRow([
        Utilities.getUuid(),
        new Date().toISOString(),
        reportQuestionId,
        reportSubject,
        reportQuestionText,
        reportErrorType,
        cleanText(data.comments, MAX_REPORT_TEXT_LENGTH),
        "Pending",
        "",
        cleanText(
          data.optionA !== undefined ? data.optionA : reportChoices.A,
          2000,
        ),
        cleanText(
          data.optionB !== undefined ? data.optionB : reportChoices.B,
          2000,
        ),
        cleanText(
          data.optionC !== undefined ? data.optionC : reportChoices.C,
          2000,
        ),
        cleanText(
          data.optionD !== undefined ? data.optionD : reportChoices.D,
          2000,
        ),
        cleanText(data.correctAnswer, 200),
        cleanText(data.lesson, 500),
      ]);
      return jsonResponse({ status: "success" });
    }

    if (requestType === "submit_feedback") {
      var feedback = cleanText(data.comments, MAX_FEEDBACK_LENGTH);
      if (!feedback)
        return jsonResponse({
          status: "error",
          message: "Feedback cannot be empty.",
        });

      var feedbackSs = SpreadsheetApp.openById(REPORTS_SHEET_ID);
      var feedbackSheet =
        feedbackSs.getSheetByName("MRH_Feedback") ||
        feedbackSs.insertSheet("MRH_Feedback");
      if (feedbackSheet.getLastRow() === 0) {
        feedbackSheet.appendRow(["Timestamp", "User ID", "Comments"]);
      }
      feedbackSheet.appendRow([
        new Date().toISOString(),
        cleanText(data.userId, 200),
        feedback,
      ]);
      return jsonResponse({ status: "success" });
    }

    if (requestType === "get_reports") {
      if (data.role === "admin" && !isAdminTokenValid(data)) {
        return jsonResponse({
          status: "error",
          message: "Unauthorized access.",
        });
      }
      var ss = SpreadsheetApp.openById(REPORTS_SHEET_ID);
      var sheet = ss.getSheetByName("MRH_Reports");
      if (!sheet)
        return ContentService.createTextOutput(JSON.stringify([])).setMimeType(
          ContentService.MimeType.JSON,
        );

      var rows = sheet.getDataRange().getValues();
      var reports = [];
      var now = new Date().getTime();

      for (var i = 1; i < rows.length; i++) {
        var status = rows[i][7];
        var resolvedDateStr = rows[i][8];

        if (status === "Resolved" && resolvedDateStr && data.role !== "admin") {
          if (now - new Date(resolvedDateStr).getTime() > 86400000) continue;
        }

        reports.push({
          id: rows[i][0],
          timestamp: rows[i][1],
          questionId: rows[i][2],
          subject: rows[i][3],
          questionText: rows[i][4],
          errorType: rows[i][5],
          comments: rows[i][6],
          lesson: rows[i][14] || "",
          status: status,
          optionA: rows[i][9] || "",
          optionB: rows[i][10] || "",
          optionC: rows[i][11] || "",
          optionD: rows[i][12] || "",
          correctAnswer: rows[i][13] || "",
        });
      }
      return ContentService.createTextOutput(
        JSON.stringify(reports.reverse()),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "admin_resolve_report") {
      if (!isAdminTokenValid(data))
        return jsonResponse({ status: "error", message: "Unauthorized." });

      var ss = SpreadsheetApp.openById(REPORTS_SHEET_ID);
      var sheet = ss.getSheetByName("MRH_Reports");
      if (!sheet)
        return jsonResponse({
          status: "error",
          message: "Reports sheet not found.",
        });
      var rows = sheet.getDataRange().getValues();
      if (!["resolve", "delete"].includes(data.action)) {
        return jsonResponse({
          status: "error",
          message: "Unsupported report action.",
        });
      }

      for (var i = 1; i < rows.length; i++) {
        if (rows[i][0] === data.reportId) {
          if (data.action === "resolve") {
            sheet.getRange(i + 1, 8).setValue("Resolved");
            sheet.getRange(i + 1, 9).setValue(new Date().toISOString());
          } else if (data.action === "delete") {
            sheet.deleteRow(i + 1);
          }
          return ContentService.createTextOutput(
            JSON.stringify({ status: "success" }),
          ).setMimeType(ContentService.MimeType.JSON);
        }
      }
      return ContentService.createTextOutput(
        JSON.stringify({ status: "error", message: "Report not found." }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "admin_update") {
      if (!isAdminTokenValid(data))
        return jsonResponse({ status: "error", message: "Unauthorized." });

      var updates = Array.isArray(data.updates) ? data.updates : [];
      if (updates.length > 200) {
        return jsonResponse({
          status: "error",
          message: "Too many updates in one request.",
        });
      }
      var renamedCount = 0;
      var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);

      var passSs = SpreadsheetApp.openById(PASSWORDS_SHEET_ID);
      var passSheet =
        passSs.getSheetByName("DECK") || passSs.insertSheet("DECK");

      var passData = passSheet.getDataRange().getValues();
      var passMap = {};
      for (var p = 1; p < passData.length; p++) {
        if (passData[p][0])
          passMap[passData[p][0]] = String(passData[p][1] || "");
      }

      var fileIterator = rootFolder.searchFiles(
        "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
      );
      var localFiles = [];
      while (fileIterator.hasNext()) {
        var f = fileIterator.next();
        localFiles.push({ file: f, name: f.getName() });
      }

      for (var i = 0; i < updates.length; i++) {
        var update = updates[i];
        if (
          !update ||
          typeof update.oldName !== "string" ||
          typeof update.newName !== "string"
        )
          continue;
        update.oldName = cleanText(update.oldName, 100);
        update.newName = cleanText(update.newName, 100);
        if (update.newName.length > 100) continue;

        var oldPass = passMap[update.oldName];
        if (update.newName !== update.oldName) {
          delete passMap[update.oldName];
          if (update.password !== undefined && update.password !== "")
            passMap[update.newName] = update.password;
          else if (
            oldPass &&
            (update.password === undefined || update.password === oldPass)
          )
            passMap[update.newName] = oldPass;
        } else {
          if (update.password !== undefined) {
            if (update.password === "") delete passMap[update.oldName];
            else passMap[update.oldName] = update.password;
          }
        }

        if (update.newName === update.oldName) {
          renamedCount++;
          continue;
        }

        var oldParts = update.oldName.split("::");
        var newParts = update.newName.split("::");

        var possibleName1 = oldParts[oldParts.length - 1].trim();
        var possibleName2 =
          oldParts.length > 1
            ? oldParts[oldParts.length - 2].trim()
            : possibleName1;

        var foundAndRenamed = false;

        for (var fIdx = 0; fIdx < localFiles.length; fIdx++) {
          var file = localFiles[fIdx].file;
          var fileName = localFiles[fIdx].name;

          if (fileName === possibleName1 || fileName === possibleName2) {
            var ss = SpreadsheetApp.open(file);
            var isSingleSheet = ss.getSheets().length === 1;

            if (isSingleSheet) {
              if (fileName === possibleName1) {
                var newFileName = newParts[newParts.length - 1].trim();
                file.setName(newFileName);
                ss.getSheets()[0].setName(newFileName);
                localFiles[fIdx].name = newFileName;
                foundAndRenamed = true;
                break;
              }
            } else {
              if (fileName === possibleName2) {
                var sheet = ss.getSheetByName(possibleName1);
                if (sheet) {
                  var newSheetName = newParts[newParts.length - 1].trim();
                  var newFileName2 =
                    newParts.length > 1
                      ? newParts[newParts.length - 2].trim()
                      : newSheetName;
                  if (fileName !== newFileName2) {
                    file.setName(newFileName2);
                    localFiles[fIdx].name = newFileName2;
                  }
                  if (sheet.getName() !== newSheetName)
                    sheet.setName(newSheetName);
                  foundAndRenamed = true;
                  break;
                }
              }
            }
          }
        }
        if (foundAndRenamed) renamedCount++;
      }

      var outData = [["Deck Name", "Password"]];
      for (var k in passMap) outData.push([k, passMap[k]]);

      passSheet.clearContents();
      if (outData.length > 0)
        passSheet.getRange(1, 1, outData.length, 2).setValues(outData);

      triggerBuildDatabaseCache();
      return ContentService.createTextOutput(
        JSON.stringify({
          status: "success",
          message: "Successfully updated " + renamedCount + " items!",
        }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (requestType === "admin_edit_question") {
      if (data.token !== ADMIN_TOKEN)
        return ContentService.createTextOutput(
          JSON.stringify({ status: "error", message: "Unauthorized access." }),
        ).setMimeType(ContentService.MimeType.JSON);

      var subject = data.subject || "";
      var questionId = data.questionId || "";
      if (!subject || !questionId)
        return ContentService.createTextOutput(
          JSON.stringify({
            status: "error",
            message: "Missing subject or question ID.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);

      var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
      var parts = subject.split("::");
      var possibleName1 = parts[parts.length - 1].trim();
      var possibleName2 =
        parts.length > 1 ? parts[parts.length - 2].trim() : possibleName1;

      var query =
        "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and (title='" +
        possibleName1.replace(/'/g, "\\'") +
        "' or title='" +
        possibleName2.replace(/'/g, "\\'") +
        "')";
      var files = rootFolder.searchFiles(query);
      var targetSheet = null;

      while (files.hasNext()) {
        var file = files.next();
        var ss = SpreadsheetApp.open(file);
        var sheets = ss.getSheets();

        if (sheets.length === 1 && file.getName() === possibleName1) {
          targetSheet = sheets[0];
          break;
        } else {
          if (file.getName() === possibleName2) {
            targetSheet = ss.getSheetByName(possibleName1);
            if (targetSheet) break;
          } else if (file.getName() === possibleName1) {
            targetSheet = ss.getSheetByName(possibleName1);
            if (targetSheet) break;
          }
        }
      }

      if (!targetSheet)
        return ContentService.createTextOutput(
          JSON.stringify({
            status: "error",
            message: "Target sheet not found.",
          }),
        ).setMimeType(ContentService.MimeType.JSON);

      var idIndex = parseInt(questionId.split("-").pop(), 10);
      var rowNumber = idIndex + 1;

      if (
        isNaN(rowNumber) ||
        rowNumber <= 1 ||
        rowNumber > targetSheet.getLastRow()
      )
        return ContentService.createTextOutput(
          JSON.stringify({ status: "error", message: "Invalid question row." }),
        ).setMimeType(ContentService.MimeType.JSON);

      targetSheet
        .getRange(rowNumber, 1, 1, 5)
        .setValues([
          [
            (data.questionText || "").trim(),
            (data.optionA || "").trim(),
            (data.optionB || "").trim(),
            (data.optionC || "").trim(),
            (data.optionD || "").trim(),
          ],
        ]);

      var optionsRange = targetSheet.getRange(rowNumber, 2, 1, 4);
      optionsRange.setFontWeights([["normal", "normal", "normal", "normal"]]);

      var ans = (data.correctAnswer || "").trim().toUpperCase();
      if (ans === "A") targetSheet.getRange(rowNumber, 2).setFontWeight("bold");
      else if (ans === "B")
        targetSheet.getRange(rowNumber, 3).setFontWeight("bold");
      else if (ans === "C")
        targetSheet.getRange(rowNumber, 4).setFontWeight("bold");
      else if (ans === "D")
        targetSheet.getRange(rowNumber, 5).setFontWeight("bold");

      triggerBuildDatabaseCache();

      try {
        var rawKeyStr = subject + "::";
        var baseKey =
          "mrh_" +
          Utilities.base64EncodeWebSafe(
            Utilities.newBlob(rawKeyStr).getBytes(),
          ).substring(0, 150);
        var cache = CacheService.getScriptCache();
        var chunkCountStr = cache.get(baseKey + "_count");
        if (chunkCountStr) {
          var chunkCount = parseInt(chunkCountStr, 10);
          var keysToRemove = [baseKey + "_count"];
          for (var c = 0; c < chunkCount; c++)
            keysToRemove.push(baseKey + "_" + c);
          cache.removeAll(keysToRemove);
        }
      } catch (e) {}

      return ContentService.createTextOutput(
        JSON.stringify({
          status: "success",
          message: "Question updated successfully!",
        }),
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: "Unknown request type." }),
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify({ status: "error", message: error.toString() }),
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// ==========================================
// 3. QUEUE-BASED CONTINUATION CACHE GENERATOR
// ==========================================
function triggerBuildDatabaseCache() {
  var props = PropertiesService.getScriptProperties();
  props.deleteProperty("BUILD_CACHE_STATE");
  cleanResumptionTriggers();
  buildDatabaseCache();
}

function forceFullRebuildCache() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("FORCE_REBUILD", "true");
  triggerBuildDatabaseCache();
}

function cleanResumptionTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "resumeBuildDatabaseCache") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function resumeBuildDatabaseCache() {
  cleanResumptionTriggers();
  buildDatabaseCache();
}

function buildDatabaseCache() {
  var startTime = Date.now();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log("Cache generation lock active. Exiting.");
    return;
  }

  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var stateJson = scriptProps.getProperty("BUILD_CACHE_STATE");
    var isFullRebuild = scriptProps.getProperty("FORCE_REBUILD") === "true";

    var state;
    if (stateJson) {
      state = JSON.parse(stateJson);
    } else {
      var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
      var cacheFolders = rootFolder.searchFolders(
        "title='MRH_Caches' and trashed=false",
      );
      var cacheFolder = cacheFolders.hasNext()
        ? cacheFolders.next()
        : rootFolder.createFolder("MRH_Caches");

      var oldSummaryMap = {};
      if (!isFullRebuild) {
        var summaryFiles = cacheFolder.searchFiles(
          "title='MRH_Summary.json' and trashed=false",
        );
        if (summaryFiles.hasNext()) {
          try {
            var summaryData = JSON.parse(
              summaryFiles.next().getBlob().getDataAsString(),
            );
            for (var i = 0; i < summaryData.length; i++)
              oldSummaryMap[summaryData[i].Subject] =
                summaryData[i].QuestionCount;
          } catch (e) {
            isFullRebuild = true;
          }
        } else {
          isFullRebuild = true;
        }
      }

      var fileTimestamps = {};
      try {
        fileTimestamps = JSON.parse(
          scriptProps.getProperty("MRH_FILE_TIMESTAMPS") || "{}",
        );
      } catch (e) {}

      state = {
        folderQueue: [{ id: ROOT_FOLDER_ID, pathPrefix: "" }],
        summaryMap: {},
        oldSummaryMap: oldSummaryMap,
        activeSubjects: {},
        cacheFolderId: cacheFolder.getId(),
        fileTimestamps: fileTimestamps,
        newFileTimestamps: {},
        isFullRebuild: isFullRebuild,
      };
    }

    var cacheFolder = DriveApp.getFolderById(state.cacheFolderId);

    while (state.folderQueue.length > 0) {
      // SAFEGUARD CHECK: Pause and schedule trigger if approaching timeout limit
      if (Date.now() - startTime > MAX_RUNTIME_MS) {
        scriptProps.setProperty("BUILD_CACHE_STATE", JSON.stringify(state));
        ScriptApp.newTrigger("resumeBuildDatabaseCache")
          .timeBased()
          .after(10000)
          .create();
        Logger.log(
          "Safe runtime limit hit (4.5 min). Scheduled continuation trigger.",
        );
        return;
      }

      var currentTarget = state.folderQueue.shift();
      var folder = DriveApp.getFolderById(currentTarget.id);
      var pathPrefix = currentTarget.pathPrefix;

      // Scan Files in current folder
      var files = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
      while (files.hasNext()) {
        var file = files.next();
        var fileId = file.getId();
        var fileName = file.getName();
        if (
          fileName === "MRH_Telemetry" ||
          fileName === "MRH_Passwords" ||
          fileName.indexOf("MRH_Reports") > -1
        )
          continue;

        var lastUpdated = file.getLastUpdated().getTime();
        state.newFileTimestamps[fileId] = lastUpdated;

        var previousTimestamp = state.fileTimestamps[fileId] || 0;
        var isModified = lastUpdated > previousTimestamp;

        if (!isModified && !state.isFullRebuild) {
          var fileBase = pathPrefix ? pathPrefix + "::" + fileName : fileName;
          var foundAny = false;
          for (var oldSubj in state.oldSummaryMap) {
            if (
              oldSubj === fileBase ||
              oldSubj.indexOf(fileBase + "::") === 0
            ) {
              state.activeSubjects[oldSubj] = true;
              state.summaryMap[oldSubj] = state.oldSummaryMap[oldSubj];
              foundAny = true;
            }
          }
          if (foundAny) continue;
        }

        var ss = SpreadsheetApp.open(file);
        var sheets = ss.getSheets();
        var isSingleSheetFile = sheets.length === 1;

        for (var i = 0; i < sheets.length; i++) {
          var sheet = sheets[i];
          var subjectName = pathPrefix ? pathPrefix + "::" : "";
          subjectName += isSingleSheetFile
            ? fileName
            : fileName === sheet.getName()
              ? fileName
              : fileName + "::" + sheet.getName();

          var qData = extractQuestionsOptimized(sheet, subjectName);

          if (qData.length > 0) {
            state.activeSubjects[subjectName] = true;
            var safeName = Utilities.base64EncodeWebSafe(
              Utilities.newBlob(subjectName).getBytes(),
            );
            updateOrCreateCacheFile(
              cacheFolder,
              "SUBJ_" + safeName + ".json",
              JSON.stringify(qData),
            );
            state.summaryMap[subjectName] = qData.length;
          }
        }
      }

      // Add subfolders to Queue
      var subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        var subFolder = subFolders.next();
        var nextPath = pathPrefix
          ? pathPrefix + "::" + subFolder.getName()
          : subFolder.getName();
        state.folderQueue.push({ id: subFolder.getId(), pathPrefix: nextPath });
      }
    }

    // FINALIZATION PHASE
    scriptProps.setProperty(
      "MRH_FILE_TIMESTAMPS",
      JSON.stringify(state.newFileTimestamps),
    );

    var passMap = {};
    try {
      var passSs = SpreadsheetApp.openById(PASSWORDS_SHEET_ID);
      var passSheet = passSs.getSheetByName("DECK");
      if (passSheet) {
        var passData = passSheet.getDataRange().getValues();
        for (var p = 1; p < passData.length; p++) {
          if (passData[p][0])
            passMap[passData[p][0]] = String(passData[p][1] || "");
        }
      }
    } catch (e) {}

    var summaryArray = [];
    var passwordsArray = [];
    var processedKeys = {};

    for (var key in state.summaryMap) {
      var storedPass = passMap[key] || "";
      processedKeys[key] = true;
      summaryArray.push({
        Subject: key,
        QuestionCount: state.summaryMap[key],
        Locked: storedPass !== "",
      });
      passwordsArray.push({ Subject: key, password: storedPass });
    }

    for (var passKey in passMap) {
      if (!processedKeys[passKey] && passMap[passKey] !== "") {
        summaryArray.push({
          Subject: passKey,
          QuestionCount: 0,
          Locked: true,
          IsFolder: true,
        });
        passwordsArray.push({ Subject: passKey, password: passMap[passKey] });
      }
    }

    updateOrCreateCacheFile(
      cacheFolder,
      "MRH_Summary.json",
      JSON.stringify(summaryArray),
    );
    updateOrCreateCacheFile(
      cacheFolder,
      "MRH_Passwords.json",
      JSON.stringify(passwordsArray),
    );

    var cachedFiles = cacheFolder.searchFiles(
      "title contains 'SUBJ_' and trashed=false",
    );
    while (cachedFiles.hasNext()) {
      var cFile = cachedFiles.next();
      var cName = cFile.getName();
      if (cName.indexOf("SUBJ_") === 0 && cName.indexOf(".json") > 0) {
        var base64Part = cName.substring(5, cName.length - 5);
        try {
          var decodedSubject = Utilities.newBlob(
            Utilities.base64DecodeWebSafe(base64Part),
          ).getDataAsString();
          if (!state.activeSubjects[decodedSubject]) hardDeleteFile(cFile);
        } catch (e) {
          hardDeleteFile(cFile);
        }
      }
    }

    scriptProps.setProperty("CACHE_VER", new Date().getTime().toString());
    scriptProps.deleteProperty("BUILD_CACHE_STATE");
    scriptProps.deleteProperty("FORCE_REBUILD");
    Logger.log("Database cache successfully updated!");
  } finally {
    lock.releaseLock();
  }
}

// OPTIMIZED EXTRACTION: Batches formatting retrieval to save API calls
function extractQuestionsOptimized(sheet, subjectName) {
  var db = [];
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return db;

  var range = sheet.getRange(1, 1, lastRow, 7);
  var data = range.getValues();

  // Single pass background and font weight reads
  var backgrounds = range.getBackgrounds();
  var fontWeights = range.getFontWeights();
  var fontColors = range.getFontColors();

  var idPrefix = subjectName.split("::").pop().substring(0, 3).toUpperCase();

  for (var j = 1; j < data.length; j++) {
    var row = data[j];
    if (!row[0] || String(row[0]).trim() === "") continue;

    var ans = "";
    if (backgrounds[j][1] !== "#ffffff") ans = "A";
    else if (backgrounds[j][2] !== "#ffffff") ans = "B";
    else if (backgrounds[j][3] !== "#ffffff") ans = "C";
    else if (backgrounds[j][4] !== "#ffffff") ans = "D";
    else if (fontWeights[j][1] === "bold") ans = "A";
    else if (fontWeights[j][2] === "bold") ans = "B";
    else if (fontWeights[j][3] === "bold") ans = "C";
    else if (fontWeights[j][4] === "bold") ans = "D";
    else if (fontColors[j][1] !== "#000000") ans = "A";
    else if (fontColors[j][2] !== "#000000") ans = "B";
    else if (fontColors[j][3] !== "#000000") ans = "C";
    else if (fontColors[j][4] !== "#000000") ans = "D";

    db.push({
      Subject: subjectName,
      ID: idPrefix + "-" + j,
      Question: String(row[0]).trim(),
      ChoiceA: String(row[1]).trim(),
      ChoiceB: String(row[2]).trim(),
      ChoiceC: String(row[3]).trim(),
      ChoiceD: String(row[4]).trim(),
      Answer: ans,
      Explanation: String(row[5] || "").trim(),
      ImageURL: String(row[6] || "").trim(),
    });
  }
  return db;
}

// ==========================================
// 4. UTILITIES & TELEMETRY FLUSH
// ==========================================
function updateOrCreateCacheFile(folder, fileName, contentStr) {
  var files = folder.searchFiles("title='" + fileName + "' and trashed=false");
  if (files.hasNext()) {
    var file = files.next();
    file.setContent(contentStr);
    while (files.hasNext()) hardDeleteFile(files.next());
    return file;
  } else {
    return folder.createFile(fileName, contentStr, MimeType.PLAIN_TEXT);
  }
}

function getOrCreateTelemetrySheet() {
  var rootFolder = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var files = rootFolder.searchFiles(
    "title='MRH_Telemetry' and mimeType='application/vnd.google-apps.spreadsheet'",
  );
  if (files.hasNext()) return SpreadsheetApp.open(files.next()).getSheets()[0];

  var ss = SpreadsheetApp.create("MRH_Telemetry");
  var file = DriveApp.getFileById(ss.getId());
  file.moveTo(rootFolder);

  var sheet = ss.getSheets()[0];
  sheet.appendRow(["Timestamp", "User ID", "Action", "Details"]);
  return sheet;
}

function flushTelemetry() {
  var lock = LockService.getScriptLock();
  if (lock.tryLock(10000)) {
    var cache = CacheService.getScriptCache();
    var currentCache = cache.get("TELEMETRY_QUEUE");

    if (currentCache) {
      var queue = JSON.parse(currentCache);
      if (queue.length > 0) {
        var sheet = getOrCreateTelemetrySheet();
        sheet
          .getRange(sheet.getLastRow() + 1, 1, queue.length, 4)
          .setValues(queue);
        cache.remove("TELEMETRY_QUEUE");
      }
    }
    lock.releaseLock();
  }
}

// ==========================================
// 5. MAINTENANCE
// ==========================================
function permanentlyDeleteOldCaches() {
  var trashedFolders = DriveApp.searchFolders(
    "title='MRH_Caches' and trashed=true",
  );
  var count = 0;

  while (trashedFolders.hasNext()) {
    var folder = trashedFolders.next();
    try {
      Drive.Files.remove(folder.getId());
      count++;
    } catch (e) {
      Logger.log(
        "Failed to delete folder ID: " + folder.getId() + " - " + e.message,
      );
    }
  }
  Logger.log(
    "Success! Permanently deleted " +
      count +
      " old cache folders from the trash.",
  );
}

function hardDeleteFile(file) {
  try {
    Drive.Files.remove(file.getId());
  } catch (e) {
    file.setTrashed(true);
  }
}
