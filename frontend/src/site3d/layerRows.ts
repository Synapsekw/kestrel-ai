import type { SiteLayer } from "@/site3d/layers/types";

/** `off`: the project has a model but the 3D view could not start, so it is not shown. */
export type ModelState = "none" | "loading" | "ready" | "error" | "off";
/** Structurally S2's LayerStatus (`layers/status.ts`); declared here so the panel builds without S2. */
export type RowStatus =
  | { kind: "loading"; note?: string }
  | { kind: "ready"; note?: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "error"; message: string };

export type LayerGroup = "Model" | "Imagery" | "Point clouds" | "Environment" | "Data";
export const GROUP_ORDER: readonly LayerGroup[] = ["Model", "Imagery", "Point clouds", "Environment", "Data"];

/** One row of the Layers panel. */
export interface LayerRow {
  id: string;
  label: string;
  group: LayerGroup;
  visible: boolean;
  /** 0..1, or null when the layer has no opacity control. */
  opacity: number | null;
  status: RowStatus;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const MODEL_DETAIL: Record<Exclude<ModelState, "ready">, string> = {
  none: "None yet",
  loading: "Loading",
  error: "Could not load",
  off: "Not shown",
};

/** What the screen knows about S1's layers beyond the layer objects. */
export interface LayerUi {
  visible: Record<string, boolean>;
  opacity: Record<string, number>;
  /** The Plant model row's state and item count (S1's copy: Loading, Could not load, N items, Not shown). */
  model?: ModelRowState;
  /** Layer ids whose source was removed (a 410 from the tile server). */
  gone?: ReadonlySet<string>;
}

/**
 * `state` is the asked-for version's (`version`); `shown` is the version on screen. After a failed
 * swap the old version stays on screen, so the row says it is stale rather than "Could not load".
 */
export interface ModelRowState {
  state: ModelState;
  items: number;
  version?: number | null;
  shown?: number | null;
}

const isModel = (id: string) => id === "model" || id.startsWith("model:");
const swapping = (m: ModelRowState) => m.shown != null && m.version != null && m.shown !== m.version;

function modelStatus(m: ModelRowState): RowStatus {
  switch (m.state) {
    case "loading":
      return { kind: "loading", note: swapping(m) ? `Loading version ${m.version}` : MODEL_DETAIL.loading };
    case "error":
      return swapping(m)
        ? {
            kind: "error",
            message: `Stale: showing version ${m.shown}. Version ${m.version} could not load.`,
          }
        : { kind: "error", message: MODEL_DETAIL.error };
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

/**
 * The panel's rows for S1's layers; S2's come from `extraRows`. Without a model layer (no model yet,
 * or no running view) the Plant model row still shows, switched off, saying why.
 */
export function s1Rows(layers: readonly SiteLayer[], ui: LayerUi): LayerRow[] {
  const noLayer: LayerRow[] =
    ui.model && !layers.some((l) => isModel(l.id))
      ? [
          {
            id: "model",
            label: "Plant model",
            group: "Model",
            visible: false,
            opacity: null,
            status: modelStatus(ui.model),
          },
        ]
      : [];
  return [
    ...noLayer,
    ...layers.map((l): LayerRow => {
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
      };
    }),
  ];
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
