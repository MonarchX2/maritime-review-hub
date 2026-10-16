const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "..");
const appEntry = fs.readFileSync(path.join(rootDir, "app-entry.js"), "utf8");
const worker = fs.readFileSync(path.join(rootDir, "sw.js"), "utf8");
const html = fs.readFileSync(path.join(rootDir, "index.html"), "utf8");
const changelog = fs.readFileSync(
  path.join(rootDir, "CHANGELOG.md"),
  "utf8",
);
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
const aboutModal = html.match(
  /id="about-modal"[\s\S]*?id="review-settings-modal"/,
)?.[0];
assert.ok(aboutModal, "the About dialog must be present");
assert.match(aboutModal, /class="about-modal-panel/);
assert.match(
  fs.readFileSync(path.join(rootDir, "styles.css"), "utf8"),
  /\.about-modal-panel\s*\{[\s\S]*?max-height:\s*90vh;[\s\S]*?max-height:\s*min\(90dvh,\s*calc\(100dvh - 2rem\)\);[\s\S]*?overflow-y:\s*auto;/,
);
assert.match(aboutModal, /id="about-changelog-older" class="hidden"/);
assert.match(
  aboutModal,
  /id="about-changelog-toggle"[\s\S]*?aria-expanded="false"[\s\S]*?aria-controls="about-changelog-older"[\s\S]*?Show More/,
);
assert.match(html, /function toggleAboutChangelog\(\)/);
const latestChangelogs = aboutModal.split('id="about-changelog-older"')[0];
assert.equal(
  [...latestChangelogs.matchAll(/Version \d+\.\d+/g)].length,
  3,
  "only the three newest changelogs should be visible by default",
);
const markdownChangelogVersions = [
  ...changelog.matchAll(/^## (\d+\.\d+\.\d+-\d+) - /gm),
].map((match) => match[1]);
const aboutChangelogVersions = [
  ...aboutModal.matchAll(/Version (\d+\.\d+\.\d+-\d+)/g),
].map((match) => match[1]);
assert.deepEqual(
  aboutChangelogVersions,
  markdownChangelogVersions,
  "every About changelog release should match CHANGELOG.md in order",
);
const appVersion = appEntry.match(/^  const APP_VERSION = "([^"]+)";$/m)?.[1];
const appDisplayVersion = appEntry.match(
  /^  const APP_DISPLAY_VERSION = "([^"]+)";$/m,
)?.[1];
const workerVersion = worker.match(/^const APP_VERSION = "([^"]+)";$/m)?.[1];
assert.ok(appVersion, "app entry must declare its release version");
assert.match(
  appDisplayVersion || "",
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  "app entry must declare a human-readable display version",
);
assert.equal(workerVersion, appVersion);
assert.equal(release.version, appDisplayVersion);
assert.equal(release.buildVersion, appVersion);
assert.equal(
  appDisplayVersion,
  JSON.parse(fs.readFileSync(path.join(rootDir, "version.json"), "utf8")).version,
  "version.json must be the authoritative semantic application version",
);
assert.equal(
  JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version,
  appDisplayVersion,
  "the npm package metadata must match the authoritative app version",
);
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
assert.match(html, /<script src="app-entry\.js" defer><\/script>/);
assert.doesNotMatch(
  html,
  /<script\b[^>]*\bsrc="[^"]+\.js\?[^"]*"[^>]*>/,
  "script URLs must not include query-string suffixes",
);
assert.doesNotMatch(
  appEntry,
  /url\.searchParams\.set\("v",\s*APP_VERSION\)/,
  "dynamically loaded script URLs must remain clean in DevTools",
);
assert.equal([...html.matchAll(/id="site-version"/g)].length, 1);
assert.doesNotMatch(html, /id="dashboard-version"/);
assert.ok(
  html.indexOf('id="site-version"') > html.indexOf("</main>"),
  "the site version must be outside the main dashboard content",
);
assert.match(html, new RegExp(`Version ${appDisplayVersion}`));
assert.match(appEntry, /const versionLabel = `Version \$\{APP_DISPLAY_VERSION\}`/);
assert.match(appEntry, /\["site-version", "about-version"\]/);
assert.match(appEntry, /APP_UPDATE_CHECK_INTERVAL_MS = 5 \* 60 \* 1000/);
assert.match(appEntry, /document\.addEventListener\("visibilitychange"/);
assert.match(appEntry, /window\.addEventListener\("focus",\s*checkUpdateWhenForegrounded\)/);
assert.match(appEntry, /window\.addEventListener\("pageshow",\s*checkUpdateWhenForegrounded\)/);
assert.match(appEntry, /const checkUpdateWhenForegrounded = \(\) => \{[\s\S]*?checkForAppUpdate\(\)[\s\S]*?applyPendingAppUpdate\(\)/);
assert.match(appEntry, /window\.addEventListener\("online"/);
const siteHeader = html.match(/<header[\s\S]*?<\/header>/)?.[0];
assert.ok(siteHeader, "the app header should be present");
assert.match(siteHeader, /px-3 py-3 sm:px-4 sm:py-3/);
assert.match(siteHeader, /gap-4 relative/);
assert.match(html, /header\s*\{[\s\S]*?min-height:\s*64px;/);
assert.match(appEntry, /serviceWorkerRegistration\.update\(\)/);
assert.match(appEntry, /updateViaCache:\s*"none"/);
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
assert.match(
  appEntry,
  /const LEGACY_PAGES_BASE_PATH = "\/maritime-review-hub\/"/,
);
assert.match(
  appEntry,
  /rootScope\.location\?\.hostname !== "monarchx2\.github\.io"[\s\S]*?rootScope\.__MRH_APP_BASE_PATH !== "\/mrh\/"/,
  "legacy cleanup must be restricted to the renamed GitHub Pages site",
);
assert.match(
  appEntry,
  /navigator\.serviceWorker\s*\.getRegistrations\(\)[\s\S]*?scopeUrl\.origin === legacyAppUrl\.origin[\s\S]*?isLegacyPath\(scopeUrl\.pathname\)/,
  "the new Pages app must find every service worker scoped under the old URL",
);
assert.match(
  appEntry,
  /pathname === LEGACY_PAGES_BASE_PATH\.slice\(0, -1\)[\s\S]*?pathname\.startsWith\(LEGACY_PAGES_BASE_PATH\)/,
  "legacy path matching must include the bare old path and its descendants only",
);
assert.match(
  appEntry,
  /map\(\(registration\) => registration\.unregister\(\)\)/,
  "the new Pages app must unregister every legacy service worker",
);
assert.doesNotMatch(
  appEntry,
  /location\.(?:assign|replace)\([^)]*LEGACY_PAGES_BASE_PATH/,
  "legacy URLs must never redirect to the new website",
);
assert.match(
  appEntry,
  /requestUrl\.origin === legacyAppUrl\.origin &&\s*isLegacyPath\(requestUrl\.pathname\)[\s\S]*?cache\.delete\(request\)/,
  "the new Pages app must remove only cached requests from the old path",
);
assert.match(
  appEntry,
  /serviceWorkerRegistrationPromise = retireLegacyPagesApp\(\)\s*\.then\(\(\) =>\s*navigator\.serviceWorker\.register/,
  "the legacy app cleanup must finish before registering the new Pages worker",
);
const legacyCleanupStart = appEntry.indexOf(
  "  async function retireLegacyPagesApp() {",
);
const legacyCleanupEnd = appEntry.indexOf(
  "\n  function registerServiceWorker()",
  legacyCleanupStart,
);
assert.ok(legacyCleanupStart >= 0 && legacyCleanupEnd > legacyCleanupStart);
const legacyCleanupSource = appEntry.slice(
  legacyCleanupStart,
  legacyCleanupEnd,
);
assert.match(appEntry, /rootScope\.state\?\.session\?\.active/);
assert.match(appEntry, /#view-practice\.active, #view-deck-review\.active/);
assert.match(appEntry, /const saved = await rootScope\.saveState\(\)/);
assert.match(appEntry, /if \(saved === false\)/);
assert.match(
  appEntry,
  /UPDATE_QUERY_PARAMETER[\s\S]*?searchParams\.set\([\s\S]*?pendingAppUpdateVersion[\s\S]*?location\.replace/,
  "a no-service-worker update must force a fresh HTML request",
);
assert.ok(
  appEntry.indexOf("const saved = await rootScope.saveState()") <
    appEntry.indexOf("rootScope.location.reload()"),
  "the app must persist recoverable state before reloading for an update",
);
assert.match(appEntry, /MRH_QUERY_CLIENT_VERSION/);
assert.match(appEntry, /MRH_UPDATE_AVAILABLE/);
assert.match(
  appEntry,
  /__MRH_REQUEST_APP_UPDATE = checkForAppUpdate/,
  "the backend version gate should trigger the existing safe state-save and reload flow",
);
assert.match(appEntry, /PENDING_UPDATE_RETRY_INTERVAL_MS = 15 \* 1000/);
assert.match(
  appEntry,
  /const dashboard = document\.getElementById\("view-dashboard"\)[\s\S]*?const resourceDashboard = document\.getElementById\("view-resources"\)[\s\S]*?!dashboard\?\.classList\.contains\("active"\)[\s\S]*?!resourceDashboard\?\.classList\.contains\("active"\)/,
  "safe app updates should apply while the Resource Dashboard is active",
);
assert.match(
  appEntry,
  /resourceDashboard\?\.classList\.contains\("active"\)[\s\S]*?resource-reviewer-enrollment-form[\s\S]*?Array\.from\(enrollmentForm\.elements\)\.some/,
  "app updates should not discard unsaved Profile enrollment details",
);

assert.doesNotMatch(worker, /self\.clients\.claim\(/);
assert.doesNotMatch(worker, /client\.navigate\(/);
assert.match(worker, /MRH_UPDATE_AVAILABLE/);
assert.match(worker, /MRH_QUERY_CLIENT_VERSION/);
assert.match(worker, /cleanupOldCachesWhenSafe/);
assert.match(worker, /getAssetFetchCacheMode/);
assert.match(worker, /\?\s*"force-cache"/);
assert.match(worker, /verifyCurrentReleaseMetadata/);
assert.match(worker, /Release metadata mismatch/);
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
assert.match(
  workflow,
  /npm run sync:version[\s\S]*?npm run sync:about-changelog[\s\S]*?npm ci/,
  "the workflow must sync package metadata and the About changelog before installing dependencies",
);
assert.match(
  workflow,
  /- name: Sync About changelog\s+run: node scripts\/sync-about-changelog\.js[\s\S]*?- name: Resolve semantic release version/,
  "the deployment job must generate the About changelog before publishing the site",
);
assert.match(
  workflow,
  /Resolve semantic release version[\s\S]*?RELEASE_VERSION:\s*\$\{\{\s*steps\.release\.outputs\.release_version\s*\}\}[\s\S]*?DISPLAY_VERSION:\s*\$\{\{\s*steps\.release\.outputs\.display_version\s*\}\}/,
  "deployments must stamp both unique build and SemVer display versions",
);
assert.match(workflow, /fetch-depth:\s*0/);
assert.match(workflow, /Tag semantic release[\s\S]*?git push origin "\$RELEASE_TAG"/);
assert.match(
  workflow,
  /Prepare content-hashed Pages assets[\s\S]*?upload-pages-artifact[\s\S]*?path:\s*\$\{\{\s*runner\.temp\s*\}\}\/mrh-pages/,
  "deployment must publish the generated immutable-asset site",
);
const minificationStep = workflow.match(
  /- name: Minify deploy assets[\s\S]*?(?=\n      - name:)/,
);
assert.ok(minificationStep, "deployment must minify its static assets");
assert.match(minificationStep[0], /find \. -maxdepth 1/);
assert.match(minificationStep[0], /! -name 'tailwind\.config\.js'/);
assert.match(minificationStep[0], /! -name 'tailwind\.input\.css'/);
assert.match(
  minificationStep[0],
  /minify "\$file" > "\$output"[\s\S]*?test -s "\$output"[\s\S]*?mv "\$output" "\$file"/,
  "deployment must only replace source assets after successful non-empty minification",
);

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
  const nextDisplayVersion = "14.9.1-2";
  const env = {
    ...process.env,
    RELEASE_VERSION: nextVersion,
    DISPLAY_VERSION: nextDisplayVersion,
  };
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
  const stampedVersionMetadata = JSON.parse(
    fs.readFileSync(path.join(tempRoot, "version.json"), "utf8"),
  );
  assert.equal(stampedVersionMetadata.version, nextDisplayVersion);
  assert.equal(stampedVersionMetadata.buildVersion, nextVersion);

  const stampedAppEntry = fs.readFileSync(
    path.join(tempRoot, "app-entry.js"),
    "utf8",
  );
  assert.match(
    stampedAppEntry,
    new RegExp(`const APP_DISPLAY_VERSION = "${nextDisplayVersion}"`),
    "release stamping must write the SemVer display version",
  );
  fs.writeFileSync(
    path.join(tempRoot, "app-entry.js"),
    `!function(){const a="${nextVersion}";document.textContent="Version ${nextDisplayVersion}"}();`,
  );
  execFileSync(
    process.execPath,
    [path.join(tempRoot, "scripts", "verify-release-version.js")],
    { cwd: tempRoot, env, stdio: "pipe" },
  );

  const stampedHtml = fs.readFileSync(
    path.join(tempRoot, "index.html"),
    "utf8",
  );
  const minifiedHtml = stampedHtml.replace(
    `<p id="site-version" class="site-version">Version ${nextDisplayVersion}</p>`,
    `<p id=site-version class=site-version>Version ${nextDisplayVersion}`,
  );
  fs.writeFileSync(path.join(tempRoot, "index.html"), minifiedHtml);
  execFileSync(
    process.execPath,
    [path.join(tempRoot, "scripts", "verify-release-version.js")],
    { cwd: tempRoot, env, stdio: "pipe" },
  );

  const stampedAssetVersions = [
    ...stampedHtml.matchAll(
      /href="(?:manifest\.json|icon\.svg|tailwind\.generated\.css|styles\.css)\?v=([^"]+)"/g,
    ),
  ];
  assert.equal(stampedAssetVersions.length, 7);
  assert.ok(stampedAssetVersions.every((match) => match[1] === nextVersion));
  assert.ok(
    stampedHtml.includes(
      `<p id="site-version" class="site-version">Version ${nextDisplayVersion}</p>`,
    ),
    "release stamping must update the visible site version",
  );
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

async function verifyLegacyCleanupBehavior() {
  const baseUrl = "https://monarchx2.github.io";
  const eventOrder = [];
  const registrations = [
    {
      scope: `${baseUrl}/maritime-review-hub/`,
      async unregister() {
        await Promise.resolve();
        eventOrder.push("unregister-old");
        return true;
      },
    },
    {
      scope: `${baseUrl}/maritime-review-hub/nested/`,
      async unregister() {
        await Promise.resolve();
        eventOrder.push("unregister-nested-old");
        return true;
      },
    },
    {
      scope: `${baseUrl}/maritime-review-hub`,
      async unregister() {
        eventOrder.push("unregister-no-trailing-slash");
        return true;
      },
    },
    {
      scope: `${baseUrl}/maritime-review-hub/failing/`,
      async unregister() {
        await Promise.resolve();
        eventOrder.push("unregister-failing");
        throw new Error("simulated unregister failure");
      },
    },
    {
      scope: `${baseUrl}/maritime-review-hub-archive/`,
      async unregister() {
        eventOrder.push("unregister-sibling");
        return true;
      },
    },
    {
      scope: `${baseUrl}/mrh/`,
      async unregister() {
        eventOrder.push("unregister-new");
        return true;
      },
    },
    {
      scope: "https://other.github.io/maritime-review-hub/",
      async unregister() {
        eventOrder.push("unregister-other-origin");
        return true;
      },
    },
  ];
  const cacheEntries = new Map([
    [
      "shared-cache",
      new Set([
        `${baseUrl}/maritime-review-hub/`,
        `${baseUrl}/maritime-review-hub`,
        `${baseUrl}/maritime-review-hub/nested/app.js`,
        `${baseUrl}/maritime-review-hub-archive/index.html`,
        `${baseUrl}/mrh/index.html`,
        "https://other.github.io/maritime-review-hub/index.html",
      ]),
    ],
  ]);
  const serviceWorker = {
    async getRegistrations() {
      return registrations;
    },
  };
  const caches = {
    async keys() {
      return [...cacheEntries.keys()];
    },
    async open(name) {
      const entries = cacheEntries.get(name);
      return {
        async keys() {
          return [...entries].map((url) => ({ url }));
        },
        async delete(request) {
          eventOrder.push(`delete:${request.url}`);
          return entries.delete(request.url);
        },
      };
    },
  };
  const rootScope = {
    location: {
      hostname: "monarchx2.github.io",
      origin: baseUrl,
    },
    __MRH_APP_BASE_PATH: "/mrh/",
    caches,
  };
  const warnings = [];
  const retireLegacyPagesApp = vm.runInNewContext(
    `(${legacyCleanupSource})`,
    {
      URL,
      Promise,
      LEGACY_PAGES_BASE_PATH: "/maritime-review-hub/",
      navigator: { serviceWorker },
      rootScope,
      bootstrapLogger: () => ({
        warn(...args) {
          warnings.push(args);
        },
      }),
    },
  );

  await retireLegacyPagesApp();

  assert.deepEqual(
    eventOrder
      .filter((event) => event.startsWith("unregister-"))
      .sort(),
    [
      "unregister-failing",
      "unregister-nested-old",
      "unregister-no-trailing-slash",
      "unregister-old",
    ].sort(),
    "cleanup should unregister every legacy-scope worker and leave sibling/new/other-origin workers intact",
  );
  assert.deepEqual(
    [...cacheEntries.get("shared-cache")],
    [
      `${baseUrl}/maritime-review-hub-archive/index.html`,
      `${baseUrl}/mrh/index.html`,
      "https://other.github.io/maritime-review-hub/index.html",
    ],
    "cleanup should remove only the legacy path from shared cache storage",
  );
  assert.ok(
    eventOrder
      .filter((event) => event.startsWith("unregister-"))
      .every(
        (event) =>
          eventOrder.indexOf(event) <
          eventOrder.findIndex((entry) => entry.startsWith("delete:")),
      ),
    "legacy workers should be unregistered before old-path cached assets are deleted",
  );
  assert.equal(
    warnings.length,
    1,
    "an individual legacy worker failure should be reported without preventing cache cleanup",
  );
}

verifyLegacyCleanupBehavior()
  .then(() =>
    console.log("Frontend update flow and release stamping checks passed."),
  )
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
