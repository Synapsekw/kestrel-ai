import { useId, type ReactNode } from "react";
import { GlassPanel } from "@/ui";

/** One numbered card of the setup page (layout A); the region is named by its title. */
export function SetupCard({
  n,
  title,
  aside,
  children,
}: {
  n: number;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <GlassPanel as="section" aria-labelledby={headingId} className="flex min-w-0 flex-col gap-4 p-5">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-chip bg-accent-soft text-xs font-semibold tabular-nums text-accent-ink"
        >
          {n}
        </span>
        <h2 id={headingId} className="text-lg text-ink">
          {title}
        </h2>
        {aside && <p className="text-xs text-muted">{aside}</p>}
      </header>
      {children}
    </GlassPanel>
  );
}
