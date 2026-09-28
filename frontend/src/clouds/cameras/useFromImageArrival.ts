import { useEffect, useRef, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import type { PointCloud } from "@/api/clouds";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { insideXY, jumpQuery, parseCloudArrival } from "@/clouds/jump";
import { toast } from "@/ui";
import { dronePose } from "./cameraMath";
import { useCamerasStore } from "./store";

export const FROM_IMAGE_OVERLAY = "from-image";
export const NO_POSE_TOAST = "Camera angles unknown: showing where the drone was";
export const OUTSIDE_TOAST = "This spot is outside the cloud";
/** The orbit distance after the arrival: the drone's distance to the hit, at least this. */
export const MIN_ARRIVAL_DISTANCE_M = 20;

const TICK_MS = 100;
const MAX_WAIT_TICKS = 300; // 30 s, as S1's arrival
/** Idle ticks in a row before the view counts as settled (S1's settled-ticks rule). */
const SETTLED_TICKS = 2;
const PICK_ROUNDS = 3;
const MARKER_HEIGHT_M = 3;

/**
 * Spec §10.4 image → cloud, once per navigation: find the photo in the cameras payload; when it is
 * posed, wait for points, `lookThrough` its pose, wait for the view to settle, map the photo pixel
 * with `toCanvas` and pick there; mark the hit and re-centre the orbit on it (C-L1 Ruling 8). No pose
 * or no hit: S1's `?at=` at the drone's XY, with a toast. Not in the payload (or no cameras): the
 * "outside the cloud" toast.
 */
export function useFromImageArrival(
  viewer: RefObject<CloudViewerHandle | null>,
  cloud: PointCloud | null,
  search: string,
): void {
  const navigate = useNavigate();
  const status = useCamerasStore((s) => s.status);
  const set = useCamerasStore((s) => s.set);
  const storeCloud = useCamerasStore((s) => s.cloudId);
  const cloudId = cloud?.status === "ready" ? cloud.id : null;
  const boundsKey = cloud?.bounds_native?.join(",") ?? "";
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!cloudId || !boundsKey) return;
    const arrival = parseCloudArrival(new URLSearchParams(search));
    if (arrival?.kind !== "from_image") return;
    const key = `${cloudId}|${search}`;
    if (handled.current === key) return;
    if (storeCloud !== cloudId || status === "idle" || status === "loading") return; // wait for the cameras
    handled.current = key;

    const bounds = boundsKey.split(",").map(Number);
    const i = status === "ready" && set ? set.image_id.indexOf(arrival.imageId) : -1;
    if (!set || i < 0 || !insideXY(bounds, { x: set.x[i], y: set.y[i] })) {
      toast("info", OUTSIDE_TOAST);
      return;
    }
    const at = { x: set.x[i], y: set.y[i] };
    const fallback = () => {
      toast("info", NO_POSE_TOAST);
      navigate({ search: jumpQuery(at) }, { replace: true });
    };
    const pose = dronePose(set, i);
    if (!pose) {
      fallback();
      return;
    }

    let posed = false;
    let ticks = 0;
    let idle = 0;
    let rounds = 0;
    let finished = false;
    let timer = 0;
    const stop = () => {
      finished = true;
      window.clearInterval(timer);
    };
    timer = window.setInterval(() => {
      const v = viewer.current;
      ticks += 1;
      if (ticks > MAX_WAIT_TICKS) return stop();
      if (!v) return;
      const s = v.stats();
      if (s.numVisiblePoints === 0) return; // the cloud is not loaded yet
      if (!posed) {
        // Pose exactly once, on the tick the cloud first has points. `lookThrough` is not a no-op:
        // it moves the camera, forces orbit and drops any tween, so it must not run again on every
        // waiting tick (that would fight a drag the operator starts and keep the render loop from
        // ever idling). `stats()` above was read before this pose, so it is not used for `idle` —
        // idle is counted only from ticks that follow the pose.
        if (!v.lookThrough(pose)) return; // no running engine yet: retry next tick, do not count as posed
        posed = true;
        return;
      }
      idle = s.nodesLoading > 0 ? 0 : idle + 1;
      if (idle < SETTLED_TICKS) return;
      // C-L1 Ruling 7 / controller adaptation 2: a `LookThrough` handle is never kept across time —
      // it goes stale after an engine rebuild and the FOV is not refitted after a resize. Re-ask for
      // one fresh handle right here, immediately before this pick round's `toCanvas` call (the same
      // pose re-frames the same pre-photo snapshot, so this is the one call per round, not a repose
      // on every poll tick).
      const look = v.lookThrough(pose);
      if (!look) return; // not ready yet (no running engine): retry next tick
      const c = look.toCanvas(arrival.u, arrival.v);
      const hit = v.pickAtClient(c.x, c.y);
      if (!hit) {
        rounds += 1;
        if (rounds >= PICK_ROUNDS) {
          stop();
          fallback();
        }
        return;
      }
      stop();
      const p = { x: hit.x, y: hit.y, z: hit.z };
      v.setOverlay(FROM_IMAGE_OVERLAY, [
        { kind: "line", points: [p, { ...p, z: p.z + MARKER_HEIGHT_M }], tone: "accent" },
        { kind: "points", points: [p], tone: "accent" },
      ]);
      const [cx, cy, cz] = pose.position;
      v.lookAt(p, Math.max(MIN_ARRIVAL_DISTANCE_M, Math.hypot(cx - p.x, cy - p.y, cz - p.z)));
    }, TICK_MS);
    return () => {
      window.clearInterval(timer);
      if (!finished) handled.current = null; // unmounted or re-keyed mid-way: the next run starts over
    };
  }, [viewer, cloudId, boundsKey, search, status, set, storeCloud, navigate]);
}
