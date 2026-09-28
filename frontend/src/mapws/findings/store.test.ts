import { beforeEach, describe, expect, it } from "vitest";
import type { MapFindingPin } from "@/api/mapFindings";
import { useMapFindingsStore } from "./store";

const pin = (id: string): MapFindingPin =>
  ({
    id,
    number: 1,
    type_id: "t",
    severity: null,
    status: "open",
    created_by: "human",
    map_id: "m",
    geometry_site: { type: "Point", coordinates: [0, 0] },
  }) as MapFindingPin;

describe("useMapFindingsStore", () => {
  beforeEach(() => {
    useMapFindingsStore.getState().clearSide("single");
    useMapFindingsStore.getState().clearSide("left");
    useMapFindingsStore.getState().clearSide("right");
  });

  it("byId holds the pins of every pane", () => {
    useMapFindingsStore.getState().setSide("left", [pin("a")], false);
    useMapFindingsStore.getState().setSide("right", [pin("b")], false);
    expect(Object.keys(useMapFindingsStore.getState().byId).sort()).toEqual(["a", "b"]);
  });

  it("keeps truncated per pane: one pane's answer never clears the other's flag (preflight C)", () => {
    useMapFindingsStore.getState().setSide("left", [pin("a")], true);
    useMapFindingsStore.getState().setSide("right", [pin("b")], false);
    expect(useMapFindingsStore.getState().truncatedBySide).toEqual({ left: true, right: false });
    expect(useMapFindingsStore.getState().truncated).toBe(true);
  });

  it("clearSide drops an unmounted pane's pins and flag", () => {
    useMapFindingsStore.getState().setSide("left", [pin("a")], true);
    useMapFindingsStore.getState().setSide("right", [pin("b")], false);
    useMapFindingsStore.getState().clearSide("left");
    expect(Object.keys(useMapFindingsStore.getState().byId)).toEqual(["b"]);
    expect(useMapFindingsStore.getState().truncated).toBe(false);
  });
});
