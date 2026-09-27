import { describe, expect, it, vi } from "vitest";
import type { CloudClipBox } from "@contract/client";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { applyClipBox, canClip } from "./clipEngine";
import {
  clipFootprint,
  clipKey,
  defaultClipBox,
  readClip,
  recentreClip,
  resizeClip,
  writeClip,
} from "./clip";

const box: CloudClipBox = { centre: [0, 0, 0], size: [4, 2, 6], yaw_deg: 90, mode: "show_inside" };

function memory(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  };
}

describe("the clip box (spec §7, plan Ruling 4)", () => {
  it("defaults to the cloud's centre, half its XY extent and its full height", () => {
    expect(defaultClipBox([0, 0, -5, 100, 50, 20])).toEqual({
      centre: [50, 25, 7.5],
      size: [50, 25, 27],
      yaw_deg: 0,
      mode: "show_inside",
    });
  });

  it("recentres on a pick and refuses sizes that are not positive", () => {
    expect(recentreClip(box, { x: 1, y: 2, z: 3 }).centre).toEqual([1, 2, 3]);
    expect(resizeClip(box, 0, 10).size).toEqual([10, 2, 6]);
    expect(resizeClip(box, 1, 0).size).toEqual([4, 2, 6]);
    expect(resizeClip(box, 2, Number.NaN).size).toEqual([4, 2, 6]);
  });

  it("turns its footprint counter-clockwise from east (V2 Ruling 3)", () => {
    const f = clipFootprint(box).map(([x, y]) => [Math.round(x * 1e9) / 1e9, Math.round(y * 1e9) / 1e9]);
    expect(f).toEqual([
      [1, -2],
      [1, 2],
      [-1, 2],
      [-1, -2],
    ]);
  });

  it("remembers the box per cloud and survives garbage or blocked storage", () => {
    const s = memory();
    writeClip("c1", box, s);
    expect(readClip("c1", s)).toEqual(box);
    expect(readClip("c2", s)).toBeNull();
    writeClip("c1", null, s);
    expect(readClip("c1", s)).toBeNull();
    s.setItem(clipKey("c3"), "{not json");
    expect(readClip("c3", s)).toBeNull();
    s.setItem(clipKey("c4"), JSON.stringify({ centre: [1, 2], size: [1, 1, 1], yaw_deg: 0, mode: "x" }));
    expect(readClip("c4", s)).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    } as unknown as Storage;
    expect(readClip("c1", blocked)).toBeNull();
    expect(() => writeClip("c1", box, blocked)).not.toThrow();
  });

  it("drives V2's setClipBox when the handle has it, and says so when it does not", () => {
    const setClipBox = vi.fn();
    const withV2 = { setClipBox } as unknown as CloudViewerHandle;
    expect(canClip(withV2)).toBe(true);
    expect(applyClipBox(withV2, box)).toBe(true);
    expect(setClipBox).toHaveBeenCalledWith(
      { centre: [0, 0, 0], size: [4, 2, 6], yawDeg: 90 },
      "show_inside",
    );
    applyClipBox(withV2, null);
    expect(setClipBox).toHaveBeenLastCalledWith(null, "show_inside");
    expect(canClip({} as CloudViewerHandle)).toBe(false);
    expect(applyClipBox(null, box)).toBe(false);
  });
});
