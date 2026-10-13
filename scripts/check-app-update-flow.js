const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const appEntry = fs.readFileSync(path.join(rootDir, "app-entry.js"), "utf8");
const worker = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");
const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
const manifest = JSON.parse(
  fs.readFileSync(path.join(rootDir, "manifest.json"), "utf8"),
);
const release = JSON.parse(
  fs.readFileSync(path.join(rootDir, "version.json"), "utf8"),
);
const workflow = fs.readFileSync(
  path.join(rootDir, ".github", "workflows", "deploy.yml"),
  "utf8",
);

const appVersion = appEntry.match(/^  const APP_VERSION = "([^"]+)";$/m)?.[1];
const appDisplayVersion = appEntry.match(
  /^  const APP_DISPLAY_VERSION = "([^"]+)";$/m,
)?.[1];
const workerVersion = worker.match(/^const APP_VERSION = "([^"]+)";$/m)?.[1];
assert.ok(appVersion, "app entry must declare its release version");
assert.match(
  appDisplayVersion || "",
  /^\d+\.\d+(?:\.\d+)?$/,
  "app entry must declare a human-readable display version",
);
assert.equal(workerVersion, appVersion);
assert.equal(release.version, appVersion);
assert.equal(
  manifest.icons[0].src,
  `icon.svg?v=${appVersion}`,
  "the installed-app icon must use the release asset version",
);

const versionedLocalAssets = [
  ...html.matchAll(
    /href="((?:manifest\.json|icon\.svg|tailwind\.generated\.css|styles\.css))\?v=([^"]+)"/g,
  ),
];
assert.equal(versionedLocalAssets.length, 7);
assert.ok(versionedLocalAssets.every((match) => match[2] === appVersion));
assert.match(html, new RegExp(`app-entry\\.js\\?v=${appVersion}`));
assert.equal([...html.matchAll(/id="site-version"/g)].length, 1);
assert.doesNotMatch(html, /id="dashboard-version"/);
assert.ok(
  html.indexOf('id="site-version"') > html.indexOf("</main>"),
  "the site version must be outside the main dashboard content",
);
assert.match(html, new RegExp(`Version ${appDisplayVersion}`));
assert.match(appEntry, /const versionLabel = `Version \$\{APP_DISPLAY_VERSION\}`/);
assert.match(appEntry, /\["site-version", "about-version"\]/);
assert.equal(
  [...html.matchAll(/id="app-update-notice"/g)].length,
  1,
  "the update notice must appear only once in the document",
);
assert.match(
  appEntry,
  /version\.json[\s\S]*?searchParams\.set\("check",\s*String\(Date\.now\(\)\)\)/,
);
assert.match(appEntry, /cache:\s*"no-store"/);
assert.match(appEntry, /serviceWorkerRegistration\) return;/);
assert.match(appEntry, /await serviceWorkerRegistrationPromise/);
assert.match(appEntry, /if \(!serviceWorkerRegistrationFailed\) return;/);
assert.match(appEntry, /serviceWorkerRegistrationPromise = navigator\.serviceWorker/);
assert.match(appEntry, /rootScope\.state\?\.session\?\.active/);
assert.match(appEntry, /#view-practice\.active, #view-deck-review\.active/);
assert.match(appEntry, /const saved = await rootScope\.saveState\(\)/);
assert.match(appEntry, /if \(saved === false\)/);
assert.ok(
  appEntry.indexOf("const saved = await rootScope.saveState()") <
    appEntry.indexOf("rootScope.location.reload()"),
  "the app must persist recoverable state before reloading for an update",
);
assert.match(appEntry, /MRH_QUERY_CLIENT_VERSION/);
assert.match(appEntry, /MRH_UPDATE_AVAILABLE/);
assert.match(appEntry, /PENDING_UPDATE_RETRY_INTERVAL_MS = 15 \* 1000/);

assert.doesNotMatch(worker, /self\.clients\.claim\(/);
assert.doesNotMatch(worker, /client\.navigate\(/);
assert.match(worker, /MRH_UPDATE_AVAILABLE/);
assert.match(worker, /MRH_QUERY_CLIENT_VERSION/);
assert.match(worker, /cleanupOldCachesWhenSafe/);
assert.doesNotMatch(worker, /"\\.\/version\.json"/);
assert.match(
  html,
  /id="app-update-notice"[\s\S]*?role="status"[\s\S]*?aria-live="polite"/,
);
assert.match(
  fs.readFileSync(path.join(rootDir, "styles.css"), "utf8"),
  /\.app-update-notice\[hidden\][\s\S]*?display:\s*none;/,
);
assert.equal(
  [
    ...fs
      .readFileSync(path.join(rootDir, "styles.css"), "utf8")
      .matchAll(/^\.app-update-notice\s*\{/gm),
  ].length,
  1,
  "the update notice must have one authoritative style block",
);
for (const asset of [
  "app-config.js",
  "app-core.js",
  "app-core-network.js",
  "sync-core.js",
  "session-core.js",
  "deck-review-core.js",
  "quiz-rendering-core.js",
  "qr-transfer-core.js",
  "qr-vendor/qrcode-generator.js",
  "qr-vendor/jsQR.js",
]) {
  assert.ok(
    appEntry.includes(`"${asset}"`),
    `the no-service-worker update check must verify ${asset}`,
  );
}
assert.match(workflow, /Stamp release version[\s\S]*?Verify deployed release version/);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mrh-release-stamp-"));
try {
  fs.mkdirSync(path.join(tempRoot, "scripts"));
  for (const file of [
    "app-entry.js",
    "sw.js",
    "index.html",
    "manifest.json",
    "version.json",
  ]) {
    fs.copyFileSync(path.join(rootDir, file), path.join(tempRoot, file));
  }
  for (const file of ["stamp-release-version.js", "verify-release-version.js"]) {
    fs.copyFileSync(
      path.join(rootDir, "scripts", file),
      path.join(tempRoot, "scripts", file),
    );
  }

  const nextVersion = "mrh-check-release-stamp";
  const env = { ...process.env, RELEASE_VERSION: nextVersion };
  execFileSync(
    process.execPath,
    [path.join(tempRoot, "scripts", "stamp-release-version.js")],
    { cwd: tempRoot, env, stdio: "pipe" },
  );
  execFileSync(
    process.execPath,
    [path.join(tempRoot, "scripts", "verify-release-version.js")],
    { cwd: tempRoot, env, stdio: "pipe" },
  );

  const stampedAppEntry = fs.readFileSync(
    path.join(tempRoot, "app-entry.js"),
    "utf8",
  );
  assert.match(
    stampedAppEntry,
    new RegExp(`const APP_DISPLAY_VERSION = "${appDisplayVersion}"`),
    "release stamping must preserve the human-readable display version",
  );

  const stampedHtml = fs.readFileSync(
    path.join(tempRoot, "index.html"),
    "utf8",
  );
  const stampedAssetVersions = [
    ...stampedHtml.matchAll(
      /href="(?:manifest\.json|icon\.svg|tailwind\.generated\.css|styles\.css)\?v=([^"]+)"/g,
    ),
  ];
  assert.equal(stampedAssetVersions.length, 7);
  assert.ok(stampedAssetVersions.every((match) => match[1] === nextVersion));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log("Frontend update flow and release stamping checks passed.");
