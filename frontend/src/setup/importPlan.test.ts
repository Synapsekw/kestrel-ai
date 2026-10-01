import { describe, expect, it } from "vitest";
import { bucket, draft, draftType, PHOTOS, slot, VERTICAL_SLOTS } from "@/test/setupDispatchFixtures";
import { pathKey, planImports, projectTypes, typeSpecs } from "./importPlan";

describe("planImports", () => {
  it("imports a folder of visual and thermal photos once, for both slots (S-R4)", () => {
    const plan = planImports(
      draft({
        buckets: [
          bucket({ route: "images", match: { thermal: false }, slot_key: "visual" }),
          bucket({ route: "images", match: { thermal: true }, slot_key: "thermal" }),
        ],
      }),
    );
    expect(plan.units).toEqual([
      {
        id: `images:${pathKey(PHOTOS)}`,
        route: "images",
        path: PHOTOS,
        slotKeys: ["visual", "thermal"],
        state: "pending",
      },
    ]);
    expect(plan.labels).toEqual({ visual: "Visual photos", thermal: "Thermal photos" });
  });

  it("treats the same folder spelt with other case or slashes as one folder", () => {
    const plan = planImports(
      draft({
        buckets: [
          bucket({ route: "images", slot_key: "visual", folder: "E:\\Delivery\\DCIM\\100MEDIA" }),
          bucket({ route: "images", slot_key: "thermal", folder: "e:/delivery/dcim/100media/" }),
        ],
      }),
    );
    expect(plan.units).toHaveLength(1);
    expect(plan.units[0].path).toBe("E:\\Delivery\\DCIM\\100MEDIA");
  });

  it("imports nested photo folders once, through the top-most one (the importer is recursive)", () => {
    const plan = planImports(
      draft({
        buckets: [
          bucket({ route: "images", slot_key: "thermal", folder: "E:\\D\\DCIM\\100MEDIA\\IR" }),
          bucket({ route: "images", slot_key: "visual", folder: "E:\\D\\DCIM" }),
          bucket({ route: "images", slot_key: "visual", folder: "E:\\D\\DCIM\\100MEDIA" }),
          bucket({ route: "images", slot_key: "visual", folder: "E:\\D\\DCIM2" }),
        ],
      }),
    );
    expect(plan.units.map((u) => [u.path, u.slotKeys])).toEqual([
      ["E:\\D\\DCIM", ["visual", "thermal"]],
      ["E:\\D\\DCIM2", ["visual"]],
    ]);
    expect(plan.units.every((u) => u.blocked === undefined)).toBe(true);
  });

  it("does not start a photo folder that also holds GeoTIFFs, even from a skipped map bucket", () => {
    const plan = planImports(
      draft({
        slots: [...VERTICAL_SLOTS, slot("ortho", "Orthomosaic", "map", { raster: "ortho" })],
        buckets: [
          bucket({ route: "images", slot_key: "visual", folder: "E:\\D\\flight" }),
          bucket({ route: "images", slot_key: "thermal", folder: "E:\\D\\thermal" }),
          bucket({
            route: "map",
            slot_key: "ortho",
            skipped: true,
            folder: "E:\\D\\flight\\products",
            files: ["E:\\D\\flight\\products\\ortho.tif"],
          }),
        ],
      }),
    );
    expect(plan.units.map((u) => [u.path, u.blocked])).toEqual([
      [
        "E:\\D\\flight",
        "Photos in E:\\D\\flight were not imported: the folder also holds GeoTIFFs, which a photo import " +
          "would take as photos. Move the GeoTIFFs out of it, then Retry.",
      ],
      ["E:\\D\\thermal", undefined],
    ]);
  });

  it("never dispatches a skipped bucket, an unassigned one, one in a slot the template lacks, or video", () => {
    const plan = planImports(
      draft({
        slots: [...VERTICAL_SLOTS, slot("video", "Inspection video", "video")],
        buckets: [
          bucket({ route: "images", slot_key: "visual", skipped: true }),
          bucket({
            route: "pointcloud",
            slot_key: null,
            folder: "E:\\D\\scan",
            files: ["E:\\D\\scan\\tower.laz"],
          }),
          bucket({
            route: "drawing",
            slot_key: "ortho",
            folder: "E:\\D\\plans",
            files: ["E:\\D\\plans\\a.pdf"],
          }),
          bucket({
            route: "video",
            slot_key: "video",
            folder: "E:\\D\\video",
            files: ["E:\\D\\video\\walk.mp4"],
          }),
          bucket({ route: "images", slot_key: "video", folder: "E:\\D\\stills" }),
        ],
      }),
    );
    expect(plan).toEqual({ labels: {}, units: [], omitted: [] });
  });

  it("names the files past a bucket's 200-path list instead of dropping them silently", () => {
    const files = Array.from({ length: 200 }, (_, i) => `E:\\D\\ortho\\tile-${i}.tif`);
    const plan = planImports(
      draft({
        slots: [
          ...VERTICAL_SLOTS,
          slot("ortho", "Orthomosaic", "map", { raster: "ortho" }),
          slot("cloud", "LiDAR scan", "pointcloud"),
        ],
        buckets: [
          bucket({ route: "map", slot_key: "ortho", folder: "E:\\D\\ortho", files, count: 250 }),
          bucket({
            route: "pointcloud",
            slot_key: "cloud",
            folder: "E:\\D\\scan",
            files: ["E:\\D\\scan\\t.laz"],
            count: 1,
          }),
          bucket({ route: "images", slot_key: "visual", folder: "E:\\D\\DCIM", count: 5000 }),
        ],
      }),
    );
    expect(plan.units.filter((u) => u.route === "map")).toHaveLength(200);
    expect(plan.omitted).toEqual([{ slotKey: "ortho", folder: "E:\\D\\ortho", count: 50, tab: "Maps" }]);
  });

  it("dispatches a bucket through its slot's route: a GeoTIFF moved into an elevation slot is an elevation (S-R15)", () => {
    const plan = planImports(
      draft({
        slots: [slot("dsm", "Elevation DSM/DTM", "elevation", { raster: "elevation" })],
        buckets: [
          bucket({ route: "map", slot_key: "dsm", folder: "E:\\D\\o", files: ["E:\\D\\o\\dsm.tif"] }),
        ],
      }),
    );
    expect(plan.units.map((u) => [u.route, u.path, u.slotKeys])).toEqual([
      ["elevation", "E:\\D\\o\\dsm.tif", ["dsm"]],
    ]);
  });

  it("dispatches a file once across routes: the first bucket wins, a same-route repeat adds its slot", () => {
    const f = "E:\\D\\o\\a.tif";
    const plan = planImports(
      draft({
        slots: [
          slot("ortho", "Orthomosaic", "map"),
          slot("dsm", "Elevation DSM/DTM", "elevation"),
          slot("site", "Site map", "map"),
        ],
        buckets: [
          bucket({ route: "map", slot_key: "ortho", folder: "E:\\D\\o", files: [f] }),
          bucket({ route: "map", slot_key: "dsm", folder: "E:\\D\\o", files: [f.toUpperCase()] }),
          bucket({ route: "map", slot_key: "site", folder: "E:\\D\\o", files: [f] }),
        ],
      }),
    );
    expect(plan.units.map((u) => [u.route, u.slotKeys])).toEqual([["map", ["ortho", "site"]]]);
    expect(plan.labels).toEqual({ ortho: "Orthomosaic", site: "Site map" });
  });

  it("starts one import per file for maps, elevations, point clouds and drawings", () => {
    const plan = planImports(
      draft({
        slots: [
          slot("ortho", "Orthomosaic", "map", { raster: "ortho" }),
          slot("dsm", "Elevation DSM/DTM", "elevation", { raster: "elevation" }),
          slot("cloud", "LiDAR scan", "pointcloud"),
          slot("plans", "Design surface / CAD", "drawing"),
        ],
        buckets: [
          bucket({
            route: "map",
            slot_key: "ortho",
            folder: "E:\\D\\ortho",
            files: ["E:\\D\\ortho\\n.tif", "E:\\D\\ortho\\s.tif"],
          }),
          bucket({
            route: "elevation",
            slot_key: "dsm",
            folder: "E:\\D\\ortho",
            files: ["E:\\D\\ortho\\dsm.tif"],
          }),
          bucket({
            route: "pointcloud",
            slot_key: "cloud",
            folder: "E:\\D\\scan",
            files: ["E:\\D\\scan\\t.laz"],
          }),
          bucket({
            route: "drawing",
            slot_key: "plans",
            folder: "E:\\D\\cad",
            files: ["E:\\D\\cad\\site.dxf"],
          }),
        ],
      }),
    );
    expect(plan.units.map((u) => [u.route, u.path, u.slotKeys])).toEqual([
      ["map", "E:\\D\\ortho\\n.tif", ["ortho"]],
      ["map", "E:\\D\\ortho\\s.tif", ["ortho"]],
      ["elevation", "E:\\D\\ortho\\dsm.tif", ["dsm"]],
      ["pointcloud", "E:\\D\\scan\\t.laz", ["cloud"]],
      ["drawing", "E:\\D\\cad\\site.dxf", ["plans"]],
    ]);
    expect(Object.keys(plan.labels)).toEqual(["ortho", "dsm", "cloud", "plans"]);
  });
});

