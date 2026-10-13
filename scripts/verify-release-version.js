const fs = require("node:fs");
const path = require("node:path");

const expectedVersion = process.env.RELEASE_VERSION;
if (!expectedVersion || !/^mrh-[A-Za-z0-9._-]+$/.test(expectedVersion)) {
  throw new Error("RELEASE_VERSION must be a non-empty mrh- release identifier.");
}
const expectedDisplayVersion = process.env.DISPLAY_VERSION;
if (!expectedDisplayVersion || !/^\d+\.\d+\.\d+$/.test(expectedDisplayVersion)) {
  throw new Error("DISPLAY_VERSION must be a valid MAJOR.MINOR.PATCH version.");
}

const rootDir = path.resolve(__dirname, "..");
const hasStringLiteral = (source, value) => {
  const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`["']${escapedValue}["']`).test(source);
};
const releaseMarkers = [
  [
    "app-entry.js",
    (source) =>
      hasStringLiteral(source, expectedVersion) &&
      (hasStringLiteral(source, expectedDisplayVersion) ||
        source.includes(`Version ${expectedDisplayVersion}`)),
  ],
  ["sw.js", (source) => source.includes(expectedVersion)],
  [
    "index.html",
    (source) =>
      [...source.matchAll(/<script\b[^>]*\bsrc="[^"]+\.js\?[^"]*"[^>]*>/g)]
        .length === 0 &&
      /<script\b[^>]*\bsrc=["']?app-entry\.js["']?[^>]*><\/script>/i.test(
        source,
      ) &&
      [
        ...source.matchAll(
          /href="(?:manifest\.json|icon\.svg|tailwind\.generated\.css|styles\.css)\?v=(mrh-[A-Za-z0-9._-]+)"/g,
        ),
      ].length === 7 &&
      [
        ...source.matchAll(
          /href="(?:manifest\.json|icon\.svg|tailwind\.generated\.css|styles\.css)\?v=(mrh-[A-Za-z0-9._-]+)"/g,
        ),
      ].every(
        (match) => match[1] === expectedVersion,
      ) &&
      new RegExp(
        `<p\\b(?=[^>]*\\bid=["']?site-version["']?(?:\\s|>))(?=[^>]*\\bclass=["']?site-version["']?(?:\\s|>))[^>]*>Version ${expectedDisplayVersion}(?:<\\/p>)?`,
      ).test(source),
  ],
  [
    "version.json",
    (source) =>
      JSON.parse(source).version === expectedVersion,
  ],
  [
    "manifest.json",
    (source) =>
      [...source.matchAll(/"src"\s*:\s*"icon\.svg\?v=(mrh-[A-Za-z0-9._-]+)"/g)]
        .length === 1 &&
      source.includes(`icon.svg?v=${expectedVersion}`),
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
