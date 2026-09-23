export interface ProjectProgress {
  images: number;
  labeled: number;
  /** Suggestions (boxes, not images) nobody has reviewed yet: `Stats.pending_review_count`. */
  pendingReview: number;
  datasets: number;
  models: number;
  trainedModels: number;
  /** Detection runs of the project, any state. */
  queryRuns: number;
  /** GeoTIFF maps of the project, any state (a count only). */
  maps: number;
}

export interface NextStep {
  /** Short, verb first; doubles as the label of the action. */
  text: string;
  /** One sentence of why, or what happens. */
  detail: string;
  /** Where the step is done. */
  to: string;
}

/** Below this many labeled images a training is a smoke test; the hint keeps asking for more. */
export const USEFUL_LABELED = 200;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The one thing worth doing next in a project, in the order import, label, dataset, base model,
 * train, run, review. `null` when nothing is pending.
 */
export function nextStep(projectId: string, p: ProjectProgress): NextStep | null {
  const at = (screen: string) => `/p/${projectId}/${screen}`;
  if (p.pendingReview > 0)
    return {
      text: `Review ${plural(p.pendingReview, "suggestion", "suggestions")}`,
      detail: "Suggested boxes from detection runs and pre-annotation wait until you accept or reject them.",
      to: at("review"),
    };
  if (p.images === 0)
    return {
      text: "Import images",
      detail: "Import a folder of aerial frames. The originals are never modified.",
      to: at("data"),
    };
  if (p.labeled === 0)
    return {
      text: "Label your images",
      detail: `Open an image and draw boxes around the machinery. 0 of ${p.images} are labeled.`,
      to: at("label"),
    };
  if (p.datasets === 0)
    return p.labeled < USEFUL_LABELED
      ? {
          text: "Keep labeling",
          detail: `${p.labeled} of ${p.images} labeled. A first useful model needs about ${USEFUL_LABELED}; you can also create a dataset now and try a training.`,
          to: at("label"),
        }
      : {
          text: "Create a dataset",
          detail: `Freeze the ${p.labeled} labeled images into a dataset for training.`,
          to: at("datasets"),
        };
  if (p.models === 0)
    return {
      text: "Add a starter model",
      detail: "Training needs a base model. Starter models are bundled with the app.",
      to: at("models"),
    };
  if (p.trainedModels === 0)
    return {
      text: "Train a model",
      detail: "Train on the dataset. A few epochs are enough for a first look.",
      to: at("train"),
    };
  const unlabeled = p.images - p.labeled;
  if (unlabeled > 0)
    return {
      text: `Run detection on ${plural(unlabeled, "unlabeled image", "unlabeled images")}`,
      detail: "The trained model suggests boxes; you review them instead of drawing from scratch.",
      to: at("query"),
    };
  return {
    text: "Export the results",
    detail: "Take the counts, the labels and the model out of the app as tables, label files or a report.",
    to: at("export"),
  };
}
