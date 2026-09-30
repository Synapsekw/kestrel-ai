import { describe, expect, it } from "vitest";
import type { CatalogueType } from "@/api/catalogue";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import {
  DEFAULT_FILTERS,
  draftOf,
  filterTypes,
  findClash,
  KIND_OPTIONS,
  migratedCount,
  nextTypeColour,
  supportsDefinition,
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
      definition: "",
      rules: [],
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

  it("copies definition and rules from a type, and reads an answer without them as empty", () => {
    const ruled: CatalogueType = {
      ...crack,
      definition: "A linear fracture.",
      severity_rules: [{ when: "Wider than 5 mm", severity: 4 }],
    };
    const d = draftOf(ruled, exampleTypes);
    expect(d.definition).toBe("A linear fracture.");
    expect(d.rules.map(({ when, severity }) => ({ when, severity }))).toEqual([
      { when: "Wider than 5 mm", severity: 4 },
    ]);

    const legacy: Partial<CatalogueType> = { ...crack };
    delete legacy.definition;
    delete legacy.severity_rules;
    const old = draftOf(legacy as CatalogueType, exampleTypes);
    expect(old.definition).toBe("");
    expect(old.rules).toEqual([]);
    expect(toPatch(old, legacy as CatalogueType)).toEqual({});
    expect(supportsDefinition(legacy as CatalogueType)).toBe(false);
    expect(supportsDefinition(crack)).toBe(true);
    expect(supportsDefinition(null)).toBe(true);
  });

  it("patches the definition and the whole rule list only when they changed", () => {
    const ruled: CatalogueType = {
      ...crack,
      definition: "A linear fracture.",
      severity_rules: [
        { when: "Wider than 5 mm", severity: 4 },
        { when: "Hairline", severity: 1 },
      ],
    };
    const d = draftOf(ruled, exampleTypes);
    expect(toPatch(d, ruled)).toEqual({});
    expect(toPatch({ ...d, definition: " A linear fracture. " }, ruled)).toEqual({});
    expect(toPatch({ ...d, definition: "  " }, ruled)).toEqual({ definition: null });
    expect(toPatch({ ...d, definition: "Any fracture." }, ruled)).toEqual({ definition: "Any fracture." });
    expect(toPatch({ ...d, rules: [d.rules[1], d.rules[0]] }, ruled)).toEqual({
      severity_rules: [
        { when: "Hairline", severity: 1 },
        { when: "Wider than 5 mm", severity: 4 },
      ],
    });
    expect(toPatch({ ...d, rules: [{ ...d.rules[0], severity: 3 }, d.rules[1]] }, ruled)).toEqual({
      severity_rules: [
        { when: "Wider than 5 mm", severity: 3 },
        { when: "Hairline", severity: 1 },
      ],
    });
    expect(toPatch({ ...d, rules: [] }, ruled)).toEqual({ severity_rules: [] });
    // A type from before 0003 after migration: nothing to send until something changes.
    const old: CatalogueType = { ...crack, definition: null, severity_rules: [] };
    expect(toPatch(draftOf(old, exampleTypes), old)).toEqual({});
  });

  it("creates with a definition and rules only when given", () => {
    const blank = { ...draftOf(null, exampleTypes), name: "Rust" };
    expect(toCreate(blank)).not.toHaveProperty("definition");
    expect(toCreate(blank)).not.toHaveProperty("severity_rules");
    expect(toCreate({ ...blank, definition: "   " })).not.toHaveProperty("definition");
    expect(
      toCreate({
        ...blank,
        definition: " Orange-brown flaking. ",
        rules: [{ key: "k", when: " Section loss ", severity: 4 }],
      }),
    ).toMatchObject({
      name: "Rust",
      definition: "Orange-brown flaking.",
      severity_rules: [{ when: "Section loss", severity: 4 }],
    });
  });

  it("refuses a definition over 1000 characters", () => {
    const blank = { ...draftOf(null, exampleTypes), name: "Rust" };
    expect(validateTypeDraft({ ...blank, definition: "x".repeat(1000) }, exampleTypes)).toBeNull();
    expect(validateTypeDraft({ ...blank, definition: "x".repeat(1001) }, exampleTypes)).toBe(
      "Keep the definition to 1000 characters or fewer.",
    );
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
