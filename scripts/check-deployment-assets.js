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
      (extension === ".js" &&
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
    if (extension === ".js") {
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
    "the browser-only PDF processing package must not be shipped to the website",
  );
  assert.match(
    fs.readFileSync(path.join(outputDir, "404.html"), "utf8"),
    /baseLengths\.push\(1\)[\s\S]*?for \([\s\S]*?baseLengths\.includes\(baseLength\)/,
    "GitHub Pages deep links should resolve the project app base before probing nested paths",
  );
  for (const match of html.matchAll(/\b(?:src|href)="([^"]+)"/g)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    if (!reference || /^(?:[a-z]+:|\/\/|#)/i.test(reference)) continue;
    assertFileExists(reference);
    if (/\.(?:js|css|svg)$/.test(reference)) {
      assert.match(
        reference,
        /\.[0-9a-f]{16}\.(?:js|css|svg)$/,
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
  assert.match(
    fs.readFileSync(path.join(outputDir, deployedAppCore), "utf8"),
    /new URL\(\s*"reviewer-pdf-worker\.[0-9a-f]{16}\.js"/,
    "app core must load the content-hashed PDF worker lazily",
  );
  const deployedPdfWorker = fs
    .readdirSync(outputDir)
    .find((name) => /^reviewer-pdf-worker\.[0-9a-f]{16}\.js$/.test(name));
  assert.ok(deployedPdfWorker, "the deployment must include the PDF worker");
  assert.match(
    fs.readFileSync(path.join(outputDir, deployedPdfWorker), "utf8"),
    /importScripts\("\.\/pdf-lib-1\.17\.1\.min\.[0-9a-f]{16}\.js"\)/,
    "the PDF worker must import the content-hashed library bundle",
  );
  assert.ok(
    fs.existsSync(path.join(outputDir, "pdf-lib-1.17.1-LICENSE.md")),
    "the deployed PDF library must include its MIT license",
  );

  const worker = fs.readFileSync(path.join(outputDir, "sw.js"), "utf8");
  for (const match of worker.matchAll(/["']\.\/([^"']+)["']/g)) {
    assertFileExists(match[1].split(/[?#]/, 1)[0]);
  }
  const shellAssets = worker.match(
    /const APP_SHELL = \[([\s\S]*?)\]\.map/,
  )?.[1];
  assert.ok(shellAssets, "the service worker must declare its precached shell");
  for (const match of shellAssets.matchAll(/"\.\/([^"]+)"/g)) {
    const reference = match[1].split(/[?#]/, 1)[0];
    assertFileExists(reference);
    if (/\.(?:js|css|svg)$/.test(reference)) {
      assert.match(reference, /\.[0-9a-f]{16}\.(?:js|css|svg)$/);
    }
  }
  assert.match(deployedEntry, /\.[0-9a-f]{16}\.js$/);

  console.log(
    `Deployment asset checks passed for ${sourceAssets.length} content-hashed assets.`,
  );
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
