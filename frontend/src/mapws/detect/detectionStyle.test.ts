import { describe, expect, it } from "vitest";
import { lookStyle, tagText } from "./detectionStyle";
import { MAX_CACHED, useDetectStore } from "./detectStore";

describe("detection styles", () => {
  it("pending defects are accent and dashed; objects take the class colour", () => {
    expect(lookStyle("pending-defect", "#f97316")).toMatchObject({
      stroke: "token:accent",
      dash: [6, 4],
    });
    expect(lookStyle("object", "#f97316")).toMatchObject({
      stroke: "#f97316",
      dash: null,
      label: true,
    });
    expect(lookStyle("object", undefined)?.stroke).toBe("token:accent");
    expect(lookStyle("selected", "#f97316")).toMatchObject({
      stroke: "token:accent",
      width: 3,
    });
    expect(lookStyle("accepted-defect", "#f97316")?.stroke).toBe("token:ok");
    expect(lookStyle("rejected", "#f97316")).toMatchObject({
      stroke: "token:dim",
      dash: [2, 4],
    });
    expect(lookStyle("hidden", "#f97316")).toBeNull();
  });
  it("tags a box with its type and confidence", () => {
    expect(tagText("Excavator", 0.964)).toBe("Excavator 0.96");
    expect(tagText(undefined, 0.5)).toBe("Unknown 0.50");
  });
});

describe("detect store", () => {
  it("caps the detection cache", () => {
    const many = Array.from({ length: MAX_CACHED + 5 }, (_, i) => ({ id: `d${i}` }) as never);
    useDetectStore.getState().remember("r1", many);
    expect(useDetectStore.getState().byId.size).toBe(MAX_CACHED);
    expect(useDetectStore.getState().byId.has("d0")).toBe(false);
  });
  it("keeps a back history for Shift+Tab", () => {
    const s = useDetectStore.getState();
    s.pushHistory({ kind: "detection", id: "r.a" });
    s.pushHistory({ kind: "detection", id: "r.b" });
    expect(useDetectStore.getState().popHistory()).toEqual({
      kind: "detection",
      id: "r.a",
    });
  });
});
