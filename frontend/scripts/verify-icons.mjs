import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const iconDir = resolve(frontend, "src-tauri/icons");
const manifestPath = resolve(frontend, "scripts/icons.manifest.json");
const sourcePath = resolve(frontend, "src/assets/kestrel-mark.svg");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function main() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const sourceHash = sha256(await readFile(sourcePath));
  if (sourceHash !== manifest.sourceSha256) {
    throw new Error("native icons are stale: kestrel-mark.svg changed; run pnpm icons:generate");
  }

  const actualNames = (await readdir(iconDir)).sort();
  const expectedNames = Object.keys(manifest.files).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames)) {
    throw new Error(
      `native icon coverage differs\nexpected: ${expectedNames.join(", ")}\nactual: ${actualNames.join(", ")}`,
    );
  }

  for (const name of expectedNames) {
    const actualHash = sha256(await readFile(resolve(iconDir, name)));
    if (actualHash !== manifest.files[name]) {
      throw new Error(`native icon is stale or damaged: ${name}; run pnpm icons:generate`);
    }
  }

  console.log(`verified ${expectedNames.length} native icons from kestrel-mark.svg`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
