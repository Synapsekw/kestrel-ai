import type { ReactNode } from "react";

/** One Analytics section: a heading, an optional control row, and its body; separated by a rule. */
export function Section({
  title,
  intro,
  controls,
  children,
  testId,
}: {
  title: string;
  intro?: ReactNode;
  controls?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className="border-t border-line pt-6 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {intro && <p className="mt-1 max-w-prose text-sm text-muted">{intro}</p>}
        </div>
        {controls && <div className="flex flex-wrap items-end gap-3">{controls}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
