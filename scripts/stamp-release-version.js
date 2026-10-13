const fs = require("node:fs");
const path = require("node:path");

const version = process.env.RELEASE_VERSION;
if (!version || !/^mrh-[A-Za-z0-9._-]+$/.test(version)) {
  throw new Error("RELEASE_VERSION must be a non-empty mrh- release identifier.");
}

const rootDir = path.resolve(__dirname, "..");

function replaceExactlyOne(file, pattern, replacement) {
  const filePath = path.join(rootDir, file);
  const source = fs.readFileSync(filePath, "utf8");
  const matches = [...source.matchAll(new RegExp(pattern.source, "g"))];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one release marker in ${file}.`);
  }
  fs.writeFileSync(filePath, source.replace(pattern, replacement));
}

replaceExactlyOne(
  "app-entry.js",
  /(const APP_VERSION = ")[^"]+(";)/,
  `$1${version}$2`,
);
replaceExactlyOne(
  "sw.js",
  /(const APP_VERSION = ")[^"]+(";)/,
  `$1${version}$2`,
);
replaceExactlyOne(
  "version.json",
  /("version"\s*:\s*")[^"]+(")/,
  `$1${version}$2`,
);
replaceExactlyOne(
  "manifest.json",
  /("src"\s*:\s*"icon\.svg)(?:\?v=mrh-[^"]*)?(")/,
  `$1?v=${version}$2`,
);

const indexPath = path.join(rootDir, "index.html");
let indexSource = fs.readFileSync(indexPath, "utf8");
const assetVersionPattern =
  /(href="(?:manifest\.json|icon\.svg|tailwind\.generated\.css|styles\.css))(?:\?v=mrh-[^"]*)?(")/g;
const assetMatches = [...indexSource.matchAll(assetVersionPattern)];
if (assetMatches.length !== 7) {
  throw new Error(
    `Expected exactly seven versioned local asset references in index.html; found ${assetMatches.length}.`,
  );
}
indexSource = indexSource.replace(
  assetVersionPattern,
  `$1?v=${version}$2`,
);

const appEntryPattern = /(app-entry\.js\?v=)mrh-[^"]+/g;
const appEntryMatches = [...indexSource.matchAll(appEntryPattern)];
if (appEntryMatches.length !== 1) {
  throw new Error("Expected exactly one app-entry.js release version in index.html.");
}
indexSource = indexSource.replace(appEntryPattern, `$1${version}`);
fs.writeFileSync(indexPath, indexSource);
