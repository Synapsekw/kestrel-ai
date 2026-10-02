import { assetModelGlbUrl, type AssetSpec } from "@contract/client";

/** A file name the OS accepts: the characters Windows forbids become a dash. */
function fileStem(name: string, version: number): string {
  const safe = name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "asset-model";
  return `${safe}-v${version}`;
}

/** The app has no save helper: an anchor with `download` is what the reports page uses. */
function clickAnchor(href: string, download: string): void {
  const a = document.createElement("a");
  a.href = href;
  a.download = download;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** The version's GLB, served by the backend (the token rides in the query, like image files). */
export function downloadGlb(
  backend: { baseUrl: string; token: string },
  projectId: string,
  model: { id: string; name: string },
  version: number,
): void {
  clickAnchor(
    assetModelGlbUrl(backend.baseUrl, backend.token, projectId, model.id, version),
    `${fileStem(model.name, version)}.glb`,
  );
}

/** The version's spec, saved from the detail the workspace already holds (no separate endpoint). */
export function downloadSpec(model: { name: string }, version: number, spec: AssetSpec): void {
  const blob = new Blob([JSON.stringify(spec, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  clickAnchor(url, `${fileStem(model.name, version)}.json`);
  // The click has handed the blob to the download; release it on the next turn.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
