import { useEffect, useState, type RefObject } from "react";
import { useApi } from "@/api/client";
import { listCloudMeasurements, type CloudMeasurement } from "@/api/cloudMeasurements";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { KIND_LABEL } from "@/clouds/measure";
import { useChangesStore } from "@/store/changes";
import { Button, Skeleton } from "@/ui";
import { FLY_TO_DISTANCE_M } from "./flyTo";

export interface MeasureSlotProps {
  projectId: string;
  cloudId: string;
  findingId: string;
  viewer: RefObject<CloudViewerHandle | null>;
}

function middle(m: CloudMeasurement): { x: number; y: number; z: number } {
  const n = m.points.length;
  const s = m.points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y, z: a.z + p.z }), { x: 0, y: 0, z: 0 });
  return { x: s.x / n, y: s.y / n, z: s.z / n };
}

/** Spec §9.4 `measureSlot`: the measurements linked to this finding (≤ 1 000 rows read, S1 cap). */
export function MeasureSlot({ projectId, cloudId, findingId, viewer }: MeasureSlotProps) {
  const api = useApi();
  const revision = useChangesStore((s) => s.pointcloudsRevision);
  const key = `${cloudId}|${findingId}`;
  const [rows, setRows] = useState<{ key: string; items: CloudMeasurement[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    listCloudMeasurements(api, projectId, cloudId)
      .then((all) => {
        if (!cancelled) setRows({ key, items: all.filter((m) => m.finding_id === findingId) });
      })
      .catch(() => {
        if (!cancelled) setRows({ key, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, cloudId, findingId, key, revision]);

  if (!rows || rows.key !== key) return <Skeleton className="h-4 w-full" />;
  if (rows.items.length === 0)
    return (
      <p className="text-xs text-muted">No linked measurements. Link one from its row in Measurements.</p>
    );
  return (
    <ul className="flex flex-col gap-1" aria-label="Linked measurements">
      {rows.items.map((m) => (
        <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            <span className="text-muted">{KIND_LABEL[m.kind]}</span> · <span>{m.name}</span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Go to ${m.name}`}
            onClick={() => viewer.current?.lookAt(middle(m), FLY_TO_DISTANCE_M)}
          >
            Go to
          </Button>
        </li>
      ))}
    </ul>
  );
}
