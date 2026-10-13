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

  git(["tag", "v1.3.0"]);
  fs.writeFileSync(path.join(fixture, "fix.txt"), "fix\n");
  git(["add", "fix.txt"]);
  git(["commit", "-m", "fix: correct fixture"]);
  const fixRelease = getReleaseContext(fixture);
  assert.equal(fixRelease.displayVersion, "1.3.1");
  assert.equal(fixRelease.shouldTag, true);
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

console.log("Conventional Commit SemVer checks passed.");
