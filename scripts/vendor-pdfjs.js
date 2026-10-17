"use strict";

const fs = require("node:fs");
const path = require("node:path");

const repositoryRoot = path.resolve(__dirname, "..");
const packageRoot = path.join(repositoryRoot, "node_modules", "pdfjs-dist");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);
const expectedVersion = "5.4.394";
if (packageJson.version !== expectedVersion) {
  throw new Error(
    `Expected pdfjs-dist ${expectedVersion}, found ${packageJson.version}.`,
  );
}

const assets = [
  ["build/pdf.min.mjs", `pdfjs-${expectedVersion}.min.mjs`],
  ["build/pdf.worker.min.mjs", `pdfjs-${expectedVersion}.worker.min.mjs`],
  ["LICENSE", `pdfjs-${expectedVersion}-LICENSE.md`],
];
for (const [source, destination] of assets) {
  const contents = fs.readFileSync(path.join(packageRoot, source));
  if (!contents.length)
    throw new Error(`The PDF.js distribution file is empty: ${source}`);
  fs.writeFileSync(path.join(repositoryRoot, destination), contents);
}

console.log(`Vendored PDF.js ${expectedVersion} browser renderer.`);
