import type { ClassDef } from "@contract/client";
import { Button, Kbd, cx } from "@/ui";

interface Props {
  classes: ClassDef[];
  activeClassId: string | null;
  counts: Record<string, number>;
  onSelect: (id: string) => void;
}

export function ClassSidebar({ classes, activeClassId, counts, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="px-2 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Classes
      </h2>
      {classes.map((c) => {
        const active = c.id === activeClassId;
        return (
          <Button
            key={c.id}
            variant="ghost"
            aria-pressed={active}
            onClick={() => onSelect(c.id)}
            // A class hotkey changes the active row: no transition, so nothing moves on a key press.
            className={cx(
              "!h-8 w-full !justify-start !gap-2 !px-2 text-left !text-[13px] !font-normal !transition-none",
              active && "!border-accent !bg-surface",
            )}
          >
            <span
              aria-hidden="true"
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: c.colour }}
            />
            <span className="min-w-0 flex-1 truncate">{c.name}</span>
            <span className="tabular-nums text-muted">{counts[c.id] ?? 0}</span>
            {c.hotkey && <Kbd>{c.hotkey}</Kbd>}
          </Button>
        );
      })}
    </div>
  );
}
