import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import { GlassPanel, cx, focusRing, stagger, transition } from "@/ui";
import type { SeverityRow } from "./kpis";

/** One bar per level; a click opens the Findings tab filtered to it (F §9.1). */
export function SeverityBars({ rows, bare = false }: { rows: SeverityRow[]; bare?: boolean }) {
  const content = (
    <>
      <h2 className="text-xs text-muted">Open findings by severity</h2>
      <ul className="mt-3 flex flex-col gap-1">
        {rows.map((r, i) => (
          <li key={r.key}>
            <Link
              to={r.href}
              aria-label={`${r.name}: ${r.count} open`}
              className={cx(
                "-mx-1.5 grid grid-cols-[5.5rem_1fr_2rem] items-center gap-2.5 rounded-sm px-1.5 py-1 text-sm text-ink hover:bg-hover",
                transition,
                focusRing,
              )}
            >
              <span className="truncate">{r.name}</span>
              <span className="h-2 overflow-hidden rounded-chip bg-surface-2">
                <span
                  className="ov-bar block h-full rounded-chip bg-[color:var(--c)]"
                  style={
                    {
                      ...stagger(i),
                      "--c": r.colour ?? "rgb(var(--muted))",
                      transform: `scaleX(${r.fraction})`,
                    } as CSSProperties
                  }
                />
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted">{r.count}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
  if (bare) return content;
  return (
    <GlassPanel variant="pane" className="stagger animate-rise px-4 py-3.5" style={stagger(5)}>
      {content}
    </GlassPanel>
  );
}
