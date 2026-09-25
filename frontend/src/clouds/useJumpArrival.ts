import { useEffect, type RefObject } from "react";
import type { PointCloud } from "@/api/clouds";
import { toast } from "@/ui";
import type { CloudPick, CloudViewerHandle } from "./CloudViewer";
import { footprintDiagonal, insideXY, parseAt, parseFootprint, type XY } from "./jump";
import { jumpDistance } from "./viewer/camera";

const TICK_MS = 100;
const MAX_WAIT_TICKS = 300; // 30 s
const Z_REFINE_M = 2;
/** Fallback: screen positions sampled along the pin, top to bottom (plus the p50 one): a small, fixed pick count. */
const PIN_SAMPLES = 12;
/** Idle ticks in a row before the view counts as settled: the first idle tick after lookAt can be stale. */
const SETTLED_TICKS = 2;
/** Rounds of picks that found nothing before the refine gives up. */
const PICK_ROUNDS = 3;

/**
 * The fallback when the straight-down pick finds nothing: the hit nearest (x, y) horizontally among
 * picks along the pin's screen segment. Only samples that land on the canvas are picked: potree's
 * picker clamps an off-canvas position to the viewport edge, which answers for some other spot.
 */
function pickAlongPin(v: CloudViewerHandle, at: XY, zLo: number, zHi: number, z0: number): CloudPick | null {
  const zs = Array.from({ length: PIN_SAMPLES }, (_, i) => zHi - ((zHi - zLo) * i) / (PIN_SAMPLES - 1));
  zs.push(z0);
  const rect = v.canvasRect();
  if (!rect) return null;
  let best: CloudPick | null = null;
  let bestD = Infinity;
  for (const z of zs) {
    const s = v.project({ x: at.x, y: at.y, z });
    if (!s || s.x < rect.left || s.x > rect.right || s.y < rect.top || s.y > rect.bottom) continue;
    const hit = v.pickAtClient(s.x, s.y);
    if (!hit) continue;
    const d = Math.hypot(hit.x - at.x, hit.y - at.y);
    if (d < bestD) {
      best = hit;
      bestD = d;
    }
  }
  return best;
}

/**
 * Spec §10 "Arriving in 3D", once per navigation: outside the cloud → a toast; else look at
 * (x, y, p50) from 45° south at max(40 m, 3 × footprint diagonal), draw a vertical pin, and once
 * the view has settled pick straight down at the spot (the topmost surface within 2 m, however far
 * above or below p50: a 45° view only shows about p50 − 77 m … p50 + 21 m of the pin), falling back
 * to picks along the pin's on-canvas stretch. The nearest hit within 2 m retargets Z and draws the
 * footprint there.
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
    let idle = 0;
    let rounds = 0;
    const timer = window.setInterval(() => {
      const v = viewer.current;
      ticks += 1;
      if (ticks > MAX_WAIT_TICKS) {
        window.clearInterval(timer);
        return;
      }
      if (!v) return;
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
      idle = s.nodesLoading > 0 ? 0 : idle + 1;
      if (idle < SETTLED_TICKS) return;
      const hit = v.pickDown(at.x, at.y, Z_REFINE_M) ?? pickAlongPin(v, at, b[2], b[5], z0);
      if (!hit) {
        rounds += 1;
        if (rounds >= PICK_ROUNDS) window.clearInterval(timer);
        return; // nothing under the pin yet: try again next tick
      }
      window.clearInterval(timer);
      if (Math.hypot(hit.x - at.x, hit.y - at.y) <= Z_REFINE_M) {
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
