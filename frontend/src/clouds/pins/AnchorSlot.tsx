import type { RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { CloudViewOut, GeoMap } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { cloudToMapNative, jumpQuery } from "@/clouds/jump";
import { useWorkspaceSeams } from "@/clouds/workspace/seams";
import { Button } from "@/ui";
import { flyToPin } from "./flyTo";
import type { CloudPin } from "./types";

export interface AnchorSlotProps {
  projectId: string;
  cloud: PointCloud;
  pin: CloudPin;
  view: CloudViewOut | undefined;
  viewer: RefObject<CloudViewerHandle | null>;
  moving: boolean;
  onMovePin: () => void;
  /** The cloud's linked map (T8-2: resolved by `FindingsTab` with W1's predicate), or null. */
  map: GeoMap | null;
}

const f3 = (v: number) => v.toFixed(3);

/** Spec §9.4 `anchorSlot`: where the pin is and what to do with it. */
export function AnchorSlot({ projectId, cloud, pin, view, viewer, moving, onMovePin, map }: AnchorSlotProps) {
  const navigate = useNavigate();
  const seams = useWorkspaceSeams();
  const ReportViewCard = seams.ReportViewCard;
  const LikelyViews = seams.LikelyViews;

  return (
    <div className="flex w-full flex-col gap-2" data-testid="cloud-anchor-slot">
      <div className="flex flex-col gap-0.5">
        <span className="text-xs text-muted">Position · {cloud.epsg ? `EPSG:${cloud.epsg}` : "no CRS"}</span>
        <span className="font-mono text-xs tabular-nums text-ink">
          {`E ${f3(pin.p[0])} · N ${f3(pin.p[1])} · Z ${f3(pin.p[2])}`}
        </span>
        <span className="text-xs text-muted">
          {pin.u === null ? "Uncertainty unknown" : `Uncertainty ±${pin.u.toFixed(2)} m`}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon="eye" onClick={() => viewer.current && flyToPin(viewer.current, pin.p, view)}>
          Fly to
        </Button>
        <Button
          size="sm"
          icon="pin"
          variant={moving ? "primary" : "secondary"}
          aria-pressed={moving}
          aria-label="Move pin"
          onClick={onMovePin}
        >
          {moving ? "Click the new spot…" : "Move pin"}
        </Button>
        {map && (
          <Button
            size="sm"
            icon="map"
            onClick={() => {
              const q = cloudToMapNative(cloud, map, { x: pin.p[0], y: pin.p[1] });
              void navigate(`/p/${projectId}/maps?map=${map.id}&${jumpQuery(q).slice(1)}`);
            }}
          >
            Show on map
          </Button>
        )}
      </div>
      {ReportViewCard && <ReportViewCard subject={{ kind: "finding", id: pin.id }} />}
      {LikelyViews && <LikelyViews point={pin.p} normal={pin.normal} findingId={pin.id} />}
    </div>
  );
}
