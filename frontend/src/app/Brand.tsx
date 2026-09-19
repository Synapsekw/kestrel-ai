import { Icon, cx } from "@/ui";

/** The app mark: an orange square with a hard hat, and the name. */
export function Brand({ size = "md", className }: { size?: "md" | "lg"; className?: string }) {
  const big = size === "lg";
  return (
    <span className={cx("inline-flex items-center gap-2.5 font-semibold tracking-tight text-ink", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "grid shrink-0 place-items-center rounded-md bg-accent text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]",
          big ? "h-9 w-9" : "h-6 w-6",
        )}
      >
        <Icon name="hard-hat" size={big ? 22 : 15} className="[stroke-width:2]" />
      </span>
      <span className={big ? "text-lg" : "text-sm"}>Machinery</span>
    </span>
  );
}
