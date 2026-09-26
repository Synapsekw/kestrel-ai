import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import type { BulkSet } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { Button, GlassPanel, MenuButton, toast, type SeverityLevel } from "@/ui";
import { applyBulk, bulkMessage } from "./bulk";
import { STATUSES, STATUS_LABEL } from "./status";

/** The bar over a selection (F §8.6): Set status, Set severity, Clear. A pane, never blurred (F7). */
export function BulkBar({
  projectId,
  ids,
  scale,
  onDone,
  onClear,
}: {
  projectId: string;
  ids: readonly string[];
  scale: readonly SeverityLevel[];
  onDone: () => void;
  onClear: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);

  async function apply(set: BulkSet, what: string) {
    setBusy(true);
    try {
      const r = await applyBulk(api, projectId, ids, set);
      toast(r.skipped.length ? "info" : "ok", bulkMessage(r.updated, r.skipped, what));
      onDone();
    } catch (e) {
      toast("danger", messageOf(e, "could not update the findings"));
    } finally {
      // Earlier 1000-id chunks may have been applied even when a later one failed.
      useChangesStore.getState().bumpFindings();
      setBusy(false);
    }
  }

  return (
    <GlassPanel
      variant="pane"
      role="toolbar"
      aria-label="Selected findings"
      aria-busy={busy}
      className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 px-3 py-2 shadow-elev-2"
    >
      <span className="px-1 text-sm font-medium tabular-nums">{ids.length} selected</span>
      <MenuButton
        label="Set status"
        size="sm"
        variant="secondary"
        disabled={busy}
        items={STATUSES.map((s) => ({
          id: s,
          label: STATUS_LABEL[s],
          onSelect: () => void apply({ status: s }, STATUS_LABEL[s]),
        }))}
      />
      <MenuButton
        label="Set severity"
        size="sm"
        variant="secondary"
        disabled={busy}
        items={[
          ...[...scale]
            .sort((a, b) => b.level - a.level)
            .map((l) => ({
              id: String(l.level),
              label: l.name,
              shortcut: String(l.level),
              onSelect: () => void apply({ severity: l.level }, l.name),
            })),
          { id: "none", label: "No severity", onSelect: () => void apply({ severity: null }, "No severity") },
        ]}
      />
      <Button size="sm" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </GlassPanel>
  );
}
