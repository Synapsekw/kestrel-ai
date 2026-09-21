import { Icon, cx } from "@/ui";

/** The app mark: an amber hard hat, with the name available in compact mode. */
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
  return (
    <span className={cx("inline-flex items-center gap-2.5 font-semibold tracking-tight text-ink", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "grid shrink-0 place-items-center rounded-md bg-accent text-accent-fg",
          big || compact ? "h-9 w-9" : "h-7 w-7",
        )}
      >
        <Icon name="hard-hat" size={big ? 22 : 15} className="[stroke-width:2]" />
      </span>
      <span className={compact ? "sr-only" : big ? "text-lg" : "text-sm"}>Kestrel AI</span>
    </span>
  );
}
