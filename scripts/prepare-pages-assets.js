const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const outputDir = process.argv[2] && path.resolve(process.argv[2]);
if (!outputDir || outputDir === rootDir || outputDir.startsWith(`${rootDir}${path.sep}`)) {
  throw new Error("Provide an output directory outside the repository.");
}
if (fs.existsSync(outputDir)) {
  throw new Error(`Output directory already exists: ${outputDir}`);
}

const excludedDirectories = new Set([
  ".git",
  ".github",
  "node_modules",
  "reviewer-pdf-service",
]);
const textExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".txt",
  ".webmanifest",
  ".xml",
]);

function copyDirectory(sourceDir, destinationDir) {
  fs.mkdirSync(destinationDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;

    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
    }
  }
}

function getHashedAssets(directory, relativeDirectory = "") {
  const assets = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (relativeDirectory || entry.name === "qr-vendor") {
        assets.push(...getHashedAssets(absolutePath, relativePath));
      }
      continue;
    }

    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (
      extension === ".js" &&
      relativeDirectory === "" &&
      entry.name !== "sw.js"
    ) {
      assets.push(relativePath);
    } else if (
      extension === ".css" &&
      relativeDirectory === ""
    ) {
      assets.push(relativePath);
    } else if (extension === ".mjs" && relativeDirectory === "") {
      assets.push(relativePath);
    } else if (
      extension === ".svg" &&
      relativeDirectory === ""
    ) {
      assets.push(relativePath);
    } else if (
      relativeDirectory === "qr-vendor" &&
      extension === ".js"
    ) {
      assets.push(relativePath);
    }
  }
  return assets;
}

function hashName(relativePath, contents) {
  const extension = path.extname(relativePath);
  const basename = path.basename(relativePath, extension);
  const digest = crypto
    .createHash("sha256")
    .update(contents)
    .digest("hex")
    .slice(0, 16);
  return `${basename}.${digest}${extension}`;
}

const runtimeTextFiles = [
  "index.html",
  "manifest.json",
  "app-entry.js",
  "app-core.js",
  "sw.js",
  "qr-transfer-core.js",
  "reviewer-pdf-worker.js",
  "pdfjs-5.4.394.min.mjs",
  "pdfjs-5.4.394.worker.min.mjs",
  "styles.css",
  "tailwind.generated.css",
  "qr-vendor/qrcode-generator.js",
  "qr-vendor/jsQR.js",
];
const hashedFiles = new Set();

function replaceAssetReferences(relativePath, nextPath) {
  const oldName = path.posix.basename(relativePath);
  const newName = path.posix.basename(nextPath);
  const escapedName = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const referencePattern = new RegExp(
    `${escapedName}(?=[?#"'\\s)>]|$)`,
    "g",
  );

  for (const textPath of runtimeTextFiles) {
    const normalizedTextPath = textPath.split("/").join(path.sep);
    if (hashedFiles.has(normalizedTextPath)) continue;

    const filePath = path.join(outputDir, normalizedTextPath);
    if (
      !fs.existsSync(filePath) ||
      !textExtensions.has(path.extname(filePath))
    ) {
      continue;
    }
    const source = fs.readFileSync(filePath, "utf8");
    const updated = source
      .replace(referencePattern, newName)
      .replace(
        new RegExp(
          `${newName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=mrh-[A-Za-z0-9._-]+`,
          "g",
        ),
        newName,
      );
    if (updated !== source) fs.writeFileSync(filePath, updated);
  }
}

copyDirectory(rootDir, outputDir);

const assets = getHashedAssets(outputDir).sort((left, right) => {
  const rank = (name) =>
    name.startsWith("qr-vendor/")
      ? 0
      : name === "pdf-lib-1.17.1.min.js" ||
        name.startsWith("pdfjs-")
        ? 1
        : name === "reviewer-pdf-worker.js"
        ? 2
        : name === "qr-transfer-core.js"
          ? 2
          : name === "app-entry.js"
            ? 4
            : 3;
  return rank(left) - rank(right) || left.localeCompare(right);
});
const names = new Set();
for (const relativePath of assets) {
  const absolutePath = path.join(outputDir, relativePath);
  const contents = fs.readFileSync(absolutePath);
  const hashedPath = path.posix.join(
    path.posix.dirname(relativePath),
    hashName(relativePath, contents),
  );
  const hashedAbsolutePath = path.join(outputDir, hashedPath);
  if (names.has(hashedPath) || fs.existsSync(hashedAbsolutePath)) {
    throw new Error(`Hashed asset path already exists: ${hashedPath}`);
  }
  names.add(hashedPath);
  fs.renameSync(absolutePath, hashedAbsolutePath);
  hashedFiles.add(hashedPath.split("/").join(path.sep));
  replaceAssetReferences(relativePath, hashedPath);
}

console.log(`Prepared ${assets.length} content-hashed assets in ${outputDir}.`);
