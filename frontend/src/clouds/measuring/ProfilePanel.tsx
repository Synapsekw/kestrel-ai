import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { Alert, Button, GlassPanel, Switch, cx } from "@/ui";
import type { MPoint } from "../measure";
import { formatLength } from "../readout";
import { tokenRgb } from "../viewer/overlay";
import { PROFILE_PANEL } from "../workspace/layout";
import { PROFILE_FAILED, lineLength } from "./measureView";
import {
  between,
  extentOf,
  fitView,
  gridStep,
  nearestPoint,
  panBy,
  profileCaption,
  rasterise,
  toData,
  toPx,
  toWorld,
  zoomAt,
  type ProfileData,
  type SZ,
  type View2D,
} from "./profileView";
import type { SectionLine } from "./slab";

export type ProfileStatus = "draft" | "computing" | "ready" | "failed";

const css = ([r, g, b]: readonly number[], a = 1) => `rgb(${r} ${g} ${b} / ${a})`;

function drawGrid(ctx: CanvasRenderingContext2D, v: View2D, w: number, h: number) {
  const dim = tokenRgb("dim");
  ctx.strokeStyle = css(dim, 0.35);
  ctx.fillStyle = css(dim, 0.9);
  ctx.lineWidth = 1;
  ctx.font = "10px ui-monospace, monospace";
  const ss = gridStep(v.sx);
  const zs = gridStep(v.sz);
  const s0 = toData(v, 0, 0).s;
  const s1 = toData(v, w, 0).s;
  for (let s = Math.ceil(s0 / ss) * ss; s <= s1; s += ss) {
    const x = Math.round(toPx(v, { s, z: 0 }).x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    ctx.fillText(`${+s.toFixed(2)} m`, x + 3, h - 4);
  }
  const zTop = toData(v, 0, 0).z;
  const zBottom = toData(v, 0, h).z;
  for (let z = Math.ceil(zBottom / zs) * zs; z <= zTop; z += zs) {
    const y = Math.round(toPx(v, { s: 0, z }).y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
    ctx.fillText(`${+z.toFixed(2)}`, 3, y - 3);
  }
}

export interface ProfilePanelProps {
  line: SectionLine;
  data: ProfileData | null;
  source: "preview" | "full";
  status: ProfileStatus;
  error: string | null;
  /** Resolves once the retry request settles; the button stays disabled until then (M1 hand-off e). */
  onRetry?: () => Promise<unknown>;
  /** "Save as distance": two profile points as a normal 2-point distance (Ruling 13). */
  onSaveDistance: (a: MPoint, b: MPoint) => void;
}

/** The s–z section of spec §8.3: the preview while drawing, the stored profile once the job is done. */
export function ProfilePanel({
  line,
  data,
  source,
  status,
  error,
  onRetry,
  onSaveDistance,
}: ProfilePanelProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<{ key: string; v: View2D } | null>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [open, setOpen] = useState(true);
  const [aspectTrue, setAspectTrue] = useState(true);
  const [marks, setMarks] = useState<SZ[]>([]);
  const [retrying, setRetrying] = useState(false);
  const fitKey = `${source}|${data?.count ?? 0}|${aspectTrue}`;

  const draw = useCallback(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d") ?? null;
    if (!c || !ctx) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const e = data ? extentOf(data) : null;
    if (!data || !e) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    if (!view.current || view.current.key !== fitKey)
      view.current = { key: fitKey, v: fitView(e, w, h, aspectTrue) };
    const v = view.current.v;
    const img = ctx.createImageData(w, h);
    rasterise(img.data, w, h, v, data, tokenRgb("ink"));
    ctx.putImageData(img, 0, 0);
    drawGrid(ctx, v, w, h);
    ctx.fillStyle = css(tokenRgb("accent"));
    ctx.strokeStyle = css(tokenRgb("accent"));
    const pts = marks.map((m) => toPx(v, m));
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (pts.length === 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      ctx.lineTo(pts[1].x, pts[1].y);
      ctx.stroke();
    }
  }, [data, fitKey, aspectTrue, marks]);

  useEffect(() => {
    draw();
    const c = canvas.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      view.current = null;
      draw();
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, [draw, open]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      const cur = view.current;
      if (!cur) return;
      e.preventDefault();
      const r = c.getBoundingClientRect();
      view.current = {
        ...cur,
        v: zoomAt(cur.v, e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.2 : 1 / 1.2),
      };
      draw();
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [draw, open]);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    const cur = view.current;
    if (!d || !cur) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    view.current = { ...cur, v: panBy(cur.v, dx, dy) };
    drag.current = { x: e.clientX, y: e.clientY, moved: true };
    draw();
  };
  const onPointerUp = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    const cur = view.current;
    if (!d || d.moved || !cur || !data) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const hit = nearestPoint(data, cur.v, x, y) ?? toData(cur.v, x, y);
    setMarks((m) => (m.length >= 2 ? [hit] : [...m, hit]));
  };

  const handleRetry = () => {
    if (!onRetry || retrying) return;
    setRetrying(true);
    onRetry().finally(() => setRetrying(false));
  };

  const helper = marks.length === 2 ? between(marks[0], marks[1]) : null;
  return (
    <GlassPanel
      variant="float"
      data-testid="profile-panel"
      aria-label="Cross-section profile"
      className="pointer-events-auto absolute flex flex-col gap-2 p-3"
      style={{
        left: PROFILE_PANEL.left,
        right: PROFILE_PANEL.right,
        bottom: PROFILE_PANEL.bottom,
        height: open ? PROFILE_PANEL.height : undefined,
      }}
    >
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-semibold text-ink">Cross-section</h3>
        <span
          data-testid="profile-caption"
          className={cx("text-xs", data?.count === 0 ? "text-warn" : "text-muted")}
        >
          {profileCaption(source, data)}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <Switch label="1:1 metres" checked={aspectTrue} onChange={setAspectTrue} />
          <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </Button>
        </span>
      </div>
      {status === "failed" && (
        <Alert
          tone="danger"
          actions={
            onRetry && (
              <Button size="sm" icon="refresh" disabled={retrying} onClick={handleRetry}>
                Retry
              </Button>
            )
          }
        >
          {error ?? PROFILE_FAILED}
        </Alert>
      )}
      {open && (
        <>
          <canvas
            ref={canvas}
            data-testid="profile-canvas"
            aria-label={`Section ${formatLength(lineLength(line.a, line.b))} long`}
            className="min-h-0 w-full flex-1 cursor-crosshair rounded-control"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          <div className="flex items-center gap-3 text-xs">
            <span className="font-mono tabular-nums text-muted">
              {helper
                ? `${formatLength(helper.d)} · Δs ${formatLength(helper.ds)} · Δz ${helper.dz >= 0 ? "+" : "−"}${formatLength(Math.abs(helper.dz))}`
                : "Click two points of the section to measure between them"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              className="ml-auto"
              disabled={!helper}
              onClick={() =>
                onSaveDistance(
                  toWorld(line, marks[0], line.thicknessM),
                  toWorld(line, marks[1], line.thicknessM),
                )
              }
            >
              Save as distance
            </Button>
          </div>
        </>
      )}
    </GlassPanel>
  );
}
