const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const rootDir = path.resolve(__dirname, "..");
const expectedHashes = new Map([
  [
    "qrcode-generator.js",
    "8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k",
  ],
  [
    "jsQR.js",
    "b5Ya4Bq3qCyz39m2ISh+4DxjAIljdeFwK/BsXLuj9gugaNwAcj/ia15fxNZL9Nlx",
  ],
]);

for (const [filename, expectedHash] of expectedHashes) {
  const filePath = path.join(rootDir, "qr-vendor", filename);
  const actualHash = crypto
    .createHash("sha384")
    .update(fs.readFileSync(filePath))
    .digest("base64");
  assert.equal(actualHash, expectedHash, `${filename} integrity mismatch`);
}

console.log("QR vendor asset integrity checks passed.");
