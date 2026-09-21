import kestrelMark from "@/assets/kestrel-mark.svg";
import { cx } from "@/ui";

/** The app mark, with the name available to assistive technology in compact mode. */
export function Brand({
  size = "md",
  compact = false,
  className,
}: {
  size?: "md" | "lg";
  compact?: boolean;
  className?: string;
}) {
  const big = size === "lg";
  const largeTile = big || compact;
  return (
    <span className={cx("inline-flex items-center gap-2.5 font-semibold tracking-tight text-ink", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "grid shrink-0 place-items-center rounded-md bg-accent text-accent-fg",
          largeTile ? "h-9 w-9" : "h-7 w-7",
        )}
      >
        <img
          src={kestrelMark}
          alt=""
          aria-hidden="true"
          className={largeTile ? "h-7 w-7" : "h-[22px] w-[22px]"}
        />
      </span>
      <span className={compact ? "sr-only" : big ? "text-lg" : "text-sm"}>Kestrel AI</span>
    </span>
  );
}
