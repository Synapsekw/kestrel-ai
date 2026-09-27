import { describe, expect, it } from "vitest";
import { exampleModel } from "@/test/fixtures";
import { exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { IGNORE, draftsOf, leftoverNames, resolveClass, toClassMap, unmappedCount } from "./classMapModel";

const types = [...exampleTypes, { ...exampleTypes[0], id: TYPE_ID(5), name: "Bus", origin: "user" as const }];
const model = { ...exampleModel, class_map: { person: null, car: TYPE_ID(1) } };

describe("model class -> catalogue type (F §7.4: name, then alias, then class_map)", () => {
  it("resolves by name, alias and map, and leaves the rest unmapped", () => {
    expect(resolveClass("bus", model, types)).toMatchObject({ kind: "name", type: { id: TYPE_ID(5) } });
    expect(resolveClass("truck", model, types)).toMatchObject({
      kind: "alias",
      alias: "dump_truck",
      type: { id: TYPE_ID(2) },
    });
    expect(resolveClass("person", model, types)).toEqual({ kind: "map", typeId: null });
    expect(resolveClass("car", model, types)).toEqual({ kind: "map", typeId: TYPE_ID(1) });
    expect(resolveClass("bicycle", model, types)).toEqual({ kind: "unmapped" });
  });

  it("never matches an archived type by name", () => {
    expect(resolveClass("spalling", model, types)).toEqual({ kind: "unmapped" });
  });

  it("offers a picker only for the leftovers, in the model's class order", () => {
    expect(leftoverNames(model, types)).toEqual([
      "person",
      "bicycle",
      "car",
      "motorcycle",
      "airplane",
      "train",
    ]);
    const drafts = draftsOf(model, types);
    expect(drafts).toEqual({
      person: IGNORE,
      bicycle: "",
      car: TYPE_ID(1),
      motorcycle: "",
      airplane: "",
      train: "",
    });
    expect(unmappedCount(drafts)).toBe(4);
    expect(toClassMap(drafts)).toEqual({ person: null, car: TYPE_ID(1) });
  });
});
