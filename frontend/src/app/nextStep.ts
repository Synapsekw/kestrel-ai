export interface ProjectProgress {
  images: number;
  labeled: number;
  /** Images with proposals nobody has reviewed yet. */
  pendingReview: number;
  datasets: number;
  models: number;
  trainedModels: number;
}

export interface NextStep {
  text: string;
  /** Where the step is done. */
  to: string;
}

/** Below this many labeled images a training is a smoke test; the hint keeps asking for more. */
const USEFUL_LABELED = 200;

/**
 * The one thing worth doing next in a project, in the order import, label, dataset, base model,
 * train, run, review. `null` when nothing is pending.
 */
export function nextStep(projectId: string, p: ProjectProgress): NextStep | null {
  const at = (screen: string) => `/p/${projectId}/${screen}`;
  if (p.pendingReview > 0)
    return {
      text: `Review the proposals on ${p.pendingReview} ${p.pendingReview === 1 ? "image" : "images"}.`,
      to: at("review"),
    };
  if (p.images === 0) return { text: "Import a folder of images.", to: at("data") };
  if (p.labeled === 0)
    return {
      text: `Label images: open one from the list (Enter or double-click) and draw boxes. 0 of ${p.images} are labeled.`,
      to: at("data"),
    };
  if (p.datasets === 0)
    return p.labeled < USEFUL_LABELED
      ? {
          text: `Keep labeling (${p.labeled} of ${p.images} labeled; a first useful model needs about ${USEFUL_LABELED}), or freeze a dataset and try a training.`,
          to: at("data"),
        }
      : { text: `Freeze the ${p.labeled} labeled images into a dataset.`, to: at("data") };
  if (p.models === 0)
    return { text: "Add a starter model: training needs one as its base.", to: at("models") };
  if (p.trainedModels === 0) return { text: "Train a model on the dataset.", to: at("train") };
  const unlabeled = p.images - p.labeled;
  if (unlabeled > 0)
    return {
      text: `Run the trained model over the ${unlabeled} unlabeled ${unlabeled === 1 ? "image" : "images"}.`,
      to: at("query"),
    };
  return null;
}
