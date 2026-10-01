import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { ReportWarning } from "@/api/reports";
import { Button, Popover, focusRing, cx } from "@/ui";

/** A warning may carry an in-app deep link (R0 `ReportWarning.link`; spec §9.4 "Open this finding in Point clouds"). */
function linkOf(w: ReportWarning): string | null {
  return typeof w.link === "string" && w.link.startsWith("/") ? w.link : null;
}

/** The top bar's warnings chip (spec §8.2 step 5, §12): the count, and the list in a popover. */
export function WarningsChip({ warnings }: { warnings: readonly ReportWarning[] }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (warnings.length === 0) return null;
  const n = warnings.length;
  return (
    <>
      <Button
        ref={anchor}
        size="sm"
        variant="ghost"
        icon="warning"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="text-warn"
      >
        {n === 1 ? "1 warning" : `${n} warnings`}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label="Report warnings"
        align="end"
      >
        <ul className="flex max-w-sm flex-col gap-2 p-1 text-sm text-ink">
          {warnings.map((w, i) => {
            const href = linkOf(w);
            return (
              <li key={i} className="flex flex-col gap-0.5">
                <span>{w.message}</span>
                {href && (
                  <Link to={href} className={cx("self-start text-xs text-accent hover:underline", focusRing)}>
                    Open to fix
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Popover>
    </>
  );
}
