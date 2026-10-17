const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  calculateNextVersion,
  getReleaseContext,
} = require("./resolve-semver-version");
const { isDateVersion } = require("./date-version");

assert.equal(
  calculateNextVersion("26.10.17-8", ["feat: add a feature"]),
  "26.10.17-9",
);
assert.equal(
  calculateNextVersion("26.10.17-8", ["fix(sync): retry failed uploads"]),
  "26.10.17-9",
);
assert.equal(
  calculateNextVersion("26.10.17-8", ["feat!: replace the storage API"]),
  "26.10.17-9",
);
assert.equal(
  calculateNextVersion("26.10.17-8", [
    "fix: correct response",
    "docs: update guide\n\nBREAKING CHANGE: remove legacy docs",
  ]),
  "26.10.17-9",
);
assert.equal(
  calculateNextVersion("26.10.17-8", ["perf: reduce render work", "chore: cleanup"]),
  "26.10.17-9",
);
assert.equal(
  calculateNextVersion("26.10.17-8", ["docs: update guide", "chore: cleanup"]),
  "26.10.17-8",
);
assert.equal(
  calculateNextVersion("26.10.15-6", ["fix(resources): remove portal commentary"]),
  "26.10.15-7",
  "date-based release fixes should increment the daily patch sequence",
);
assert.equal(
  calculateNextVersion("25.12.31-2", ["fix: correct layout"]),
  "25.12.31-3",
  "date-based release sequences should work for two-digit years across the full calendar",
);
assert.equal(
  calculateNextVersion("26.10.15-6", ["feat: add a resource view"]),
  "26.10.15-7",
  "date-based feature releases should increment the daily patch sequence",
);
assert.equal(
  calculateNextVersion("26.10.15-6", ["fix: update portal"]),
  "26.10.15-7",
  "date-based breaking releases should increment the daily patch sequence without rolling the date",
);
assert.equal(
  calculateNextVersion("26.10.15-6", ["docs: update guide"]),
  "26.10.15-6",
);
assert.equal(
  calculateNextVersion("26.12.31-8", ["feat!: replace the storage API"]),
  "26.12.31-9",
  "breaking changes must never roll the date-based version format forward",
);
assert.equal(isDateVersion("26.10.17-8"), true);
assert.equal(isDateVersion("26.02.30-1"), false);
assert.equal(isDateVersion("26.10.17"), false);
assert.throws(
  () => calculateNextVersion("14.8.0", []),
  /Invalid date-based version/,
);

