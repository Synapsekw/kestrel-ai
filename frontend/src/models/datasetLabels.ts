import type { DatasetTask, LibraryDataset } from "@/api/libraryDatasets";
import type { SplitAdviceInput } from "@/datasets/splitAdvice";
import type { PillTone } from "@/ui";

export const DATASET_TASK_LABEL: Record<DatasetTask, string> = {
  detect: "Boxes",
  obb: "Rotated boxes",
  segment: "Polygons",
};

export const SPLIT_LABEL: Record<string, string> = {
  by_group: "By flight",
  by_tile: "By place",
  random: "Random",
};

export interface DatasetStateLabel {
  text: string;
  tone: PillTone;
  live: boolean;
}

/** One pill for the build state and, once ready, the export state (F §12.1). */
export function datasetStateLabel(d: Pick<LibraryDataset, "state" | "export_state">): DatasetStateLabel {
  if (d.state === "resolving") return { text: "Building", tone: "accent", live: true };
  if (d.state === "failed") return { text: "Failed", tone: "danger", live: false };
  switch (d.export_state) {
    case "building":
      return { text: "Exporting", tone: "accent", live: true };
    case "ready":
      return { text: "Exported", tone: "ok", live: false };
    case "stale":
      return { text: "Export out of date", tone: "warn", live: false };
    case "failed":
      return { text: "Export failed", tone: "danger", live: false };
    default:
      return { text: "Ready", tone: "neutral", live: false };
  }
}

export function sourcesText(d: Pick<LibraryDataset, "sources">): string {
  const names = d.sources.map((s) => s.project_name);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} + ${names.length - 3} more`;
}

const SPLITS: SplitAdviceInput["split_method"][] = ["by_group", "by_tile", "random"];

/** BM types `split_method` as a string and `split_params` as a number map; advice needs the known shape. */
export function toSplitAdviceInput(d: LibraryDataset): SplitAdviceInput {
  const method = SPLITS.find((m) => m === d.split_method) ?? "random";
  return {
    image_count: d.counts.images,
    train_count: d.counts.train,
    val_count: d.counts.val,
    split_method: method,
    split_params: { val_fraction: Number(d.split_params.val_fraction ?? 0.2) },
  };
}
