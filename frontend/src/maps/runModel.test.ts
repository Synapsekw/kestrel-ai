import { describe, expect, it } from "vitest";
import { exampleModel, exampleMapRun } from "@/test/fixtures";
import {
  countsFromDensity,
  defaultTargetGsd,
  lastRunTargetGsd,
  runTitle,
  toggleCompare,
  validateRunForm,
} from "./runModel";

const model = (over: Partial<typeof exampleModel> = {}): typeof exampleModel => ({
  ...exampleModel,
  id: "m1",
  ...over,
});

describe("defaultTargetGsd", () => {
  it("is the model's own training scale", () => {
    expect(defaultTargetGsd(model({ train_gsd_cm: 18.92 }))).toBe(18.92);
  });

  it("is null when the model has no training scale", () => {
    expect(defaultTargetGsd(model({ train_gsd_cm: null }))).toBeNull();
    expect(defaultTargetGsd(null)).toBeNull();
  });
});

describe("lastRunTargetGsd", () => {
  it("is the most recent run of that model", () => {
    const older = {
      ...exampleMapRun,
      id: "old",
      model_id: "m1",
      target_gsd_cm: 1.5,
      created_at: "2026-09-20T00:00:00Z",
    };
    const newer = {
      ...exampleMapRun,
      id: "new",
      model_id: "m1",
      target_gsd_cm: 7,
      created_at: "2026-09-22T00:00:00Z",
    };
    expect(lastRunTargetGsd([older, newer], "m1")).toBe(7);
  });

  it("ignores runs belonging to another model", () => {
    const runs = [{ ...exampleMapRun, model_id: "other", target_gsd_cm: 7 }];
    expect(lastRunTargetGsd(runs, "m1")).toBeNull();
  });

  it("is null with no runs", () => {
    expect(lastRunTargetGsd([], "m1")).toBeNull();
  });
});

describe("the reported failure", () => {
  it("a null training scale does NOT resurrect a past run at the map's native scale", () => {
    // ICVD_V4 had a run recorded at the map's 2.296 cm/px, which found 1.5 m boxes on a site of
    // 9 m machines. The primary default must not hand that number back.
    const runs = [{ ...exampleMapRun, model_id: "m1", target_gsd_cm: 2.296 }];
    expect(defaultTargetGsd(model({ train_gsd_cm: null }))).toBeNull();
    // It remains reachable only as the last resort, which the dialog uses after a derive fails.
    expect(lastRunTargetGsd(runs, "m1")).toBe(2.296);
  });
});

describe("run model", () => {
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
