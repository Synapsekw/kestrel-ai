import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ICON_NAMES = [
  "128x128.png",
  "128x128@2x.png",
  "32x32.png",
  "64x64.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square30x30Logo.png",
  "Square310x310Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "StoreLogo.png",
  "icon.icns",
  "icon.ico",
  "icon.png",
];

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(frontend, "src/assets/kestrel-mark.svg");
const destination = resolve(frontend, "src-tauri/icons");
const manifestPath = resolve(frontend, "scripts/icons.manifest.json");
const tauriCli = resolve(frontend, "node_modules/@tauri-apps/cli/tauri.js");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function composeNativeIcon(master) {
  if (!/viewBox=["']0 0 256 256["']/.test(master)) {
    throw new Error("kestrel-mark.svg must use viewBox 0 0 256 256");
  }
  const body = master
    .replace(/^.*?<svg[^>]*>/s, "")
    .replace(/<\/svg>\s*$/s, "")
    .trim();
  if (!body || /<(?:rect|image)\b/i.test(body)) {
    throw new Error("kestrel-mark.svg must contain transparent geometry only");
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="48" fill="#e5af64"/>
  <g transform="translate(24 24) scale(.8125)" fill="#1d2322">
    ${body}
  </g>
</svg>\n`;
}

async function normalizeIcns(path) {
  const bytes = await readFile(path);
  if (bytes.toString("ascii", 0, 4) !== "icns" || bytes.readUInt32BE(4) !== bytes.length) {
    throw new Error("Tauri generated an invalid icon.icns container");
  }

  const chunks = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > bytes.length) {
      throw new Error("Tauri generated an invalid icon.icns chunk");
    }
    chunks.push(bytes.subarray(offset, offset + length));
    offset += length;
  }
  chunks.sort((left, right) => left.toString("ascii", 0, 4).localeCompare(right.toString("ascii", 0, 4)));
  const header = Buffer.alloc(8);
  header.write("icns", 0, "ascii");
  header.writeUInt32BE(bytes.length, 4);
  await writeFile(path, Buffer.concat([header, ...chunks]));
}

async function main() {
  const masterBytes = await readFile(sourcePath);
  const work = await mkdtemp(resolve(tmpdir(), "kestrel-icons-"));
  const composedPath = resolve(work, "kestrel-native.svg");
  const generated = resolve(work, "icons");

  try {
    await writeFile(composedPath, composeNativeIcon(masterBytes.toString("utf8")));
    const result = spawnSync(process.execPath, [tauriCli, "icon", composedPath, "--output", generated], {
      cwd: frontend,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(`Tauri icon generation failed\n${result.stdout}${result.stderr}`);
    }
    await normalizeIcns(resolve(generated, "icon.icns"));

    const files = {};
    for (const name of ICON_NAMES) {
      const generatedPath = resolve(generated, name);
      const bytes = await readFile(generatedPath);
      await copyFile(generatedPath, resolve(destination, name));
      files[name] = sha256(bytes);
    }
    const manifest = { sourceSha256: sha256(masterBytes), files };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`generated ${ICON_NAMES.length} native icons from kestrel-mark.svg`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
