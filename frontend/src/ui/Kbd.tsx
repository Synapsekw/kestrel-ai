import type { ReactNode } from "react";
import { cx } from "./tokens";

/** A key cap (mockup kbd): mono, a 2px bottom edge. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] border border-b-2 border-line-strong bg-hover px-1 font-mono text-2xs text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
