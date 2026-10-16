"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(repositoryRoot, "reviewer-pdf-service");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const expectedVersion = "1.17.1";
if (packageJson.devDependencies?.["pdf-lib"] !== expectedVersion) {
  throw new Error(`Expected the pinned pdf-lib version ${expectedVersion}.`);
}

const installedPackagePath = path.join(
  packageRoot,
  "node_modules",
  "pdf-lib",
  "package.json",
);
const installedPackage = JSON.parse(
  fs.readFileSync(installedPackagePath, "utf8"),
);
if (installedPackage.version !== expectedVersion) {
  throw new Error(
    `Expected installed pdf-lib ${expectedVersion}, found ${installedPackage.version}.`,
  );
}

const vendorDirectory = path.join(packageRoot, "vendor");
const backendDirectory = path.join(repositoryRoot, "backend");
fs.mkdirSync(vendorDirectory, { recursive: true });
const bundlePath = path.join(
  packageRoot,
  "node_modules",
  "pdf-lib",
  "dist",
  "pdf-lib.min.js",
);
const licensePath = path.join(
  packageRoot,
  "node_modules",
  "pdf-lib",
  "LICENSE.md",
);
const bundle = fs.readFileSync(bundlePath);
const license = fs.readFileSync(licensePath);
if (!bundle.length || !license.toString("utf8").includes("MIT License")) {
  throw new Error("The pinned PDF library bundle or MIT license is missing.");
}

fs.writeFileSync(
  path.join(vendorDirectory, `pdf-lib-${expectedVersion}.min.js`),
  bundle,
);
fs.writeFileSync(
  path.join(vendorDirectory, `pdf-lib-${expectedVersion}-LICENSE.md`),
  license,
);
fs.mkdirSync(backendDirectory, { recursive: true });
fs.writeFileSync(path.join(backendDirectory, "PDFLib.js"), bundle);
console.log(
  `Vendored pdf-lib ${expectedVersion} (${bundle.length} bytes) to the local GAS project and test fixture.`,
);
