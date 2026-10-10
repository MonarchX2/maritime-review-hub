const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const requiredFiles = [
  "index.html",
  "manifest.json",
  "icon.svg",
  "tailwind.generated.css",
  "styles.css",
  "app-entry.js",
  "app-config.js",
  "app-core.js",
  "preferences-core.js",
  "dashboard-core.js",
  "app-core-state.js",
  "app-core-network.js",
  "sync-core.js",
  "session-core.js",
  "analytics-core.js",
  "ui-modal-core.js",
  "deck-nav-core.js",
  "deck-review-core.js",
  "quiz-rendering-core.js",
  "debug-utils.js",
  "lifecycle-utils.js",
  "rendering-core.js",
  "storage-utils.js",
  "text-utils.js",
  "sw.js",
];

const bootstrapScripts = [
  "app-config.js",
  "storage-utils.js",
  "text-utils.js",
  "debug-utils.js",
  "lifecycle-utils.js",
  "rendering-core.js",
  "app-core-state.js",
  "preferences-core.js",
  "dashboard-core.js",
];

const runtimeScripts = [
  "app-core.js",
  "app-core-network.js",
  "sync-core.js",
  "deck-nav-core.js",
];

const featureScripts = [
  "session-core.js",
  "analytics-core.js",
  "ui-modal-core.js",
  "deck-review-core.js",
  "quiz-rendering-core.js",
];

function read(fileName) {
  const fullPath = path.join(rootDir, fileName);
  return fs.readFileSync(fullPath, "utf8");
}

const missingFiles = requiredFiles.filter((fileName) => !fs.existsSync(path.join(rootDir, fileName)));
if (missingFiles.length > 0) {
  console.error("Missing required files:");
  missingFiles.forEach((fileName) => console.error(` - ${fileName}`));
  process.exit(1);
}

const issues = [];

const appEntryText = read("app-entry.js");
for (const scriptName of [...bootstrapScripts, ...runtimeScripts, ...featureScripts]) {
  if (!appEntryText.includes(scriptName)) {
    issues.push(`app-entry.js is missing the expected dependency load for ${scriptName}`);
  }
}

const swText = read("sw.js");
for (const scriptName of requiredFiles.filter((value) => value.endsWith(".js") && value !== "sw.js")) {
  const reference = `./${scriptName}`;
  if (!swText.includes(reference)) {
    issues.push(`sw.js is missing ${reference} in its app shell list`);
  }
}

const runtimeList = [...bootstrapScripts, ...runtimeScripts, ...featureScripts];
if (!runtimeList.every((scriptName) => swText.includes(`"./${scriptName}"`))) {
  issues.push("sw.js does not include the expected runtime app shell list");
}

if (issues.length > 0) {
  console.error("Architecture validation failed:");
  issues.forEach((issue) => console.error(` - ${issue}`));
  process.exit(1);
}

console.log(`Architecture check passed for ${requiredFiles.length} frontend files.`);
