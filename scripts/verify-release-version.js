const fs = require("node:fs");
const path = require("node:path");
const { isDateVersion } = require("./date-version");

const expectedVersion = process.env.DISPLAY_VERSION;
if (!isDateVersion(expectedVersion)) {
  throw new Error("DISPLAY_VERSION must use the YY.MM.DD-Patch format.");
}

const rootDir = path.resolve(__dirname, "..");
const releaseMarkers = [
  [
    "app-entry.js",
    (source) =>
      source.includes("version.json") &&
      /(?:\.version\b|\[['"]version['"]\])/.test(source),
  ],
  [
    "sw.js",
    (source) =>
      source.includes("version.json") &&
      /(?:\.version\b|\[['"]version['"]\])/.test(source),
  ],
  [
    "index.html",
    (source) =>
      [...source.matchAll(/<script\b[^>]*\bsrc="[^"]+\.js\?[^"]*"[^>]*>/g)]
        .length === 0 &&
      /<script\b[^>]*\bsrc=["']?app-entry\.js["']?[^>]*><\/script>/i.test(
        source,
      ) &&
      new RegExp(
        `<p\\b(?=[^>]*\\bid=["']?site-version["']?(?:\\s|>))(?=[^>]*\\bclass=["']?site-version["']?(?:\\s|>))[^>]*>Version(?:<\\/p>)?`,
      ).test(source),
  ],
  [
    "version.json",
    (source) => JSON.parse(source).version === expectedVersion,
  ],
  [
    "manifest.json",
    (source) => JSON.parse(source).icons[0].src === "icon.svg",
  ],
];

for (const [file, hasReleaseMarker] of releaseMarkers) {
  const source = fs.readFileSync(path.join(rootDir, file), "utf8");
  if (!hasReleaseMarker(source)) {
    throw new Error(
      `Expected ${file} to derive its release version from version.json (${expectedVersion}).`,
    );
  }
}
