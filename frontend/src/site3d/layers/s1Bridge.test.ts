import { describe, expect, it, vi } from "vitest";
import { siteToScene } from "@/site3d/engine/siteTransform";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME } from "@/test/siteSceneFixtures";
import { partsOf } from "./s1Bridge";

describe("partsOf", () => {
  it("reaches S1's renderer, scene, camera and canvas and asks S1 for a frame", () => {
    const f = fakeSiteEngine();
    const p = partsOf(f.engine);
    expect(p.renderer).toBe(f.renderer);
    expect(p.scene).toBe(f.scene);
    expect(p.camera).toBe(f.camera);
    expect(p.canvas).toBe(f.canvas);
    p.requestRender();
    expect(f.requestRender).toHaveBeenCalledTimes(1);
  });
});

describe("fakeSiteEngine", () => {
  it("replaces a layer with the same id, detaching the old one first", () => {
    const f = fakeSiteEngine();
    const mk = () => ({
      id: "x",
      label: "x",
      attach: vi.fn(),
      detach: vi.fn(),
      setVisible: vi.fn(),
    });
    const a = mk();
    const b = mk();
    f.engine.addLayer(a);
    f.engine.addLayer(b);
    expect(a.detach).toHaveBeenCalledTimes(1);
    expect(b.attach).toHaveBeenCalledTimes(1);
    expect(f.layers.get("x")).toBe(b);
  });
});

describe("siteToScene (S1), as S2 reads it", () => {
  it("takes a plant EL: the plant origin at the datum is the scene origin", () => {
    const [x, y, z] = siteToScene(FRAME, FRAME.origin_crs[0], FRAME.origin_crs[1], FRAME.datum.el_m);
    expect(Math.abs(x)).toBeLessThan(1e-6);
    expect(Math.abs(y)).toBeLessThan(1e-6);
    expect(Math.abs(z)).toBeLessThan(1e-6);
  });

  it("puts plant north on scene +x: a point 10 m along plant north lands at x = 10", () => {
    const t = (FRAME.plant_north_deg * Math.PI) / 180;
    const [x, y, z] = siteToScene(FRAME, FRAME.origin_crs[0] + 10 * Math.sin(t), FRAME.origin_crs[1] + 10 * Math.cos(t), 100);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(0, 6);
  });
});
