const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const packageVersions = [
  ["qrcode-generator", "1.4.4"],
  ["jsqr", "1.4.0"],
];

for (const [name, expectedVersion] of packageVersions) {
  const packagePath = path.join(rootDir, "node_modules", name, "package.json");
  const actualVersion = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Expected ${name}@${expectedVersion}, found ${name}@${actualVersion}.`,
    );
  }
}

const vendorDir = path.join(rootDir, "qr-vendor");
fs.mkdirSync(vendorDir, { recursive: true });
for (const [source, destination] of [
  ["qrcode-generator/qrcode.js", "qrcode-generator.js"],
  ["jsqr/dist/jsQR.js", "jsQR.js"],
]) {
  fs.copyFileSync(
    path.join(rootDir, "node_modules", source),
    path.join(vendorDir, destination),
  );
}
