import type { ProjectProgress } from "./nextStep";
import type { ProjectKind } from "./useProjectKind";

export type StepId =
  "images" | "label" | "datasets" | "train" | "sources" | "runs" | "review" | "analytics" | "export";
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
export const DETECT_STEPS: StepId[] = ["sources", "runs", "review", "analytics", "export"];

const LABEL: Record<StepId, string> = {
  images: "Images",
  label: "Label",
  datasets: "Datasets",
  train: "Train",
  sources: "Sources",
  runs: "Runs",
  review: "Review",
  analytics: "Analytics",
  export: "Export",
};

const PATH: Record<StepId, string> = {
  images: "data",
  label: "label",
  datasets: "datasets",
  train: "train",
  sources: "sources",
  runs: "runs",
  review: "review",
  analytics: "analytics",
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
  const hasSources = p.images > 0 || p.maps > 0;
  const hasRuns = p.hasRuns ?? p.queryRuns > 0;
  const noRun = hasRuns ? null : "Run a model first";
  return {
    done: {
      sources: hasSources,
      runs: hasRuns,
      // Only photo runs report what waits for review; a map-only project keeps Review current.
      review: p.queryRuns > 0 && p.pendingReview === 0,
    },
    locked: {
      runs: hasSources ? null : "Add photos or a map first",
      review: p.pendingReview > 0 ? null : noRun,
      analytics: noRun,
    },
    count: {
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
    return {
      id,
      label: LABEL[id],
      path: `/p/${projectId}/${PATH[id]}`,
      state,
      count: count[id] ?? null,
      lockedReason: state === "locked" ? reason : null,
      opensWhenLocked: false,
    };
  });
}
