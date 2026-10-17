const fs = require("node:fs");
const path = require("node:path");
const { isDateVersion } = require("./date-version");

const version = process.env.DISPLAY_VERSION;
if (!isDateVersion(version)) {
  throw new Error("DISPLAY_VERSION must use the YY.MM.DD-Patch format.");
}

const rootDir = path.resolve(__dirname, "..");
const versionPath = path.join(rootDir, "version.json");
fs.writeFileSync(
  versionPath,
  `${JSON.stringify({ version }, null, 2)}\n`,
);
console.log(`Stamped canonical website version ${version}.`);
