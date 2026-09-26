import { Link } from "react-router-dom";
import { StatTile, cx, focusRing, stagger } from "@/ui";
import type { Kpi } from "./kpis";

/** Four StatTiles (span 3 each); count-up and sparkline draw come from the DS primitive. */
export function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <>
      {kpis.map((k, i) => {
        const tile = (
          <StatTile
            label={k.label}
            value={k.value}
            unit={k.unit}
            delta={k.delta}
            tone={k.tone}
            spark={k.spark}
            className="h-full"
            chips={
              k.chips?.length
                ? k.chips.map((c) => (
                    <span
                      key={c}
                      className="rounded-chip bg-surface-2 px-2 py-0.5 font-mono text-2xs text-muted"
                    >
                      {c}
                    </span>
                  ))
                : undefined
            }
          />
        );
        return (
          <div
            key={k.id}
            className="stagger animate-rise col-span-12 sm:col-span-6 xl:col-span-3"
            style={stagger(i)}
          >
            {k.href ? (
              <Link to={k.href} className={cx("block h-full rounded-panel", focusRing)}>
                {tile}
              </Link>
            ) : (
              tile
            )}
          </div>
        );
      })}
    </>
  );
}
