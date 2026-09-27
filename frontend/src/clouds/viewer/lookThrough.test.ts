import { describe, expect, it } from "vitest";
import { captureFovDeg, letterbox, photoFrame, photoToCanvas, type LookPose } from "./lookThrough";

// a DJI-like 4:3 frame: tan(73.7/2) / tan(53.1/2) ≈ 1.4997
const photo: Pick<LookPose, "hfovDeg" | "vfovDeg" | "width" | "height"> = {
  hfovDeg: 73.7,
  vfovDeg: 53.1,
  width: 4000,
  height: 3000,
};
const tan = (deg: number) => Math.tan((deg * Math.PI) / 360);

describe("letterbox", () => {
  it("a wide canvas fits the photo's height and keeps its vertical FOV", () => {
    const lb = letterbox(photo, 1600, 900);
    expect(lb.vfovDeg).toBeCloseTo(53.1, 9);
    expect(lb.k).toBeCloseTo(450 / tan(53.1), 9);
    const f = photoFrame(photo, { left: 0, top: 0, width: 1600, height: 900 }, lb.k);
    expect(f.height).toBeCloseTo(900, 6);
    expect(f.width).toBeLessThan(1600);
    expect(f.left).toBeCloseTo((1600 - f.width) / 2, 6);
  });

  it("a tall canvas fits the photo's width and widens the vertical FOV", () => {
    const lb = letterbox(photo, 600, 1000);
    expect(lb.k).toBeCloseTo(300 / tan(73.7), 9);
    const f = photoFrame(photo, { left: 0, top: 0, width: 600, height: 1000 }, lb.k);
    expect(f.width).toBeCloseTo(600, 6);
    expect(f.top).toBeCloseTo((1000 - f.height) / 2, 6);
    expect(lb.vfovDeg).toBeGreaterThan(53.1);
  });
});

describe("photoToCanvas", () => {
  const rect = { left: 100, top: 50, width: 1600, height: 900 };
  const { k } = letterbox(photo, rect.width, rect.height);
  it("the photo centre is the canvas centre", () => {
    const c = photoToCanvas(photo, rect, k, 2000, 1500);
    expect(c.x).toBeCloseTo(900, 9);
    expect(c.y).toBeCloseTo(500, 9);
  });
  it("is the inverse of the photo-link pixel mapping (spec §10.3)", () => {
    // a direction with tangents (x, y) lands in the photo at px = W/2 + x·(W/2)/tan(h/2),
    // py = H/2 − y·(H/2)/tan(v/2), and on the canvas at centre + (x·k, −y·k)
    const x = 0.3;
    const y = -0.2;
    const px = 2000 + (x * 2000) / tan(73.7);
    const py = 1500 - (y * 1500) / tan(53.1);
    const c = photoToCanvas(photo, rect, k, px, py);
    expect(c.x).toBeCloseTo(900 + x * k, 9);
    expect(c.y).toBeCloseTo(500 - y * k, 9);
  });
});

describe("captureFovDeg (the 1.6 crop of the on-screen camera)", () => {
  it("keeps the vertical FOV when the canvas is at least 1.6 wide", () => {
    expect(captureFovDeg(1.78, 60)).toBe(60);
  });
  it("keeps the horizontal FOV when the canvas is narrower", () => {
    const v = captureFovDeg(1.2, 60);
    expect(tan(v) * 1.6).toBeCloseTo(tan(60) * 1.2, 12);
  });
});
