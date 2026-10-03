import type { SiteScene } from "@/api/siteScene";
import type { SiteLayer } from "@/site3d/layers/types";

/** `off`: the project has a model but the 3D view could not start, so it is not shown. */
export type ModelState = "none" | "loading" | "ready" | "error" | "off";
export type LayerRowId = "model" | "ortho" | "drawing" | "cloud" | "photos" | "findings";
/** Structurally S2's LayerStatus (`layers/status.ts`); declared here so the panel builds without S2. */
export type RowStatus =
  | { kind: "loading"; note?: string }
  | { kind: "ready"; note?: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export type LayerGroup = "Model" | "Imagery" | "Point clouds" | "Environment" | "Data";
export const GROUP_ORDER: readonly LayerGroup[] = ["Model", "Imagery", "Point clouds", "Environment", "Data"];

/** One row of the Layers list: S1's placeholder reads `available`/`toggleable`/`detail`, the panel the rest. */
export interface LayerRow {
  id: string;
  label: string;
  group: LayerGroup;
  visible: boolean;
  /** 0..1, or null when the layer has no opacity control. */
  opacity: number | null;
  status: RowStatus;
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
  return baseRows(scene, model, items).map((r) => ({
    ...r,
    group: GROUP_OF[r.id],
    visible: true,
    opacity: null,
    status: { kind: "ready" as const },
  }));
}

type BaseRow = Pick<LayerRow, "label" | "available" | "toggleable" | "detail"> & { id: LayerRowId };
const GROUP_OF: Record<LayerRowId, LayerGroup> = {
  model: "Model",
  ortho: "Imagery",
  drawing: "Imagery",
  cloud: "Point clouds",
  photos: "Data",
  findings: "Data",
};

function baseRows(scene: SiteScene, model: ModelState, items: number): BaseRow[] {
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

/** What the screen knows about S1's layers beyond the layer objects. */
export interface LayerUi {
  visible: Record<string, boolean>;
  opacity: Record<string, number>;
  /** The Plant model row's state and item count (S1's copy: Loading, Could not load, N items, Not shown). */
  model?: { state: ModelState; items: number };
  /** Layer ids whose source was removed (a 410 from the tile server). */
  gone?: ReadonlySet<string>;
}

const isModel = (id: string) => id === "model" || id.startsWith("model:");

function modelStatus(m: { state: ModelState; items: number }): RowStatus {
  switch (m.state) {
    case "loading":
      return { kind: "loading", note: MODEL_DETAIL.loading };
    case "error":
      return { kind: "error", message: MODEL_DETAIL.error };
    case "off":
      return { kind: "unavailable", reason: MODEL_DETAIL.off };
    case "none":
      return { kind: "unavailable", reason: MODEL_DETAIL.none };
    case "ready":
      return { kind: "ready", note: count(m.items, "item", "items") };
  }
}

function goneReason(id: string): string {
  return id.startsWith("drawing:") ? "This drawing was removed." : "This map was removed.";
}

/** The panel's rows for S1's layers; S2's come from `extraRows`. */
export function s1Rows(layers: readonly SiteLayer[], ui: LayerUi): LayerRow[] {
  return layers.map((l) => {
    const model = isModel(l.id);
    const status: RowStatus = ui.gone?.has(l.id)
      ? { kind: "unavailable", reason: goneReason(l.id) }
      : model && ui.model
        ? modelStatus(ui.model)
        : { kind: "ready" };
    const visible = ui.visible[l.id] ?? true;
    return {
      id: l.id,
      label: l.label,
      group: model ? "Model" : "Imagery",
      visible,
      opacity: l.setOpacity ? (ui.opacity[l.id] ?? 1) : null,
      status,
      available: status.kind !== "unavailable",
      toggleable: status.kind !== "unavailable",
      detail: "",
    };
  });
}

/** The minimal shape of S2's `ExtraLayerRow` the panel reads (S2's type satisfies it structurally). */
export interface ExtraRowLike {
  id: string;
  label: string;
  group: "Point clouds" | "Environment" | "Data";
  visible: boolean;
  layer: { status: { get(): RowStatus } };
}

export function extraRows(rows: readonly ExtraRowLike[]): LayerRow[] {
  return rows.map((r) => {
    const status = r.layer.status.get();
    return {
      id: r.id,
      label: r.label,
      group: r.group,
      visible: r.visible,
      opacity: null,
      status,
      available: status.kind !== "unavailable",
      toggleable: status.kind !== "unavailable",
      detail: "",
    };
  });
}

export function groupRows(rows: readonly LayerRow[]): [LayerGroup, LayerRow[]][] {
  return GROUP_ORDER.map((g) => [g, rows.filter((r) => r.group === g)] as [LayerGroup, LayerRow[]]).filter(
    ([, rs]) => rs.length > 0,
  );
}

export function statusLine(s: RowStatus): { text: string; tone: "muted" | "danger" } | null {
  switch (s.kind) {
    case "loading":
      return { text: s.note ?? "Loading…", tone: "muted" };
    case "ready":
      return s.note ? { text: s.note, tone: "muted" } : null;
    case "unavailable":
      return { text: s.reason, tone: "muted" };
    case "error":
      return { text: s.message, tone: "danger" };
  }
}
