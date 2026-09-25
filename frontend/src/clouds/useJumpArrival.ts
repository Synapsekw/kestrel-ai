import { useEffect, type RefObject } from "react";
import type { PointCloud } from "@/api/clouds";
import { toast } from "@/ui";
import type { CloudViewerHandle } from "./CloudViewer";
import { footprintDiagonal, insideXY, parseAt, parseFootprint } from "./jump";
import { jumpDistance } from "./viewer/camera";

const TICK_MS = 100;
const MAX_WAIT_TICKS = 300; // 30 s
const Z_REFINE_M = 2;

/**
 * Spec §10 "Arriving in 3D", once per navigation: outside the cloud → a toast; else look at
 * (x, y, p50) from 45° south at max(40 m, 3 × footprint diagonal), draw a vertical pin, and once
 * the view has settled pick at the pin: a hit within 2 m retargets Z and draws the footprint there.
 */
export function useJumpArrival(
  viewer: RefObject<CloudViewerHandle | null>,
  cloud: PointCloud | null,
  search: string,
): void {
  const cloudId = cloud?.status === "ready" ? cloud.id : null;
  useEffect(() => {
    if (!cloud || !cloudId || !cloud.bounds_native) return;
    const q = new URLSearchParams(search);
    const at = parseAt(q);
    if (!at) return;
    const fp = parseFootprint(q);
    const b = cloud.bounds_native;
    if (!insideXY(b, at)) {
      toast("info", "This spot is outside the cloud");
      return;
    }
    const z0 = cloud.z_stats?.p50 ?? (b[2] + b[5]) / 2;
    const distance = jumpDistance(fp ? footprintDiagonal(fp) : 0);
    let placed = false;
    let ticks = 0;
    const timer = window.setInterval(() => {
      const v = viewer.current;
      ticks += 1;
      if (!v || ticks > MAX_WAIT_TICKS) {
        if (ticks > MAX_WAIT_TICKS) window.clearInterval(timer);
        return;
      }
      const s = v.stats();
      if (!placed) {
        if (s.numVisiblePoints === 0) return; // the cloud is not loaded yet
        v.lookAt({ x: at.x, y: at.y, z: z0 }, distance);
        v.setOverlay("pin", [
          {
            kind: "line",
            points: [
              { x: at.x, y: at.y, z: b[2] },
              { x: at.x, y: at.y, z: b[5] },
            ],
            tone: "accent",
          },
        ]);
        placed = true;
        return;
      }
      if (s.nodesLoading > 0) return;
      window.clearInterval(timer);
      const screen = v.project({ x: at.x, y: at.y, z: z0 });
      const hit = screen ? v.pickAtClient(screen.x, screen.y) : null;
      if (hit && Math.hypot(hit.x - at.x, hit.y - at.y) <= Z_REFINE_M) {
        v.lookAt({ x: at.x, y: at.y, z: hit.z }, distance);
        if (fp)
          v.setOverlay("footprint", [
            { kind: "line", points: fp.map((p) => ({ x: p.x, y: p.y, z: hit.z })), closed: true, tone: "ok" },
          ]);
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
    // once per navigation: the search string and the cloud decide; the cloud object's identity does not
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, cloudId, search]);
}
