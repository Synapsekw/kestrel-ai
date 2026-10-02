import type { RefObject } from "react";
import type { ClassDef, GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { FindingInspector } from "@/findings/FindingInspector";
import { formatFindingNumber } from "@/findings/format";
import { STATUS_LABEL } from "@/findings/status";
import { Alert, EmptyState, Kbd, SeverityPill, StatusDot, TypeChip, cx } from "@/ui";
import { AnchorSlot } from "./AnchorSlot";
import { locationLabel } from "./callout";
import { MeasureSlot } from "./MeasureSlot";
import type { CloudPinsState } from "./useCloudPins";

export interface FindingsTabProps {
  projectId: string;
  cloud: PointCloud;
  pins: CloudPinsState;
  types: ReadonlyMap<string, ClassDef>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  viewer: RefObject<CloudViewerHandle | null>;
  /** The finding whose Move pin waits for a click, or null. */
  moving: string | null;
  onMovePin: (id: string) => void;
  /** `FindingInspector`'s navigation: null once deleted, else a workspace link. */
  onNavigate: (href: string | null) => void;
  /** T8-2: W1's loaded maps, so `AnchorSlot` can offer "Show on map" without its own fetch. */
  maps: GeoMap[];
}

/** Spec §9.4 "Findings tab", the list half: compact rows (the rail's Findings panel). */
export function FindingsList(p: FindingsTabProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="cloud-findings-tab">
      {p.pins.capNote && <p className="px-3 py-1 text-xs text-muted">{p.pins.capNote}</p>}
      {p.pins.status === "error" && <Alert tone="danger">{p.pins.error}</Alert>}
      {p.pins.status === "ready" && p.pins.pins.length === 0 && (
        <EmptyState icon="pin" title="No findings on this cloud">
          Press <Kbd>M</Kbd> and click the cloud to pin one.
        </EmptyState>
      )}
      {p.pins.pins.length > 0 && (
        <ul aria-label="Findings on this cloud" className="min-h-0 flex-1 overflow-y-auto">
          {p.pins.pins.map((pin) => {
            const type = p.types.get(pin.typeId);
            const on = pin.id === p.selectedId;
            return (
              <li key={pin.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => p.onSelect(on ? null : pin.id)}
                  className={cx(
                    "flex w-full items-center gap-2 rounded-control px-3 py-1.5 text-left hover:bg-hover",
                    on && "bg-accent-soft",
                  )}
                >
                  {type ? (
                    <TypeChip name={type.name} colour={type.colour} kind={type.kind} size="sm" />
                  ) : (
                    <span className="text-xs text-muted">Unknown type</span>
                  )}
                  <SeverityPill level={pin.severity} size="sm" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-muted">
                    {`${formatFindingNumber(pin.number)} · ${locationLabel(pin.p[2], pin.normal)}`}
                  </span>
                  <StatusDot status={pin.status} label={STATUS_LABEL[pin.status]} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Spec §9.4, the detail half: F's inspector for the selected finding, or nothing without one. */
export function FindingDetail(p: FindingsTabProps) {
  const selected = p.pins.pins.find((x) => x.id === p.selectedId) ?? null;
  if (!selected) return null;
  // Same predicate as `CloudWorkspace.tsx`'s `linkedMap` (T8-2): ready, georeferenced, and this cloud's map.
  const linkedMap: GeoMap | null =
    p.maps.find((m) => m.id === p.cloud.map_id && m.status === "ready" && m.proj4 && m.geotransform) ?? null;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <FindingInspector
        key={selected.id}
        projectId={p.projectId}
        findingId={selected.id}
        onNavigate={p.onNavigate}
        anchorSlot={
          <AnchorSlot
            projectId={p.projectId}
            cloud={p.cloud}
            pin={selected}
            view={p.pins.views.get(selected.id)}
            viewer={p.viewer}
            moving={p.moving === selected.id}
            onMovePin={() => p.onMovePin(selected.id)}
            map={linkedMap}
          />
        }
        measureSlot={
          <MeasureSlot
            projectId={p.projectId}
            cloudId={p.cloud.id}
            findingId={selected.id}
            viewer={p.viewer}
          />
        }
      />
    </div>
  );
}
