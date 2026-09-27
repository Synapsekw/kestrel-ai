import { useEffect, useState } from "react";

/** Spec §7.2 / §15: at most 8 thumbnail fetches in flight; a tile that scrolls out aborts its fetch. */
export const THUMB_MAX_IN_FLIGHT = 8;
/** Object URLs kept for scrolling back (256 px JPEGs, ≈ 15 KB each). */
export const THUMB_CACHE_MAX = 400;

type FetchBlob = (url: string, signal: AbortSignal) => Promise<Blob>;

export interface ThumbLoaderDeps {
  fetchBlob?: FetchBlob;
  createUrl?: (blob: Blob) => string;
  revokeUrl?: (url: string) => void;
  maxInFlight?: number;
  cacheMax?: number;
}

interface Job {
  url: string;
  signal: AbortSignal;
  resolve: (src: string) => void;
  reject: (e: unknown) => void;
  onAbort: () => void;
}

/** One fetch per url, shared by every tile that asks for it while it is queued or in flight. */
interface Pending {
  promise: Promise<string>;
  /** Callers still waiting; the fetch is aborted only when the last of them gives up. */
  subscribers: number;
  controller: AbortController;
}

const abortError = () => new DOMException("thumbnail request aborted", "AbortError");

async function defaultFetchBlob(url: string, signal: AbortSignal): Promise<Blob> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`thumbnail answered ${r.status}`);
  return r.blob();
}

export class ThumbLoader {
  private readonly fetchBlob: FetchBlob;
  private readonly createUrl: (blob: Blob) => string;
  private readonly revokeUrl: (url: string) => void;
  private readonly maxInFlight: number;
  private readonly cacheMax: number;
  private readonly queue: Job[] = [];
  private active = 0;
  private readonly cache = new Map<string, string>();
  private readonly pending = new Map<string, Pending>();

  constructor(deps: ThumbLoaderDeps = {}) {
    this.fetchBlob = deps.fetchBlob ?? defaultFetchBlob;
    this.createUrl = deps.createUrl ?? ((b) => URL.createObjectURL(b));
    this.revokeUrl = deps.revokeUrl ?? ((u) => URL.revokeObjectURL(u));
    this.maxInFlight = deps.maxInFlight ?? THUMB_MAX_IN_FLIGHT;
    this.cacheMax = deps.cacheMax ?? THUMB_CACHE_MAX;
  }

  get inFlight(): number {
    return this.active;
  }

  get queued(): number {
    return this.queue.length;
  }

  /** A loaded object URL, without changing the recency order (safe during render). */
  peek(url: string): string | undefined {
    return this.cache.get(url);
  }

  load(url: string, signal: AbortSignal): Promise<string> {
    const hit = this.cache.get(url);
    if (hit) {
      this.cache.delete(url);
      this.cache.set(url, hit);
      return Promise.resolve(hit);
    }
    if (signal.aborted) return Promise.reject(abortError());
    let shared = this.pending.get(url);
    if (!shared) shared = this.start(url);
    const entry = shared;
    entry.subscribers += 1;
    return new Promise<string>((resolve, reject) => {
      let settled = false;
      const onAbort = () => {
        if (settled) return;
        settled = true;
        reject(abortError());
        entry.subscribers -= 1;
        if (entry.subscribers === 0) {
          // Nobody waits any more: a later ask for this url starts afresh rather than joining this.
          if (this.pending.get(url) === entry) this.pending.delete(url);
          entry.controller.abort();
        }
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.promise.then(
        (src) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          resolve(src);
        },
        (e: unknown) => {
          if (settled) return;
          settled = true;
          signal.removeEventListener("abort", onAbort);
          reject(e);
        },
      );
    });
  }

  /** Queues the one fetch of `url`; its own controller aborts it once nobody waits for it. */
  private start(url: string): Pending {
    const controller = new AbortController();
    const signal = controller.signal;
    const promise = new Promise<string>((resolve, reject) => {
      const job: Job = {
        url,
        signal,
        resolve,
        reject,
        onAbort: () => {
          const at = this.queue.indexOf(job);
          if (at >= 0) {
            this.queue.splice(at, 1);
            reject(abortError());
          }
        },
      };
      signal.addEventListener("abort", job.onAbort, { once: true });
      this.queue.push(job);
    });
    const entry: Pending = { promise, subscribers: 0, controller };
    this.pending.set(url, entry);
    const done = () => {
      if (this.pending.get(url) === entry) this.pending.delete(url);
    };
    // Settles once, whichever way; every subscriber sees the outcome through `promise` itself.
    promise.then(done, done);
    this.pump();
    return entry;
  }

  private pump(): void {
    while (this.active < this.maxInFlight && this.queue.length > 0) {
      const job = this.queue.shift()!;
      job.signal.removeEventListener("abort", job.onAbort);
      if (job.signal.aborted) {
        job.reject(abortError());
        continue;
      }
      this.active += 1;
      this.fetchBlob(job.url, job.signal)
        .then((blob) => {
          const src = this.remember(job.url, this.createUrl(blob));
          job.resolve(src);
        })
        .catch((e: unknown) => job.reject(e))
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }

  private remember(url: string, src: string): string {
    // A tile may still show the url already cached for this key: keep it, drop the newcomer.
    const old = this.cache.get(url);
    if (old && old !== src) {
      this.revokeUrl(src);
      src = old;
    }
    this.cache.delete(url);
    this.cache.set(url, src);
    while (this.cache.size > this.cacheMax) {
      const [oldestUrl, oldestSrc] = this.cache.entries().next().value as [string, string];
      this.cache.delete(oldestUrl);
      this.revokeUrl(oldestSrc);
    }
    return src;
  }
}

/** The app's one loader: the grid and the filmstrip share its 8 slots and its cache. */
export const thumbLoader = new ThumbLoader();

/** A tile's thumbnail: loads while mounted, aborts on unmount (scroll-out). */
export function useThumb(
  url: string | null,
  loader: ThumbLoader = thumbLoader,
): { src: string | null; failed: boolean } {
  const cached = url ? loader.peek(url) : undefined;
  const [state, setState] = useState<{ url: string; src: string | null; failed: boolean } | null>(null);

  useEffect(() => {
    if (!url || loader.peek(url)) return;
    const ac = new AbortController();
    loader.load(url, ac.signal).then(
      (src) => setState({ url, src, failed: false }),
      () => {
        if (!ac.signal.aborted) setState({ url, src: null, failed: true });
      },
    );
    return () => ac.abort();
  }, [url, loader]);

  if (cached) return { src: cached, failed: false };
  if (state && state.url === url) return { src: state.src, failed: state.failed };
  return { src: null, failed: false };
}
