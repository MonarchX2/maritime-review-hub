const fs = require("node:fs");
const path = require("node:path");

const expectedVersion = process.env.RELEASE_VERSION;
if (!expectedVersion || !/^mrh-[A-Za-z0-9._-]+$/.test(expectedVersion)) {
  throw new Error("RELEASE_VERSION must be a non-empty mrh- release identifier.");
}

const rootDir = path.resolve(__dirname, "..");
const releaseMarkers = [
  ["app-entry.js", /const\s+APP_VERSION\s*=\s*["']([^"']+)["']/g],
  ["sw.js", /const\s+APP_VERSION\s*=\s*["']([^"']+)["']/g],
  ["index.html", /app-entry\.js\?v=(mrh-[A-Za-z0-9._-]+)/g],
];

for (const [file, pattern] of releaseMarkers) {
  const source = fs.readFileSync(path.join(rootDir, file), "utf8");
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || matches[0][1] !== expectedVersion) {
    throw new Error(
      `Expected ${file} to contain exactly one release marker for ${expectedVersion}.`,
    );
  }
}
