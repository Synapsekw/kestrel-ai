import type { SiteScene } from "@/api/siteScene";

/** `off`: the project has a model but the 3D view could not start, so it is not shown. */
export type ModelState = "none" | "loading" | "ready" | "error" | "off";
export type LayerRowId = "model" | "ortho" | "drawing" | "cloud" | "photos" | "findings";
export interface LayerRow {
  id: LayerRowId;
  label: string;
  available: boolean;
  toggleable: boolean;
  detail: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const later = (n: number, one: string, many: string) =>
  n === 0 ? "None" : `${count(n, one, many)} · not in this view yet`;

const MODEL_DETAIL: Record<Exclude<ModelState, "ready">, string> = {
  none: "None yet",
  loading: "Loading",
  error: "Could not load",
  off: "Not shown",
};

/** The Layers placeholder's rows (S3's LayersPanel replaces the panel; S2 makes the last three live). */
export function sceneLayerRows(scene: SiteScene, model: ModelState, items: number): LayerRow[] {
  const modelDetail = model === "ready" ? count(items, "item", "items") : MODEL_DETAIL[model];
  return [
    {
      id: "model",
      label: "Plant model",
      available: model !== "none",
      toggleable: model === "ready",
      detail: modelDetail,
    },
    {
      id: "ortho",
      label: "Maps",
      available: scene.orthos.length > 0,
      toggleable: true,
      detail: scene.orthos.length === 0 ? "None placed" : count(scene.orthos.length, "map", "maps"),
    },
    {
      id: "drawing",
      label: "Drawings",
      available: scene.drawings.length > 0,
      toggleable: true,
      detail:
        scene.drawings.length === 0 ? "None placed" : count(scene.drawings.length, "drawing", "drawings"),
    },
    {
      id: "cloud",
      label: "Point clouds",
      available: scene.clouds.length > 0,
      toggleable: false,
      detail: later(scene.clouds.length, "cloud", "clouds"),
    },
    {
      id: "photos",
      label: "Photos",
      available: scene.photos.count > 0,
      toggleable: false,
      detail: later(scene.photos.count, "photo", "photos"),
    },
    {
      id: "findings",
      label: "Findings",
      available: scene.findings.count > 0,
      toggleable: false,
      detail: later(scene.findings.count, "finding", "findings"),
    },
  ];
}
