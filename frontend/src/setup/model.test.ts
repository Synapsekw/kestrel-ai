import { describe, expect, it } from "vitest";
import {
  CATALOGUE_TYPES,
  MAPPING,
  ORTHO,
  SAVED,
  THERMAL,
  VERTICAL,
  VISUAL,
  draftBucket,
  typeSpec,
} from "@/test/setupFixtures";
import type { CatalogueTypeSpec } from "./api";
import {
  MAX_TYPES,
  basicsError,
  bucketLabel,
  checklistOf,
  clashLines,
  conflictText,
  countLabel,
  emptyRequired,
  folderName,
  freeColour,
  freeHotkey,
  hotkeyClashes,
  isAbsolutePath,
  mergeTypes,
  sharesFolder,
  sizeLabel,
  slotFills,
  specFromCatalogue,
  specOf,
  templateLabel,
  toDraftType,
} from "./model";
import { remap } from "./remap";

let n = 0;
const key = () => `k${++n}`;
const draftTypes = (specs: readonly CatalogueTypeSpec[]) => specs.map((s) => toDraftType(s, key()));

describe("name and folder (moved from the New project dialog)", () => {
  it("asks for a name, then a folder, then a full folder path", () => {
    expect(basicsError("", "E:\\Projects\\A")).toBe("Give the project a name.");
    expect(basicsError("  ", "")).toBe("Give the project a name.");
    expect(basicsError("Site A", " ")).toBe("Choose a folder for the project.");
    expect(basicsError("Site A", "Projects\\A")).toBe("Use a full folder path, such as E:\\Projects\\Site.");
    expect(basicsError("Site A", "E:\\Projects\\A")).toBeNull();
    expect(basicsError("Yard", "E:/Projects/Yard")).toBeNull();
  });

  it.each(["E:\\A", "e:/a", "\\\\server\\share\\a", "/home/a"])("%s is a full path", (p) => {
    expect(isAbsolutePath(p)).toBe(true);
  });

  it.each(["A", "Projects\\A", "~/a", ""])("%s is not", (p) => {
    expect(isAbsolutePath(p)).toBe(false);
  });
});

describe("types", () => {
  it("round-trips a spec with every field set, lower-casing the hotkey", () => {
    const t = toDraftType({ name: "Rust", kind: "defect" }, "k");
    expect(specOf(t)).toEqual({
      name: "Rust",
      kind: "defect",
      colour: null,
      default_severity: null,
      hotkey: null,
      definition: null,
      severity_rules: [],
    });
    expect(toDraftType(typeSpec("Rust", "defect", 2, "A"), "k").hotkey).toBe("a");
  });

  it("takes a catalogue type's definition and rules", () => {
    expect(specFromCatalogue(CATALOGUE_TYPES[0])).toEqual({
      name: "Corrosion",
      kind: "defect",
      colour: "#ff9c3a",
      default_severity: 2,
      hotkey: null,
      definition: "Red-brown staining or flaking on steel.",
      severity_rules: [{ when: "section loss visible", severity: 3 }],
    });
  });

  it("keeps mine and adds only the new names", () => {
    const mine = draftTypes(VERTICAL.config.types);
    const merged = mergeTypes(mine, SAVED.config.types, key);
    expect(merged.map((t) => t.name)).toEqual([...VERTICAL.config.types.map((t) => t.name), "Feeder damage"]);
    expect(merged.slice(0, 7)).toEqual(mine);
  });

  it("stops at 64 types", () => {
    const many = Array.from({ length: 70 }, (_, i) => typeSpec(`Type ${i}`, "defect", null, null));
    expect(mergeTypes([], many, key)).toHaveLength(MAX_TYPES);
  });

  it("flags a hotkey two types share, whatever its case", () => {
    const [a, b, c] = draftTypes([
      typeSpec("Bolt", "defect", 3, "b"),
      typeSpec("Scaffold", "object", null, "x"),
      typeSpec("Rust", "defect", 2, null),
    ]);
    const clash = [a, { ...b, hotkey: "B" }, c];
    expect(hotkeyClashes(clash)).toEqual(
      new Map([
        [a.key, "Scaffold"],
        [b.key, "Bolt"],
      ]),
    );
    expect(clashLines(clash)).toEqual(["Hotkey B is used by Bolt and Scaffold"]);
    expect(hotkeyClashes([a, b, c]).size).toBe(0);
  });

  it("offers the first free hotkey and colour", () => {
    expect(freeHotkey(draftTypes(VERTICAL.config.types))).toBe("8");
    expect(freeHotkey([])).toBe("1");
    expect(freeColour([])).toBe("#f97316");
  });

  it("says why the Catalogue's copy wins", () => {
    const t = toDraftType(typeSpec("Bird nest", "object", 2, "5", "#22c55e"), "k");
    expect(conflictText(t, { kind: "defect", colour: "#22c55e" })).toBe(
      "Already in your Catalogue as Defect. The Catalogue's kind and colour are kept.",
    );
    expect(conflictText(t, { kind: "object", colour: "#000000" })).toBe(
      "Already in your Catalogue with another colour. The Catalogue's colour is kept.",
    );
    expect(conflictText(t, { kind: "object", colour: "#22C55E" })).toBeNull();
  });
});

