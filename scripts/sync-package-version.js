const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const versionFile = path.join(rootDir, "version.json");
const packageFile = path.join(rootDir, "package.json");
const lockFile = path.join(rootDir, "package-lock.json");
const version = JSON.parse(fs.readFileSync(versionFile, "utf8")).version;
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(version)) {
  throw new Error("version.json must contain a valid SemVer version.");
}

const packageJson = JSON.parse(fs.readFileSync(packageFile, "utf8"));
const lockfile = JSON.parse(fs.readFileSync(lockFile, "utf8"));
if (!lockfile.packages || !lockfile.packages[""]) {
  throw new Error("package-lock.json is missing its root package metadata.");
}

if (
  packageJson.version === version &&
  lockfile.version === version &&
  lockfile.packages[""].version === version
) {
  console.log(`Package metadata is already synchronized to ${version}.`);
  process.exit(0);
}

packageJson.version = version;
lockfile.version = version;
lockfile.packages[""].version = version;
fs.writeFileSync(packageFile, `${JSON.stringify(packageJson, null, 2)}\n`);
fs.writeFileSync(lockFile, `${JSON.stringify(lockfile, null, 2)}\n`);
console.log(`Synchronized npm package metadata to ${version}.`);
