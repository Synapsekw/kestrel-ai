import type { ClassDef } from "@contract/client";

interface Props {
  classes: ClassDef[];
  activeClassId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}

export function ClassSidebar({ classes, activeClassId, counts, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Classes</h2>
      {classes.map((c) => {
        const active = c.id === activeClassId;
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(c.id)}
            className={`flex items-center gap-2 rounded px-2 py-1 text-left text-sm ${
              active ? "bg-slate-800 text-white ring-1 ring-orange-500" : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: c.colour }} />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="text-xs text-slate-500">{counts[c.id] ?? 0}</span>
            {c.hotkey && (
              <kbd className="rounded border border-slate-600 px-1 text-[10px] text-slate-300">
                {c.hotkey}
              </kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
