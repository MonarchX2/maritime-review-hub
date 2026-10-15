const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const backend = fs.readFileSync("backend/main.js", "utf8");
const start = backend.indexOf("var RESOURCE_PORTAL_ROOT_FOLDER_ID");
const end = backend.indexOf("\nfunction isSupportedClientVersion", start);
assert.ok(start >= 0 && end > start, "resource API helpers should exist");

const foldersById = new Map();
const makeIterator = (items) => {
  let index = 0;
  return {
    hasNext: () => index < items.length,
    next: () => items[index++],
  };
};
function makeFolder(id, name, parent = null, publicAccess = true) {
  const folder = {
    id,
    name,
    parent,
    publicAccess,
    folders: [],
    files: [],
    getId() {
      return this.id;
    },
    getName() {
      return this.name;
    },
    getParents() {
      return makeIterator(this.parent ? [this.parent] : []);
    },
    getFolders() {
      return makeIterator(this.folders);
    },
    getFiles() {
      return makeIterator(this.files);
    },
    getSharingAccess() {
      return this.publicAccess ? "ANYONE_WITH_LINK" : "PRIVATE";
    },
    getUrl() {
      return `https://drive.google.com/drive/folders/${this.id}`;
    },
  };
  foldersById.set(id, folder);
  if (parent) parent.folders.push(folder);
  return folder;
}
function makeFile(id, name, parent, publicAccess = true, mimeType = "application/pdf") {
  const file = {
    id,
    name,
    publicAccess,
    mimeType,
    getId() {
      return this.id;
    },
    getName() {
      return this.name;
    },
    getMimeType() {
      return this.mimeType;
    },
    getSharingAccess() {
      return this.publicAccess ? "ANYONE_WITH_LINK" : "PRIVATE";
    },
    getLastUpdated() {
      return new Date("2026-10-15T00:00:00Z");
    },
    getUrl() {
      return `https://drive.google.com/file/d/${this.id}/view`;
    },
  };
  parent.files.push(file);
  return file;
}

const rootId = "19LoMUsogxTHB5xrI1Gd08NASQv2Zqi6E";
const root = makeFolder(rootId, "Shared Resources");
const publicFolder = makeFolder("public-folder", "Navigation", root);
makeFile("public-file", "Chart.pdf", publicFolder);
makeFile("unshared-file", "Internal.pdf", publicFolder, false);
makeFile(
  "shortcut-file",
  "Reviewer shortcut",
  publicFolder,
  true,
  "application/vnd.google-apps.shortcut",
);
const privateFolder = makeFolder(
  "reviewers-folder",
  "REVIEWERS v.10.15.26",
  root,
  false,
);
makeFolder("nested-reviewers-folder", "Private Notes", privateFolder, false);
makeFile("private-file", "Answers.pdf", privateFolder, false);
makeFolder("non-public-folder", "Not Shared", root, false);

const context = {
  RESOURCE_PORTAL_ROOT_FOLDER_ID: rootId,
  RESOURCE_PORTAL_PRIVATE_FOLDER_PATTERN:
    /^REVIEWERS v\.\d{2}\.\d{2}\.\d{2}$/i,
  RESOURCE_PORTAL_MAX_ITEMS: 1000,
  DriveApp: {
    Access: {
      ANYONE: "ANYONE",
      ANYONE_WITH_LINK: "ANYONE_WITH_LINK",
    },
    getFolderById(id) {
      const folder = foldersById.get(id);
      if (!folder) throw new Error("missing");
      return folder;
    },
  },
  TextUtils: {
    naturalSortStrings: (left, right) =>
      left.localeCompare(right, undefined, { numeric: true }),
  },
  cleanText: (value, maxLength) =>
    String(value || "")
      .trim()
      .slice(0, maxLength),
  jsonResponse: (payload) => payload,
  errorResponse: (message, code) => ({ status: "error", message, code }),
};
vm.createContext(context);
vm.runInContext(backend.slice(start, end), context);

const listing = context.handleListPublicResourcesRequest({});
assert.equal(listing.status, "success");
assert.deepEqual(
  Array.from(listing.items, (item) => item.id),
  ["public-folder"],
  "the root listing should omit private reviewer folders and non-public folders",
);
const nestedListing = context.handleListPublicResourcesRequest({
  folderId: "public-folder",
});
assert.equal(nestedListing.status, "success");
assert.deepEqual(
  Array.from(nestedListing.items, (item) => item.id),
  ["public-file"],
  "the public listing should return a link for a public file",
);
assert.match(nestedListing.items[0].url, /^https:\/\/drive\.google\.com\//);
assert.equal(
  context.handleListPublicResourcesRequest({
    folderId: "reviewers-folder",
  }).code,
  "FORBIDDEN",
  "requesting a reviewer folder directly should be denied",
);
assert.equal(
  context.handleListPublicResourcesRequest({
    folderId: "nested-reviewers-folder",
  }).code,
  "FORBIDDEN",
  "nested folders under a reviewer folder should be denied",
);
assert.equal(
  context.isPrivateResourceFolderName("REVIEWERS v.10.15.26"),
  true,
  "the configured reviewer-folder version format should be private",
);
assert.equal(
  context.isPrivateResourceFolderName("Public Resources"),
  false,
  "ordinary public folders should not be classified as private",
);

console.log("Resource Portal privacy and listing checks passed.");
