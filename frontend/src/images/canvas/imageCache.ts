export type Level = "preview" | "full";
export type Decode = (url: string, signal: AbortSignal) => Promise<ImageBitmap>;

/** Fetch + createImageBitmap: decoding happens off the main thread, and the bitmap can be closed. */
export const defaultDecode: Decode = async (url, signal) => {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`image request failed with ${response.status}`);
  return createImageBitmap(await response.blob());
};

interface Entry {
  key: string;
  level: Level;
  bitmap: ImageBitmap;
  pins: number;
}

/**
 * Decoded frames, least recently used first (spec §9.1, §15: one full frame and four previews).
 * An evicted bitmap is `close()`d at once, which frees its memory without waiting for GC; a pinned
 * one (on screen) is never evicted, and the entry a load has just inserted is never its own victim.
 */
export class BitmapCache {
  private entries = new Map<string, Entry>();
  private inflight = new Map<string, { promise: Promise<ImageBitmap>; abort: AbortController }>();

  constructor(
    private readonly limits: Record<Level, number>,
    private readonly decode: Decode = defaultDecode,
  ) {}

  get(key: string): ImageBitmap | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.bitmap;
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  load(key: string, url: string, level: Level): Promise<ImageBitmap> {
    const hit = this.get(key);
    if (hit) return Promise.resolve(hit);
    const running = this.inflight.get(key);
    if (running) return running.promise;
    const abort = new AbortController();
    const promise = this.decode(url, abort.signal).then(
      (bitmap) => {
        this.inflight.delete(key);
        this.entries.set(key, { key, level, bitmap, pins: 0 });
        this.evict(level, key);
        return bitmap;
      },
      (e: unknown) => {
        this.inflight.delete(key);
        throw e;
      },
    );
    this.inflight.set(key, { promise, abort });
    return promise;
  }

  pin(key: string): void {
    const entry = this.entries.get(key);
    if (entry) entry.pins += 1;
  }

  unpin(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.pins = Math.max(0, entry.pins - 1);
    this.evict(entry.level);
  }

  count(level: Level): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.level === level) n += 1;
    return n;
  }

  clear(): void {
    for (const { abort } of this.inflight.values()) abort.abort();
    this.inflight.clear();
    for (const e of this.entries.values()) e.bitmap.close();
    this.entries.clear();
  }

  private evict(level: Level, keep?: string): void {
    let over = this.count(level) - this.limits[level];
    for (const e of [...this.entries.values()]) {
      if (over <= 0) return;
      if (e.level !== level || e.pins > 0 || e.key === keep) continue;
      this.entries.delete(e.key);
      e.bitmap.close();
      over -= 1;
    }
  }
}

/** The app's cache: the current full frame and four previews. */
export const bitmapCache = new BitmapCache({ preview: 4, full: 1 });
