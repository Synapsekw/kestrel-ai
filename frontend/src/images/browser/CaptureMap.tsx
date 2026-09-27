import { useState, type CSSProperties } from "react";
import { cx, EmptyState, focusRing, GlassPanel, Pill, severityOf, useSeverityScale } from "@/ui";
import type { BrowserSort } from "./filters";
import type { FootprintInput } from "./captureModel";
import { plural, stemOf } from "./format";
import { useCaptureMap } from "./useCaptureMap";
import { useImageDetails } from "./useImageDetails";
import type { ImageIndexState } from "./useImageIndex";
import "./browser.css";

export interface CaptureMapProps {
  projectId: string;
  index: ImageIndexState;
  currentId: string | null;
  sort: BrowserSort;
  footprint: FootprintInput | null;
  onOpen: (id: string) => void;
  /** Shift+drag: the ids inside the rectangle, for batch detection (FA/FW). */
  onLasso?: (ids: string[]) => void;
}

export const NO_WEBGL = "The capture map needs WebGL, which this graphics driver does not provide.";

function HoverTip({
  projectId,
  index,
  hovered,
}: {
  projectId: string;
  index: ImageIndexState;
  hovered: { ordinal: number; pixel: number[] };
}) {
  const scale = useSeverityScale();
  const id = index.ids[hovered.ordinal];
  const details = useImageDetails(projectId, id ? [id] : []);
  const row = id ? details.get(id) : undefined;
  const count = index.count[hovered.ordinal] ?? 0;
  const level = severityOf(scale, (index.sev[hovered.ordinal] ?? 0) || null);
  return (
    <GlassPanel
      variant="float"
      role="tooltip"
      className="pointer-events-none absolute z-[3] px-2 py-1 text-2xs"
      style={{ left: hovered.pixel[0] + 10, top: hovered.pixel[1] + 10 }}
    >
      <span className="block font-mono text-ink">
        {row ? stemOf(row.file_name) : `Image ${hovered.ordinal + 1}`}
      </span>
      <span className="text-muted">
        {count > 0 ? `${plural(count, "finding")} · ${level?.name ?? "No severity"}` : "No findings"}
      </span>
    </GlassPanel>
  );
}

function Legend() {
  const scale = useSeverityScale();
  return (
    <GlassPanel
      variant="float"
      className="absolute bottom-2 left-2 right-2 z-[2] flex flex-wrap gap-3 px-2.5 py-1.5 text-2xs"
    >
      {[...scale]
        .sort((a, b) => b.level - a.level)
        .map((l) => (
          <span
            key={l.level}
            className="inline-flex items-center gap-1.5"
            style={{ "--c": l.colour } as CSSProperties}
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-[color:var(--c)]" />
            {l.name}
          </span>
        ))}
    </GlassPanel>
  );
}

/** Spec §6.1 map mode / §7.5: capture points, the flight path, the current footprint and ring. */
export function CaptureMap(p: CaptureMapProps) {
  const [showFootprint, setShowFootprint] = useState(true);
  // Destructured at the call site: the hook's return mixes `targetRef` with plain data, and
  // holding the whole object taints every property read as a ref access under react-hooks/refs.
  const { targetRef, webgl, points, hovered } = useCaptureMap({
    projectId: p.projectId,
    index: p.index,
    currentId: p.currentId,
    interactive: true,
    onOpen: p.onOpen,
    onLasso: p.onLasso,
    sort: p.sort,
    footprint: p.footprint,
    showFootprint,
  });
  const missing = p.index.total - points.length;

  if (!webgl) return <EmptyState icon="map" title={NO_WEBGL} />;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-panel bg-bg" data-testid="capture-map">
      <div ref={targetRef} className="absolute inset-0" />
      <div className="absolute left-2 right-2 top-2 z-[2] flex flex-wrap gap-1.5">
        <Pill size="sm">
          Capture points · <span className="font-mono">{points.length}</span>
        </Pill>
        <button
          type="button"
          aria-pressed={showFootprint}
          onClick={() => setShowFootprint((v) => !v)}
          className={cx("rounded-chip", focusRing)}
        >
          <Pill size="sm" tone={showFootprint ? "accent" : "neutral"}>
            Footprint
          </Pill>
        </button>
        {missing > 0 && (
          <Pill size="sm" tone="warn">
            <span className="font-mono">{missing}</span> of <span className="font-mono">{p.index.total}</span>{" "}
            without location
          </Pill>
        )}
      </div>
      {hovered && <HoverTip projectId={p.projectId} index={p.index} hovered={hovered} />}
      <Legend />
    </div>
  );
}
