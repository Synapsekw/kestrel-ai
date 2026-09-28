import { useMemo, useState } from "react";
import { useApi } from "@/api/client";
import { toast } from "@/ui";
import { completedCoords, useTools, useWorkspace, type ToolOverlayProps } from "@/mapws/annotations/bindings";
import { PointPopover } from "@/mapws/annotations/PointPopover";
import { centroid } from "@/mapws/annotations/planar";
import { ZoneRefusal, createZone, zoneFailure } from "./actions";
import type { ZoneCategory } from "./categories";
import { useZonesStore } from "./store";
import { ZoneForm } from "./ZoneForm";

/** Spec §5.1 `Z`: W1's finished polygon → name and category → a SiteArea (WGS84, project-wide). */
export function ZoneOverlay({ projectId, frame }: ToolOverlayProps) {
  const api = useApi();
  const completed = useTools((s) => (s.completed?.toolId === "zone" ? s.completed : null));
  const clearCompleted = useTools((s) => s.clearCompleted);
  const viewApi = useWorkspace((s) => s.viewApi);
  const select = useWorkspace((s) => s.select);
  const [busy, setBusy] = useState(false);
  const ring = useMemo(() => (completed ? completedCoords(completed.geometry) : null), [completed]);

  async function save(value: { name: string; category: ZoneCategory }) {
    if (!ring || busy) return;
    setBusy(true);
    try {
      const area = await createZone(api, projectId, { ...value, ring, frame });
      useZonesStore.getState().bump(); // the Zones layer re-reads (there is no site-area event)
      select({ kind: "zone", id: area.id }); // W3-10: the tool stays active
      toast("ok", `${area.name} saved — counts update in the background`);
      clearCompleted();
    } catch (e) {
      const refused = e instanceof ZoneRefusal;
      toast(refused ? "info" : "danger", zoneFailure(e)); // W3-16 / T5a
      if (refused) clearCompleted(); // redraw; a server failure keeps the form for a retry
    } finally {
      setBusy(false);
    }
  }

  if (!ring) return null;
  const c = centroid(ring);
  const px = viewApi?.pixelOf([c[0], c[1]]) ?? null;
  if (!px) return null;
  return (
    <PointPopover px={px} label="New zone" onClose={clearCompleted}>
      <ZoneForm busy={busy} onCancel={clearCompleted} onSubmit={(v) => void save(v)} />
    </PointPopover>
  );
}
