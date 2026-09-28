import View from "ol/View";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeViewApi, readView } from "./viewApi";

afterEach(() => {
  delete document.documentElement.dataset.motion;
});

describe("the view API under reduced motion (jumps, no animation)", () => {
  it("centres, zooms and resets north at once", () => {
    document.documentElement.dataset.motion = "reduced";
    const view = new View({ center: [0, 0], resolution: 1, rotation: 0.5 });
    const api = makeViewApi(view);
    api.centreOn([100, 200], 0.05);
    expect(view.getCenter()).toEqual([100, 200]);
    expect(view.getResolution()).toBe(0.05);
    api.centreOn([1, 2]);
    expect(view.getResolution()).toBe(0.05);
    const z = view.getZoom()!;
    api.zoomBy(1);
    expect(view.getZoom()).toBeCloseTo(z + 1);
    api.resetNorth();
    expect(view.getRotation()).toBe(0);
    expect(readView(view)).toEqual({
      center: [1, 2],
      resolution: view.getResolution(),
      rotation: 0,
    });
    expect(api.pixelOf([1, 2])).toBeNull(); // no map rendered yet
    expect(api.coordOf([10, 10])).toBeNull();
  });

  it("never zooms out to arrive (R-W1-8)", () => {
    document.documentElement.dataset.motion = "reduced";
    const view = new View({ center: [0, 0], resolution: 0.01 });
    makeViewApi(view).centreOn([5, 5], 0.05);
    expect(view.getResolution()).toBe(0.01);
  });
});

describe("an instant centreOn (the minimap drag)", () => {
  it("sets the centre and resolution at once, cancelling a running animation, with motion on", () => {
    const view = new View({ center: [0, 0], resolution: 1 });
    const api = makeViewApi(view);
    api.centreOn([50, 50]); // starts an animation
    expect(view.getAnimating()).toBe(true);
    const animate = vi.spyOn(view, "animate");
    api.centreOn([100, 200], 0.5, { instant: true });
    expect(animate).not.toHaveBeenCalled();
    expect(view.getAnimating()).toBe(false);
    expect(view.getCenter()).toEqual([100, 200]);
    expect(view.getResolution()).toBe(0.5);
  });
});
