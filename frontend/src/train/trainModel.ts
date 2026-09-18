import type { Dataset, Model, TrainRequest } from "@contract/client";

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
  /^epoch (\d+)\/(\d+)(?: mAP50 ([\d.]+))?(?: loss((?: [a-z_]+ [\d.]+)+))?(?: ETA (\d+)s)?$/;

export interface EpochProgress {
  epoch: number;
  epochs: number;
  map50: number | null;
  /** Loss terms by short name (`box`, `cls`, `dfl`), empty before the trainer reports any. */
  losses: Record<string, number>;
  etaSeconds: number | null;
}

/**
 * The trainer's `job.progress` message: `epoch 3/50 mAP50 0.612 loss box 1.234 cls 2.346 dfl 1.111 ETA 252s`
 * (mAP50 absent before the first validation; loss and ETA absent on older messages).
 */
export function parseEpochMessage(message: string): EpochProgress | null {
  const m = EPOCH_MESSAGE.exec(message.trim());
  if (!m) return null;
  const losses: Record<string, number> = {};
  if (m[4]) {
    const parts = m[4].trim().split(" ");
    for (let i = 0; i + 1 < parts.length; i += 2) losses[parts[i]] = Number(parts[i + 1]);
  }
  return {
    epoch: Number(m[1]),
    epochs: Number(m[2]),
    map50: m[3] === undefined ? null : Number(m[3]),
    losses,
    etaSeconds: m[5] === undefined ? null : Number(m[5]),
  };
}

export function suggestName(dataset: Dataset | undefined, base: Model | undefined): string {
  if (!dataset || !base) return "";
  return `${dataset.name}-${base.name}`;
}
