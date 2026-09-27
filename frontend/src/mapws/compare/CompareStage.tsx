/* eslint-disable react-refresh/only-export-components --
   sideLabel and ghostOffset are pure helpers tested next to the overlay that uses them. */
import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { cx, focusRing } from "@/ui";
import { useWorkspace } from "../context";
import { useRasterPlacements } from "../data/useRasterLayers";
import type { Placement } from "../layers/placement";
import type { PanelProps } from "../panels/panelRegistry";
import { formatSurveyDate } from "../timeline/timelineModel";
import { hasDataIn, sideExtent, viewExtent } from "./coverage";
import { useStageSize } from "./stageSize";
import { clampSwipe, swipeFromPointer } from "./swipeClip";

/** Ruling W2-6. */
export function sideLabel(
  placements: readonly Placement[],
  side: "left" | "right",
): "Ortho" | "Elevation" | "No data" {
  const own = placements.filter((p) => p.side === side && p.row.date !== null);
  if (own.some((p) => p.row.group === "base")) return "Ortho";
  return own.length > 0 ? "Elevation" : "No data";
}

/** Ruling W2-8: the same offset in the other half of the stage; null outside the stage. */
export function ghostOffset(
  clientX: number,
  clientY: number,
  root: DOMRect,
): { x: number; y: number } | null {
  const x = clientX - root.left;
  const y = clientY - root.top;
  if (x < 0 || y < 0 || x > root.width || y > root.height) return null;
  const half = root.width / 2;
  return { x: x < half ? x + half : x - half, y };
}

const NOTE =
  "absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-control bg-glass-solid px-3 py-1.5 text-xs text-muted";
const LABEL = "absolute top-[112px] rounded-chip bg-glass-solid px-2.5 py-1 text-2xs tabular-nums text-ink";

function SwipeDivider({ rootRef }: { rootRef: RefObject<HTMLDivElement> }) {
  const { swipe, setSwipe, l, r } = useWorkspace(
    useShallow((s) => ({
      swipe: s.swipe,
      setSwipe: s.setSwipe,
      l: s.l,
      r: s.r,
    })),
  );
  const drag = useRef<{ left: number; width: number } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { left: rect.left, width: rect.width };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setSwipe(swipeFromPointer(e.clientX, drag.current.left, drag.current.width));
  };
  const end = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 10 : 1;
    const next =
      e.key === "ArrowLeft"
        ? swipe - step
        : e.key === "ArrowRight"
          ? swipe + step
          : e.key === "Home"
            ? 2
            : e.key === "End"
              ? 98
              : null;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    setSwipe(clampSwipe(next));
  };
  return (
    <div
      data-testid="swipe-line"
      className="absolute inset-y-0 w-px -translate-x-1/2 bg-ink/80"
      style={{ left: `${swipe}%` }}
    >
      <div
        role="slider"
        tabIndex={0}
        aria-label="Swipe divider"
        aria-valuemin={2}
        aria-valuemax={98}
        aria-valuenow={Math.round(swipe)}
        aria-valuetext={`${Math.round(swipe)}%`}
        data-testid="swipe-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={end}
        onPointerCancel={end}
        onKeyDown={onKeyDown}
        className={cx(
          "pointer-events-auto absolute left-1/2 top-1/2 grid h-[38px] w-[38px] -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-chip bg-grad-primary text-accent-fg shadow-glow",
          focusRing,
        )}
      >
        <span aria-hidden="true" className="font-mono text-xs">
          ⟷
        </span>
      </div>
      <div className="absolute left-1/2 top-[calc(50%+28px)] flex -translate-x-1/2 gap-1.5 whitespace-nowrap">
        <span className="rounded-chip bg-glass-solid px-2 py-0.5 text-2xs tabular-nums text-ink">
          {formatSurveyDate(l, true)}
        </span>
        <span className="rounded-chip bg-glass-solid px-2 py-0.5 text-2xs tabular-nums text-ink">
          {formatSurveyDate(r, true)}
        </span>
      </div>
    </div>
  );
}

function Ghost({ rootRef }: { rootRef: RefObject<HTMLDivElement> }) {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: globalThis.PointerEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      setAt(rect ? ghostOffset(e.clientX, e.clientY, rect) : null);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [rootRef]);
  if (!at) return null;
  return (
    <svg
      data-testid="ghost-crosshair"
      aria-hidden="true"
      width="22"
      height="22"
      viewBox="-11 -11 22 22"
      className="absolute -left-[11px] -top-[11px] text-ink/70"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <path d="M-10 0H-3M3 0H10M0 -10V-3M0 3V10" stroke="currentColor" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/** M §5 Swipe and Side-by-side overlays and the §14 no-data note. Pointer-transparent except the handle. */
function CompareStageOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const { mode, l, r, swipe, viewInfo } = useWorkspace(
    useShallow((s) => ({
      mode: s.mode,
      l: s.l,
      r: s.r,
      swipe: s.swipe,
      viewInfo: s.viewInfo,
    })),
  );
  const size = useStageSize((s) => s.size);
  const setSize = useStageSize((s) => s.setSize);
  const placements = useRasterPlacements();

  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, [setSize]);

  const swiping = mode === "swipe";
  const side = mode === "side";
  let leftEmpty = false;
  let rightEmpty = false;
  if ((swiping || side) && viewInfo && size) {
    const paneSize: [number, number] = side ? [size[0] / 2, size[1]] : size;
    const ext = viewExtent(viewInfo, paneSize);
    leftEmpty = !hasDataIn(swiping ? sideExtent(ext, swipe, "left") : ext, placements, "left");
    rightEmpty = !hasDataIn(swiping ? sideExtent(ext, swipe, "right") : ext, placements, "right");
  }
  const leftAt = swiping ? swipe / 2 : 25;
  const rightAt = swiping ? swipe + (100 - swipe) / 2 : 75;

  return (
    <div ref={rootRef} data-testid="compare-stage" className="pointer-events-none absolute inset-0">
      {swiping && <SwipeDivider rootRef={rootRef} />}
      {side && (
        <>
          <span data-testid="side-label-left" className={cx(LABEL, "right-[calc(50%+12px)]")}>
            {`◀ ${formatSurveyDate(l)} · ${sideLabel(placements, "left")}`}
          </span>
          <span data-testid="side-label-right" className={cx(LABEL, "left-[calc(50%+12px)]")}>
            {`${formatSurveyDate(r)} · ${sideLabel(placements, "right")} ▶`}
          </span>
          <div aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-glass-line" />
          <Ghost rootRef={rootRef} />
        </>
      )}
      {leftEmpty && (
        <span data-testid="no-data-left" className={NOTE} style={{ left: `${leftAt}%` }}>
          {`No ${formatSurveyDate(l, true)} data here`}
        </span>
      )}
      {rightEmpty && (
        <span data-testid="no-data-right" className={NOTE} style={{ left: `${rightAt}%` }}>
          {`No ${formatSurveyDate(r, true)} data here`}
        </span>
      )}
    </div>
  );
}

export const CompareStage: ComponentType<PanelProps> = CompareStageOverlay;
