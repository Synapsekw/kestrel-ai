import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import {
  JPEG_QUALITY,
  VIEW_MAX_BYTES,
  captureCameraParams,
  encodeView,
  markObjects,
  opaque,
  pinSpriteRgba,
  pinTexture,
  rawColor,
  spriteScale,
  MIN_STEP_MS,
  waitForNodes,
} from "./capture";
import { tokenColor } from "./overlay";

describe("read-back helpers", () => {
  it("forces every alpha opaque, in place", () => {
    const px = new Uint8ClampedArray([255, 0, 0, 10, 0, 255, 0, 0]);
    expect([...opaque(px)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("a raw colour keeps the token's bytes, unlike tokenColor's sRGB decode (plan Ruling 6)", () => {
    const raw = rawColor([21, 27, 25]);
    expect(raw.r).toBeCloseTo(21 / 255, 12);
    expect(raw.g).toBeCloseTo(27 / 255, 12);
    expect(tokenColor([21, 27, 25]).r).toBeLessThan(21 / 255);
  });
});

describe("the finding pin sprite", () => {
  const accent: [number, number, number] = [229, 175, 100];
  const size = 64;
  const px = (rgba: Uint8Array, x: number, y: number) => [
    ...rgba.slice(4 * (y * size + x), 4 * (y * size + x) + 4),
  ];
  it("is the accent colour inside a white ring, transparent outside, never a severity colour", () => {
    const rgba = pinSpriteRgba(size, accent);
    expect(px(rgba, 32, 32)).toEqual([...accent, 255]);
    expect(px(rgba, 32 + 27, 32)).toEqual([255, 255, 255, 255]);
    expect(px(rgba, 0, 0)[3]).toBe(0);
  });

  it("its texture carries raw bytes (no colour space), so the target stores them unchanged", () => {
    const t = pinTexture(accent);
    expect(t.colorSpace).toBe(THREE.NoColorSpace);
    expect(t.image.width).toBe(64);
    t.dispose();
  });

  it("stays the same screen size: scale = px / height · 2·tan(fov/2)", () => {
    expect(spriteScale(28, 1000, 50)).toBeCloseTo((28 / 1000) * 2 * Math.tan((25 * Math.PI) / 180), 12);
  });
});

describe("captureCameraParams", () => {
  it("uses the pose's fov at aspect 1.6 and near/far from the pose distance", () => {
    const p = captureCameraParams(
      { position: [0, -30, 40], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 },
      [0, 0, 0, 100, 100, 10],
    );
    expect(p.fov).toBe(50);
    expect(p.aspect).toBe(1.6);
    expect(p.near).toBeCloseTo(0.05, 12);
    expect(p.far).toBeGreaterThan(1000);
  });
});

describe("waitForNodes", () => {
  it("is complete as soon as nothing is loading", async () => {
    let n = 0;
    const step = vi.fn(() => ({ busy: ++n < 3, loads: [] as Promise<unknown>[] }));
    await expect(waitForNodes(step, 10_000, { now: () => 0, sleep: async () => {} })).resolves.toBe(true);
    expect(step).toHaveBeenCalledTimes(3);
  });

  it("gives up at the timeout and says incomplete", async () => {
    let t = 0;
    const clock = {
      now: () => t,
      sleep: async (ms: number) => {
        t += ms;
      },
    };
    await expect(waitForNodes(() => ({ busy: true, loads: [] }), 1_000, clock)).resolves.toBe(false);
    expect(t).toBeGreaterThanOrEqual(1_000);
  });

  // C-G Task 16: potree-core 2.0.15's OctreeGeometryNode.load() returns undefined, so
  // `nodeLoadPromises` is [undefined, …]; racing those settles at once, and a loop that only awaits
  // microtasks starves the fetches and workers that finish the loads (the chimney spun 33 509 steps
  // in 10 s, then gave up). A node load here finishes on a macrotask, as the real one does.
  it.each([
    ["undefined", () => [undefined]],
    ["already settled", () => [Promise.resolve()]],
  ])("yields to the event loop between steps when the loads are %s", async (_, loads) => {
    let loaded = false;
    setTimeout(() => {
      loaded = true;
    }, 0);
    const step = () => ({ busy: !loaded, loads: loads() as Promise<unknown>[] });
    await expect(waitForNodes(step, 300)).resolves.toBe(true);
  });

  // C-G final review m8: loads that are settled at once made every wait a 0 ms timer, so the frozen
  // capture ran hundreds of updatePointClouds a second; a step now takes at least MIN_STEP_MS.
  it("steps at most once per MIN_STEP_MS when the loads settle at once", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"], loopLimit: 1_000 });
    try {
      let steps = 0;
      const step = () => {
        steps++;
        return { busy: true, loads: [undefined] as unknown as Promise<unknown>[] };
      };
      const done = waitForNodes(step, 80);
      await vi.advanceTimersByTimeAsync(100);
      await expect(done).resolves.toBe(false);
      expect(MIN_STEP_MS).toBeGreaterThanOrEqual(4);
      expect(steps).toBeLessThanOrEqual(80 / MIN_STEP_MS + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the WAIT_STEP_MS timer that lost the race to the loads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    try {
      let n = 0;
      const step = () => ({ busy: ++n < 4, loads: [Promise.resolve()] });
      const done = waitForNodes(step, 10_000);
      await vi.advanceTimersByTimeAsync(3 * MIN_STEP_MS + 1);
      await expect(done).resolves.toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("encodeView", () => {
  const fakeCanvas = (pngBytes: number) => {
    const convertToBlob = vi.fn(async (o: { type: string; quality?: number }) =>
      o.type === "image/png"
        ? new Blob([new Uint8Array(pngBytes)], { type: "image/png" })
        : new Blob(["j"], { type: o.type }),
    );
    const putImageData = vi.fn();
    return { canvas: { getContext: () => ({ putImageData }), convertToBlob }, convertToBlob, putImageData };
  };
  const imageData = (d: Uint8ClampedArray, w: number, h: number) =>
    ({ data: d, width: w, height: h }) as unknown as ImageData;

  it("encodes a PNG", async () => {
    const f = fakeCanvas(100);
    const blob = await encodeView(new Uint8ClampedArray(16), 2, 2, () => f.canvas as never, imageData);
    expect(blob.type).toBe("image/png");
    expect(f.putImageData).toHaveBeenCalled();
  });

  it("re-encodes as JPEG 0.92 when the PNG is over 6 MiB", async () => {
    const f = fakeCanvas(VIEW_MAX_BYTES + 1);
    const blob = await encodeView(new Uint8ClampedArray(16), 2, 2, () => f.canvas as never, imageData);
    expect(blob.type).toBe("image/jpeg");
    expect(f.convertToBlob).toHaveBeenLastCalledWith({ type: "image/jpeg", quality: JPEG_QUALITY });
  });
});

describe("markObjects", () => {
  it("a finding is a screen-constant sprite over everything; a measurement is its overlay geometry", () => {
    const texture = new THREE.Texture();
    const colours = {
      accent: new THREE.Color(1, 0, 0),
      ok: new THREE.Color(0, 1, 0),
      warn: new THREE.Color(0, 0, 1),
    };
    const origin = { x: 100, y: 200, z: 0 };
    const objs = markObjects(
      [
        { kind: "finding", at: [101, 202, 3] },
        {
          kind: "measurement",
          shapes: [
            {
              kind: "line",
              points: [
                { x: 100, y: 200, z: 0 },
                { x: 110, y: 200, z: 0 },
              ],
              tone: "accent",
            },
            { kind: "points", points: [{ x: 105, y: 200, z: 1 }], tone: "ok" },
          ],
        },
      ],
      origin,
      colours,
      texture,
      50,
      1000,
    );
    expect(objs).toHaveLength(3);
    const sprite = objs[0] as THREE.Sprite;
    expect(sprite).toBeInstanceOf(THREE.Sprite);
    expect(sprite.position.toArray()).toEqual([1, 2, 3]);
    expect((sprite.material as THREE.SpriteMaterial).sizeAttenuation).toBe(false);
    expect((sprite.material as THREE.SpriteMaterial).depthTest).toBe(false);
    expect(sprite.scale.y).toBeCloseTo(spriteScale(28, 1000, 50), 12);
    expect(objs[1]).toBeInstanceOf(THREE.Line);
    const line = (objs[1] as THREE.Line).geometry.getAttribute("position");
    expect(line.getX(1)).toBeCloseTo(10, 6);
    expect(objs[2]).toBeInstanceOf(THREE.Points);
    expect(((objs[2] as THREE.Points).material as THREE.PointsMaterial).color.g).toBe(1);
  });
});
