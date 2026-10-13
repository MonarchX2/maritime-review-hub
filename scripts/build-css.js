const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const version = "3.4.19";
const assets = {
  "linux-arm64": [
    "tailwindcss-linux-arm64",
    "e5b2d27694daa80cc52ec29553ba2c6bd43d86bd51a9d633ed24058b9c05a676",
  ],
  "linux-arm": [
    "tailwindcss-linux-armv7",
    "e3610b109a64720295e1c00a18dd2d6d79d3cddc618219aa0830de97a55429a4",
  ],
  "linux-x64": [
    "tailwindcss-linux-x64",
    "4af3198c015616ea7d6617974ec3d70d987ecc00c1ca8463b0a30fd65cc7c06e",
  ],
  "darwin-arm64": [
    "tailwindcss-macos-arm64",
    "7fdeb00818b6214a337383063282b2361ecb08bbc08f8c8a7ba97ee1e2eaa4fe",
  ],
  "darwin-x64": [
    "tailwindcss-macos-x64",
    "a597f407e0f1f03535731f5b42f1576a8152cb5fffc2f38e754722bc0c280045",
  ],
  "win32-arm64": [
    "tailwindcss-windows-arm64.exe",
    "f2b6b999747aa0ae31999d59db117b1ba1e4e15e17675d7108e30aac4b680686",
  ],
  "win32-x64": [
    "tailwindcss-windows-x64.exe",
    "a15158c4c5e0e7a75f7229bfe4986fe7710d2edc468b6f96c8981f78ab211347",
  ],
};
const asset = assets[`${process.platform}-${process.arch}`];
if (!asset) {
  throw new Error(
    `Tailwind CSS ${version} has no supported standalone build for ${process.platform}-${process.arch}.`,
  );
}

const [filename, expectedHash] = asset;
const compilerPath = path.join(os.tmpdir(), filename);

async function ensureCompiler() {
  if (fs.existsSync(compilerPath)) {
    const cachedHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(compilerPath))
      .digest("hex");
    if (cachedHash === expectedHash) return;
  }

  const url = `https://github.com/tailwindlabs/tailwindcss/releases/download/v${version}/${filename}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download Tailwind CSS compiler: HTTP ${response.status}.`);
  }

  const compiler = Buffer.from(await response.arrayBuffer());
  const actualHash = crypto
    .createHash("sha256")
    .update(compiler)
    .digest("hex");
  if (actualHash !== expectedHash) {
    throw new Error(`Tailwind CSS compiler checksum mismatch for ${filename}.`);
  }

  fs.writeFileSync(compilerPath, compiler, { mode: 0o755 });
  if (process.platform !== "win32") fs.chmodSync(compilerPath, 0o755);
}

async function buildCss() {
  await ensureCompiler();
  const rootDir = path.resolve(__dirname, "..");
  execFileSync(
    compilerPath,
    [
      "-c",
      "tailwind.config.js",
      "-i",
      "tailwind.input.css",
      "-o",
      "tailwind.generated.css",
      "--minify",
    ],
    { cwd: rootDir, stdio: "inherit" },
  );
}

buildCss().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
