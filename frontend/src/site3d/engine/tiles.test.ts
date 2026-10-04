import { afterEach, describe, expect, it, vi } from "vitest";
import { tileBounds, type SiteExtent } from "@/mapws/view/siteGrid";
import type { SiteFrameT } from "./siteTransform";
import {
  GoneError,
  RETRY_BACKOFF_MS,
  TILE_TIMEOUT_MS,
  MAX_TILE_BYTES,
  TILE_BYTES,
  TileCache,
  childTiles,
  fetchSiteTile,
  makeTexture,
  fillTemplate,
  minZoomFor,
  parentTile,
  rootTiles,
  selectTiles,
  tileQuad,
  tileView,
  type TileFetch,
  type TileImage,
} from "./tiles";

const FRAME: SiteFrameT = {
  crs: { epsg: 32639, wkt: null },
  origin_crs: [500000, 3300000],
  plant_north_deg: 0,
  datum: { label: "EL", el_m: 0 },
};
const B: SiteExtent = [499500, 3299500, 500500, 3300500]; // 1 km around the origin
const inside = (t: { z: number; x: number; y: number }) => {
  const [a, b, c, d] = tileBounds(t);
  return a < B[2] && c > B[0] && b < B[3] && d > B[1];
};
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("tile quadtree", () => {
  it("root tiles cover the bounds at a zoom", () => {
    const roots = rootTiles(B, 8); // span 1024 m
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.length).toBeLessThanOrEqual(4);
    roots.forEach((t) => expect(inside(t)).toBe(true));
  });

  it("children stay inside the bounds and the parent inverts them", () => {
    const kids = childTiles({ z: 8, x: 488, y: -3223 }, B);
    expect(kids).toHaveLength(4);
    for (const k of kids) {
      expect(k.z).toBe(9);
      expect(inside(k)).toBe(true);
      expect(parentTile(k)).toEqual({ z: 8, x: 488, y: -3223 });
    }
    expect(parentTile({ z: 0, x: 1, y: -13 })).toBeNull();
  });

  it("minZoomFor mirrors the backend rule (R7)", () => {
    expect(minZoomFor([0, 0, 120, 60], 17)).toBe(11);
    expect(minZoomFor([0, 0, 3000, 1000], 18)).toBe(6);
    expect(minZoomFor([0, 0, 0.01, 0.01], 12)).toBe(12);
  });

  it("fills a template", () => {
    expect(fillTemplate("/t/{z}/{x}/{y}?v=1", { z: 3, x: -2, y: 7 })).toBe("/t/3/-2/7?v=1");
  });

  it("a far camera keeps the coarse tiles", () => {
    const view = tileView(FRAME, { x: 0, y: 100_000, z: 0 }, 45, 1000, 0);
    const tiles = selectTiles(B, 8, 18, view);
    expect(tiles.every((t) => t.z === 8)).toBe(true);
  });

  it("a near camera refines towards the max zoom, inside the bounds", () => {
    const view = tileView(FRAME, { x: 0, y: 30, z: 0 }, 45, 1000, 0);
    const tiles = selectTiles(B, 8, 18, view);
    expect(Math.max(...tiles.map((t) => t.z))).toBeGreaterThan(12);
    expect(tiles.every((t) => t.z <= 18 && inside(t))).toBe(true);
    expect(tiles.length).toBeLessThanOrEqual(256);
  });

  it("never selects more than the cap (Review Focus 4)", () => {
    const big: SiteExtent = [497000, 3297000, 503000, 3303000];
    const view = tileView(FRAME, { x: 0, y: 2, z: 0 }, 45, 2000, 0);
    expect(selectTiles(big, 6, 20, view, 256).length).toBeLessThanOrEqual(256);
    expect(selectTiles(big, 6, 20, view, 10).length).toBeLessThanOrEqual(10);
  });

  it("budget constants: 256 tiles of 256 KB are 64 MiB", () => {
    expect(TILE_BYTES * 256).toBe(MAX_TILE_BYTES);
    expect(MAX_TILE_BYTES).toBe(64 * 1024 * 1024);
  });
});

describe("tileQuad", () => {
  it("maps the north-west corner to uv (0, 0) in scene x = N, z = E", () => {
    // z 10: span 256 m; the tile holding the origin is x 1953, y -12891 (minx 499968, maxy 3300096)
    const q = tileQuad(FRAME, { z: 10, x: 1953, y: -12891 }, 0.5);
    expect(Array.from(q.positions.slice(0, 3))).toEqual([96, 0.5, -32]);
    expect(Array.from(q.uvs)).toEqual([0, 0, 1, 0, 1, 1, 0, 1]);
    // south-east corner: (500224, 3299840) -> E 224, N -160
    expect(Array.from(q.positions.slice(6, 9))).toEqual([-160, 0.5, 224]);
  });

  it("rotates with plant north", () => {
    const f = { ...FRAME, plant_north_deg: 90 };
    const q = tileQuad(f, { z: 10, x: 1953, y: -12891 }, 0);
    // NW corner (−32 E, 96 N in site terms): with θ = 90°, E = −dy = −96, N = dx = −32
    expect(q.positions[0]).toBeCloseTo(-32, 6);
    expect(q.positions[2]).toBeCloseTo(-96, 6);
  });
});

