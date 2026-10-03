/** One in-flight frame. `update` may ask to render again (OrbitControls damping fires `change`
 * from inside `update`); that must extend the hold, not queue a second paint of the same frame. */
export function createOnDemandLoop(o: {
  now(): number;
  requestFrame(cb: () => void): number;
  cancelFrame(id: number): void;
  update(): void;
  render(): void;
  holdMs: number;
}): { request(): void; dispose(): void } {
  let raf = 0;
  let idleUntil = 0;
  let inside = false;
  let dead = false;

  const frame = () => {
    raf = 0;
    if (dead) return;
    inside = true;
    o.update();
    inside = false;
    if (dead) return;
    o.render();
    if (!dead && raf === 0 && o.now() < idleUntil) raf = o.requestFrame(frame);
  };

  return {
    request() {
      if (dead) return;
      idleUntil = o.now() + o.holdMs;
      if (raf === 0 && !inside) raf = o.requestFrame(frame);
    },
    dispose() {
      dead = true;
      if (raf !== 0) {
        o.cancelFrame(raf);
        raf = 0;
      }
    },
  };
}
