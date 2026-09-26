import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "@/ui/toastStore";
import {
  applyEffects,
  isSoftwareRenderer,
  measureFrames,
  p95,
  readEffectsChoice,
  resetAutoProbe,
  resolveEffects,
  runAutoProbe,
  setEffectsChoice,
} from "./effects";

const frames = (ms: number, n = 100) => Array.from({ length: n }, () => ms);

beforeEach(() => {
  // jsdom has no WebGL; without the stub it prints "Not implemented: HTMLCanvasElement.getContext".
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

afterEach(() => {
  localStorage.clear();
  delete document.documentElement.dataset.effects;
  resetAutoProbe();
  useToastStore.getState().clear();
  vi.restoreAllMocks();
});

describe("resolveEffects", () => {
  it("keeps an explicit choice", () => {
    expect(resolveEffects("full", "reduced", "SwiftShader")).toBe("full");
    expect(resolveEffects("reduced", null, null)).toBe("reduced");
  });

  it("starts Auto reduced on a software renderer and full otherwise", () => {
    expect(resolveEffects("auto", null, "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))")).toBe(
      "reduced",
    );
    expect(resolveEffects("auto", null, "ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11)")).toBe(
      "reduced",
    );
    expect(resolveEffects("auto", null, "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11)")).toBe("full");
    expect(resolveEffects("auto", null, null)).toBe("full");
  });

  it("remembers Auto's probe outcome", () => {
    expect(resolveEffects("auto", "reduced", "NVIDIA")).toBe("reduced");
    expect(isSoftwareRenderer("swiftshader")).toBe(true);
    expect(isSoftwareRenderer(null)).toBe(false);
  });
});

describe("the saved choice", () => {
  it("defaults to Auto and marks <html>", () => {
    expect(readEffectsChoice()).toBe("auto");
    expect(applyEffects()).toBe("full");
    expect(document.documentElement.dataset.effects).toBe("full");
  });

  it("applies and stores an explicit choice", () => {
    setEffectsChoice("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(localStorage.getItem("kestrel.effects")).toBe("reduced");
  });

  it("survives blocked storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readEffectsChoice()).toBe("auto");
    expect(() => setEffectsChoice("full")).not.toThrow();
  });
});

describe("the frame probe", () => {
  it("takes the 95th percentile", () => {
    expect(p95(Array.from({ length: 100 }, (_, i) => i + 1))).toBe(95);
    expect(p95([])).toBe(0);
  });

  it("measures frame gaps after the warm-up", async () => {
    let now = 0;
    const raf = (cb: (t: number) => void) => {
      now += 20;
      queueMicrotask(() => cb(now));
    };
    expect(await measureFrames(100, raf, 40)).toEqual([20, 20, 20, 20, 20]);
  });

  it("switches Auto to reduced once, remembers it, and Undo chooses Full for good", async () => {
    applyEffects();
    expect(await runAutoProbe(async () => frames(30))).toBe("reduced");
    expect(document.documentElement.dataset.effects).toBe("reduced");
    expect(localStorage.getItem("kestrel.effects.auto")).toBe("reduced");
    const [shown] = useToastStore.getState().toasts;
    expect(shown.text).toBe("Visual effects reduced for smoother performance");
    expect(shown.action?.label).toBe("Undo");
    shown.action!.onClick();
    expect(document.documentElement.dataset.effects).toBe("full");
    expect(readEffectsChoice()).toBe("full");
    resetAutoProbe();
    const measure = vi.fn(async () => frames(30));
    expect(await runAutoProbe(measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });

  it("keeps full effects under the budget and probes only once per session", async () => {
    applyEffects();
    expect(await runAutoProbe(async () => frames(16))).toBe("full");
    expect(await runAutoProbe(async () => frames(40))).toBeNull();
    expect(document.documentElement.dataset.effects).toBe("full");
  });

  it("makes no decision while the window is hidden", async () => {
    applyEffects();
    const visibility = vi.spyOn(Document.prototype, "visibilityState", "get").mockReturnValue("hidden");
    const measure = vi.fn(async () => frames(200));
    expect(await runAutoProbe(measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    expect(await runAutoProbe(async () => frames(16))).toBe("full");
  });

  it("makes no decision when the window is hidden and restored mid-probe, and may probe again later", async () => {
    applyEffects();
    const visibility = vi.spyOn(Document.prototype, "visibilityState", "get").mockReturnValue("visible");
    let now = 0;
    let count = 0;
    const raf = (cb: (t: number) => void) => {
      count += 1;
      if (count === 5) {
        // Minimised: rAF pauses, then the window comes back 10 s later.
        visibility.mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        visibility.mockReturnValue("visible");
        document.dispatchEvent(new Event("visibilitychange"));
        now += 10_000;
      } else now += 16;
      queueMicrotask(() => cb(now));
    };
    expect(await runAutoProbe(() => measureFrames(200, raf, 0))).toBeNull();
    expect(document.documentElement.dataset.effects).toBe("full");
    expect(localStorage.getItem("kestrel.effects.auto")).toBeNull();
    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(await runAutoProbe(async () => frames(16))).toBe("full");
  });

  it("drops frame gaps long enough to be a paused window, not a slow frame", async () => {
    let now = 0;
    let count = 0;
    const raf = (cb: (t: number) => void) => {
      count += 1;
      now += count === 3 ? 5_000 : 20;
      queueMicrotask(() => cb(now));
    };
    expect(await measureFrames(5_100, raf, 0)).toEqual([20, 20, 20, 20, 20]);
  });

  it("never probes when the operator chose a mode", async () => {
    setEffectsChoice("full");
    const measure = vi.fn(async () => frames(40));
    expect(await runAutoProbe(measure)).toBeNull();
    expect(measure).not.toHaveBeenCalled();
  });
});
