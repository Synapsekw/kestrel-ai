import { useEffect, useState } from "react";
import { usePreviewEnv } from "./PreviewContext";

const supported = () => typeof IntersectionObserver !== "undefined";

/**
 * Whether the element is within `rootMargin` of the preview's scroll viewport. Without
 * IntersectionObserver (old jsdom) everything counts as in view. `once` latches the first hit.
 */
export function useInView<T extends Element>(
  rootMargin: string,
  opts: { once?: boolean } = {},
): [(el: T | null) => void, boolean] {
  const { scrollRoot } = usePreviewEnv();
  const once = opts.once ?? false;
  const [el, setEl] = useState<T | null>(null);
  const [inView, setInView] = useState(() => !supported());
  const latched = once && inView;
  useEffect(() => {
    if (!el || !supported() || latched) return;
    const io = new IntersectionObserver(
      (entries) => {
        const mine = entries.filter((e) => e.target === el);
        if (mine.length === 0) return;
        setInView(mine[mine.length - 1].isIntersecting);
      },
      { root: scrollRoot, rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [el, scrollRoot, rootMargin, latched]);
  return [setEl, inView];
}
