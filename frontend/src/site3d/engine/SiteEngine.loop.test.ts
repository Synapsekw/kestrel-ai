import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteLayer } from "../layers/types";
import { SiteEngine } from "./SiteEngine";

vi.mock("three", async (importOriginal) => {
  const actual = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    localClippingEnabled = false;
    toneMapping = 0;
    setPixelRatio(): void {}
    setClearColor(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

let frames: Map<number, FrameRequestCallback>;
let nextId: number;

/** Runs the frames pending now (not those they schedule) at `now`. */
function tick(now: number): void {
  const due = [...frames];
  frames.clear();
  for (const [, cb] of due) cb(now);
}

function layer(id: string, extra: Partial<SiteLayer> = {}): SiteLayer {
  return { id, label: id, attach: () => {}, detach: () => {}, setVisible: () => {}, ...extra };
}

describe("SiteEngine render loop", () => {
  beforeEach(() => {
    frames = new Map();
    nextId = 1;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      const id = nextId++;
      frames.set(id, cb);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a requestRender from inside a frame leaves exactly one pending frame", () => {
    const e = new SiteEngine(document.createElement("canvas"), null);
    e.addLayer(layer("l", { update: () => e.requestRender() }));
    expect(frames.size).toBe(1);
    for (let i = 1; i <= 5; i++) {
      tick(performance.now());
      expect(frames.size).toBe(1);
    }
    e.dispose();
    expect(frames.size).toBe(0);
  });

  it("controls 'change' during a tween does not stack frames", () => {
    const e = new SiteEngine(document.createElement("canvas"), null);
    e.setContentBox("model", new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 20, 50)));
    tick(performance.now());
    e.setPreset("plan"); // a tween: every frame moves the camera, so controls.update() fires "change"
    const t0 = performance.now();
    for (let i = 1; i <= 6; i++) {
      tick(t0 + i * 16);
      expect(frames.size).toBe(1);
    }
    e.dispose();
  });

  it("a failing attach is logged with the layer id and error name only", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new SiteEngine(document.createElement("canvas"), null);
    e.addLayer(
      layer("sync", {
        attach: () => {
          throw new TypeError("secret detail");
        },
      }),
    );
    e.addLayer(layer("async", { attach: () => Promise.reject(new RangeError("secret detail")) }));
    await Promise.resolve();
    await Promise.resolve();
    const logged = err.mock.calls.map((c) => c.join(" "));
    expect(logged.some((s) => s.includes("sync") && s.includes("TypeError"))).toBe(true);
    expect(logged.some((s) => s.includes("async") && s.includes("RangeError"))).toBe(true);
    expect(logged.some((s) => s.includes("secret detail"))).toBe(false);
    e.dispose();
  });

  it("a throwing detach does not abort dispose or removeLayer", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const e = new SiteEngine(document.createElement("canvas"), null);
    const bad = () => {
      throw new Error("boom");
    };
    const other = vi.fn();
    e.addLayer(layer("a", { detach: bad }));
    e.removeLayer("a");
    expect(e.layer("a")).toBeUndefined();
    e.addLayer(layer("b", { detach: bad }));
    e.addLayer(layer("c", { detach: other }));
    expect(() => e.dispose()).not.toThrow();
    expect(other).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(err).toHaveBeenCalled();
  });

  it("setup failing after the renderer exists disposes the renderer and rethrows", () => {
    const dispose = vi.spyOn(THREE.WebGLRenderer.prototype, "dispose");
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor() {
          throw new Error("no observer");
        }
      },
    );
    expect(() => new SiteEngine(document.createElement("canvas"), null)).toThrow("no observer");
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
  });

  it("fly keys with a modifier are not held", () => {
    const e = new SiteEngine(document.createElement("canvas"), null);
    e.setContentBox("model", new THREE.Box3(new THREE.Vector3(-50, 0, -50), new THREE.Vector3(50, 20, 50)));
    e.setNav("fly");
    tick(performance.now());
    const before = e.camera.position.clone();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", ctrlKey: true }));
    const t0 = performance.now() + 2000;
    tick(t0);
    tick(t0 + 50);
    expect(e.camera.position.distanceTo(before)).toBeLessThan(1e-6);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW" })); // control: plain W does fly
    tick(t0 + 100);
    tick(t0 + 150);
    expect(e.camera.position.distanceTo(before)).toBeGreaterThan(0.01);
    e.dispose();
  });

  it("a click another listener already handled (a pin or glyph, R-S3-31) is not a model pick", () => {
    const canvas = document.createElement("canvas");
    // jsdom has no pointer capture; OrbitControls calls it on pointerdown (an uncaught error otherwise)
    Object.assign(canvas, {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    });
    const e = new SiteEngine(canvas, null);
    const picked = vi.fn();
    e.onSelect(picked);
    const handled = (ev: Event) => ev.preventDefault();
    const click = () => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 5, clientY: 5, button: 0 }));
      canvas.dispatchEvent(
        new PointerEvent("pointerup", { clientX: 5, clientY: 5, button: 0, cancelable: true }),
      );
    };
    canvas.addEventListener("pointerup", handled, true);
    click();
    expect(picked).not.toHaveBeenCalled();
    canvas.removeEventListener("pointerup", handled, true);
    click();
    expect(picked).toHaveBeenCalledTimes(1);
    e.dispose();
  });
});
