import { describe, expect, it } from "vitest";
import { INITIAL_SAM, samReducer, type SamState } from "./session";

const crop = { x: 0, y: 0, w: 512, h: 512 };
const run = (actions: Parameters<typeof samReducer>[1][], s: SamState = INITIAL_SAM) =>
  actions.reduce(samReducer, s);

describe("samReducer", () => {
  it("prepares, takes points, and shows a polygon with its device", () => {
    const s = run([
      { type: "prepare", key: "k" },
      { type: "prepared", key: "k", crop, device: "cpu" },
      { type: "point", point: { x: 10, y: 10, positive: true } },
      {
        type: "segmented",
        seq: 1,
        polygon: [
          [1, 1],
          [5, 1],
          [3, 4],
        ],
        device: "cpu",
      },
    ]);
    expect(s.status).toBe("ready");
    expect(s.device).toBe("cpu");
    expect(s.points).toHaveLength(1);
    expect(s.polygon).toHaveLength(3);
    expect(s.empty).toBe(false);
  });
  it("flags an empty mask", () => {
    const s = run([
      { type: "prepared", key: "k", crop, device: "cuda" },
      { type: "point", point: { x: 1, y: 1, positive: true } },
      { type: "segmented", seq: 1, polygon: null, device: "cuda" },
    ]);
    expect(s.empty).toBe(true);
    expect(s.polygon).toBeNull();
  });
  it("ignores a stale segment answer (older seq) and a prepare for another crop", () => {
    let s = run([
      { type: "prepared", key: "k", crop, device: "cuda" },
      { type: "point", point: { x: 1, y: 1, positive: true } },
      { type: "point", point: { x: 2, y: 2, positive: false } },
    ]);
    expect(s.seq).toBe(2);
    s = samReducer(s, {
      type: "segmented",
      seq: 1,
      polygon: [
        [0, 0],
        [1, 0],
        [0, 1],
      ],
      device: "cuda",
    });
    expect(s.polygon).toBeNull();
    s = samReducer({ ...s, key: "k2" }, { type: "prepared", key: "k", crop, device: "cpu" });
    expect(s.device).toBe("cuda");
  });
  it("marks the model unavailable and clears on cancel", () => {
    let s = run([{ type: "unavailable", state: "missing" }]);
    expect(s.status).toBe("unavailable");
    s = run([
      { type: "prepared", key: "k", crop, device: "cuda" },
      { type: "point", point: { x: 1, y: 1, positive: true } },
      { type: "cancel" },
    ]);
    expect(s.points).toEqual([]);
    expect(s.polygon).toBeNull();
    expect(s.crop).toEqual(crop);
  });
  it("removes the last point", () => {
    const s = run([
      { type: "prepared", key: "k", crop, device: "cuda" },
      { type: "point", point: { x: 1, y: 1, positive: true } },
      { type: "point", point: { x: 2, y: 2, positive: true } },
      { type: "removeLast" },
    ]);
    expect(s.points).toEqual([{ x: 1, y: 1, positive: true }]);
  });
});
