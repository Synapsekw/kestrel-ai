import { describe, expect, it } from "vitest";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  DEFAULT_FILTERS,
  draftOf,
  filterTypes,
  findClash,
  KIND_OPTIONS,
  migratedCount,
  nextTypeColour,
  toCreate,
  toPatch,
  validateTypeDraft,
} from "./catalogueModel";

const names = (f: Partial<typeof DEFAULT_FILTERS>) =>
  filterTypes(exampleTypes, { ...DEFAULT_FILTERS, ...f }).map((t) => t.name);
const crack = exampleTypes[2];

describe("filterTypes", () => {
  it("hides archived types unless asked, sorted by group then name", () => {
    expect(names({})).toEqual(["Dump truck", "Excavator", "Crack"]);
    expect(names({ showArchived: true })).toEqual(["Dump truck", "Excavator", "Crack", "Spalling"]);
  });

  it("filters by kind, by migrated origin, and searches names and groups by normalised text", () => {
    expect(names({ kind: "defect" })).toEqual(["Crack"]);
    expect(names({ migratedOnly: true })).toEqual(["Dump truck", "Excavator"]);
    expect(names({ q: "dump_truck" })).toEqual(["Dump truck"]);
    expect(names({ q: "concrete" })).toEqual(["Crack"]);
  });
});

describe("migratedCount", () => {
  it("counts non-archived migrated types", () => {
    expect(migratedCount(exampleTypes)).toBe(2);
    expect(migratedCount([{ ...exampleTypes[0], archived: true }])).toBe(0);
  });
});

describe("drafts", () => {
  it("starts a new type as a defect with the first unused palette colour", () => {
    expect(draftOf(null, exampleTypes)).toEqual({
      name: "",
      colour: "#eab308",
      kind: "defect",
      group: "",
      defaultSeverity: null,
      hotkey: "",
    });
  });

  it("finds a clash by normalised name among live types only", () => {
    expect(findClash({ ...draftOf(null, exampleTypes), name: "dump-truck" }, exampleTypes)?.id).toBe(
      TYPE_ID(2),
    );
    expect(
      findClash({ ...draftOf(null, exampleTypes), name: "dump-truck" }, exampleTypes, TYPE_ID(2)),
    ).toBeNull();
    expect(findClash({ ...draftOf(null, exampleTypes), name: "spalling" }, exampleTypes)).toBeNull();
  });

  it("validates name, clash and hotkey", () => {
    const blank = draftOf(null, exampleTypes);
    expect(validateTypeDraft(blank, exampleTypes)).toBe("Give the type a name.");
    expect(validateTypeDraft({ ...blank, name: "Dump_truck" }, exampleTypes)).toBe(
      '"Dump truck" already exists. Open it instead of creating a second one.',
    );
    expect(validateTypeDraft({ ...blank, name: "Rust", hotkey: "c" }, exampleTypes)).toBe(
      'Hotkey C is already used by "Crack".',
    );
    expect(validateTypeDraft({ ...blank, name: "Rust", hotkey: "%" }, exampleTypes)).toBe(
      "A hotkey is one digit from 1 to 9 or one letter.",
    );
    expect(validateTypeDraft({ ...blank, name: "Rust", hotkey: "r" }, exampleTypes)).toBeNull();
    expect(validateTypeDraft(draftOf(crack, exampleTypes), exampleTypes, crack.id)).toBeNull();
  });

  it("sends only what changed in a patch, and nulls for cleared optional fields", () => {
    const d = draftOf(crack, exampleTypes);
    expect(toPatch(d, crack)).toEqual({});
    expect(toPatch({ ...d, name: " Hairline crack " }, crack)).toEqual({ name: "Hairline crack" });
    expect(toPatch({ ...d, group: "", defaultSeverity: null, hotkey: "" }, crack)).toEqual({
      group: null,
      default_severity: null,
      hotkey: null,
    });
    expect(toPatch({ ...d, kind: "object" }, crack)).toEqual({ kind: "object" });
  });

  it("builds a create body with trimmed text and nulls for empty fields", () => {
    expect(toCreate({ ...draftOf(null, exampleTypes), name: " Rust ", group: " " })).toEqual({
      name: "Rust",
      colour: "#eab308",
      kind: "defect",
      group: null,
      default_severity: null,
      hotkey: null,
    });
  });

  it("picks the next colour among live types only", () => {
    expect(nextTypeColour(exampleTypes)).toBe("#eab308");
    expect(nextTypeColour([])).toBe("#f97316");
  });
});

describe("KIND_OPTIONS", () => {
  it("offers defect then object", () => {
    expect(KIND_OPTIONS).toEqual([
      { value: "defect", label: "Defect" },
      { value: "object", label: "Object" },
    ]);
  });
});
