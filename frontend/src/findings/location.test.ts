import { describe, expect, it } from "vitest";
import type { Finding } from "@/api/findings";
import { exampleFinding } from "@/test/findingFixtures";
import { findingLocation } from "./location";

const assetFinding: Finding = {
  ...exampleFinding,
  anchor: { kind: "asset", asset_model_id: "m1", asset_version: 2, point: null, normal: null },
  data_type: "asset_model",
  data_id: "m1",
  asset_model_id: "m1",
  representative: null,
  sighting_count: 0,
};

describe("findingLocation", () => {
  it("names an asset finding by its asset model", () => {
    expect(findingLocation(assetFinding, new Map([["m1", "Flare stack"]]))).toEqual({
      icon: "cube",
      primary: "Flare stack",
      secondary: null,
    });
  });

  it("falls back to the kind's label when the model is not in the data list", () => {
    expect(findingLocation(assetFinding, new Map()).primary).toBe("Asset model");
  });
});
