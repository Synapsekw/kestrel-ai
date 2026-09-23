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
  it("lists the detection steps only: no Label, Datasets or Train", () => {
    expect(DETECT_STEPS).toEqual(["images", "detect", "maps", "review", "export"]);
    const steps = stepStates("p1", "detect", { ...empty, models: 1 });
    expect(steps.map((s) => s.id)).toEqual(DETECT_STEPS);
    expect(steps.map((s) => s.path)).toEqual([
      "/p/p1/data",
      "/p/p1/query",
      "/p/p1/maps",
      "/p/p1/review",
      "/p/p1/export",
    ]);
  });

  it("with no model in the library, Detect is locked and points at the library", () => {
    const detect = stepStates("p1", "detect", { ...empty, images: 5 }).find((s) => s.id === "detect");
    expect(detect).toMatchObject({
      state: "locked",
      lockedReason: "Add a model to the library first",
      path: "/library",
    });
  });

  it("Maps is never locked, and an empty project starts at Images", () => {
    expect(detectStates({})).toEqual({
      images: "current",
      detect: "locked",
      maps: "upcoming",
      review: "locked",
      export: "locked",
    });
  });

  it("a model and images but no run: Detect is current; a map counts on the Maps step", () => {
    expect(detectStates({ images: 5, models: 1 })).toMatchObject({ images: "done", detect: "current" });
    const maps = stepStates("p1", "detect", { ...empty, maps: 2 }).find((s) => s.id === "maps");
    expect(maps).toMatchObject({ state: "done", count: "2" });
  });

  it("runs finished and nothing waiting: Export is current", () => {
    expect(detectStates({ images: 5, models: 1, queryRuns: 1, maps: 1 })).toEqual({
      images: "done",
      detect: "done",
      maps: "done",
      review: "done",
      export: "current",
    });
  });

  it("suggestions waiting make Review current", () => {
    expect(detectStates({ images: 5, models: 1, queryRuns: 1, pendingReview: 3 })).toMatchObject({
      review: "current",
    });
  });
});
