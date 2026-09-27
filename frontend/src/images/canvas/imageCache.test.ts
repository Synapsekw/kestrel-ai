import { describe, expect, it, vi } from "vitest";
import { BitmapCache, type Decode } from "./imageCache";

const bitmap = (name: string) =>
  ({ name, close: vi.fn(), width: 10, height: 10 }) as unknown as ImageBitmap & {
    close: ReturnType<typeof vi.fn>;
  };

function decoder() {
  const made = new Map<string, ReturnType<typeof bitmap>>();
  const decode: Decode = vi.fn(async (url: string) => {
    const b = bitmap(url);
    made.set(url, b);
    return b;
  });
  return { decode, made };
}

describe("BitmapCache", () => {
  it("dedupes a load that is already in flight and hits afterwards", async () => {
    const { decode } = decoder();
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    const [a, b] = await Promise.all([
      cache.load("i1:preview", "u1", "preview"),
      cache.load("i1:preview", "u1", "preview"),
    ]);
    expect(a).toBe(b);
    await cache.load("i1:preview", "u1", "preview");
    expect(decode).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently used preview beyond four and closes it", async () => {
    const { decode, made } = decoder();
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    for (const i of [1, 2, 3, 4]) await cache.load(`i${i}:preview`, `u${i}`, "preview");
    cache.get("i1:preview"); // touch: i2 is now the oldest
    await cache.load("i5:preview", "u5", "preview");
    expect(cache.has("i2:preview")).toBe(false);
    expect(made.get("u2")!.close).toHaveBeenCalledOnce();
    expect(cache.count("preview")).toBe(4);
  });

  it("never closes a pinned bitmap, and closes it once unpinned and over budget", async () => {
    const { decode, made } = decoder();
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    await cache.load("i1:full", "f1", "full");
    cache.pin("i1:full");
    await cache.load("i2:full", "f2", "full");
    expect(made.get("f1")!.close).not.toHaveBeenCalled();
    expect(made.get("f2")!.close).not.toHaveBeenCalled(); // the one just loaded is never evicted
    cache.unpin("i1:full");
    expect(made.get("f1")!.close).toHaveBeenCalledOnce();
    expect(cache.has("i2:full")).toBe(true);
  });

  it("closes everything on clear", async () => {
    const { decode, made } = decoder();
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    await cache.load("i1:preview", "u1", "preview");
    cache.clear();
    expect(made.get("u1")!.close).toHaveBeenCalledOnce();
    expect(cache.count("preview")).toBe(0);
  });

  it("forgets a failed load so it can be retried", async () => {
    let fail = true;
    const decode: Decode = async () => {
      if (fail) {
        fail = false;
        throw new Error("503");
      }
      return bitmap("ok");
    };
    const cache = new BitmapCache({ preview: 4, full: 1 }, decode);
    await expect(cache.load("k", "u", "preview")).rejects.toThrow("503");
    await expect(cache.load("k", "u", "preview")).resolves.toBeTruthy();
  });
});
