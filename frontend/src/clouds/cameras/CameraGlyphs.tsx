import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { thumbnailUrl, type CloudCameraSet } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { useApi, useBackend } from "@/api/client";
import { fetchImage } from "@/api/images";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { imageJumpHref } from "@/clouds/jump";
import type { LookPose } from "@/clouds/viewer/lookThrough";
import { NOTICE_INSET } from "@/clouds/workspace/layout";
import type { CloudToolId } from "@/clouds/workspace/tools";
import { Button, Pill, Popover } from "@/ui";
import { cameraZ, dronePose, glyphShapes, isPosed, nearestCamera } from "./cameraMath";
import { camerasShown, useCamerasStore } from "./store";
import { useCanvasClicks } from "./useCanvasClicks";

export const CAMERAS_OVERLAY = "cameras";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Takes the drone's pose and answers the photo frame relative to `hostEl`, and the way back; null
 * without a running engine (C-V2's `lookThrough` is nullable). The handle itself is not kept.
 */
function takePose(
  v: CloudViewerHandle | null,
  hostEl: HTMLElement | null,
  pose: LookPose,
): { frame: Rect; restore: () => void } | null {
  const look = v?.lookThrough(pose) ?? null;
  if (!look) return null;
  const f = look.frame();
  const o = hostEl?.getBoundingClientRect();
  return {
    frame: { left: f.left - (o?.left ?? 0), top: f.top - (o?.top ?? 0), width: f.width, height: f.height },
    restore: () => look.restore(),
  };
}

const when = (t: string | null) =>
  t
    ? new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
    : "Capture time unknown";

function GlyphCard({
  projectId,
  cloudId,
  set,
  index,
  onLook,
}: {
  projectId: string;
  cloudId: string;
  set: CloudCameraSet;
  index: number;
  onLook: () => void;
}) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const navigate = useNavigate();
  const imageId = set.image_id[index];
  const [row, setRow] = useState<{ imageId: string; name: string; time: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchImage(api, projectId, imageId)
      .then((img) => {
        if (!cancelled) setRow({ imageId, name: img.file_name, time: img.capture_time });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [api, projectId, imageId]);
  const shownRow = row?.imageId === imageId ? row : null;
  const posed = isPosed(set, index);
  return (
    <div className="flex w-64 flex-col gap-2 p-3">
      <img
        src={thumbnailUrl(baseUrl, token, projectId, imageId)}
        alt=""
        className="aspect-[4/3] w-full rounded-control bg-surface-2 object-cover"
      />
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{shownRow?.name ?? "Drone photo"}</p>
        <p className="text-xs text-muted">
          {when(shownRow?.time ?? null)}
          {posed ? "" : " · camera angles unknown"}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => navigate(imageJumpHref(projectId, imageId, cloudId, null))}>
          Open in Images
        </Button>
        <Button size="sm" variant="primary" disabled={!posed} onClick={onLook}>
          Look through
        </Button>
      </div>
    </div>
  );
}

/**
 * The camera glyphs (spec §10.2): drawn through the viewer overlay while "Show camera positions" is
 * on; a click within 8 px of a projected camera (orbit and pan only, C-L1 Ruling 6) opens the glyph
 * popover; "Look through" takes the drone's pose (C-V2) and frames the photo; Esc goes back.
 *
 * A `LookThrough` handle is never kept across time (C-L1 Ruling 7): only the pose is, and a resize
 * asks the viewer again (the engine keeps the pre-photo snapshot, so `restore()` of the new handle
 * still returns to the view from before the first look). Unmounting (the view stopped running, so the
 * engine may be rebuilt) leaves the photo without restoring.
 */
export function CameraGlyphs({
  projectId,
  cloud,
  viewer,
  tool,
}: {
  projectId: string;
  cloud: PointCloud;
  viewer: RefObject<CloudViewerHandle | null>;
  tool: CloudToolId;
}) {
  const set = useCamerasStore((s) => s.set);
  const visible = useCamerasStore((s) => s.visible);
  const shown = camerasShown({ visible, set });
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState<{ index: number; x: number; y: number } | null>(null);
  const [frame, setFrame] = useState<Rect | null>(null);
  const lookRef = useRef<{ pose: LookPose; restore: () => void } | null>(null);
  const top = cloud.bounds_native?.[5] ?? 0;
  const looking = frame !== null;

  useEffect(() => {
    viewer.current?.setOverlay(CAMERAS_OVERLAY, shown && set ? glyphShapes(set, top) : []);
  }, [viewer, set, shown, top]);

  useEffect(() => {
    const v = viewer.current;
    return () => v?.setOverlay(CAMERAS_OVERLAY, []);
  }, [viewer]);

  useEffect(
    () => () => {
      if (!lookRef.current) return;
      lookRef.current = null;
      useCamerasStore.getState().setLookingThrough(false);
    },
    [],
  );

  const origin = () => {
    const r = host.current?.getBoundingClientRect();
    return { x: r?.left ?? 0, y: r?.top ?? 0 };
  };

  const leave = useCallback((restore: boolean) => {
    if (restore) lookRef.current?.restore();
    lookRef.current = null;
    setFrame(null);
    useCamerasStore.getState().setLookingThrough(false);
  }, []);

  // Glyph clicks only with the switch on and orbit/pan armed (Ruling 6); the pointer-down that leaves
  // a look stays live for as long as the look does, whatever the switch or the tool (Ruling 7).
  const glyphsEnabled = shown && (tool === "orbit" || tool === "pan");
  useCanvasClicks(
    glyphsEnabled || looking,
    (x, y) => {
      const v = viewer.current;
      if (!glyphsEnabled || !v || !set) return;
      const screen = set.image_id.map((_, i) =>
        v.project({ x: set.x[i], y: set.y[i], z: cameraZ(set, i, top) }),
      );
      const i = nearestCamera(screen, x, y);
      if (i === null) return;
      const o = origin();
      setOpen({ index: i, x: x - o.x, y: y - o.y });
    },
    () => {
      if (lookRef.current) leave(false);
    },
  );

  useEffect(() => {
    if (!looking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      leave(true);
    };
    const refit = () => {
      const cur = lookRef.current;
      if (!cur) return;
      const took = takePose(viewer.current, host.current, cur.pose);
      if (!took) return leave(false);
      lookRef.current = { pose: cur.pose, restore: took.restore };
      setFrame(took.frame);
    };
    // window resize and the ResizeObserver both fire on one resize: one re-ask per animation frame
    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        refit();
      });
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", schedule);
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && host.current) {
      let first = true; // observe() reports the current size once: that is not a resize
      ro = new ResizeObserver(() => {
        if (first) first = false;
        else schedule();
      });
      ro.observe(host.current);
    }
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", schedule);
      ro?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [looking, leave, viewer]);

  const lookThrough = (i: number) => {
    const pose = set ? dronePose(set, i) : null;
    const took = pose ? takePose(viewer.current, host.current, pose) : null;
    if (!pose || !took) return; // no running engine: keep the popover, draw nothing
    lookRef.current = { pose, restore: took.restore };
    setFrame(took.frame);
    useCamerasStore.getState().setLookingThrough(true);
    setOpen(null);
  };

  return (
    <div ref={host} className="pointer-events-none absolute inset-0" data-testid="camera-glyphs">
      {open && <span ref={anchor} className="absolute h-px w-px" style={{ left: open.x, top: open.y }} />}
      {open && set && (
        <Popover open onClose={() => setOpen(null)} anchorRef={anchor} label="Drone photo" side="right">
          <GlyphCard
            projectId={projectId}
            cloudId={cloud.id}
            set={set}
            index={open.index}
            onLook={() => lookThrough(open.index)}
          />
        </Popover>
      )}
      {frame && (
        <>
          <div
            data-testid="look-through-frame"
            className="absolute rounded-control border-2 border-dashed border-accent"
            style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
          />
          {/* below the hint bar, in the centre band the viewer's notices use (layout.ts) */}
          <Pill
            tone="accent"
            className="absolute left-1/2 -translate-x-1/2"
            style={{ top: NOTICE_INSET.top }}
          >
            Looking through the drone photo · Esc goes back
          </Pill>
        </>
      )}
    </div>
  );
}
