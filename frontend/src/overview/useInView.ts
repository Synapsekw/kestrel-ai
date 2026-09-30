import { useCallback, useEffect, useState } from "react";

/**
 * A callback ref plus whether the attached element intersects the viewport; the 3D preview unmounts
 * when scrolled away (spec D5). State-held, so an element that mounts later is observed too.
 */
export function useInView<T extends Element>(): [(el: T | null) => void, boolean] {
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => {
      io.disconnect();
      setInView(false);
    };
  }, [el]);
  return [useCallback((n: T | null) => setEl(n), []), inView];
}
