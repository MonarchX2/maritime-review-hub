const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  calculateNextVersion,
  getReleaseContext,
} = require("./resolve-semver-version");

assert.equal(
  calculateNextVersion("14.8.0", ["feat: add a feature"]),
  "14.9.0",
);
assert.equal(
  calculateNextVersion("14.8.0", ["fix(sync): retry failed uploads"]),
  "14.8.1",
);
assert.equal(
  calculateNextVersion("14.8.0", ["feat!: replace the storage API"]),
  "15.0.0",
);
assert.equal(
  calculateNextVersion("14.8.0", [
    "fix: correct response",
    "docs: update guide\n\nBREAKING CHANGE: remove legacy docs",
  ]),
  "15.0.0",
);
assert.equal(
  calculateNextVersion("14.8.0", ["perf: reduce render work", "chore: cleanup"]),
  "14.8.1",
);
assert.equal(
  calculateNextVersion("14.8.0", ["docs: update guide", "chore: cleanup"]),
  "14.8.0",
);
assert.equal(
  calculateNextVersion("10.15.26-2", ["docs: update guide"]),
  "10.15.26-2",
);
assert.equal(
  calculateNextVersion("10.15.26-2", ["fix: correct layout"]),
  "10.15.27",
);
assert.equal(
  calculateNextVersion("26.10.15-6", ["fix(resources): remove portal commentary"]),
  "26.10.15-7",
  "date-based release fixes should increment the daily patch sequence",
);
assert.equal(
  calculateNextVersion("09.12.31-2", ["fix: correct layout"]),
  "09.12.31-3",
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
assert.throws(() => calculateNextVersion("14.8", []), /Invalid SemVer version/);

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "mrh-semver-"));
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
    path.join(fixture, "package.json"),
    JSON.stringify({ version: "1.2.3" }),
  );
  git(["add", "package.json"]);
  git(["commit", "-m", "chore: initialize baseline"]);
  git(["tag", "v1.2.3"]);
  fs.writeFileSync(path.join(fixture, "change.txt"), "feature\n");
  git(["add", "change.txt"]);
  git(["commit", "-m", "feat: add fixture change"]);

  const featureSha = git(["rev-parse", "HEAD"]);
  const featureRelease = getReleaseContext(fixture, featureSha);
  assert.equal(featureRelease.displayVersion, "1.3.0");
  assert.equal(featureRelease.releaseVersion, `mrh-1.3.0-${featureSha.slice(0, 12)}`);
  assert.equal(featureRelease.releaseTag, "v1.3.0");
  assert.equal(featureRelease.shouldTag, true);

  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ version: "1.3.1" }),
  );
  git(["add", "package.json"]);
  git(["commit", "-m", "chore: bump version to 1.3.1"]);
  const explicitVersionRelease = getReleaseContext(fixture);
  assert.equal(explicitVersionRelease.displayVersion, "1.3.1");
  assert.equal(explicitVersionRelease.releaseTag, "v1.3.1");
  assert.equal(explicitVersionRelease.shouldTag, true);

  git(["tag", "v1.3.1"]);
  fs.writeFileSync(path.join(fixture, "fix.txt"), "fix\n");
  git(["add", "fix.txt"]);
  git(["commit", "-m", "fix: correct fixture"]);
  const fixRelease = getReleaseContext(fixture);
  assert.equal(fixRelease.displayVersion, "1.3.2");
  assert.equal(fixRelease.shouldTag, true);

  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ version: "1.3.2-2" }),
  );
  git(["add", "package.json"]);
  git(["commit", "-m", "chore: bump version to 1.3.2-2"]);
  const prereleaseRelease = getReleaseContext(fixture);
  assert.equal(prereleaseRelease.displayVersion, "1.3.2-2");
  assert.equal(prereleaseRelease.releaseTag, "v1.3.2-2");
  assert.equal(prereleaseRelease.shouldTag, true);

  fs.writeFileSync(
    path.join(fixture, "package.json"),
    JSON.stringify({ version: "26.10.15-6" }),
  );
  git(["add", "package.json"]);
  git(["commit", "-m", "chore: set date-based release baseline"]);
  const dateVersionBaseline = getReleaseContext(fixture);
  assert.equal(dateVersionBaseline.displayVersion, "26.10.15-6");
  assert.equal(dateVersionBaseline.releaseTag, "v26.10.15-6");
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log("Conventional Commit SemVer checks passed.");
