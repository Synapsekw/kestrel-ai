// frontend/src/clouds/viewer/frameRing.ts
import { MAX_FRAME_GAP_MS } from "@/app/effects";

/** `frameTimes()` keeps this many (spec §7 "Diagnostics hook"). */
export const FRAME_RING_SIZE = 600;

/** A fixed ring of frame durations in ms: no allocation per frame. */
export class FrameRing {
  private readonly buf: Float64Array;
  private next = 0;
  private count = 0;

  constructor(readonly capacity = FRAME_RING_SIZE) {
    this.buf = new Float64Array(capacity);
  }

  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.buf[this.next] = ms;
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  /** A copy, oldest first. */
  values(): number[] {
    const out = new Array<number>(this.count);
    const start = (this.next - this.count + this.capacity) % this.capacity;
    for (let i = 0; i < this.count; i++) out[i] = this.buf[(start + i) % this.capacity];
    return out;
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }
}

/**
 * The frame time a tick records (plan Ruling 8): the gap since the previous tick when this tick was
 * scheduled by it (`chained`), else nothing; a gap above `maxGapMs` is a paused window, not a frame.
 */
export function frameInterval(
  prevTickAt: number | null,
  now: number,
  chained: boolean,
  maxGapMs = MAX_FRAME_GAP_MS,
): number | null {
  if (prevTickAt === null || !chained) return null;
  const gap = now - prevTickAt;
  return gap >= 0 && gap <= maxGapMs ? gap : null;
}
