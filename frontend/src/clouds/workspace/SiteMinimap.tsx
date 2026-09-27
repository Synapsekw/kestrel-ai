import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { mapPreviewUrl, type CloudClipBox, type GeoMap } from "@contract/client";
import { useBackend } from "@/api/client";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import type { Bounds6 } from "@/clouds/viewer/camera";
import { GlassPanel, stagger } from "@/ui";
import { clipFootprint } from "./clip";
import {
  fromMini,
  horizontalFov,
  imageMatrix,
  miniFrame,
  toMini,
  underlayCorners,
  viewCone,
} from "./minimap";
import type { MinimapMark } from "./types";

const W = 330;
const H = 178;
const PAD = 14;
const SNAPSHOT_PX = 512;

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
const pts = (list: [number, number][]) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/**
 * The minimap (spec §6: right 14, bottom 14, 330 × 178; C11). Underlay: the linked map's preview by
 * its corners, else one top snapshot at the first settle. The camera dot and cone are attribute
 * writes in the frame hook.
 */
export function Minimap({
  projectId,
  cloud,
  map,
  viewer,
  running,
  marks,
  clipBox,
  onRecentre,
}: {
  projectId: string;
  cloud: PointCloud;
  map: GeoMap | null;
  viewer: RefObject<CloudViewerHandle>;
  running: boolean;
  marks: readonly MinimapMark[];
  clipBox: CloudClipBox | null;
  onRecentre(x: number, y: number): void;
}) {
  const { baseUrl, token } = useBackend();
  const bounds = cloud.bounds_native as Bounds6;
  const frame = useMemo(() => miniFrame(bounds, W, H, PAD), [bounds]);
  const corners = useMemo(() => (map ? underlayCorners(map, cloud) : null), [map, cloud]);
  const dot = useRef<SVGCircleElement>(null);
  const cone = useRef<SVGPolygonElement>(null);
  const snapCanvas = useRef<HTMLCanvasElement>(null);
  const [snapped, setSnapped] = useState(false);

  useEffect(() => {
    const v = viewer.current;
    if (!running || !v) return;
    return v.onFrame((cam) => {
      const [x, y] = toMini(frame, cam.position[0], cam.position[1]);
      dot.current?.setAttribute("cx", x.toFixed(1));
      dot.current?.setAttribute("cy", y.toFixed(1));
      dot.current?.setAttribute("visibility", "visible");
      const p = viewCone(cam.position, cam.direction, horizontalFov(cam.viewProj), frame);
      if (p) cone.current?.setAttribute("points", p);
      cone.current?.setAttribute("visibility", p ? "visible" : "hidden");
    });
  }, [viewer, running, frame]);

  // C11: without a linked map, one top-down snapshot when the view first settles.
  useEffect(() => {
    const v = viewer.current;
    if (!running || !v || corners || snapped) return;
    let asked = false;
    const off = v.onFrame(() => {
      const s = v.stats();
      if (asked || s.settledMs === null || s.nodesLoading > 0) return;
      asked = true;
      void v.topSnapshot(SNAPSHOT_PX).then((bmp) => {
        const c = snapCanvas.current;
        if (!bmp || !c) {
          bmp?.close(); // the canvas went away (cloud switch, unmount) before the snapshot arrived
          asked = false;
          return;
        }
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext("2d")?.drawImage(bmp, 0, 0);
        bmp.close();
        setSnapped(true);
      });
    });
    return off;
  }, [viewer, running, corners, snapped]);

  const [bx0, by0] = toMini(frame, bounds[0], bounds[4]);
  const [bx1, by1] = toMini(frame, bounds[3], bounds[1]);
  const label =
    map && corners ? (map.captured_on ? `Ortho · ${day(map.captured_on)}` : "Ortho") : "Cloud · top view";
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      data-testid="cloud-minimap"
      style={stagger(5)}
      className="stagger absolute bottom-3.5 right-3.5 z-10 h-[178px] w-[330px] overflow-hidden animate-slide-in reduce-motion:animate-none"
    >
      {!corners && (
        <canvas
          ref={snapCanvas}
          aria-hidden
          className="absolute"
          style={{
            left: bx0,
            top: by0,
            width: bx1 - bx0,
            height: by1 - by0,
            visibility: snapped ? "visible" : "hidden",
          }}
        />
      )}
      <svg
        role="img"
        aria-label="Site map: click to centre the view there"
        viewBox={`0 0 ${W} ${H}`}
        className="absolute inset-0 h-full w-full cursor-crosshair"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const [x, y] = fromMini(
            frame,
            ((e.clientX - r.left) * W) / r.width,
            ((e.clientY - r.top) * H) / r.height,
          );
          onRecentre(x, y);
        }}
      >
        {corners && map && (
          <image
            href={mapPreviewUrl(baseUrl, token, projectId, map.id)}
            width={1}
            height={1}
            preserveAspectRatio="none"
            transform={imageMatrix(
              toMini(frame, ...corners[0]),
              toMini(frame, ...corners[1]),
              toMini(frame, ...corners[2]),
            )}
          />
        )}
        <rect
          x={bx0}
          y={by0}
          width={bx1 - bx0}
          height={by1 - by0}
          className="fill-none stroke-line-strong"
          strokeWidth={1}
        />
        {clipBox && (
          <polygon
            data-mark="clip"
            points={pts(clipFootprint(clipBox).map(([x, y]) => toMini(frame, x, y)))}
            className="fill-none stroke-accent"
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
        )}
        {marks.map((m, i) =>
          m.kind === "dot" ? (
            <circle
              key={i}
              cx={toMini(frame, m.x, m.y)[0]}
              cy={toMini(frame, m.x, m.y)[1]}
              r={3.5}
              style={{ fill: m.colour }}
            >
              <title>{m.label}</title>
            </circle>
          ) : (
            <line
              key={i}
              x1={toMini(frame, ...m.a)[0]}
              y1={toMini(frame, ...m.a)[1]}
              x2={toMini(frame, ...m.b)[0]}
              y2={toMini(frame, ...m.b)[1]}
              className="stroke-ok"
              strokeWidth={2}
            />
          ),
        )}
        <polygon
          ref={cone}
          data-mark="cone"
          visibility="hidden"
          className="fill-accent-soft stroke-accent"
          strokeWidth={1}
        />
        <circle
          ref={dot}
          data-mark="camera"
          r={4}
          visibility="hidden"
          className="fill-accent stroke-ink"
          strokeWidth={1.5}
        />
      </svg>
      <div className="pointer-events-none relative flex items-center justify-between px-2.5 pt-2 text-xs">
        <span className="font-medium text-ink">Site map</span>
        <span className="font-mono text-2xs text-muted">{label}</span>
      </div>
    </GlassPanel>
  );
}
