import { describe, expect, it } from "vitest";
import { exampleProject } from "@/test/fixtures";
import { legacyCreateBody, legacyKind, withLegacyKind } from "./legacyKind";

describe("legacyKind (transition shim until unit SH)", () => {
  it("reads a detection project that a pre-BK backend still marks", () => {
    expect(legacyKind(withLegacyKind(exampleProject, "detect"))).toBe("detect");
    expect(legacyKind(withLegacyKind(exampleProject, "train"))).toBe("train");
  });

  it("reads a project without a kind, as the contract now sends it, as a training project", () => {
    expect("kind" in exampleProject).toBe(false);
    expect(legacyKind(exampleProject)).toBe("train");
  });

  it("builds a create body for the contract and for a pre-BK backend at once", () => {
    const classes = [{ name: "excavator", colour: "#f97316", hotkey: "1" }];
    expect(legacyCreateBody("North", "E:/Projects/North", "detect", classes)).toEqual({
      name: "North",
      folder: "E:/Projects/North",
      type_ids: [],
      kind: "detect",
      classes,
    });
  });
});
