import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { exampleProjectClasses, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  addRow,
  effectiveHotkey,
  exactMatch,
  hotkeyProblem,
  moveRow,
  removeRow,
  rowsOf,
  suggestions,
  toTypesBody,
  typeInUseMessage,
} from "./projectTypesModel";

const projectClasses = exampleProjectClasses;

describe("project type list (F §7.3)", () => {
  it("orders rows by position and spots a project hotkey override", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    expect(rows.map((r) => r.name)).toEqual(["Excavator", "Crack"]);
    expect(rows[0]).toMatchObject({ catalogueHotkey: "1", override: "9" });
    expect(rows[1]).toMatchObject({ catalogueHotkey: "c", override: "" });
    expect(effectiveHotkey(rows[0])).toBe("9");
  });

  it("without the catalogue, keeps each hotkey as the type's own", () => {
    expect(rowsOf(projectClasses, [])[0]).toMatchObject({ catalogueHotkey: "9", override: "" });
  });

  it("adds, moves and removes rows", () => {
    let rows = rowsOf(projectClasses, exampleTypes);
    rows = addRow(rows, exampleTypes[1]);
    expect(rows.map((r) => r.name)).toEqual(["Excavator", "Crack", "Dump truck"]);
    expect(addRow(rows, exampleTypes[1])).toBe(rows);
    rows = moveRow(rows, 2, -1);
    expect(rows.map((r) => r.name)).toEqual(["Excavator", "Dump truck", "Crack"]);
    expect(removeRow(rows, TYPE_ID(3)).map((r) => r.name)).toEqual(["Excavator", "Dump truck"]);
  });

  it("refuses a hotkey used twice in the project", () => {
    const rows = rowsOf(projectClasses, exampleTypes).map((r) =>
      r.name === "Crack" ? { ...r, override: "9" } : r,
    );
    expect(hotkeyProblem(rows)).toBe('Hotkey 9 is used by "Excavator" and "Crack" in this project.');
    expect(hotkeyProblem(rowsOf(projectClasses, exampleTypes))).toBeNull();
  });

  it("sends the order, keeps a set override and leaves untouched empty overrides out", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    expect(toTypesBody(rows, rows)).toEqual({
      type_ids: [TYPE_ID(1), TYPE_ID(3)],
      hotkeys: { [TYPE_ID(1)]: "9" },
    });
  });

  it("clearing a project's override sends null for that type (a left-out entry would keep it)", () => {
    const base = rowsOf(projectClasses, exampleTypes);
    const rows = base.map((r) => (r.name === "Excavator" ? { ...r, override: "" } : r));
    expect(toTypesBody(rows, base)).toEqual({
      type_ids: [TYPE_ID(1), TYPE_ID(3)],
      hotkeys: { [TYPE_ID(1)]: null },
    });
  });

  it("without the catalogue, a reorder sends no null and so keeps every stored override", () => {
    const base = rowsOf(projectClasses, []);
    const rows = moveRow(base, 0, 1);
    expect(toTypesBody(rows, base)).toEqual({ type_ids: [TYPE_ID(3), TYPE_ID(1)], hotkeys: {} });
  });

  it("sends a newly set override as a string", () => {
    const base = rowsOf(projectClasses, exampleTypes);
    const rows = base.map((r) => (r.name === "Crack" ? { ...r, override: "x" } : r));
    expect(toTypesBody(rows, base).hotkeys).toEqual({ [TYPE_ID(1)]: "9", [TYPE_ID(3)]: "x" });
  });

  it("suggests live catalogue types not yet in the list, by normalised text", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    expect(suggestions("dump_", exampleTypes, rows).map((t) => t.name)).toEqual(["Dump truck"]);
    expect(suggestions("", exampleTypes, rows)).toEqual([]);
    expect(suggestions("spall", exampleTypes, rows)).toEqual([]);
    expect(exactMatch("dump-truck", exampleTypes)?.id).toBe(TYPE_ID(2));
    expect(exactMatch("rust", exampleTypes)).toBeNull();
  });

  it("explains a type that still has annotations or findings", () => {
    const rows = rowsOf(projectClasses, exampleTypes);
    const err = new ApiFailure("class_in_use", "in use", 409, {
      type_id: TYPE_ID(3),
      box_count: 4,
      finding_count: 1,
    });
    expect(typeInUseMessage(err, rows)).toBe(
      '"Crack" still has 4 annotations and 1 finding. Reassign or delete them before removing the type.',
    );
    expect(typeInUseMessage(new Error("x"), rows)).toBeNull();
  });
});
