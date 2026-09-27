import { afterEach, describe, expect, it } from "vitest";
import type { ClassDef, LibraryModel } from "@contract/client";
import { exampleClasses, exampleModel } from "@/test/fixtures";
import { menuSubtitle, reachableTypes, readConf, stem, writeConf } from "./models";

afterEach(() => localStorage.clear());
const types: ClassDef[] = exampleClasses;

describe("models", () => {
  it("reaches types by exact name, alias or class map", () => {
    const byName: LibraryModel = {
      ...exampleModel,
      class_names: [types[0].name.toUpperCase()],
      class_aliases: {},
      class_map: {},
    };
    expect(reachableTypes(byName, types).map((t) => t.id)).toEqual([types[0].id]);
    const byAlias: LibraryModel = {
      ...exampleModel,
      class_names: ["truck"],
      class_aliases: { truck: types[1].name },
      class_map: {},
    };
    expect(reachableTypes(byAlias, types).map((t) => t.id)).toEqual([types[1].id]);
    const byMap: LibraryModel = {
      ...exampleModel,
      class_names: ["zz"],
      class_aliases: {},
      class_map: { zz: types[2].id },
    };
    expect(reachableTypes(byMap, types).map((t) => t.id)).toEqual([types[2].id]);
    const ignored: LibraryModel = {
      ...exampleModel,
      class_names: [types[0].name],
      class_aliases: {},
      class_map: { [types[0].name]: null },
    };
    expect(reachableTypes(ignored, types)).toEqual([]);
  });
  it("describes a model as task · types", () => {
    const m: LibraryModel = {
      ...exampleModel,
      task: "segment",
      class_names: [types[0].name, types[1].name],
      class_aliases: {},
      class_map: {},
    };
    expect(menuSubtitle(m, types)).toBe(`Segmentation · ${types[0].name}, ${types[1].name}`);
  });
  it("remembers the confidence per model, default 0.25", () => {
    expect(readConf("m1")).toBe(0.25);
    writeConf("m1", 0.4);
    expect(readConf("m1")).toBe(0.4);
  });
  it("takes the stem of a file name", () => {
    expect(stem("DJI_0612.JPG")).toBe("DJI_0612");
    expect(stem("no-ext")).toBe("no-ext");
  });
});
