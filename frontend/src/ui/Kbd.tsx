import type { ReactNode } from "react";
import { cx } from "./tokens";

/** A key cap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-line-strong bg-panel px-1 font-sans text-[11px] font-medium text-muted shadow-[0_1px_0_rgb(var(--line-strong))]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
