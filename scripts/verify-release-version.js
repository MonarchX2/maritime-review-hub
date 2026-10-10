const fs = require("node:fs");
const path = require("node:path");

const expectedVersion = process.env.RELEASE_VERSION;
if (!expectedVersion || !/^mrh-[A-Za-z0-9._-]+$/.test(expectedVersion)) {
  throw new Error("RELEASE_VERSION must be a non-empty mrh- release identifier.");
}

const rootDir = path.resolve(__dirname, "..");
const releaseMarkers = [
  ["app-entry.js", (source) => source.includes(expectedVersion)],
  ["sw.js", (source) => source.includes(expectedVersion)],
  [
    "index.html",
    (source) =>
      [...source.matchAll(/app-entry\.js\?v=(mrh-[A-Za-z0-9._-]+)/g)].length ===
      1 &&
      source.includes(`app-entry.js?v=${expectedVersion}`),
  ],
];

for (const [file, hasReleaseMarker] of releaseMarkers) {
  const source = fs.readFileSync(path.join(rootDir, file), "utf8");
  if (!hasReleaseMarker(source)) {
    throw new Error(
      `Expected ${file} to contain exactly one release marker for ${expectedVersion}.`,
    );
  }
}
