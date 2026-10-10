const fs = require("node:fs");
const path = require("node:path");

const version = process.env.RELEASE_VERSION;
if (!version || !/^mrh-[A-Za-z0-9._-]+$/.test(version)) {
  throw new Error("RELEASE_VERSION must be a non-empty mrh- release identifier.");
}

const rootDir = path.resolve(__dirname, "..");
const updates = [
  ["app-entry.js", /(const APP_VERSION = ")[^"]+(";)/, `$1${version}$2`],
  ["sw.js", /(const APP_VERSION = ")[^"]+(";)/, `$1${version}$2`],
  ["index.html", /(app-entry\.js\?v=)mrh-[^"]+/, `$1${version}`],
];

const replacements = updates.map(([file, pattern, replacement]) => {
  const source = fs.readFileSync(path.join(rootDir, file), "utf8");
  const matches = [...source.matchAll(new RegExp(pattern.source, "g"))];
  if (matches.length !== 1) {
    throw new Error(`Expected exactly one release version in ${file}.`);
  }
  return [file, source.replace(pattern, replacement)];
});

for (const [file, contents] of replacements) {
  fs.writeFileSync(path.join(rootDir, file), contents);
}
