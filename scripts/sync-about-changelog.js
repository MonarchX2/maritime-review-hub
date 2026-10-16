const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const changelog = fs.readFileSync(path.join(rootDir, "CHANGELOG.md"), "utf8");
const indexPath = path.join(rootDir, "index.html");
const index = fs.readFileSync(indexPath, "utf8");
const entryHeadings = [...changelog.matchAll(/^## (.+?) - (\d{4}-\d{2}-\d{2})\s*$/gm)];
if (!entryHeadings.length) {
  throw new Error("CHANGELOG.md does not contain any dated release entries.");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseEntry(heading, index) {
  const start = heading.index + heading[0].length;
  const end =
    index + 1 < entryHeadings.length
      ? entryHeadings[index + 1].index
      : changelog.length;
  const groups = [];
  let currentGroup = null;
  let currentBullet = "";

  const finishBullet = () => {
    if (!currentBullet) return;
    if (!currentGroup) {
      currentGroup = { name: "", bullets: [] };
      groups.push(currentGroup);
    }
    currentGroup.bullets.push(currentBullet.trim());
    currentBullet = "";
  };

  for (const line of changelog.slice(start, end).split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.startsWith("### ")) {
      finishBullet();
      currentGroup = { name: line.slice(4).trim(), bullets: [] };
      groups.push(currentGroup);
    } else if (line.startsWith("- ")) {
      finishBullet();
      currentBullet = line.slice(2).trim();
    } else if (/^\s+/.test(line) && currentBullet) {
      currentBullet += ` ${line.trim()}`;
    } else {
      throw new Error(
        `Unsupported changelog content in release ${heading[1]}: ${line}`,
      );
    }
  }
  finishBullet();
  return { version: heading[1], groups };
}

function renderEntry(entry) {
  const output = [
    '                <h5 class="text-sm font-semibold text-gray-700 dark:text-gray-200">',
    `                  Version ${escapeHtml(entry.version)}`,
    "                </h5>",
  ];
  for (const group of entry.groups) {
    if (group.name) {
      output.push(
        '                <h6 class="mt-2 text-xs font-bold uppercase text-gray-500 dark:text-gray-400">',
        `                  ${escapeHtml(group.name)}`,
        "                </h6>",
      );
    }
    if (!group.bullets.length) continue;
    output.push(
      '                <ul class="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-600 dark:text-gray-400">',
    );
    for (const bullet of group.bullets) {
      const safeBullet = escapeHtml(bullet).replace(
        /`([^`]+)`/g,
        "<code>$1</code>",
      );
      output.push(`                  <li>${safeBullet}</li>`);
    }
    output.push("                </ul>");
  }
  return output.join("\n");
}

const entries = entryHeadings.map(parseEntry);
const latestEntries = entries.slice(0, 3).map(renderEntry);
const olderEntries = entries.slice(3).map(renderEntry);
const generatedContent = [
  ...latestEntries,
  ...(olderEntries.length
    ? [
        '                <div id="about-changelog-older" class="hidden">',
        ...olderEntries,
        "                </div>",
      ]
    : []),
].join("\n");
const markerPattern =
  /(<!-- ABOUT CHANGELOG START -->)\s*[\s\S]*?\s*(<!-- ABOUT CHANGELOG END -->)/;
if (!markerPattern.test(index)) {
  throw new Error("The About changelog generation markers are missing.");
}
const updatedIndex = index.replace(
  markerPattern,
  `$1\n${generatedContent}\n              $2`,
);
if (updatedIndex !== index) fs.writeFileSync(indexPath, updatedIndex);
console.log(`Synchronized ${entries.length} About MRH changelog releases.`);
