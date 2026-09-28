import { useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { thumbnailUrl } from "@contract/client";
import type { PointCloud } from "@/api/clouds";
import { useApi, useBackend } from "@/api/client";
import { fetchImage } from "@/api/images";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { imageJumpHref } from "@/clouds/jump";
import { photosSeeing, type PhotoLinkResult } from "@/clouds/photoLink";
import { cx, focusRing, Pill, Popover, toast } from "@/ui";
import { disabledReason, methodLabel, photoCount, photoLinkMessage, spotOf } from "./cameraMath";
import { useCamerasStore } from "./store";
import { useCanvasClicks } from "./useCanvasClicks";

/**
 * Tool I (spec §10.3): a click picks a point, runs C-X1's `photosSeeing` over the cameras payload,
 * toasts the count and the closest photo, and lists the hits near the click; a hit opens the image
 * at the spot (cloud → image jump, §10.4). The tool stays armed.
 */
export function PhotoLinkTool({
  projectId,
  cloud,
  viewer,
  active,
}: {
  projectId: string;
  cloud: PointCloud;
  viewer: RefObject<CloudViewerHandle | null>;
  active: boolean;
}) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const navigate = useNavigate();
  const host = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLSpanElement>(null);
  const [list, setList] = useState<{ x: number; y: number; result: PhotoLinkResult } | null>(null);
  const [wasActive, setWasActive] = useState(active);

  // Controller rework: a stale list must not reappear when the tool is re-armed, so it is cleared as
  // soon as the tool stops being active rather than merely hidden while inactive. Adjusted during
  // render (React's recommended pattern for state derived from a prop change), not in an effect, so
  // there is no frame where the old list is visible again before it clears.
  if (active !== wasActive) {
    setWasActive(active);
    if (!active) setList(null);
  }

  useCanvasClicks(active, (x, y) => {
    const v = viewer.current;
    if (!v) return;
    const { status, set, error } = useCamerasStore.getState();
    const reason = disabledReason(status, set, error);
    if (reason !== null || !set) {
      toast("info", reason ?? "The drone photos are not loaded yet");
      return;
    }
    // C-V2's pick with the §9.1 PCA normal (Ruling 3): the facing test runs whenever it is not null.
    // pickWithNormal answers null while a capture runs; that is treated as a miss, same as no point.
    const pick = v.pickWithNormal(x, y);
    if (!pick) {
      toast("info", "No point under the cursor; click on the cloud");
      return;
    }
    const [px, py, pz] = pick.point;
    const result = photosSeeing({ x: px, y: py, z: pz }, pick.normal, set);
    const r = host.current?.getBoundingClientRect();
    setList({ x: x - (r?.left ?? 0), y: y - (r?.top ?? 0), result });
    const first = result.hits[0];
    if (!first) {
      toast("info", photoLinkMessage(0, null, null));
      return;
    }
    fetchImage(api, projectId, first.imageId)
      .then((img) => toast("info", photoLinkMessage(result.total, img.file_name, first.distanceM)))
      .catch(() => toast("info", photoLinkMessage(result.total, null, first.distanceM)));
  });

  return (
    <div ref={host} className="pointer-events-none absolute inset-0" data-testid="photo-link-layer">
      {list && <span ref={anchor} className="absolute h-px w-px" style={{ left: list.x, top: list.y }} />}
      {list && (
        <Popover open onClose={() => setList(null)} anchorRef={anchor} label="Photo link" side="right">
          <div className="flex max-h-96 w-72 flex-col gap-2 p-3">
            <p className="text-sm text-ink">
              {list.result.total === 0
                ? "No photo saw this point"
                : `${photoCount(list.result.total)} saw this point`}
            </p>
            <ul
              aria-label="Photos that saw this point"
              className="flex min-h-0 flex-col gap-1 overflow-y-auto"
            >
              {list.result.hits.map((h, k) => {
                const d = `${h.distanceM.toFixed(1)} m`;
                const spot = spotOf(h);
                return (
                  <li key={h.index}>
                    <button
                      type="button"
                      aria-label={`Open photo ${k + 1}, ${methodLabel(h.method)}, ${d}`}
                      className={cx(
                        "flex w-full items-center gap-2 rounded-control p-1 text-left hover:bg-hover",
                        focusRing,
                      )}
                      onClick={() => navigate(imageJumpHref(projectId, h.imageId, cloud.id, spot))}
                    >
                      <img
                        src={thumbnailUrl(baseUrl, token, projectId, h.imageId)}
                        loading="lazy"
                        alt=""
                        className="h-9 w-12 shrink-0 rounded-control bg-surface-2 object-cover"
                      />
                      <span className="min-w-0 flex-1 text-xs text-muted">
                        {d}
                        {h.zAssumed ? " · height assumed" : ""}
                      </span>
                      <Pill size="sm" tone={h.method === "frustum" ? "accent" : "neutral"}>
                        {methodLabel(h.method)}
                      </Pill>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-2xs text-muted">
              In frame: likely in the photo; the ring allows ±3 m GPS and 2° gimbal error. By distance: no
              spot.
            </p>
          </div>
        </Popover>
      )}
    </div>
  );
}
