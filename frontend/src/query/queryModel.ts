import type { Provider, ProviderName, QueryRun, QueryRunCreate, Tiling } from "@contract/client";
import type { ListImagesQuery } from "@/api/images";
import { providerLabel } from "@/api/providers";
import { DEFAULT_CONF, DEFAULT_TILING } from "@/api/queryRuns";

export type QueryKind = QueryRunCreate["kind"];
export type ImageMode = "selection" | "unlabeled" | "group" | "first_n";

export interface QueryForm {
  kind: QueryKind;
  modelId: string;
  provider: ProviderName;
  query: string;
  mode: ImageMode;
  groupKey: string;
  firstN: string;
  tilingEnabled: boolean;
  tileSize: string;
  overlap: string;
  nmsIou: string;
  conf: string;
}

export const DEFAULT_QUERY_FORM: QueryForm = {
  kind: "local_model",
  modelId: "",
  provider: "anthropic",
  query: "",
  mode: "unlabeled",
  groupKey: "",
  firstN: "50",
  tilingEnabled: DEFAULT_TILING.enabled,
  tileSize: String(DEFAULT_TILING.tile_size),
  overlap: String(DEFAULT_TILING.overlap),
  nmsIou: String(DEFAULT_TILING.nms_iou),
  conf: String(DEFAULT_CONF),
};

const LIST_LIMIT = 1000;
const MAX_LIST_PAGES = 20;
export const REVIEW_LINK_MAX_IDS = 200;

function whole(text: string): number | null {
  return /^\d+$/.test(text.trim()) ? Number(text.trim()) : null;
}

function fraction(text: string, max: number): number | null {
  const n = Number(text.trim());
  return text.trim() !== "" && Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

export function validateQueryForm(f: QueryForm, imageCount: number, providers: Provider[]): string | null {
  if (f.kind === "local_model" && !f.modelId) return "Choose a model.";
  if (f.kind === "cloud_provider") {
    const p = providers.find((x) => x.name === f.provider);
    if (!p) return "Choose a provider.";
    if (!p.has_key) return `No API key stored for ${providerLabel(p.name)}. Add one in Settings.`;
    if (!f.query.trim()) return "Describe what to find, for example: dump trucks.";
  }
  if (f.mode === "group" && !f.groupKey.trim()) return "Enter a group key.";
  if (f.mode === "first_n") {
    const n = whole(f.firstN);
    if (n === null || n < 1) return "Number of images must be a whole number of at least 1.";
  }
  if (imageCount < 1) return "No images selected.";
  const tile = whole(f.tileSize);
  if (tile === null || tile < 256 || tile > 4096) return "Tile size must be a whole number from 256 to 4096.";
  if (fraction(f.overlap, 0.5) === null) return "Overlap must be between 0 and 0.5.";
  if (fraction(f.nmsIou, 1) === null) return "NMS IoU must be between 0 and 1.";
  if (fraction(f.conf, 1) === null) return "Confidence must be between 0 and 1.";
  return null;
}

export function toTiling(f: QueryForm): Tiling {
  return {
    enabled: f.tilingEnabled,
    tile_size: Number(f.tileSize),
    overlap: Number(f.overlap),
    nms_iou: Number(f.nmsIou),
  };
}

/** Only call after `validateQueryForm` returned null. */
export function toQueryRunCreate(f: QueryForm, imageIds: string[]): QueryRunCreate {
  const base = { image_ids: imageIds, tiling: toTiling(f), conf: Number(f.conf) };
  if (f.kind === "local_model") return { kind: "local_model", model_id: f.modelId, ...base };
  return { kind: "cloud_provider", provider: f.provider, query: f.query.trim(), ...base };
}

/** Identity of an estimate: the exact request it was computed for. */
export function formKey(f: QueryForm, imageIds: string[]): string {
  return JSON.stringify(toQueryRunCreate(f, imageIds));
}

/** How to list the images for a mode; null when the ids come from the Data Manager selection. */
export function imageQuery(f: QueryForm): { query: ListImagesQuery; maxPages: number } | null {
  const base: ListImagesQuery = { sort: "path", order: "asc", limit: LIST_LIMIT };
  switch (f.mode) {
    case "selection":
      return null;
    case "unlabeled":
      return { query: { labeled: false, ...base }, maxPages: MAX_LIST_PAGES };
    case "group":
      return { query: { group_key: f.groupKey.trim(), ...base }, maxPages: MAX_LIST_PAGES };
    case "first_n": {
      const n = Math.max(1, whole(f.firstN) ?? 1);
      return { query: { ...base, limit: Math.min(LIST_LIMIT, n) }, maxPages: Math.ceil(n / LIST_LIMIT) };
    }
  }
}

/** The review queue narrowed to the run's images (`ids` query parameter), capped to keep the URL short. */
export function reviewLink(projectId: string, run: QueryRun): { to: string; capped: boolean } {
  const ids = run.image_ids.slice(0, REVIEW_LINK_MAX_IDS);
  return { to: `/p/${projectId}/review?ids=${ids.join(",")}`, capped: run.image_ids.length > ids.length };
}

export function runTitle(run: QueryRun): string {
  if (run.kind === "local_model") return `Local model ${run.model_name ?? run.model_id ?? ""}`.trim();
  return `${providerLabel(run.provider)}: "${run.query}"`;
}