describe("types for ensure and POST /projects", () => {
  const TYPES = [
    draftType("Corrosion", "1"),
    draftType("Bird nest", "5", { kind: "object" }),
    draftType("corrosion ", null),
  ];

  it("sends ensure only the contract's fields, never the draft's key", () => {
    const specs = typeSpecs(TYPES);
    expect(specs[1]).toEqual({
      name: "Bird nest",
      kind: "object",
      colour: "#ff9c3a",
      default_severity: 2,
      hotkey: "5",
      definition: "Bird nest as seen from the drone.",
      severity_rules: [],
    });
    expect(specs.every((s) => !("key" in s))).toBe(true);
    expect(specs[2].name).toBe("corrosion");
  });

  it("maps ensured ids in order, sends an id once, and keeps the draft's hotkeys", () => {
    const out = projectTypes(TYPES, [
      { name: "Corrosion", id: "t1", created: false, conflict: null },
      { name: "Bird nest", id: "t2", created: true, conflict: null },
      { name: "corrosion", id: "t1", created: false, conflict: null },
    ]);
    expect(out).toEqual({ typeIds: ["t1", "t2"], hotkeys: { t1: "1", t2: "5" } });
  });

  it("refuses an answer of another length or without an id", () => {
    expect(() => projectTypes(TYPES, [])).toThrow("the catalogue answered for 0 of 3 types");
    expect(() =>
      projectTypes(TYPES.slice(0, 1), [{ name: "Corrosion", id: null, created: false, conflict: null }]),
    ).toThrow("the catalogue returned no id for Corrosion");
  });
});
