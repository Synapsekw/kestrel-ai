import { beforeEach, describe, expect, it } from "vitest";
import {
  CONFINED,
  INSPECT_JOB_ID,
  INSPECT_JOB_ID_2,
  LAS,
  MAPPING,
  ORTHO,
  PDF,
  SAVED,
  THERMAL,
  VERTICAL,
  VISUAL,
  bucket,
  inspectResult,
  typeSpec,
} from "@/test/setupFixtures";
import type { InspectBucket, InspectResult } from "./api";
import { draftSnapshot, useSetupDraft } from "./draftStore";
import { bucketId } from "./remap";

const store = () => useSetupDraft.getState();
const names = () => store().types.map((t) => t.name);
const slotOf = (b: InspectBucket) => store().buckets.find((x) => x.id === bucketId(b))?.slot_key;

function sort(
  jobId: string,
  buckets: InspectBucket[],
  slotKey: string | null = null,
  over: Partial<InspectResult> = {},
) {
  // A drop of both fixture folders: every bucket lies under a dropped path, so its id is folder-level.
  store().beginInspect({ jobId, slotKey, paths: ["E:\\DCIM", "E:\\Delivery"] });
  store().applyInspect(jobId, inspectResult(buckets, over));
}

describe("setup draft", () => {
  beforeEach(() => store().discard());

  it("starts empty, at Blank", () => {
    expect(draftSnapshot()).toMatchObject({
      templateId: null,
      name: "",
      folder: "",
      slots: [],
      buckets: [],
      types: [],
      typesEdited: false,
      inspect: null,
      inspectError: null,
      truncated: false,
      suggestedTemplateId: null,
    });
  });

  it("fills slots and types from a template and sorts the buckets into them", () => {
    sort(INSPECT_JOB_ID, [VISUAL, THERMAL]);
    expect(slotOf(VISUAL)).toBeNull();
    store().chooseTemplate(VERTICAL, "replace");
    expect(store().templateId).toBe("builtin-vertical");
    expect(store().slots.map((s) => s.key)).toEqual(["visual", "thermal", "cloud", "drawings"]);
    expect(names()).toHaveLength(7);
    expect([slotOf(VISUAL), slotOf(THERMAL)]).toEqual(["visual", "thermal"]);
  });

  it("switching template twice with edits: keep merges, replace resets, and the buckets follow each time", () => {
    sort(INSPECT_JOB_ID, [VISUAL, ORTHO]);
    store().chooseTemplate(VERTICAL, "replace");
    const corrosion = store().types[0];
    store().setType(corrosion.key, { default_severity: 4 });
    expect(store().typesEdited).toBe(true);

    store().chooseTemplate(MAPPING, "keep");
    expect(names()).toEqual([...VERTICAL.config.types, ...MAPPING.config.types].map((t) => t.name));
    expect(store().types[0]).toMatchObject({ name: "Corrosion", default_severity: 4 });
    expect(store().typesEdited).toBe(true);
    expect([slotOf(VISUAL), slotOf(ORTHO)]).toEqual(["raw", "ortho"]);

    store().chooseTemplate(CONFINED, "replace");
    expect(names()).toEqual(CONFINED.config.types.map((t) => t.name));
    expect(store().typesEdited).toBe(false);
    expect([slotOf(VISUAL), slotOf(ORTHO)]).toEqual(["stills", null]);
  });

  it("keep never lists a name twice", () => {
    store().chooseTemplate(VERTICAL, "replace");
    store().chooseTemplate(SAVED, "keep");
    expect(names().filter((x) => x === "Corrosion")).toHaveLength(1);
    expect(names()).toContain("Feeder damage");
  });

  it("Blank with replace empties the list; with keep it stays", () => {
    store().chooseTemplate(VERTICAL, "replace");
    store().chooseTemplate(null, "keep");
    expect(names()).toHaveLength(7);
    expect(store().slots).toEqual([]);
    store().chooseTemplate(null, "replace");
    expect(names()).toEqual([]);
  });

  it("adds, edits and removes types, and refuses a name already listed", () => {
    expect(store().addType(typeSpec("Rust", "defect", 2, "1"))).toBe(true);
    expect(store().addType(typeSpec("rust", "object", null, null))).toBe(false);
    const rust = store().types[0];
    store().setType(rust.key, { hotkey: "9" });
    expect(store().types[0].hotkey).toBe("9");
    store().removeType(rust.key);
    expect(store().types).toEqual([]);
    expect(store().typesEdited).toBe(true);
  });

  it("moves, skips and restores a bucket", () => {
    store().chooseTemplate(MAPPING, "replace");
    sort(INSPECT_JOB_ID, [ORTHO]);
    const id = bucketId(ORTHO);
    store().moveBucket(id, "dsm");
    expect(slotOf(ORTHO)).toBe("dsm");
    store().skipBucket(id);
    expect(store().buckets[0].skipped).toBe(true);
    store().skipBucket(id, false);
    expect(store().buckets[0]).toMatchObject({ skipped: false, slot_key: "dsm" });
    store().moveBucket(id, null);
    expect(slotOf(ORTHO)).toBeNull();
  });

  it("a second drop adds to the first; the same folder again replaces its bucket", () => {
    store().chooseTemplate(VERTICAL, "replace");
    sort(INSPECT_JOB_ID, [VISUAL, THERMAL], null, {
      not_recognised: { count: 1, samples: [{ name: "Thumbs.db", reason: "unknown type" }] },
    });
    sort(INSPECT_JOB_ID_2, [LAS, { ...VISUAL, count: 700 }], null, {
      not_recognised: { count: 1, samples: [{ name: "notes.txt", reason: "unknown type" }] },
    });
    expect(store().buckets.map((b) => [b.slot_key, b.count])).toEqual([
      ["visual", 700],
      ["thermal", 88],
      ["cloud", 1],
    ]);
    expect(store().notRecognised.count).toBe(2);
    expect(store().inspect).toBeNull();
  });

  it("two file picks from one folder keep both buckets; a later folder drop replaces them with one", () => {
    store().chooseTemplate(MAPPING, "replace");
    const north = bucket({
      route: "map",
      match: { raster: "ortho" },
      folder: "E:\\Survey",
      files: ["E:\\Survey\\ortho_north.tif"],
    });
    const south = { ...north, files: ["E:\\Survey\\ortho_south.tif"] };
    store().beginInspect({ jobId: INSPECT_JOB_ID, slotKey: "ortho", paths: north.files });
    store().applyInspect(INSPECT_JOB_ID, inspectResult([north]));
    store().beginInspect({ jobId: INSPECT_JOB_ID_2, slotKey: "ortho", paths: south.files });
    store().applyInspect(INSPECT_JOB_ID_2, inspectResult([south]));
    expect(store().buckets.map((b) => b.files)).toEqual([north.files, south.files]);

    const both = { ...north, files: [...north.files, ...south.files], count: 2 };
    const third = "j0000000-4444-4000-8000-000000000093";
    store().beginInspect({ jobId: third, slotKey: null, paths: ["E:\\Survey\\"] });
    store().applyInspect(third, inspectResult([both]));
    expect(store().buckets).toHaveLength(1);
    expect(store().buckets[0]).toMatchObject({ id: bucketId(north), count: 2, slot_key: "ortho" });
  });

  it("a sort started from a slot's Browse lands in that slot when the route fits", () => {
    store().chooseTemplate(VERTICAL, "replace");
    sort(INSPECT_JOB_ID, [VISUAL, PDF], "thermal");
    expect(slotOf(VISUAL)).toBe("thermal");
    expect(slotOf(PDF)).toBe("drawings");
  });

  it("sorts with the template chosen when the result lands, not the server's slot_key", () => {
    store().beginInspect({ jobId: INSPECT_JOB_ID, slotKey: null, paths: ["E:\\DCIM"] });
    store().chooseTemplate(CONFINED, "replace");
    store().applyInspect(INSPECT_JOB_ID, inspectResult([{ ...VISUAL, slot_key: "visual" }]));
    expect(slotOf(VISUAL)).toBe("stills");
  });

  it("ignores the result of a job it is not waiting for", () => {
    store().beginInspect({ jobId: INSPECT_JOB_ID, slotKey: null, paths: ["E:\\A"] });
    store().applyInspect(INSPECT_JOB_ID_2, inspectResult([VISUAL]));
    expect(store().buckets).toEqual([]);
    expect(store().inspect?.jobId).toBe(INSPECT_JOB_ID);
  });

  it("keeps a failure until it is dismissed, and the earlier buckets stay", () => {
    sort(INSPECT_JOB_ID, [VISUAL]);
    store().beginInspect({ jobId: INSPECT_JOB_ID_2, slotKey: null, paths: ["E:\\B"] });
    store().failInspect(INSPECT_JOB_ID_2, "E:\\B is not readable");
    expect(store().inspectError).toBe("E:\\B is not readable");
    expect(store().buckets).toHaveLength(1);
    expect(store().inspect).toBeNull();
    store().dismissInspectError();
    expect(store().inspectError).toBeNull();
  });

  it("remembers the last sort's truncation and suggestion", () => {
    sort(INSPECT_JOB_ID, [VISUAL], null, { truncated: true, suggested_template_id: "builtin-vertical" });
    expect(store()).toMatchObject({ truncated: true, suggestedTemplateId: "builtin-vertical" });
    sort(INSPECT_JOB_ID_2, [LAS]);
    expect(store()).toMatchObject({ truncated: false, suggestedTemplateId: null });
  });

  it("Discard clears everything", () => {
    store().setName("Site A");
    store().setFolder("E:\\Projects\\A");
    store().chooseTemplate(VERTICAL, "replace");
    sort(INSPECT_JOB_ID, [VISUAL]);
    store().discard();
    expect(draftSnapshot()).toMatchObject({ name: "", folder: "", templateId: null, types: [], buckets: [] });
  });
});