describe("TileCache", () => {
  const img = (): TileImage => ({ width: 256, height: 256, close: vi.fn() });

  it("loads a tile, then serves its texture", async () => {
    const onChange = vi.fn();
    const cache = new TileCache(async () => img(), onChange);
    cache.beginFrame();
    expect(cache.want("a")).toBeNull();
    cache.endFrame();
    await flush();
    cache.beginFrame();
    expect(cache.want("a")).not.toBeNull();
    expect(cache.peek("a")).not.toBeNull();
    expect(onChange).toHaveBeenCalled();
    expect(cache.bytes()).toBe(TILE_BYTES);
  });

  it("an empty (204) tile holds no texture and no capacity", async () => {
    const cache = new TileCache(
      async () => null,
      () => {},
      1,
    );
    cache.beginFrame();
    cache.want("a");
    await flush();
    cache.want("b");
    expect(cache.live()).toBe(1);
    await flush();
    expect(cache.peek("a")).toBeNull();
  });

  it("cache never holds more than its capacity: it evicts what this frame did not want", async () => {
    const images: TileImage[] = [];
    const cache = new TileCache(
      async () => {
        const i = img();
        images.push(i);
        return i;
      },
      () => {},
      2,
    );
    cache.beginFrame();
    cache.want("a");
    cache.want("b");
    cache.endFrame();
    await flush();
    cache.beginFrame();
    cache.want("a");
    expect(cache.want("c")).toBeNull(); // b, unwanted this frame, is evicted for c
    expect(cache.live()).toBe(2);
    expect(cache.peek("b")).toBeNull();
    expect(images[1].close).toHaveBeenCalled();
    expect(cache.want("d")).toBeNull(); // full of wanted tiles: refused, nothing evicted
    expect(cache.live()).toBe(2);
  });

  it("limits fetches in flight", () => {
    const fetchTile = vi.fn(() => new Promise<TileImage | null>(() => {}));
    const cache = new TileCache(fetchTile, () => {}, 256, 6);
    cache.beginFrame();
    for (let i = 0; i < 10; i++) cache.want(`t${i}`);
    expect(fetchTile).toHaveBeenCalledTimes(6);
  });

  it("a gone layer (404/410) calls back once the fetch fails", async () => {
    const onGone = vi.fn();
    const cache = new TileCache(
      async (u) => Promise.reject(new GoneError(u)),
      () => {},
    );
    cache.beginFrame();
    cache.want("a", onGone);
    await flush();
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it("dispose aborts what is in flight", () => {
    const signals: AbortSignal[] = []; // an array, so TypeScript does not narrow a `let` to null
    const cache = new TileCache(
      (_u, s) => {
        signals.push(s);
        return new Promise(() => {});
      },
      () => {},
    );
    cache.beginFrame();
    cache.want("a");
    cache.dispose();
    expect(signals[0].aborted).toBe(true);
  });
});

describe("TileCache retries (final review fix)", () => {
  const img = (): TileImage => ({ width: 256, height: 256, close: vi.fn() });
  afterEach(() => vi.useRealTimers());

  it("retries a failed tile after the backoff, and wakes the renderer for it", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const fetchTile = vi
      .fn<TileFetch>()
      .mockRejectedValueOnce(new Error("tile answered 500"))
      .mockResolvedValue(img());
    const cache = new TileCache(fetchTile, onChange);
    cache.beginFrame();
    cache.want("a");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTile).toHaveBeenCalledTimes(1);
    cache.beginFrame();
    cache.want("a"); // inside the backoff: no refetch
    expect(fetchTile).toHaveBeenCalledTimes(1);
    onChange.mockClear();
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    expect(onChange).toHaveBeenCalled(); // the renderer is woken to ask again
    cache.beginFrame();
    cache.want("a");
    expect(fetchTile).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(0);
    cache.beginFrame();
    expect(cache.want("a")).not.toBeNull();
  });

  it("a due retry that loses its fetch slot is retried when next wanted", async () => {
    vi.useFakeTimers();
    let release: (v: TileImage) => void = () => {};
    const fetchTile = vi.fn<TileFetch>().mockImplementation((url) => {
      if (url === "b") return new Promise<TileImage>((r) => (release = r));
      return fetchTile.mock.calls.filter(([u]) => u === "a").length === 1
        ? Promise.reject(new Error("tile answered 500"))
        : Promise.resolve(img());
    });
    const cache = new TileCache(fetchTile, () => {}, 8, 1);
    cache.beginFrame();
    cache.want("a");
    await vi.advanceTimersByTimeAsync(0); // a failed, backing off
    cache.beginFrame();
    cache.want("b"); // takes the only fetch slot and never answers
    await vi.advanceTimersByTimeAsync(RETRY_BACKOFF_MS[0]);
    cache.beginFrame();
    cache.want("b");
    cache.want("a"); // due, re-queued, but no slot
    cache.endFrame();
    expect(fetchTile.mock.calls.filter(([u]) => u === "a")).toHaveLength(1);
    cache.beginFrame();
    cache.want("b"); // a is not wanted: it falls back to error
    cache.endFrame();
    release(img());
    await vi.advanceTimersByTimeAsync(0);
    cache.beginFrame();
    cache.want("a");
    expect(fetchTile.mock.calls.filter(([u]) => u === "a")).toHaveLength(2);
  });

  it("gives up after the last backoff", async () => {
    vi.useFakeTimers();
    const fetchTile = vi.fn<TileFetch>().mockRejectedValue(new Error("tile answered 500"));
    const cache = new TileCache(fetchTile, () => {});
    for (let i = 0; i < 10; i++) {
      cache.beginFrame();
      cache.want("a");
      cache.endFrame();
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(fetchTile).toHaveBeenCalledTimes(1 + RETRY_BACKOFF_MS.length);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a gone tile is never retried", async () => {
    vi.useFakeTimers();
    const fetchTile = vi.fn<TileFetch>().mockRejectedValue(new GoneError("a"));
    const cache = new TileCache(fetchTile, () => {});
    for (let i = 0; i < 4; i++) {
      cache.beginFrame();
      cache.want("a");
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(fetchTile).toHaveBeenCalledTimes(1);
  });

  it("dispose cancels a pending retry wake-up", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const cache = new TileCache(async () => Promise.reject(new Error("x")), onChange);
    cache.beginFrame();
    cache.want("a");
    await vi.advanceTimersByTimeAsync(0);
    onChange.mockClear();
    cache.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("fetchSiteTile", () => {
  const stub = (status: number) =>
    vi.fn(async (_u: string, init?: RequestInit) => {
      void init;
      return new Response(status === 200 ? new Blob(["png"]) : null, { status });
    });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("maps 204 to an empty tile, 404/410 to gone, 500 to an error and 200 to a bitmap", async () => {
    const bitmap = { width: 256, height: 256, close: vi.fn() };
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn(async () => bitmap),
    );
    const sig = new AbortController().signal;
    vi.stubGlobal("fetch", stub(204));
    await expect(fetchSiteTile("u", sig)).resolves.toBeNull();
    vi.stubGlobal("fetch", stub(404));
    await expect(fetchSiteTile("u", sig)).rejects.toBeInstanceOf(GoneError);
    vi.stubGlobal("fetch", stub(410));
    await expect(fetchSiteTile("u", sig)).rejects.toBeInstanceOf(GoneError);
    vi.stubGlobal("fetch", stub(500));
    const err = await fetchSiteTile("u", sig).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(GoneError);
    vi.stubGlobal("fetch", stub(200));
    await expect(fetchSiteTile("u", sig)).resolves.toBe(bitmap);
  });

  it("times out a hung fetch, so the cache marks it failed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_u: string, init?: RequestInit) =>
          new Promise((_res, rej) =>
            init?.signal?.addEventListener("abort", () => rej(new Error("aborted"))),
          ),
      ),
    );
    const fetchTile = vi.fn<TileFetch>((u, s) => fetchSiteTile(u, s));
    const cache = new TileCache(fetchTile, () => {}, 256, 1);
    cache.beginFrame();
    cache.want("a");
    cache.want("b");
    expect(fetchTile).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(TILE_TIMEOUT_MS);
    expect(fetchTile).toHaveBeenCalledTimes(2); // the slot freed: "a" failed, "b" started
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });

  it("the caller's abort still cancels the request", async () => {
    let seen: AbortSignal | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init?: RequestInit) => {
        seen = init?.signal ?? undefined;
        return new Promise(() => {});
      }),
    );
    const ac = new AbortController();
    void fetchSiteTile("u", ac.signal);
    ac.abort();
    expect(seen?.aborted).toBe(true);
  });
});

describe("makeTexture", () => {
  it("closes the image once three has uploaded it", () => {
    const image: TileImage = { width: 256, height: 256, close: vi.fn() };
    const t = makeTexture(image);
    expect(image.close).not.toHaveBeenCalled();
    t.onUpdate?.(t);
    expect(image.close).toHaveBeenCalledTimes(1);
  });
});
