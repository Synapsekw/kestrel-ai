import { useEffect, useState } from "react";

export const WIDE_QUERY = "(min-width: 1100px)";

const media = () => (typeof window.matchMedia === "function" ? window.matchMedia(WIDE_QUERY) : null);

/** Spec §8: from 1100 px the summary is a sticky card, below it a bottom bar. True where matchMedia is missing. */
export function useWide(): boolean {
  const [wide, setWide] = useState(() => media()?.matches ?? true);
  useEffect(() => {
    const mq = media();
    if (!mq) return;
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return wide;
}
