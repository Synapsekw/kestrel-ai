import { useCallback, useEffect, useState } from "react";

/**
 * A callback ref plus whether the attached element intersects the viewport; the 3D preview unmounts
 * when scrolled away (spec D5). State-held, so an element that mounts later is observed too. `null`
 * until the observer's first callback, so a caller can hold a placeholder instead of guessing; without
 * IntersectionObserver the element counts as in view.
 */
export function useInView<T extends Element>(): [(el: T | null) => void, boolean | null] {
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState<boolean | null>(null);
  const observable = typeof IntersectionObserver !== "undefined";
  useEffect(() => {
    if (!el || !observable) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      setInView(null);
    };
  }, [el, observable]);
  return [useCallback((n: T | null) => setEl(n), []), observable ? inView : true];
}
