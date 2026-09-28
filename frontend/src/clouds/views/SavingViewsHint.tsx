/* eslint-disable react-refresh/only-export-components -- the hint and its Findings-menu item read the same store */
import { Button, Progress, type MenuItem } from "@/ui";
import { useViewStore } from "./viewStore";

/** Capture missing views' progress in the hint bar (spec §11.3, §13): "Saving views 12 / 40" · bar · Cancel. */
export function SavingViewsHint() {
  const bulk = useViewStore((s) => s.bulk);
  const cancel = useViewStore((s) => s.actions?.cancelMissing ?? null);
  if (!bulk) return null;
  const listing = bulk.total === 0;
  return (
    <div className="flex items-center gap-3 text-xs text-ink">
      <span className="tabular-nums">
        {listing ? "Looking for missing views…" : `Saving views ${bulk.done} / ${bulk.total}`}
      </span>
      <Progress
        thin
        value={listing ? undefined : bulk.done / bulk.total}
        label="Saving report views"
        className="w-32"
      />
      <Button size="sm" variant="ghost" onClick={() => cancel?.()}>
        Cancel
      </Button>
    </div>
  );
}

/** The Findings-tab menu action (spec §11.3). */
export function useCaptureMissingItem(): MenuItem {
  const ready = useViewStore((s) => s.ready);
  const running = useViewStore((s) => s.bulk !== null);
  const run = useViewStore((s) => s.actions?.captureMissing ?? null);
  return {
    id: "capture-missing-views",
    label: "Capture missing views",
    icon: "refresh",
    disabled: !ready || running || run === null,
    onSelect: () => run?.(),
  };
}
