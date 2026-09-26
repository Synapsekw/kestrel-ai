import { useEffect, useRef, useState } from "react";
import { cubicBezier, dur, easing, useReducedMotion } from "./motion";

const easeOut = cubicBezier(...easing.out);

/**
 * The displayed value of a number counting up to `value` over `duration` (--dur-count): from 0 on
 * first mount, from the shown value when `value` changes, never on a re-render with the same value.
 * Reduced motion and non-finite values show `value` at once. Decorative; it never blocks input.
 */
export function useCountUp(value: number, duration: number = dur.count): number {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(() => (reduced ? value : 0));
  const current = useRef(reduced ? value : 0);

  useEffect(() => {
    if (reduced || !Number.isFinite(value)) {
      current.current = value;
      return;
    }
    const from = current.current;
    let frame = 0;
    if (from === value) {
      // Nothing to animate; only bring the state in line (after a reduced-motion toggle).
      frame = requestAnimationFrame(() => setShown(value));
      return () => cancelAnimationFrame(frame);
    }
    let start: number | null = null;
    const step = (now: number) => {
      if (start === null) start = now;
      const t = duration <= 0 ? 1 : Math.min(1, (now - start) / duration);
      const next = from + (value - from) * easeOut(t);
      current.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration, reduced]);

  return reduced || !Number.isFinite(value) ? value : shown;
}
