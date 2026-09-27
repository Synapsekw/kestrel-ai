import type { LibraryModel, TrainRequest } from "@contract/client";
import type { DatasetTask, LibraryDataset } from "@/api/libraryDatasets";

/** What the training form needs of a dataset: a ready library dataset through `toTrainable`. */
export interface TrainableDataset {
  id: string;
  name: string;
  image_count: number;
  train_count: number;
  val_count: number;
  class_count: number;
  split_method: string;
  /** R-BT13: only base models of the same task train on this dataset. */
  task: DatasetTask;
  /**
   * Another job is preparing this dataset: its export is building, or an active run will export it
   * because it has not been exported yet. A run started now fails at once (the backend refuses a
   * second export of the same dataset), so Start stays disabled until that job finishes.
   */
  exportBusy: boolean;
}

/**
 * The form's view of a library dataset. `activeRunDatasetIds` names the datasets with a queued or
 * running training run: such a run exports its dataset first unless the export is already ready.
 */
export function toTrainable(d: LibraryDataset, activeRunDatasetIds?: ReadonlySet<string>): TrainableDataset {
  return {
    id: d.id,
    name: d.name,
    image_count: d.counts.images,
    train_count: d.counts.train,
    val_count: d.counts.val,
    class_count: d.classes.length,
    split_method: d.split_method,
    task: d.task,
    exportBusy:
      d.export_state === "building" ||
      (Boolean(activeRunDatasetIds?.has(d.id)) && d.export_state !== "ready"),
  };
}

export interface TrainForm {
  name: string;
  datasetId: string;
  baseModelId: string;
  epochs: string;
  imgsz: string;
  batchAuto: boolean;
  batch: string;
  patience: string;
  augmentation: "default" | "aerial";
  device: string;
}

/** Contract defaults for `TrainRequest` (spec section 7: image size 1280, batch auto). */
export const DEFAULT_TRAIN_FORM: TrainForm = {
  name: "",
  datasetId: "",
  baseModelId: "",
  epochs: "50",
  imgsz: "1280",
  batchAuto: true,
  batch: "16",
  patience: "50",
  augmentation: "default",
  device: "0",
};

function whole(text: string): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  return Number(text.trim());
}

export function validateTrainForm(f: TrainForm): string | null {
  if (!f.datasetId) return "Choose a dataset.";
  if (!f.baseModelId) return "Choose a base model.";
  if (!f.name.trim()) return "Give the model a name.";
  const epochs = whole(f.epochs);
  if (epochs === null || epochs < 1 || epochs > 1000) return "Epochs must be a whole number from 1 to 1000.";
  const imgsz = whole(f.imgsz);
  if (imgsz === null || imgsz < 320 || imgsz > 4096)
    return "Image size must be a whole number from 320 to 4096.";
  if (!f.batchAuto) {
    const batch = whole(f.batch);
    if (batch === null || batch < 1) return "Batch size must be a whole number of at least 1, or automatic.";
  }
  const patience = whole(f.patience);
  if (patience === null) return "Patience must be a whole number of at least 0.";
  return null;
}

/** Only call after `validateTrainForm` returned null. Every defaulted field is sent (generated client). */
export function toTrainRequest(f: TrainForm): TrainRequest {
  return {
    name: f.name.trim(),
    dataset_id: f.datasetId,
    base_model_id: f.baseModelId,
    epochs: Number(f.epochs),
    imgsz: Number(f.imgsz),
    batch: f.batchAuto ? null : Number(f.batch),
    patience: Number(f.patience),
    augmentation: f.augmentation,
    device: f.device,
  };
}

const EPOCH_MESSAGE =
  /^epoch (\d+)\/(\d+)(?: mAP50 ([\d.]+))?(?: mask mAP50 ([\d.]+))?(?: loss((?: [a-z_]+ [\d.]+)+))?(?: ETA (\d+)s)?$/;

export interface EpochProgress {
  epoch: number;
  epochs: number;
  map50: number | null;
  /** Mask mAP50 of a segmentation run; null for boxes. */
  maskMap50: number | null;
  /** Loss terms by short name (`box`, `cls`, `dfl`), empty before the trainer reports any. */
  losses: Record<string, number>;
  etaSeconds: number | null;
}

/**
 * The trainer's `job.progress` message: `epoch 3/50 mAP50 0.612 mask mAP50 0.412 loss box 1.234 cls
 * 2.346 dfl 1.111 ETA 252s` (mAP50 absent before the first validation; mask mAP50 present only for a
 * segmentation run; loss and ETA absent on older messages).
 */
export function parseEpochMessage(message: string): EpochProgress | null {
  const m = EPOCH_MESSAGE.exec(message.trim());
  if (!m) return null;
  const losses: Record<string, number> = {};
  if (m[5]) {
    const parts = m[5].trim().split(" ");
    for (let i = 0; i + 1 < parts.length; i += 2) losses[parts[i]] = Number(parts[i + 1]);
  }
  return {
    epoch: Number(m[1]),
    epochs: Number(m[2]),
    map50: m[3] === undefined ? null : Number(m[3]),
    maskMap50: m[4] === undefined ? null : Number(m[4]),
    losses,
    etaSeconds: m[6] === undefined ? null : Number(m[6]),
  };
}

export function suggestName(dataset: TrainableDataset | undefined, base: LibraryModel | undefined): string {
  if (!dataset || !base) return "";
  return `${dataset.name}-${base.name}`;
}

/** Warnings shown above Start training: setups that run fine and produce a model nobody can use. */
export function trainAdvice(dataset: TrainableDataset | undefined, f: TrainForm): string[] {
  if (!dataset) return [];
  const advice: string[] = [];
  if (dataset.train_count < 50)
    advice.push(
      `Only ${dataset.train_count} training images: the model will learn very little. Aim for 200 or more labeled images.`,
    );
  if (dataset.val_count < 5)
    advice.push(
      `Only ${dataset.val_count} validation images: mAP will jump around and say little about the model.`,
    );
  const epochs = Number(f.epochs);
  if (Number.isInteger(epochs) && epochs > 0 && epochs < 10)
    advice.push(`${epochs} epochs is a smoke test, not a training. 50 to 100 is usual.`);
  return advice;
}

/** Below this mAP50 a finished model is called out as unlikely to be useful. */
const WEAK_MAP50 = 0.05;

export function resultAdvice(map50: number | null | undefined): string | null {
  if (typeof map50 !== "number" || map50 >= WEAK_MAP50) return null;
  return `mAP50 is ${(map50 * 100).toFixed(1)}%: this model will find little or nothing. Label more images, train for more epochs, then compare again.`;
}
