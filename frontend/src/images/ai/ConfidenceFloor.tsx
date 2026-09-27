import { cx, focusRing } from "@/ui";

interface Props {
  /** 0..1; suggestions below it are hidden in the image and in the region list. */
  value: number;
  /** How many unreviewed suggestions the floor hides on this image. */
  hidden: number;
  onChange: (value: number) => void;
  /** One compact row for the hint bar (spec §11.4); the default stacks the slider under the text. */
  inline?: boolean;
}

/** Walk-through item E6: a dense model run is unreadable until the weak suggestions are out of the way. */
export function ConfidenceFloor({ value, hidden, onChange, inline = false }: Props) {
  const percent = Math.round(value * 100);
  return (
    <label
      data-testid="confidence-floor"
      className={cx(
        "flex items-center gap-2 text-sm text-muted",
        inline ? "flex-nowrap" : "flex-wrap justify-between",
      )}
    >
      {inline ? null : "Hide suggestions"}
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
          "h-4 cursor-pointer rounded-full accent-[rgb(var(--accent))]",
          inline ? "w-24" : "order-last w-full",
          focusRing,
        )}
      />
      <span className="tabular-nums">
        {percent === 0 ? "all shown" : `below ${percent}% · ${hidden} hidden`}
      </span>
    </label>
  );
}
