import { describe, expect, it } from "vitest";
import type { AssetItem } from "@/api/plantItems";
import { CATALOGUE, ITEM, PUMP, plantSpec } from "@/test/plantFixtures";
import {
  applyDraft,
  draftOf,
  editNote,
  effectiveHeightSource,
  fieldsFromSchema,
  sameDraft,
  validateDraft,
  withItem,
} from "./itemEdit";

const tankFields = fieldsFromSchema(CATALOGUE[0].params_schema);

describe("fieldsFromSchema", () => {
  it("reads numbers, enums, booleans, integers and nullable arrays from a pydantic schema", () => {
    expect(tankFields.map((f) => [f.key, f.kind, f.label, f.unit ?? null])).toEqual([
      ["d_m", "number", "D", "m"],
      ["roof", "enum", "Roof", null],
      ["platforms", "boolean", "Platforms", null],
      ["risers", "integer", "Risers", null],
      ["nozzles", "json", "Nozzles", null],
    ]);
    const d = tankFields[0];
    expect([d.min, d.exclusiveMin, d.defaultValue]).toEqual([0, true, 80]);
    expect(tankFields[1].options).toEqual(["dome", "flat"]);
    expect(tankFields[4].nullable).toBe(true);
  });
  it("an empty schema has no fields", () => {
    expect(fieldsFromSchema({ type: "object", properties: {} })).toEqual([]);
    expect(fieldsFromSchema(null)).toEqual([]);
  });
});

describe("drafts", () => {
  it("round-trips an item unchanged", () => {
    const d = draftOf(ITEM, tankFields);
    expect(d.top_el).toBe("135");
    expect(d.fp).toEqual({ e: "100", n: "200", d: "80" });
    expect(applyDraft(ITEM, d, tankFields)).toEqual(ITEM);
  });
  it("applies new heights, footprint numbers and params", () => {
    const d = draftOf(ITEM, tankFields);
    const next = applyDraft(
      ITEM,
      {
        ...d,
        top_el: "140.5",
        fp: { ...d.fp, d: "82" },
        params: { ...d.params, roof: "flat", platforms: false },
      },
      tankFields,
    );
    expect(next.top_el).toBe(140.5);
    expect(next.footprint).toEqual({ kind: "circle", center: [100, 200], d: 82 });
    expect(next.params).toEqual({ d_m: 80, roof: "flat", platforms: false });
  });
  it("a new type starts from that type's defaults (params cleared)", () => {
    const d = draftOf(ITEM, tankFields);
    expect(applyDraft(ITEM, { ...d, type: "other" }, []).params).toEqual({});
  });
  it("an item without params drafts from the defaults and round-trips", () => {
    const bare = { ...ITEM } as Record<string, unknown>;
    delete bare.params;
    delete bare.flags;
    const item = bare as unknown as AssetItem;
    const d = draftOf(item, tankFields);
    expect(d.params).toEqual({ d_m: "", roof: "", platforms: true, risers: "", nozzles: "" });
    expect(applyDraft(item, d, tankFields)).toEqual(item);
    // a switch left at the builder's default stays unset; a typed value is written
    expect(applyDraft(item, { ...d, params: { ...d.params, d_m: "70" } }, tankFields).params).toEqual({
      d_m: 70,
    });
    expect(applyDraft(item, { ...d, params: { ...d.params, platforms: false } }, tankFields).params).toEqual({
      platforms: false,
    });
  });
  it("validates numbers, ordering and schema limits", () => {
    const d = draftOf(ITEM, tankFields);
    expect(validateDraft({ ...d, top_el: "90" }, tankFields, "circle")).toEqual({
      top_el: "Top EL must be at or above base EL.",
    });
    expect(validateDraft({ ...d, top_el: "abc" }, tankFields, "circle")).toEqual({
      top_el: "Enter a number.",
    });
    expect(validateDraft({ ...d, fp: { ...d.fp, d: "0" } }, tankFields, "circle")).toEqual({
      "fp.d": "Must be more than 0.",
    });
    expect(validateDraft({ ...d, params: { ...d.params, d_m: "0" } }, tankFields, "circle")).toEqual({
      "params.d_m": "Must be more than 0.",
    });
    expect(validateDraft({ ...d, params: { ...d.params, risers: "2.5" } }, tankFields, "circle")).toEqual({
      "params.risers": "Enter a whole number.",
    });
    expect(validateDraft({ ...d, params: { ...d.params, nozzles: "[1," } }, tankFields, "circle")).toEqual({
      "params.nozzles": "Enter valid JSON.",
    });
    expect(validateDraft(d, tankFields, "circle")).toEqual({});
  });
  it("knows an untouched draft", () => {
    expect(sameDraft(draftOf(ITEM, tankFields), draftOf(ITEM, tankFields))).toBe(true);
    expect(sameDraft(draftOf(ITEM, tankFields), { ...draftOf(ITEM, tankFields), base_el: "99" })).toBe(false);
  });
});

describe("height source after a hand edit", () => {
  const fromScan = { ...ITEM, height_source: "cloud" } as AssetItem;
  it("an EL typed by hand on a scan or indicative height becomes a drawing height", () => {
    const d = draftOf(fromScan, tankFields);
    expect(effectiveHeightSource(fromScan, d)).toBe("cloud");
    const edited = { ...d, top_el: "140" };
    expect(effectiveHeightSource(fromScan, edited)).toBe("drawing");
    const next = applyDraft(fromScan, edited, tankFields);
    expect(next.height_source).toBe("drawing");
    expect(editNote(fromScan, next, 3)).toBe(
      "Edited 20-T-0001 from v3: top EL 135 → 140 m, height source cloud → drawing",
    );
    const indicative = { ...ITEM, height_source: "indicative" } as AssetItem;
    const base = draftOf(indicative, tankFields);
    expect(applyDraft(indicative, { ...base, base_el: "99" }, tankFields).height_source).toBe("drawing");
  });
  it("an EL edit on a drawing height, or no EL edit, leaves the source as chosen", () => {
    const d = draftOf(ITEM, tankFields);
    expect(
      applyDraft(ITEM, { ...d, top_el: "140", height_source: "indicative" }, tankFields).height_source,
    ).toBe("indicative");
    const ds = draftOf(fromScan, tankFields);
    expect(applyDraft(fromScan, { ...ds, fp: { ...ds.fp, d: "81" } }, tankFields).height_source).toBe(
      "cloud",
    );
  });
});

describe("saving", () => {
  it("replaces the item in the base spec and leaves the others alone", () => {
    const spec = withItem(plantSpec(), { ...ITEM, top_el: 140 } as never);
    const items = (spec as unknown as { items: { id: string; top_el: number }[] }).items;
    expect(items.map((i) => [i.id, i.top_el])).toEqual([
      ["20-T-0001", 140],
      [PUMP.id, 103],
    ]);
  });
  it("an item missing from the base spec is an error, never a silent add", () => {
    expect(() => withItem(plantSpec([PUMP]), ITEM)).toThrow(/20-T-0001 is not in this version/);
  });
  it("names the base version and every change in the note", () => {
    expect(editNote(ITEM, { ...ITEM, top_el: 140 } as never, 3)).toBe(
      "Edited 20-T-0001 from v3: top EL 135 → 140 m",
    );
    expect(editNote(ITEM, { ...ITEM, type: "other", params: {} } as never, 3)).toBe(
      "Edited 20-T-0001 from v3: type tank_lng → other, params",
    );
  });
});
