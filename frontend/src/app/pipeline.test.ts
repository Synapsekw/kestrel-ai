import { describe, expect, it } from "vitest";
import type { ProjectProgress } from "./nextStep";
import { stepStates } from "./pipeline";

const empty: ProjectProgress = {
  images: 0,
  labeled: 0,
  pendingReview: 0,
  datasets: 0,
  models: 0,
  trainedModels: 0,
  queryRuns: 0,
};

const states = (p: Partial<ProjectProgress>) =>
  Object.fromEntries(stepStates("p1", { ...empty, ...p }).map((s) => [s.id, s.state]));

describe("stepStates", () => {
  it("an empty project: Images is current and everything after it is locked", () => {
    const steps = stepStates("p1", empty);
    expect(states({})).toEqual({
      images: "current",
      label: "locked",
      datasets: "locked",
      train: "locked",
      detect: "locked",
      review: "locked",
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
    const steps = stepStates("p1", { ...empty, images: 40 });
    expect(steps[1].count).toBe("0 / 40");
    expect(steps[3].lockedReason).toBe("Create a dataset first");
  });

  it("labeled, a dataset and a trained model but no run: Detect is current and Review is locked", () => {
    expect(states({ images: 40, labeled: 14, datasets: 1, models: 2, trainedModels: 1 })).toEqual({
      images: "done",
      label: "done",
      datasets: "done",
      train: "done",
      detect: "current",
      review: "locked",
    });
  });

  it("a starter model alone unlocks Detect but leaves Train current", () => {
    expect(states({ images: 40, labeled: 14, datasets: 1, models: 1 })).toMatchObject({
      train: "current",
      detect: "upcoming",
    });
  });

  it("suggestions waiting make Review current whatever else is pending", () => {
    const steps = stepStates("p1", { ...empty, images: 40, labeled: 3, pendingReview: 12 });
    expect(steps.find((s) => s.id === "review")).toMatchObject({ state: "current", count: "12" });
    expect(steps.find((s) => s.id === "label")?.state).toBe("done");
  });

  it("everything done: no current step", () => {
    const all = states({ images: 40, labeled: 40, datasets: 1, models: 1, trainedModels: 1, queryRuns: 1 });
    expect(Object.values(all).every((s) => s === "done")).toBe(true);
  });
});