describe("slots and buckets", () => {
  const vertical = VERTICAL.config.slots;

  it("fills slots from assigned, unskipped buckets and names the empty required ones", () => {
    const buckets = remap([draftBucket(THERMAL), draftBucket(VISUAL, { skipped: true })], vertical);
    const fills = slotFills(vertical, buckets);
    expect(fills.map((f) => [f.slot.key, f.count])).toEqual([
      ["visual", 0],
      ["thermal", 88],
      ["cloud", 0],
      ["drawings", 0],
    ]);
    expect(emptyRequired(vertical, buckets).map((s) => s.key)).toEqual(["visual"]);
  });

  it("notices visual and thermal photos in one folder, unless one of them is skipped", () => {
    const both = remap([draftBucket(VISUAL), draftBucket(THERMAL)], vertical);
    expect(sharesFolder(both)).toBe(true);
    expect(sharesFolder([both[0], { ...both[1], skipped: true }])).toBe(false);
  });

  it("labels buckets, counts and sizes", () => {
    expect(bucketLabel(draftBucket(VISUAL))).toBe("100MEDIA · visual");
    expect(bucketLabel(draftBucket(THERMAL))).toBe("100MEDIA · thermal");
    expect(bucketLabel(draftBucket(ORTHO))).toBe("ortho_q3.tif");
    expect(countLabel(VISUAL)).toBe("612 photos");
    expect(countLabel({ route: "map", count: 1 })).toBe("1 file");
    expect(countLabel({ route: "images", count: 1184 })).toBe("1,184 photos");
    expect(sizeLabel(7_800_000_000)).toBe("7.8 GB");
    expect(sizeLabel(412_000_000)).toBe("412 MB");
    expect(sizeLabel(14_000)).toBe("14 KB");
    expect(folderName("E:\\DCIM\\100MEDIA\\")).toBe("100MEDIA");
  });

  it("names the template, Blank when none or unknown", () => {
    expect(templateLabel(null, [MAPPING])).toBe("Blank");
    expect(templateLabel("builtin-mapping", [MAPPING])).toBe("Mapping and survey");
    expect(templateLabel("gone", [MAPPING])).toBe("Blank");
  });

  it("builds the checklist", () => {
    const buckets = remap([draftBucket(THERMAL)], vertical);
    const model = checklistOf(
      { name: "", folder: "", slots: vertical, buckets, types: draftTypes(VERTICAL.config.types) },
      "Vertical asset inspection",
    );
    expect(model).toEqual({
      templateName: "Vertical asset inspection",
      basics: "Give the project a name.",
      slotsTotal: 4,
      slotsFilled: 1,
      emptyRequired: [vertical[0]],
      typeCount: 7,
      clashes: [],
    });
  });
});
