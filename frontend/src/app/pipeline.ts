import type { ProjectProgress } from "./nextStep";

export type StepId = "images" | "label" | "datasets" | "train" | "detect" | "review";
export type StepState = "done" | "current" | "upcoming" | "locked";

export interface Step {
  id: StepId;
  label: string;
  /** Route inside the project. */
  path: string;
  state: StepState;
  /** Shown on the right of the sidebar entry; null for nothing. */
  count: string | null;
  /** Why the entry cannot be used yet; only for `locked`. */
  lockedReason: string | null;
}

export const STEP_ORDER: readonly StepId[] = ["images", "label", "datasets", "train", "detect", "review"];

const LABEL: Record<StepId, string> = {
  images: "Images",
  label: "Label",
  datasets: "Datasets",
  train: "Train",
  detect: "Detect",
  review: "Review",
};

const PATH: Record<StepId, string> = {
  images: "data",
  label: "label",
  datasets: "datasets",
  train: "train",
  detect: "query",
  review: "review",
};

/**
 * The six pipeline steps of a project with their state, from the same numbers `nextStep` uses.
 * Done and locked come from the counts; the current step is the first one that is neither,
 * except that Review is current whenever suggestions are waiting.
 */
export function stepStates(projectId: string, p: ProjectProgress): Step[] {
  const done: Record<StepId, boolean> = {
    images: p.images > 0,
    label: p.labeled > 0,
    datasets: p.datasets > 0,
    train: p.trainedModels > 0,
    detect: p.queryRuns > 0,
    review: p.queryRuns > 0 && p.pendingReview === 0,
  };
  const locked: Record<StepId, string | null> = {
    images: null,
    label: p.images === 0 ? "Import images first" : null,
    datasets: p.images === 0 ? "Import images first" : null,
    train: p.datasets === 0 ? "Create a dataset first" : null,
    detect: p.models === 0 ? "Train a model or add a starter model first" : null,
    review: p.queryRuns === 0 && p.pendingReview === 0 ? "Run a detection first" : null,
  };
  const count: Record<StepId, string | null> = {
    images: String(p.images),
    label: `${p.labeled} / ${p.images}`,
    datasets: String(p.datasets),
    train: String(p.trainedModels),
    detect: null,
    review: p.pendingReview > 0 ? String(p.pendingReview) : null,
  };

  let current: StepId | null = p.pendingReview > 0 ? "review" : null;
  if (!current) {
    for (const id of STEP_ORDER) {
      if (!done[id] && !locked[id]) {
        current = id;
        break;
      }
    }
  }

  return STEP_ORDER.map((id) => {
    const state: StepState =
      id === current ? "current" : done[id] ? "done" : locked[id] ? "locked" : "upcoming";
    return {
      id,
      label: LABEL[id],
      path: `/p/${projectId}/${PATH[id]}`,
      state,
      count: count[id],
      lockedReason: state === "locked" ? locked[id] : null,
    };
  });
}
