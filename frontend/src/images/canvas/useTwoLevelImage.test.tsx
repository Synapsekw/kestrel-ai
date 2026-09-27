import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BitmapCache, type Decode } from "./imageCache";
import { FULL_AFTER_MS, PREVIEW_SIDE, useTwoLevelImage, wantsFull } from "./useTwoLevelImage";

type Pending = { url: string; resolve: (b: ImageBitmap) => void };
let pending: Pending[];
const decode: Decode = (url) =>
  new Promise<ImageBitmap>((resolve) => pending.push({ url, resolve }));
const bmp = (url: string) => ({ url, close: vi.fn() }) as unknown as ImageBitmap;
const url = (id: string, max: number | null) => `/${id}${max ? `?max_side=${max}` : ""}`;
const settle = async (match: string) => {
  const p = pending.find((x) => x.url === match);
  if (!p) throw new Error(`no request for ${match}; have ${pending.map((x) => x.url).join(", ")}`);
  pending = pending.filter((x) => x !== p);
  await act(async () => p.resolve(bmp(match)));
};

beforeEach(() => {
  pending = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("wantsFull", () => {
  it("swaps once scale passes 2048 / long side, or 400 ms after navigation", () => {
    expect(wantsFull(0.3, 4000, 0)).toBe(false);
    expect(wantsFull(PREVIEW_SIDE / 4000 + 0.01, 4000, 0)).toBe(true);
    expect(wantsFull(0.1, 4000, FULL_AFTER_MS)).toBe(true);
    expect(wantsFull(5, 2000, 1000)).toBe(false); // the preview already is the full frame
  });
});

describe("useTwoLevelImage", () => {
  const base = { width: 4000, height: 3000, url };

  it("shows the preview, then the full frame 400 ms after navigation", async () => {
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    const { result } = renderHook(() => useTwoLevelImage({ ...base, imageId: "i1", scale: 0.2, cache }));
    expect(result.current.bitmap).toBeNull();
    await settle("/i1?max_side=2048");
    expect(result.current.level).toBe("preview");
    await act(async () => vi.advanceTimersByTime(FULL_AFTER_MS));
    await settle("/i1");
    expect(result.current.level).toBe("full");
  });

  it("asks for the full frame at once when zoomed past the preview", async () => {
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    renderHook(() => useTwoLevelImage({ ...base, imageId: "i1", scale: 1, cache }));
    expect(pending.map((p) => p.url)).toContain("/i1");
  });

  it("never loads a full frame for an image no larger than the preview", async () => {
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    const { result } = renderHook(() =>
      useTwoLevelImage({ url, width: 2000, height: 1500, imageId: "s", scale: 4, cache }),
    );
    await settle("/s?max_side=2048");
    await act(async () => vi.advanceTimersByTime(1000));
    expect(pending.map((p) => p.url)).not.toContain("/s");
    expect(result.current.level).toBe("full");
  });

  it("a late full decode for a previous image is cached, not shown", async () => {
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    const { result, rerender } = renderHook((p: { id: string }) => useTwoLevelImage({ ...base, imageId: p.id, scale: 1, cache }), {
      initialProps: { id: "i1" },
    });
    rerender({ id: "i2" });
    await settle("/i1");
    expect(result.current.imageId).toBe("i2");
    expect(result.current.bitmap).toBeNull();
    expect(cache.has("i1:full")).toBe(true);
  });

  it("prefetches at most two neighbour previews after the current one", async () => {
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    renderHook(() => useTwoLevelImage({ ...base, imageId: "i1", scale: 0.2, cache, neighbourIds: ["i0", "i2", "i3"] }));
    expect(pending.map((p) => p.url)).toEqual(["/i1?max_side=2048"]);
    await settle("/i1?max_side=2048");
    expect(pending.map((p) => p.url)).toEqual(["/i0?max_side=2048", "/i2?max_side=2048"]);
  });
});
