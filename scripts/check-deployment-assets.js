const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mrh-pages-assets-"));
const outputDir = path.join(tempDir, "site");

function listHashableAssets(directory, relativeDirectory = "") {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const relativePath = path.posix.join(relativeDirectory, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!relativeDirectory && entry.name === "qr-vendor") {
        files.push(...listHashableAssets(absolutePath, relativePath));
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).toLowerCase();
    if (
      ((extension === ".js" || extension === ".mjs") &&
        (relativeDirectory !== "" || entry.name !== "sw.js")) ||
      (relativeDirectory === "" &&
        (extension === ".css" || extension === ".svg"))
    ) {
      files.push(relativePath);
    }
  }
  return files;
}

function assertFileExists(relativePath) {
  assert.ok(
    fs.existsSync(path.join(outputDir, relativePath)),
    `deployment reference must resolve to a published file: ${relativePath}`,
  );
}

try {
  execFileSync(
    process.execPath,
    [path.join(rootDir, "scripts", "prepare-pages-assets.js"), outputDir],
    { cwd: rootDir, stdio: "pipe" },
  );

  const sourceAssets = listHashableAssets(rootDir);
  for (const sourcePath of sourceAssets) {
    const extension = path.extname(sourcePath);
    const sourceName = path.basename(sourcePath, extension);
    const outputDirectory = path.dirname(path.join(outputDir, sourcePath));
    const candidates = fs
      .readdirSync(outputDirectory)
      .filter((name) =>
        new RegExp(
          `^${sourceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.[0-9a-f]{16}${extension.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
        ).test(name),
      );
    assert.equal(
      candidates.length,
      1,
      `exactly one content-hashed asset must be published for ${sourcePath}`,
    );
    const hashedPath = path.join(path.dirname(sourcePath), candidates[0]);
    const contents = fs.readFileSync(path.join(outputDir, hashedPath));
    const digest = crypto
      .createHash("sha256")
      .update(contents)
      .digest("hex")
      .slice(0, 16);
    assert.ok(
      candidates[0].endsWith(`.${digest}${extension}`),
      `asset filename hash must match final bytes: ${hashedPath}`,
    );
    if (extension === ".js" || extension === ".mjs") {
      execFileSync(
        process.execPath,
        ["--check", path.join(outputDir, hashedPath)],
        { stdio: "pipe" },
      );
    }
    assert.equal(
      fs.existsSync(path.join(outputDir, sourcePath)),
      false,
      `the unhashed deployment asset must not be published: ${sourcePath}`,
    );
  }

  const html = fs.readFileSync(path.join(outputDir, "index.html"), "utf8");
  assert.equal(
    fs.existsSync(path.join(outputDir, "reviewer-pdf-service")),
    false,
    "the backend PDF processing package must not be shipped to the website",
  );
  for (const asset of [
    "reviewer-pdf-worker.js",
    "pdf-lib-1.17.1.min.js",
    "pdfjs-5.4.394.min.mjs",
    "pdfjs-5.4.394.worker.min.mjs",
  ]) {
    const extension = path.extname(asset);
    const basename = path.basename(asset, extension);
    const published = fs
      .readdirSync(outputDir)
      .filter((name) => name.startsWith(`${basename}.`) && name.endsWith(extension));
    assert.equal(
      published.length,
      1,
      `the website must publish one hashed client PDF asset: ${asset}`,
    );
  }
  assert.match(
    fs.readFileSync(path.join(outputDir, "404.html"), "utf8"),
    /baseLengths\.push\(1\)[\s\S]*?for \([\s\S]*?baseLengths\.includes\(baseLength\)/,
    "GitHub Pages deep links should resolve the project app base before probing nested paths",
  );
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    if (!reference || /^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
    assertFileExists(reference);
    if (/\.(?:js|css|svg|mjs)$/.test(reference)) {
      assert.match(
        reference,
        /\.[0-9a-f]{16}\.(?:js|css|svg|mjs)$/,
        `local runtime assets must use content-hashed filenames: ${reference}`,
      );
      assert.ok(
        !match[1].includes("?"),
        `immutable runtime assets must not depend on query-string cache busting: ${match[1]}`,
      );
    }
  }

  const manifest = JSON.parse(
    fs.readFileSync(path.join(outputDir, "manifest.json"), "utf8"),
  );
  assertFileExists(manifest.icons[0].src.split(/[?#]/, 1)[0]);
  assert.match(manifest.icons[0].src, /\.[0-9a-f]{16}\.svg$/);

  const deployedEntry = [
    ...html.matchAll(
      /<script\b[^>]*\bsrc=["']?([^"'\s>]+\.js)["']?[^>]*>/gi,
    ),
  ]
    .map((match) => match[1])
    .find((source) => /(?:^|\/)app-entry\.[0-9a-f]{16}\.js$/.test(source));
  assert.ok(deployedEntry, "HTML must reference its content-hashed entry script");

  const deployedEntrySource = fs.readFileSync(
    path.join(outputDir, deployedEntry),
    "utf8",
  );
  const releaseAssets = deployedEntrySource.match(
    /const assetNames = \[([\s\S]*?)\];/,
  )?.[1];
  assert.ok(
    releaseAssets,
    "the no-service-worker release check must include its deployment assets",
  );
  for (const match of releaseAssets.matchAll(/"([^"]+)"/g)) {
    assertFileExists(match[1]);
  }
  const deployedAppCore = fs
    .readdirSync(outputDir)
    .find((name) => /^app-core\.[0-9a-f]{16}\.js$/.test(name));
  assert.ok(deployedAppCore, "the deployment must include the hashed app core");
  const deployedAppCoreSource = fs.readFileSync(
    path.join(outputDir, deployedAppCore),
    "utf8",
  );
  assert.doesNotMatch(
    deployedAppCoreSource,
    /PDFDocument\.load/,
    "PDF parsing must remain isolated to the dedicated browser worker",
  );
  assert.match(
    deployedAppCoreSource,
    /new globalScope\.Worker/,
    "the deployed app core must offload PDF watermarking to a browser worker",
  );
  for (const asset of [
    "pdfjs-5.4.394.min.mjs",
    "pdfjs-5.4.394.worker.min.mjs",
  ]) {
    const basename = path.basename(asset, ".mjs");
    const hashedAsset = fs
      .readdirSync(outputDir)
      .find((name) => new RegExp(`^${basename}\\.[0-9a-f]{16}\\.mjs$`).test(name));
    assert.ok(hashedAsset, `the deployment must hash ${asset}`);
    assert.ok(
      deployedAppCoreSource.includes(hashedAsset),
      `the deployed app core must reference the hashed PDF.js asset ${hashedAsset}`,
    );
    assert.ok(
      !deployedAppCoreSource.includes(asset),
      `the deployed app core must not retain the unhashed PDF.js path ${asset}`,
    );
  }
  const worker = fs.readFileSync(path.join(outputDir, "sw.js"), "utf8");
  for (const match of worker.matchAll(/["']\.\/([^"']+)["']/g)) {
    assertFileExists(match[1].split(/[?#]/, 1)[0]);
  }
  const shellAssets = worker.match(
    /const APP_SHELL_PATHS = \[([\s\S]*?)\];/,
  )?.[1];
  assert.ok(
    shellAssets,
    "the service worker must declare paths used to build its precached shell",
  );
  for (const match of shellAssets.matchAll(/"\.\/([^"]+)"/g)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    assertFileExists(reference);
    if (/\.(?:js|css|svg|mjs)$/.test(reference)) {
      assert.match(reference, /\.[0-9a-f]{16}\.(?:js|css|svg|mjs)$/);
    }
  }
  assert.match(deployedEntry, /\.[0-9a-f]{16}\.js$/);

  console.log(
    `Deployment asset checks passed for ${sourceAssets.length} content-hashed assets.`,
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
