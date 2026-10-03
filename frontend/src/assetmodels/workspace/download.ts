import { assetModelGlbUrl, type AssetSpec } from "@contract/client";

/** A file name the OS accepts: the characters Windows forbids become a dash. */
function fileStem(name: string, version: number): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "asset-model";
  return `${safe}-v${version}`;
}

/**
 * Saves `href` as `download`. Only a same-origin (blob:) href keeps the file name: Chromium and
 * WebView2 ignore `download` on a cross-origin link, which is why the GLB goes through a blob too.
 */
function clickAnchor(href: string, download: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = download;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Saves a blob under `name` through an object URL, released once the click has handed it over. */
function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  clickAnchor(url, name);
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * The version's GLB, fetched from the backend (the token rides in the query, like image files) and
 * saved as "<name>-v<n>.glb". Rejects on a failed fetch; the caller says so without the URL.
 */
export async function downloadGlb(
  backend: { baseUrl: string; token: string },
  projectId: string,
  model: { id: string; name: string },
  version: number,
): Promise<void> {
  const r = await fetch(assetModelGlbUrl(backend.baseUrl, backend.token, projectId, model.id, version));
  if (!r.ok) throw new Error(`GLB download failed (${r.status})`);
  saveBlob(await r.blob(), `${fileStem(model.name, version)}.glb`);
}

/** The version's spec, saved from the detail the workspace already holds (no separate endpoint). */
export function downloadSpec(model: { name: string }, version: number, spec: AssetSpec): void {
  saveBlob(
    new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" }),
    `${fileStem(model.name, version)}.json`,
  );
}