const repositoryRoot = path.resolve(__dirname, "..");
const currentVersion = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "version.json"), "utf8"),
).version;
const packageVersion = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
).version;
const lockfile = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package-lock.json"), "utf8"),
);
assert.equal(
  packageVersion,
  currentVersion,
  "package metadata must be synchronized from version.json before running checks",
);
assert.equal(
  lockfile.version,
  currentVersion,
  "package-lock metadata must be synchronized from version.json before running checks",
);
assert.equal(
  lockfile.packages[""].version,
  currentVersion,
  "the root package-lock entry must be synchronized from version.json",
);
const changelog = fs.readFileSync(
  path.join(repositoryRoot, "CHANGELOG.md"),
  "utf8",
);
const changelogVersions = [...changelog.matchAll(/^## (.+?) - /gm)].map(
  (match) => match[1],
);
assert.ok(
  changelogVersions.includes(currentVersion),
  `CHANGELOG.md must include the current release ${currentVersion}`,
);
assert.equal(
  new Set(changelogVersions).size,
  changelogVersions.length,
  "CHANGELOG.md must not contain duplicate release headings",
);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mrh-semver-"));
const packageSyncFixture = path.join(fixture, "package-sync");
fs.mkdirSync(path.join(packageSyncFixture, "scripts"), { recursive: true });
for (const fileName of ["package.json", "package-lock.json"]) {
  fs.copyFileSync(
    path.join(repositoryRoot, fileName),
    path.join(packageSyncFixture, fileName),
  );
}
fs.copyFileSync(
  path.join(repositoryRoot, "scripts", "sync-package-version.js"),
  path.join(packageSyncFixture, "scripts", "sync-package-version.js"),
);
fs.copyFileSync(
  path.join(repositoryRoot, "scripts", "date-version.js"),
  path.join(packageSyncFixture, "scripts", "date-version.js"),
);
fs.writeFileSync(
  path.join(packageSyncFixture, "version.json"),
  JSON.stringify({ version: "25.12.31-2" }),
);
execFileSync(
  process.execPath,
  [path.join(packageSyncFixture, "scripts", "sync-package-version.js")],
  { cwd: packageSyncFixture, stdio: "pipe" },
);
assert.equal(
  JSON.parse(
    fs.readFileSync(path.join(packageSyncFixture, "package.json"), "utf8"),
  ).version,
  "25.12.31-2",
  "package metadata must synchronize from version.json",
);
const synchronizedLockfile = JSON.parse(
  fs.readFileSync(path.join(packageSyncFixture, "package-lock.json"), "utf8"),
);
assert.equal(synchronizedLockfile.version, "25.12.31-2");
assert.equal(synchronizedLockfile.packages[""].version, "25.12.31-2");

function git(args) {
  return execFileSync("git", args, {
    cwd: fixture,
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

try {
  git(["init", "--initial-branch=main"]);
  git(["config", "user.name", "SemVer Test"]);
  git(["config", "user.email", "semver-test@example.invalid"]);
  fs.writeFileSync(
    path.join(fixture, "version.json"),
    JSON.stringify({ version: "25.01.02-0" }),
  );
  git(["add", "version.json"]);
  git(["commit", "-m", "chore: initialize baseline"]);
  git(["tag", "v25.01.02-0"]);
  fs.writeFileSync(path.join(fixture, "change.txt"), "feature\n");
  git(["add", "change.txt"]);
  git(["commit", "-m", "feat: add fixture change"]);

  const featureRelease = getReleaseContext(fixture);
  assert.equal(featureRelease.displayVersion, "25.01.02-1");
  assert.equal(featureRelease.releaseTag, "v25.01.02-1");
  assert.equal(featureRelease.shouldTag, true);

  fs.writeFileSync(
    path.join(fixture, "version.json"),
    JSON.stringify({ version: "25.01.02-2" }),
  );
  git(["add", "version.json"]);
  git(["commit", "-m", "chore: bump version to 25.01.02-2"]);
  const explicitVersionRelease = getReleaseContext(fixture);
  assert.equal(explicitVersionRelease.displayVersion, "25.01.02-2");
  assert.equal(explicitVersionRelease.releaseTag, "v25.01.02-2");
  assert.equal(explicitVersionRelease.shouldTag, true);

  git(["tag", "v25.01.02-2"]);
  fs.writeFileSync(path.join(fixture, "fix.txt"), "fix\n");
  git(["add", "fix.txt"]);
  git(["commit", "-m", "fix: correct fixture"]);
  const fixRelease = getReleaseContext(fixture);
  assert.equal(fixRelease.displayVersion, "25.01.02-3");
  assert.equal(fixRelease.shouldTag, true);

  fs.writeFileSync(
    path.join(fixture, "version.json"),
    JSON.stringify({ version: "25.01.02-4" }),
  );
  git(["add", "version.json"]);
  git(["commit", "-m", "chore: bump version to 25.01.02-4"]);
  const prereleaseRelease = getReleaseContext(fixture);
  assert.equal(prereleaseRelease.displayVersion, "25.01.02-4");
  assert.equal(prereleaseRelease.releaseTag, "v25.01.02-4");
  assert.equal(prereleaseRelease.shouldTag, true);

  fs.writeFileSync(
    path.join(fixture, "version.json"),
    JSON.stringify({ version: "26.10.15-6" }),
  );
  git(["add", "version.json"]);
  git(["commit", "-m", "chore: set date-based release baseline"]);
  const dateVersionBaseline = getReleaseContext(fixture);
  assert.equal(dateVersionBaseline.displayVersion, "26.10.15-6");
  assert.equal(dateVersionBaseline.releaseTag, "v26.10.15-6");

  git(["tag", "v26.11.0"]);
  git(["tag", "v26.10.17-4"]);
  fs.writeFileSync(
    path.join(fixture, "version.json"),
    JSON.stringify({ version: "26.10.17-4" }),
  );
  git(["add", "version.json"]);
  git(["commit", "-m", "chore: set an already tagged release version"]);
  const existingReleaseTag = getReleaseContext(fixture);
  assert.equal(existingReleaseTag.displayVersion, "26.10.17-4");
  assert.equal(existingReleaseTag.releaseTag, "v26.10.17-4");
  assert.equal(
    existingReleaseTag.shouldTag,
    false,
    "deployment must not try to recreate a release tag that already exists",
  );
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log("Date-based release version checks passed.");
