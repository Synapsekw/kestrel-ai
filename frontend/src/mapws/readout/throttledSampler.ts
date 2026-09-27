/** M §13: the readout samples at most once per 150 ms. */
export const SAMPLE_INTERVAL_MS = 150;

export interface Sampler {
  push(x: number, y: number): void;
  cancel(): void;
}

/**
 * Leading and trailing throttle with one request in flight: a new sample aborts the older one and an
 * aborted answer is dropped. A failed sample reports null (the readout shows a dash).
 */
export function createThrottledSampler(opts: {
  intervalMs: number;
  sample: (x: number, y: number, signal: AbortSignal) => Promise<number | null>;
  onResult: (z: number | null) => void;
  now?: () => number;
}): Sampler {
  const now = opts.now ?? (() => Date.now());
  let last = Number.NEGATIVE_INFINITY;
  let pending: [number, number] | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  let dead = false;

  const fire = (x: number, y: number) => {
    last = now();
    inflight?.abort();
    const ctl = new AbortController();
    inflight = ctl;
    opts.sample(x, y, ctl.signal).then(
      (z) => {
        if (!ctl.signal.aborted && !dead) opts.onResult(z);
      },
      () => {
        if (!ctl.signal.aborted && !dead) opts.onResult(null);
      },
    );
  };

  return {
    push(x, y) {
      if (dead) return;
      const wait = last + opts.intervalMs - now();
      if (wait <= 0 && timer === null) {
        fire(x, y);
        return;
      }
      pending = [x, y];
      if (timer === null) {
        timer = setTimeout(
          () => {
            timer = null;
            if (pending && !dead) {
              const [px, py] = pending;
              pending = null;
              fire(px, py);
            }
          },
          Math.max(0, wait),
        );
      }
    },
    cancel() {
      dead = true;
      if (timer !== null) clearTimeout(timer);
      inflight?.abort();
    },
  };
}
