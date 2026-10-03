import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEVERITY_SCALE } from "@/ui/severityScale";
import {
  MAX_PATCH_FETCHES,
  PatchLoader,
  frustumOf,
  placementItems,
  type PatchBuffers,
  type PlacementItem,
  type Sphere,
} from "./placements";

const patch = (id: string, center: [number, number, number]): PlacementItem => ({
  sightingId: id,
  findingId: `f-${id}`,
  kind: "patch",
  center,
  normal: [0, 0, 1],
  size: 1,
  severity: 2,
  colour: "#e2bf2e",
  hasPatch: true,
});
const pin = (id: string, center: [number, number, number]): PlacementItem => ({
  ...patch(id, center),
  kind: "point",
  hasPatch: false,
});

const buffers: PatchBuffers = { mesh: new ArrayBuffer(4), texture: new Blob([]), labels: new ArrayBuffer(4) };

function camera(at: [number, number, number], look: [number, number, number]) {
  const c = new THREE.PerspectiveCamera(40, 1, 0.1, 1000);
  c.position.set(...at);
  c.lookAt(...look);
  return c;
}

function visibleFrom(c: THREE.Camera) {
  const f = frustumOf(c);
  return (s: Sphere) => f.intersectsSphere(new THREE.Sphere(new THREE.Vector3(...s.center), s.radius));
}

/** A fetch whose answers the test releases one by one. */
function deferredFetch() {
  const pending = new Map<string, (b: PatchBuffers) => void>();
  const fetchPatch = vi.fn((id: string) => new Promise<PatchBuffers>((res) => pending.set(id, res)));
  const release = async (id: string) => {
    pending.get(id)?.(buffers);
    pending.delete(id);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { fetchPatch, release };
}

describe("placementItems", () => {
  it("keeps placed sightings, colours them by severity and drops unplaced ones", () => {
    const rows = [
      {
        sighting_id: "s1",
        finding_id: "f1",
        kind: "patch",
        center: [1, 2, 3],
        normal: [0, 0, 1],
        size: 2.5,
        severity: 2,
        has_patch: true,
      },
      {
        sighting_id: "s2",
        finding_id: "f1",
        kind: "point",
        center: [1, 2, 3],
        normal: null,
        size: null,
        severity: null,
        has_patch: false,
      },
      {
        sighting_id: "s3",
        finding_id: "f2",
        kind: "none",
        center: null,
        normal: null,
        size: null,
        severity: 1,
        has_patch: false,
      },
    ];
    const items = placementItems(rows as never, DEFAULT_SEVERITY_SCALE, "#999999");
    expect(items.map((i) => [i.sightingId, i.kind, i.colour, i.size, i.hasPatch])).toEqual([
      ["s1", "patch", "#e2bf2e", 2.5, true],
      ["s2", "point", "#999999", 0, false],
    ]);
  });

  it("reads a missing has_patch as no patch files", () => {
    const rows = [
      { sighting_id: "s1", finding_id: null, kind: "patch", center: [0, 0, 0], normal: [0, 0, 1], size: 1 },
    ];
    expect(placementItems(rows as never, DEFAULT_SEVERITY_SCALE, "#999999")[0].hasPatch).toBe(false);
  });
});

describe("PatchLoader", () => {
  it("loads only visible patch binaries", async () => {
    const { fetchPatch, release } = deferredFetch();
    const onLoaded = vi.fn();
    const loader = new PatchLoader(fetchPatch, onLoaded);
    const items = [patch("front", [0, 0, 0]), patch("behind", [0, 0, 30]), pin("pin", [0, 0, 0])];

    loader.update(items, visibleFrom(camera([0, 0, 10], [0, 0, 0])));
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["front"]); // never the one behind, never a pin
    await release("front");
    expect(onLoaded).toHaveBeenCalledWith("front", buffers);
    expect(loader.has("front")).toBe(true);

    // Turn round: the other patch comes into view and loads; the first is kept, not fetched again.
    loader.update(items, visibleFrom(camera([0, 0, 10], [0, 0, 30])));
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["front", "behind"]);
    loader.update(items, visibleFrom(camera([0, 0, 10], [0, 0, 0])));
    expect(fetchPatch).toHaveBeenCalledTimes(2);
  });

  it("never fetches a patch row that has no patch files", () => {
    const { fetchPatch } = deferredFetch();
    const loader = new PatchLoader(fetchPatch, () => {});
    const bare = { ...patch("bare", [0, 0, 0]), hasPatch: false };
    loader.update([bare, patch("real", [0, 0, 0])], visibleFrom(camera([0, 0, 10], [0, 0, 0])));
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["real"]);
  });

  it("keeps at most six fetches in flight, nearest first, and continues as they land", async () => {
    const { fetchPatch, release } = deferredFetch();
    const loader = new PatchLoader(fetchPatch, () => {});
    const items = Array.from({ length: 10 }, (_, i) => patch(`p${i}`, [0, 0, -i]));
    const cam = camera([0, 0, 10], [0, 0, 0]);
    loader.update(items, visibleFrom(cam), (c) => cam.position.distanceTo(new THREE.Vector3(...c)));
    expect(MAX_PATCH_FETCHES).toBe(6);
    expect(fetchPatch.mock.calls.map((c) => c[0])).toEqual(["p0", "p1", "p2", "p3", "p4", "p5"]);
    expect(loader.inFlight).toBe(6);
    await release("p0");
    expect(fetchPatch.mock.calls.map((c) => c[0])).toContain("p6");
    expect(loader.inFlight).toBe(6);
  });

  it("does not retry a failed patch in a loop, and stops after dispose", async () => {
    const fetchPatch = vi.fn(() => Promise.reject(new Error("404")));
    const loader = new PatchLoader(fetchPatch, () => {});
    const items = [patch("gone", [0, 0, 0])];
    const vis = visibleFrom(camera([0, 0, 10], [0, 0, 0]));
    loader.update(items, vis);
    await Promise.resolve();
    await Promise.resolve();
    loader.update(items, vis);
    expect(fetchPatch).toHaveBeenCalledTimes(1);
    loader.dispose();
    loader.update([patch("new", [0, 0, 0])], vis);
    expect(fetchPatch).toHaveBeenCalledTimes(1);
  });
});
