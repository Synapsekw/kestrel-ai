import { describe, it, expect } from "vitest";
import { exampleClasses, CLASS_ID } from "@/test/fixtures";
import { ApiFailure } from "@/api/errors";
import {
  classInUseMessage,
  moveDraft,
  nextColour,
  toClassInputs,
  toDrafts,
  validateDrafts,
} from "./classesModel";

describe("classes model", () => {
  it("round-trips drafts and inputs", () => {
    const drafts = toDrafts(exampleClasses);
    expect(drafts[0]).toEqual({ id: CLASS_ID(1), name: "excavator", colour: "#f97316", hotkey: "1" });
    const inputs = toClassInputs([...drafts.slice(0, 1), { name: "new", colour: "#ffffff", hotkey: "" }]);
    expect(inputs).toEqual([
      { id: CLASS_ID(1), name: "excavator", colour: "#f97316", hotkey: "1" },
      { name: "new", colour: "#ffffff", hotkey: null },
    ]);
  });

  it("validates names and hotkeys", () => {
    const drafts = toDrafts(exampleClasses);
    expect(validateDrafts(drafts)).toBeNull();
    expect(validateDrafts([{ name: " ", colour: "#000000", hotkey: "" }])).toBe("Every class needs a name.");
    expect(
      validateDrafts([
        { name: "a", colour: "#000000", hotkey: "1" },
        { name: "a", colour: "#000000", hotkey: "2" },
      ]),
    ).toBe('Class name "a" is used twice.');
    expect(
      validateDrafts([
        { name: "a", colour: "#000000", hotkey: "1" },
        { name: "b", colour: "#000000", hotkey: "1" },
      ]),
    ).toBe("Hotkey 1 is used twice.");
    expect(validateDrafts([{ name: "a", colour: "#000000", hotkey: "x" }])).toBe(
      "Hotkeys must be a digit from 1 to 9.",
    );
  });

  it("explains class_in_use and ignores other errors", () => {
    const err = new ApiFailure("class_in_use", "class still has boxes", 409, {
      class_id: CLASS_ID(4),
      box_count: 40,
    });
    expect(classInUseMessage(err, exampleClasses)).toBe(
      'Class "dump_truck" still has 40 boxes. Reassign or delete those boxes in the editor before removing it.',
    );
    expect(classInUseMessage(new ApiFailure("conflict", "x", 409), exampleClasses)).toBeNull();
    expect(classInUseMessage(new Error("x"), exampleClasses)).toBeNull();
  });

  it("moves drafts and picks the next colour", () => {
    const drafts = toDrafts(exampleClasses);
    expect(
      moveDraft(drafts, 0, 1)
        .map((d) => d.name)
        .slice(0, 2),
    ).toEqual(["wheel_loader", "excavator"]);
    expect(moveDraft(drafts, 0, -1)).toBe(drafts);
    expect(nextColour(drafts.slice(0, 2))).toBe("#22c55e");
  });
});
