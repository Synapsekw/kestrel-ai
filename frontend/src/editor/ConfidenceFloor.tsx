import { cx, focusRing } from "@/ui";

interface Props {
  /** 0..1; suggestions below it are hidden in the image and in the region list. */
  value: number;
  /** How many unreviewed suggestions the floor hides on this image. */
  hidden: number;
  onChange: (value: number) => void;
}

/** Walk-through item E6: a dense model run is unreadable until the weak suggestions are out of the way. */
export function ConfidenceFloor({ value, hidden, onChange }: Props) {
  const percent = Math.round(value * 100);
  return (
    <label
      data-testid="confidence-floor"
      className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-muted"
    >
      Hide suggestions
      {/* No ui component draws a range; the native slider takes the accent colour. */}
      <input
        type="range"
        min={0}
        max={95}
        step={5}
        value={percent}
        aria-label="Hide suggestions below this confidence"
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className={cx(
          "order-last h-4 w-full cursor-pointer rounded-full accent-[rgb(var(--accent))]",
          focusRing,
        )}
      />
      <span className="tabular-nums">
        {percent === 0 ? "all shown" : `below ${percent}% · ${hidden} hidden`}
      </span>
    </label>
  );
}
