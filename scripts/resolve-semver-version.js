const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  formatDateVersion,
  parseDateVersion,
} = require("./date-version");

const rootDir = path.resolve(__dirname, "..");
const historicalTagPattern =
  /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

function parseVersion(version) {
  const parsed = parseDateVersion(version);
  if (!parsed)
    throw new Error(
      `Invalid date-based version: ${version}. Expected YY.MM.DD-Patch.`,
    );
  return parsed;
}

function calculateNextVersion(baseVersion, commitMessages) {
  const dateVersion = parseVersion(baseVersion);
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

  if (bump > 0)
    return formatDateVersion({ ...dateVersion, patch: dateVersion.patch + 1 });
  return baseVersion;
}

function getVersionBumpCommit(repositoryDir, version, previousTag) {
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const commits = execFileSync(
    "git",
    ["log", "--format=%H", range, "--", "version.json"],
    { cwd: repositoryDir, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

  for (const commit of commits) {
    const commitVersion = JSON.parse(
      execFileSync("git", ["show", `${commit}:version.json`], {
        cwd: repositoryDir,
        encoding: "utf8",
      }),
    );
    if (commitVersion.version !== version) continue;

    let parentVersion = "";
    try {
      const parent = execFileSync("git", ["rev-parse", `${commit}^`], {
        cwd: repositoryDir,
        encoding: "utf8",
      }).trim();
      parentVersion = JSON.parse(
        execFileSync("git", ["show", `${parent}:version.json`], {
          cwd: repositoryDir,
          encoding: "utf8",
        }),
      ).version;
    } catch (error) {
      if (error.code !== "ENOENT" && error.status !== 128) throw error;
    }

    if (
      historicalTagPattern.test(parentVersion) &&
      parentVersion !== version
    )
      return commit;
  }

  return "";
}

function getReleaseContext(repositoryDir = rootDir) {
  const tags = execFileSync(
    "git",
    ["tag", "--merged", "HEAD", "--list", "v[0-9]*", "--sort=-version:refname"],
    { cwd: repositoryDir, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter((tag) =>
      /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag),
    );
  const previousTag = tags[0] || "";
  const versionJson = JSON.parse(
    fs.readFileSync(path.join(repositoryDir, "version.json"), "utf8"),
  );
  parseVersion(versionJson.version);
  const taggedVersion = previousTag ? previousTag.slice(1) : versionJson.version;
  const versionBumpCommit = previousTag
    ? getVersionBumpCommit(repositoryDir, versionJson.version, previousTag)
    : "";
  const baseVersion = versionBumpCommit
    ? versionJson.version
    : taggedVersion;
  parseVersion(baseVersion);
  const commitRangeStart = versionBumpCommit || previousTag;
  const commitMessages = commitRangeStart
    ? execFileSync(
        "git",
        ["log", "--format=%B%x00", `${commitRangeStart}..HEAD`],
        { cwd: repositoryDir, encoding: "utf8" },
      )
        .split("\0")
        .filter((message) => message.trim())
    : [];
  const displayVersion = calculateNextVersion(baseVersion, commitMessages);

  return {
    baseVersion,
    displayVersion,
    releaseTag: `v${displayVersion}`,
    shouldTag:
      displayVersion !== taggedVersion &&
      !tags.includes(`v${displayVersion}`),
  };
}

if (require.main === module) {
  const release = getReleaseContext();
  const outputs = [
    `display_version=${release.displayVersion}`,
    `release_tag=${release.releaseTag}`,
    `should_tag=${release.shouldTag}`,
  ];
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `${outputs.join("\n")}\n`);
  } else {
    console.log(outputs.join("\n"));
  }
}

module.exports = {
  calculateNextVersion,
  getReleaseContext,
  getVersionBumpCommit,
};
