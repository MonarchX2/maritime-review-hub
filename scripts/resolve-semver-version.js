const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const semverPattern = /^(\d+)\.(\d+)\.(\d+)$/;

function parseVersion(version) {
  const match = semverPattern.exec(version);
  if (!match) throw new Error(`Invalid SemVer version: ${version}`);
  return match.slice(1).map(Number);
}

function calculateNextVersion(baseVersion, commitMessages) {
  const [major, minor, patch] = parseVersion(baseVersion);
  let bump = 0;

  for (const message of commitMessages) {
    const [header = "", ...bodyLines] = message.trim().split(/\r?\n/);
    const conventional = /^([a-z][a-z0-9-]*)(?:\([^)]+\))?(!)?:\s.+$/i.exec(
      header,
    );
    if (!conventional) continue;

    if (
      conventional[2] === "!" ||
      bodyLines.some((line) => /^BREAKING CHANGE:\s*\S/i.test(line)) ||
      /^BREAKING-CHANGE:\s*\S/im.test(message)
    ) {
      bump = Math.max(bump, 3);
    } else if (conventional[1].toLowerCase() === "feat") {
      bump = Math.max(bump, 2);
    } else if (["fix", "perf"].includes(conventional[1].toLowerCase())) {
      bump = Math.max(bump, 1);
    }
  }

  if (bump === 3) return `${major + 1}.0.0`;
  if (bump === 2) return `${major}.${minor + 1}.0`;
  if (bump === 1) return `${major}.${minor}.${patch + 1}`;
  return baseVersion;
}

function getReleaseContext(repositoryDir = rootDir, commitSha = process.env.GITHUB_SHA) {
  const tags = execFileSync(
    "git",
    ["tag", "--merged", "HEAD", "--list", "v[0-9]*", "--sort=-version:refname"],
    { cwd: repositoryDir, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag));
  const previousTag = tags[0] || "";
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(repositoryDir, "package.json"), "utf8"),
  );
  const baseVersion = previousTag
    ? previousTag.slice(1)
    : packageJson.version;
  parseVersion(baseVersion);
  const commitMessages = previousTag
    ? execFileSync(
        "git",
        ["log", "--format=%B%x00", `${previousTag}..HEAD`],
        { cwd: repositoryDir, encoding: "utf8" },
      )
        .split("\0")
        .filter((message) => message.trim())
    : [];
  const displayVersion = calculateNextVersion(baseVersion, commitMessages);
  const sha = (
    commitSha ||
    execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryDir,
      encoding: "utf8",
    })
  )
    .trim()
    .slice(0, 12);

  return {
    baseVersion,
    displayVersion,
    releaseVersion: `mrh-${displayVersion}-${sha}`,
    releaseTag: `v${displayVersion}`,
    shouldTag: displayVersion !== baseVersion,
  };
}

if (require.main === module) {
  const release = getReleaseContext();
  const outputs = [
    `display_version=${release.displayVersion}`,
    `release_version=${release.releaseVersion}`,
    `release_tag=${release.releaseTag}`,
    `should_tag=${release.shouldTag}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
  } else {
    console.log(outputs.join("\n"));
  }
}

module.exports = { calculateNextVersion, getReleaseContext };
