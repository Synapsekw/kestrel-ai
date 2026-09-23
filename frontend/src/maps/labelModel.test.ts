import { describe, expect, it, vi } from "vitest";
import { exampleLabel, exampleZone } from "@/test/fixtures";
import { boxFromExtent, LabelHistory, outsideZones, pointInPolygon, type LabelApi } from "./labelModel";

function fakeApi(): LabelApi & { calls: string[] } {
  let n = 0;
  const calls: string[] = [];
  return {
    calls,
    create: vi.fn(async () => {
      calls.push("create");
      return `new-${++n}`;
    }),
    update: vi.fn(async (id: string) => {
      calls.push(`update ${id}`);
    }),
    remove: vi.fn(async (id: string) => {
      calls.push(`remove ${id}`);
    }),
  };
}

const body = { class_id: "c", x: 1, y: 2, w: 3, h: 4 };

describe("label history", () => {
  it("undoes a create by deleting, and redo re-creates under a new id that later steps follow", async () => {
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "create", id: "a", body });
    h.record({ kind: "update", id: "a", before: { x: 1 }, after: { x: 9 } });
    expect(await h.undo(api)).toBe(true); // update back
    expect(await h.undo(api)).toBe(true); // create -> remove
    expect(api.calls).toEqual(["update a", "remove a"]);
    await h.redo(api); // create again -> new-1
    await h.redo(api); // the update now targets new-1
    expect(api.calls.slice(2)).toEqual(["create", "update new-1"]);
    expect(h.canRedo).toBe(false);
  });

  it("undoes a delete by re-creating, and a new edit clears redo", async () => {
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "delete", id: "a", body });
    await h.undo(api);
    expect(api.calls).toEqual(["create"]);
    h.record({ kind: "create", id: "b", body });
    expect(h.canRedo).toBe(false);
    expect(await new LabelHistory().undo(api)).toBe(false);
  });

  it("threads the recreated id through every step of a create -> edit -> delete chain", async () => {
    // Regression for the id-remap bug: the command that triggers a recreate must itself pick up
    // the new id, not just its neighbours, or a later step in the same chain replays a stale id.
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "create", id: "a", body });
    h.record({ kind: "update", id: "a", before: { x: 1 }, after: { x: 9 } });
    h.record({ kind: "delete", id: "a", body });

    expect(await h.undo(api)).toBe(true); // delete -> recreate as new-1
    expect(await h.undo(api)).toBe(true); // update -> targets new-1
    expect(await h.undo(api)).toBe(true); // create -> remove new-1
    expect(api.calls).toEqual(["create", "update new-1", "remove new-1"]);
    expect(h.canUndo).toBe(false);

    expect(await h.redo(api)).toBe(true); // create -> recreate as new-2
    expect(await h.redo(api)).toBe(true); // update -> targets new-2
    expect(await h.redo(api)).toBe(true); // delete -> remove new-2
    expect(api.calls.slice(3)).toEqual(["create", "update new-2", "remove new-2"]);
    expect(h.canRedo).toBe(false);
  });

  it("threads the recreated id through undo x2 / redo x2 of a create -> delete chain", async () => {
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "create", id: "a", body });
    h.record({ kind: "delete", id: "a", body });

    expect(await h.undo(api)).toBe(true); // delete -> recreate as new-1
    expect(await h.undo(api)).toBe(true); // create -> remove new-1
    expect(api.calls).toEqual(["create", "remove new-1"]);

    expect(await h.redo(api)).toBe(true); // create -> recreate as new-2
    expect(await h.redo(api)).toBe(true); // delete -> remove new-2
    expect(api.calls.slice(2)).toEqual(["create", "remove new-2"]);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("keeps a command undoable when its recreate rejects mid-undo", async () => {
    const h = new LabelHistory();
    const api = fakeApi();
    h.record({ kind: "delete", id: "a", body });

    vi.mocked(api.create).mockRejectedValueOnce(new Error("network"));
    await expect(h.undo(api)).rejects.toThrow("network");
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);

    // The command survived the failed attempt under its original id and can still be undone.
    expect(await h.undo(api)).toBe(true);
    expect(api.calls).toEqual(["create"]);
  });
});

describe("zones and boxes", () => {
  it("tests points against polygons", () => {
    expect(
      pointInPolygon(2, 2, [
        [0, 0],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(true);
    expect(
      pointInPolygon(8, 8, [
        [0, 0],
        [10, 0],
        [0, 10],
      ]),
    ).toBe(false);
  });

  it("flags labels whose centre is outside every zone", () => {
    const inside = exampleLabel; // centre (1297.5, 1264) is inside the 1000..6000 x 1000..5000 zone
    const outside = { ...exampleLabel, id: "far", x: 9000, y: 9000 };
    expect(outsideZones([inside, outside], [exampleZone])).toEqual(new Set(["far"]));
    expect(outsideZones([inside], [])).toEqual(new Set([inside.id])); // no zones: nothing counts
  });

  it("turns an OpenLayers extent into a map-pixel box", () => {
    expect(boxFromExtent([10, -40, 50, -20])).toEqual({ x: 10, y: 20, w: 40, h: 20 });
    expect(boxFromExtent([10, -20, 10.2, -20])).toEqual({ x: 10, y: 20, w: 1, h: 1 });
  });
});
