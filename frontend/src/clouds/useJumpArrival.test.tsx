import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { exampleCloud } from "@/test/cloudFixtures";
import type { CloudPick, CloudViewerHandle } from "./CloudViewer";
import { useJumpArrival } from "./useJumpArrival";
import { jumpDistance } from "./viewer/camera";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/ui", () => ({ toast }));

const AT = { x: 243550, y: 3178050 };
// z from 0 to 100, p50 50: the pin runs 0..100 and every screen row maps back to one z
const cloud = {
  ...exampleCloud,
  status: "ready" as const,
  bounds_native: [243500, 3178000, 0, 243600, 3178100, 100],
  z_stats: { ...exampleCloud.z_stats!, p50: 50 },
};
const FP = "&fp=243545,3178055;243555,3178055;243555,3178045;243545,3178045";
const D = jumpDistance(Math.hypot(10, 10));

/** A fake viewer: `project` puts z on the screen's y axis (y = 1000 - 10 z); `hitFor(z)` answers a pick there. */
function fakeViewer(hitFor: (z: number) => CloudPick | null) {
  const v = {
    stats: vi.fn(() => ({ numVisiblePoints: 100, nodesLoading: 0 })),
    lookAt: vi.fn(),
    setOverlay: vi.fn(),
    project: vi.fn((p: { x: number; y: number; z: number }) => ({ x: 400, y: 1000 - 10 * p.z })),
    pickAtClient: vi.fn((_x: number, y: number) => hitFor((1000 - y) / 10)),
  };
  const ref = { current: v as unknown as CloudViewerHandle } as RefObject<CloudViewerHandle | null>;
  return { v, ref };
}

const hit = (dx: number, z: number): CloudPick => ({
  x: AT.x + dx,
  y: AT.y,
  z,
  level: 3,
  uncertainty_m: 0.1,
});
const footprintCalls = (v: ReturnType<typeof fakeViewer>["v"]) =>
  v.setOverlay.mock.calls.filter(([key]) => key === "footprint");

function arrive(ref: RefObject<CloudViewerHandle | null>, search: string) {
  const r = renderHook(({ s }) => useJumpArrival(ref, cloud, s), { initialProps: { s: search } });
  act(() => void vi.advanceTimersByTime(3000));
  return r;
}

describe("useJumpArrival", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("a hit within 2 m retargets Z and draws the footprint there", () => {
    const { v, ref } = fakeViewer((z) => hit(0.5, z));
    arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    expect(v.lookAt).toHaveBeenCalledWith({ x: AT.x, y: AT.y, z: 50 }, D);
    expect(v.setOverlay).toHaveBeenCalledWith("pin", expect.any(Array));
    const z = (v.lookAt.mock.calls.at(-1)![0] as { z: number }).z;
    expect(v.lookAt).toHaveBeenCalledTimes(2);
    const fp = footprintCalls(v);
    expect(fp).toHaveLength(1);
    const shape = fp[0][1][0] as { points: { z: number }[]; closed: boolean };
    expect(shape.closed).toBe(true);
    expect(shape.points).toHaveLength(4);
    for (const p of shape.points) expect(p.z).toBe(z);
  });

  it("a hit further than 2 m draws no footprint", () => {
    const { v, ref } = fakeViewer((z) => hit(5, z));
    arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    expect(v.lookAt).toHaveBeenCalledTimes(1);
    expect(footprintCalls(v)).toHaveLength(0);
  });

  it("no hit anywhere draws no footprint, after a bounded number of picks", () => {
    const { v, ref } = fakeViewer(() => null);
    arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    expect(footprintCalls(v)).toHaveLength(0);
    const picks = v.pickAtClient.mock.calls.length;
    expect(picks).toBeGreaterThan(0);
    act(() => void vi.advanceTimersByTime(60_000));
    expect(v.pickAtClient.mock.calls.length).toBe(picks); // it gave up
  });

  it("a spot outside the cloud says so and does not move the camera", () => {
    const { v, ref } = fakeViewer((z) => hit(0, z));
    arrive(ref, "?at=100,200");
    expect(toast).toHaveBeenCalledWith("info", "This spot is outside the cloud");
    expect(v.lookAt).not.toHaveBeenCalled();
  });

  it("runs once per navigation: a re-render with the same search does nothing more", () => {
    const { v, ref } = fakeViewer((z) => hit(0.5, z));
    const r = arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    const calls = v.lookAt.mock.calls.length;
    r.rerender({ s: `?at=${AT.x},${AT.y}${FP}` });
    act(() => void vi.advanceTimersByTime(3000));
    expect(v.lookAt.mock.calls.length).toBe(calls);
  });

  it("searches along the pin: a surface far above p50 is still found", () => {
    // Only screen rows for z ≥ 85 land near the spot (a chimney top); the p50 row lands 20 m away.
    const { v, ref } = fakeViewer((z) => (z >= 85 ? hit(0.3, 90) : hit(20, 0)));
    arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    expect(v.lookAt).toHaveBeenLastCalledWith({ x: AT.x, y: AT.y, z: 90 }, D);
    expect(footprintCalls(v)).toHaveLength(1);
  });

  it("keeps the nearest hit of all the samples", () => {
    const { v, ref } = fakeViewer((z) => hit(Math.abs(z - 30) / 10, z));
    arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    const z = (v.lookAt.mock.calls.at(-1)![0] as { z: number }).z;
    expect(Math.abs(z - 30)).toBeLessThan(10); // the sample nearest z = 30, not p50 or the top
  });

  it("waits for two settled ticks: a stale idle tick right after lookAt does not pick", () => {
    // tick 1 places; tick 2 idle (stale); tick 3 loading; ticks 4, 5 idle -> the pick is on tick 5
    const seq = [0, 0, 1, 0, 0];
    let tick = 0;
    const { v, ref } = fakeViewer((z) => hit(0.2, z));
    v.stats.mockImplementation(() => ({ numVisiblePoints: 100, nodesLoading: seq[Math.min(tick++, 4)] }));
    renderHook(() => useJumpArrival(ref, cloud, `?at=${AT.x},${AT.y}${FP}`));
    act(() => void vi.advanceTimersByTime(400)); // 4 ticks
    expect(v.pickAtClient).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(100));
    expect(v.pickAtClient).toHaveBeenCalled();
    expect(footprintCalls(v)).toHaveLength(1);
  });

  it("retries a pick that finds nothing before giving up", () => {
    let round = 0;
    const { v, ref } = fakeViewer((z) => (round < 2 ? null : hit(0.2, z)));
    v.project.mockImplementation((p) => {
      if (p.z === 100) round += 1; // the first sample of each round is the pin's top
      return { x: 400, y: 1000 - 10 * p.z };
    });
    arrive(ref, `?at=${AT.x},${AT.y}${FP}`);
    expect(footprintCalls(v)).toHaveLength(1);
  });
});
