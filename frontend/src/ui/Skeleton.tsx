import { cx } from "./tokens";

/** A well-coloured placeholder block with a slow shimmer; size it with `className`. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx(
        "rounded-md bg-surface-2 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.6),transparent)] bg-[length:200%_100%] animate-shimmer reduce-motion:animate-none",
        className,
      )}
    />
  );
}

/** Placeholder rows for a table or list while it loads. */
export function SkeletonRows({
  rows = 6,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div role="status" aria-label="Loading" className={cx("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-3">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton key={c} className={cx("h-4", c === 0 ? "w-40" : c === columns - 1 ? "w-16" : "w-24")} />
          ))}
        </div>
      ))}
    </div>
  );
}
