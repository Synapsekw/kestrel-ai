import { describe, expect, it } from "vitest";
import type { ProjectProgress } from "./nextStep";
import { DETECT_STEPS, TRAIN_STEPS, stepStates } from "./pipeline";

const empty: ProjectProgress = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
  maps: 0,
};

const states = (p: Partial<ProjectProgress>) =>
  Object.fromEntries(stepStates("p1", "train", { ...empty, ...p }).map((s) => [s.id, s.state]));

const detectStates = (p: Partial<ProjectProgress>) =>
  Object.fromEntries(stepStates("p1", "detect", { ...empty, ...p }).map((s) => [s.id, s.state]));

describe("stepStates, training project", () => {
  it("lists the training steps only: no Detect, no Maps", () => {
    expect(TRAIN_STEPS).toEqual(["images", "label", "datasets", "train", "review", "export"]);
    expect(stepStates("p1", "train", empty).map((s) => s.id)).toEqual(TRAIN_STEPS);
  });

  it("an empty project: Images is current and everything after it is locked", () => {
    const steps = stepStates("p1", "train", empty);
    expect(states({})).toEqual({
      images: "current",
      label: "locked",
      datasets: "locked",
      train: "locked",
      review: "locked",
      export: "locked",
    });
    expect(steps[1].lockedReason).toBe("Import images first");
    expect(steps[0].path).toBe("/p/p1/data");
    expect(steps[1].path).toBe("/p/p1/label");
  });

  it("images imported, nothing labeled: Label is current, Datasets is open, Train is locked", () => {
    expect(states({ images: 40 })).toMatchObject({
      images: "done",
      label: "current",
      datasets: "upcoming",
      train: "locked",
    });
    const steps = stepStates("p1", "train", { ...empty, images: 40 });
    expect(steps[1].count).toBe("0 / 40");
    expect(steps[3].lockedReason).toBe("Create a dataset first");
  });

  it("a trained model and nothing waiting: Export is current", () => {
    expect(states({ images: 40, labeled: 14, datasets: 1, models: 2, trainedModels: 1 })).toEqual({
      images: "done",
      label: "done",
      datasets: "done",
      train: "done",
      review: "locked",
      export: "current",
    });
  });

  it("suggestions waiting make Review current whatever else is pending", () => {
    const steps = stepStates("p1", "train", { ...empty, images: 40, labeled: 3, pendingReview: 12 });
    expect(steps.find((s) => s.id === "review")).toMatchObject({ state: "current", count: "12" });
    expect(steps.find((s) => s.id === "label")?.state).toBe("done");
  });
});

describe("stepStates, detection project", () => {
  it("lists Sources, Runs, Review, Analytics and Export, at their own routes", () => {
    expect(DETECT_STEPS).toEqual(["sources", "runs", "review", "analytics", "export"]);
    const steps = stepStates("p1", "detect", { ...empty, images: 5, hasRuns: true });
    expect(steps.map((s) => s.id)).toEqual(DETECT_STEPS);
    expect(steps.map((s) => s.label)).toEqual(["Sources", "Runs", "Review", "Analytics", "Export"]);
    expect(steps.map((s) => s.path)).toEqual([
      "/p/p1/sources",
      "/p/p1/runs",
      "/p/p1/review",
      "/p/p1/analytics",
      "/p/p1/export",
    ]);
  });

  it("an empty project starts at Sources; Runs waits for a source, Review and Analytics for a run", () => {
    expect(detectStates({})).toEqual({
      sources: "current",
      runs: "locked",
      review: "locked",
      analytics: "locked",
      export: "upcoming",
    });
    const steps = stepStates("p1", "detect", empty);
    expect(steps.find((s) => s.id === "runs")?.lockedReason).toBe("Add photos or a map first");
    expect(steps.find((s) => s.id === "review")?.lockedReason).toBe("Run a model first");
    expect(steps.find((s) => s.id === "analytics")?.lockedReason).toBe("Run a model first");
    expect(steps.every((s) => !s.opensWhenLocked)).toBe(true);
  });

  it("photos or a map alone make Sources done and Runs current", () => {
    expect(detectStates({ images: 5 })).toMatchObject({ sources: "done", runs: "current" });
    expect(detectStates({ maps: 1 })).toMatchObject({ sources: "done", runs: "current" });
  });

  it("a map run counts as a run; with no photo run to go by, Review stays current", () => {
    expect(detectStates({ maps: 1, hasRuns: true })).toMatchObject({
      runs: "done",
      review: "current",
      analytics: "upcoming",
    });
  });

  it("without the runs list, a photo run still unlocks Review and Analytics", () => {
    expect(detectStates({ images: 5, queryRuns: 1 })).toMatchObject({ runs: "done", analytics: "current" });
  });

  it("detections waiting make Review current and counted", () => {
    const steps = stepStates("p1", "detect", { ...empty, images: 5, queryRuns: 1, pendingReview: 3 });
    expect(steps.find((s) => s.id === "review")).toMatchObject({ state: "current", count: "3" });
  });
});
