import { GlassPanel } from "@/ui";

/**
 * The "≈ 48.20 m grid" label next to the cursor while drawing (spec §5.1); `px` from W1's `pixelOf`.
 * The live figure changes on every pointer move, so it is not announced; `announce` is for a settled
 * state such as "Measuring…".
 */
export function FloatLabel({
  px,
  text,
  announce = false,
}: {
  px: readonly number[];
  text: string;
  announce?: boolean;
}) {
  return (
    <GlassPanel
      variant="float"
      role="status"
      aria-live={announce ? "polite" : "off"}
      className="pointer-events-none absolute z-20 whitespace-nowrap px-2 py-1 font-mono text-xs tabular-nums text-glass-ink"
      style={{ left: px[0] + 14, top: px[1] - 30 }}
    >
      {text}
    </GlassPanel>
  );
}
