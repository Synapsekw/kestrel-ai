import { describe, expect, it } from "vitest";
import { exampleMapRun } from "@/test/fixtures";
import { countsFromDensity, defaultTargetGsd, runTitle, toggleCompare, validateRunForm } from "./runModel";

describe("run model", () => {
  it("prefills the training GSD from the model's last run, else the map's own", () => {
    const older = { ...exampleMapRun, id: "old", target_gsd_cm: 1.5, created_at: "2026-09-20T00:00:00Z" };
    expect(defaultTargetGsd([exampleMapRun, older], exampleMapRun.model_id, 3)).toBe(2);
    expect(defaultTargetGsd([exampleMapRun], "other-model", 3)).toBe(3);
    expect(defaultTargetGsd([], null, null)).toBeNull();
  });

  it("sums density cells per class", () => {
    const d = {
      cell_size: 10,
      cells: [
        { gx: 0, gy: 0, class_id: "a", count: 2 },
        { gx: 1, gy: 0, class_id: "a", count: 3 },
        { gx: 0, gy: 1, class_id: "b", count: 1 },
      ],
    };
    expect(countsFromDensity(d)).toEqual({ a: 5, b: 1 });
  });

  it("compares at most two runs, newest pick replacing the oldest", () => {
    expect(toggleCompare([], "a")).toEqual(["a"]);
    expect(toggleCompare(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleCompare(["a", "b"], "c")).toEqual(["b", "c"]);
    expect(toggleCompare(["a", "b"], "a")).toEqual(["b"]);
  });

  it("names a run by its model and date", () => {
    // local time: the day and hour depend on the runner's zone, the shape does not
    expect(runTitle(exampleMapRun)).toMatch(/^machinery-v3 · \d{1,2} Sep \d{2}:\d{2}$/);
  });

  it("needs a model, or a provider with a key and a query", () => {
    const providers = [
      {
        name: "anthropic" as const,
        has_key: false,
        model_name: "m",
        requests_per_minute: 1,
        cost_per_request: 0,
      },
    ];
    expect(validateRunForm({ kind: "local_model", modelId: "" }, providers)).toBe("Choose a model.");
    expect(
      validateRunForm({ kind: "cloud_provider", provider: "anthropic", query: "trucks" }, providers),
    ).toBe("Add an API key for this provider in App settings first.");
    expect(
      validateRunForm({ kind: "cloud_provider", provider: "anthropic", query: " " }, [
        { ...providers[0], has_key: true },
      ]),
    ).toBe('Describe what to find, e.g. "excavators".');
    expect(validateRunForm({ kind: "local_model", modelId: "m1" }, providers)).toBeNull();
  });
});
