import { groupParts } from "@/assetmodels/groups";
import { EmptyState, cx, focusRing, transition } from "@/ui";

export interface ListedPart {
  id: string;
  name: string;
  group: string;
}

/** The parts, grouped in the spec's group order; a click selects the part in the view and opens it. */
export function PartsTab({
  parts,
  error = null,
  selected,
  onSelect,
}: {
  parts: readonly ListedPart[] | null;
  /** The version could not be loaded, so there is no spec to list from. */
  error?: string | null;
  selected: string | null;
  onSelect(id: string): void;
}) {
  if (parts === null && error)
    return <p className="p-2 text-sm text-muted">The parts could not be loaded.</p>;
  if (parts === null) return <p className="p-2 text-sm text-muted">Loading the parts…</p>;
  if (parts.length === 0)
    return (
      <EmptyState icon="cube" title="No parts yet">
        A version lists its parts here.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-3">
      {groupParts([...parts]).map(([group, items]) => (
        <section key={group} aria-label={group} className="flex flex-col gap-0.5">
          <h3 className="flex items-baseline justify-between px-2 pb-1 text-xs font-medium text-muted">
            {group}
            <span className="font-mono text-2xs tabular-nums text-dim">{items.length}</span>
          </h3>
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-current={p.id === selected ? "true" : undefined}
              onClick={() => onSelect(p.id)}
              className={cx(
                "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                p.id === selected ? "bg-accent-soft text-ink" : "text-ink hover:bg-hover",
                transition,
                focusRing,
              )}
            >
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.id.toLowerCase() !== p.name.toLowerCase() && (
                <span className="shrink-0 font-mono text-2xs text-muted">{p.id}</span>
              )}
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
