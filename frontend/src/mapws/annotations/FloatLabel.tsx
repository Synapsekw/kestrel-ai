import { GlassPanel } from "@/ui";

/** The "≈ 48.20 m grid" label next to the cursor while drawing (spec §5.1); `px` from W1's `pixelOf`. */
export function FloatLabel({ px, text }: { px: readonly number[]; text: string }) {
  return (
    <GlassPanel
      variant="float"
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute z-20 whitespace-nowrap px-2 py-1 font-mono text-xs tabular-nums text-glass-ink"
      style={{ left: px[0] + 14, top: px[1] - 30 }}
    >
      {text}
    </GlassPanel>
  );
}
