import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { Skeleton } from "@/ui";
import {
  sampleInFrame,
  useGoneLayers,
  useSiteLayers,
  useWorkspace,
  type Selection,
  type SiteFrame,
} from "@/mapws/annotations/bindings";
import { formatArea, formatHeight } from "@/mapws/annotations/format";
import { pickDsm } from "@/mapws/annotations/pick";
import { ringArea } from "@/mapws/annotations/planar";
import { useMapFindingsStore } from "./store";

function NoElevation() {
  return <p className="text-sm text-muted">No elevation layer here</p>;
}

function PointElevation({ projectId, at }: { projectId: string; at: readonly number[] }) {
  const api = useApi();
  const layers = useSiteLayers();
  const r = useWorkspace((s) => s.r);
  const visibility = useWorkspace(useShallow((s) => ({ layerState: s.layerState, order: s.order })));
  const gone = useGoneLayers((s) => s.gone);
  const dsm = pickDsm(layers, { ...visibility, gone }, r);
  const dsmId = dsm?.id ?? null;
  const [x, y] = at;
  const key = `${dsmId}:${x}:${y}`;
  const [z, setZ] = useState<{ key: string; value: number | null } | null>(null);

  // W3-4/A8: one sample request per point finding; a stale answer (the selection moved on) is dropped.
  useEffect(() => {
    if (!dsmId) return;
    let live = true;
    sampleInFrame(api, projectId, { x, y, surface_ids: [dsmId] })
      .then((res) => {
        if (live) setZ({ key, value: res.samples.find((s) => s.surface_id === dsmId)?.z ?? null });
      })
      .catch(() => {
        if (live) setZ({ key, value: null });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, dsmId, x, y, key]);

  if (!dsm) return <NoElevation />;
  const current = z?.key === key ? z : null;
  if (!current) return <Skeleton className="h-4 w-24" />;
  if (current.value === null) return <NoElevation />;
  return (
    <p className="flex items-baseline gap-2">
      <span className="font-mono text-sm tabular-nums text-ink">{formatHeight(current.value)}</span>
      <span className="text-2xs text-muted">{dsm.name}</span>
    </p>
  );
}

/**
 * W3-4: a polygon finding's area "≈ grid" from its site outline (no endpoint computes a finding's
 * area); a point finding's height from `POST /map-workspace/sample` on the right date's DSM.
 */
export function FindingMeasure({
  selection,
  projectId,
}: {
  selection: Selection;
  projectId: string;
  frame: SiteFrame;
}) {
  // Preflight P12: a pin outside the current view (a deep link, or its Findings row hidden) never
  // has a skeleton stuck forever — it just shows "–".
  const pin = useMapFindingsStore((s) => s.byId[selection.id]);
  if (!pin) return <p className="text-sm text-muted">–</p>;
  const g = pin.geometry_site as { type: string; coordinates: unknown };
  if (g.type === "Polygon") {
    const ring = (g.coordinates as number[][][])[0] ?? [];
    return (
      <p className="flex items-baseline gap-2">
        <span className="font-mono text-sm tabular-nums text-ink">{`≈ ${formatArea(ringArea(ring))}`}</span>
        <span className="text-2xs text-muted">grid</span>
      </p>
    );
  }
  return <PointElevation projectId={projectId} at={g.coordinates as number[]} />;
}
