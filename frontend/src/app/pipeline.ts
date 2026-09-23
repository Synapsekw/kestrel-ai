import type { ProjectProgress } from "./nextStep";
import type { ProjectKind } from "./useProjectKind";

export type StepId = "images" | "label" | "datasets" | "train" | "detect" | "maps" | "review" | "export";
export type StepState = "done" | "current" | "upcoming" | "locked";

export interface Step {
  id: StepId;
  label: string;
  /** Route of the entry: the step's screen, or where to go to unlock it. */
  path: string;
  state: StepState;
  /** Shown on the right of the sidebar entry; null for nothing. */
  count: string | null;
  /** Why the entry cannot be used yet; only for `locked`. */
  lockedReason: string | null;
  /** A locked entry that still follows its `path`: it leads to where the step is unlocked. */
  opensWhenLocked: boolean;
}

/** The steps of a training project, in order. */
export const TRAIN_STEPS: StepId[] = ["images", "label", "datasets", "train", "review", "export"];
/** The steps of a detection project, in order. */
export const DETECT_STEPS: StepId[] = ["images", "detect", "maps", "review", "export"];

const LABEL: Record<StepId, string> = {
  images: "Images",
  label: "Label",
  datasets: "Datasets",
  train: "Train",
  detect: "Detect",
  maps: "Maps",
  review: "Review",
  export: "Export",
};

const PATH: Record<StepId, string> = {
  images: "data",
  label: "label",
  datasets: "datasets",
  train: "train",
  detect: "query",
  maps: "maps",
  review: "review",
  export: "export",
};

interface Rules {
  done: Partial<Record<StepId, boolean>>;
  locked: Partial<Record<StepId, string | null>>;
  count: Partial<Record<StepId, string | null>>;
}

function trainRules(p: ProjectProgress): Rules {
  return {
    done: {
      images: p.images > 0,
      label: p.labeled > 0,
      datasets: p.datasets > 0,
      train: p.trainedModels > 0,
      review: p.queryRuns > 0 && p.pendingReview === 0,
    },
    locked: {
      label: p.images === 0 ? "Import images first" : null,
      datasets: p.images === 0 ? "Import images first" : null,
      train: p.datasets === 0 ? "Create a dataset first" : null,
      review: p.queryRuns === 0 && p.pendingReview === 0 ? "No suggestions to review yet" : null,
      export: p.labeled === 0 ? "Label some images first" : null,
    },
    count: {
      images: String(p.images),
      label: `${p.labeled} / ${p.images}`,
      datasets: String(p.datasets),
      train: String(p.trainedModels),
      review: p.pendingReview > 0 ? String(p.pendingReview) : null,
    },
  };
}

function detectRules(p: ProjectProgress): Rules {
  return {
    done: {
      images: p.images > 0,
      detect: p.queryRuns > 0,
      maps: p.maps > 0,
      review: p.queryRuns > 0 && p.pendingReview === 0,
    },
    locked: {
      detect: p.models === 0 ? "Add a model to the library first" : null,
      review: p.queryRuns === 0 && p.pendingReview === 0 ? "Run a detection first" : null,
      export: p.queryRuns === 0 && p.maps === 0 ? "Run a detection first" : null,
    },
    count: {
      images: String(p.images),
      maps: String(p.maps),
      review: p.pendingReview > 0 ? String(p.pendingReview) : null,
    },
  };
}

/**
 * The pipeline steps of a project of `kind` with their state, from the same numbers `nextStep`
 * uses. Done and locked come from the counts; the current step is the first one that is neither,
 * except that Review is current whenever suggestions are waiting. Exporting is never "done":
 * results can be taken out again whenever they change.
 */
export function stepStates(projectId: string, kind: ProjectKind, p: ProjectProgress): Step[] {
  const order = kind === "detect" ? DETECT_STEPS : TRAIN_STEPS;
  const { done, locked, count } = kind === "detect" ? detectRules(p) : trainRules(p);

  let current: StepId | null = p.pendingReview > 0 ? "review" : null;
  if (!current) current = order.find((id) => !done[id] && !locked[id]) ?? null;

  return order.map((id) => {
    const reason = locked[id] ?? null;
    const state: StepState = id === current ? "current" : done[id] ? "done" : reason ? "locked" : "upcoming";
    // Detection without a model: the entry leads to the library, where a model is added.
    const toLibrary = state === "locked" && id === "detect";
    return {
      id,
      label: LABEL[id],
      path: toLibrary ? "/library" : `/p/${projectId}/${PATH[id]}`,
      state,
      count: count[id] ?? null,
      lockedReason: state === "locked" ? reason : null,
      opensWhenLocked: toLibrary,
    };
  });
}
