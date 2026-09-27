// frontend/src/clouds/viewer/tween.test.ts
import { describe, expect, it } from "vitest";
import { dur } from "@/ui/motion";
import { VIEW_TWEEN_MS, startTween, tweenAt } from "./tween";

const from = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 10, z: 0 } };
const to = { position: { x: 100, y: 0, z: 50 }, target: { x: 0, y: 10, z: 0 } };

describe("view tween", () => {
  it("lasts the emphasis duration, 350 ms", () => {
    expect(VIEW_TWEEN_MS).toBe(dur.emphasis);
    expect(VIEW_TWEEN_MS).toBe(350);
  });

  it("starts at from, eases out, and lands exactly on to", () => {
    const tw = startTween(from, to, 1000, false);
    expect(tweenAt(tw, 1000)).toEqual({ view: from, done: false });
    const mid = tweenAt(tw, 1000 + VIEW_TWEEN_MS / 2);
    expect(mid.done).toBe(false);
    expect(mid.view.position.x).toBeGreaterThan(50); // ease-out is past halfway at half time
    expect(tweenAt(tw, 1000 + VIEW_TWEEN_MS)).toEqual({ view: to, done: true });
    expect(tweenAt(tw, 99_999)).toEqual({ view: to, done: true });
  });

  it("is done at once under reduced motion", () => {
    const tw = startTween(from, to, 1000, true);
    expect(tw.ms).toBe(0);
    expect(tweenAt(tw, 1000)).toEqual({ view: to, done: true });
  });
});
