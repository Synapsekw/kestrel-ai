import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { thumbnailUrl } from "@contract/client";
import { useBackend } from "@/api/client";
import { cx, focusRing, IconButton, severityOf, Skeleton, useSeverityScale } from "@/ui";
import { indexNeighbours } from "./navigation";
import { useThumb } from "./thumbs";
import { FLAG_REVIEWED, type ImageIndexState } from "./useImageIndex";

/** Spec §6.2: a 64 px strip of 60×44 thumbs; the current one is 72 px wide. */
export const FILM_W = 60;
export const FILM_H = 44;
export const FILM_CURRENT_W = 72;
export const FILM_GAP = 4;
export const FILM_FALLBACK_WIDTH = 640;
const MASK = "linear-gradient(90deg, transparent, #000 24px, #000 calc(100% - 24px), transparent)";

export interface FilmstripProps {
  projectId: string;
  index: ImageIndexState;
  currentId: string | null;
  onOpen: (id: string) => void;
}

/** The ordinals shown: as many as fit plus one each side, centred on the current frame. */
export function filmstripWindow(
  ordinal: number,
  total: number,
  width: number,
): { start: number; end: number } {
  if (total === 0) return { start: 0, end: 0 };
  const w = width > 0 ? width : FILM_FALLBACK_WIDTH;
  const n = Math.min(total, Math.ceil(w / (FILM_W + FILM_GAP)) + 2);
  const centre = Math.max(0, ordinal);
  let start = Math.max(0, centre - Math.floor(n / 2));
  const end = Math.min(total, start + n);
  start = Math.max(0, end - n);
  return { start, end };
}

function useElementWidth(ref: RefObject<HTMLElement>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function Frame(p: {
  ordinal: number;
  src: string;
  sev: number;
  reviewed: boolean;
  current: boolean;
  onOpen: () => void;
}) {
  const thumb = useThumb(p.src);
  const scale = useSeverityScale();
  const level = severityOf(scale, p.sev > 0 ? p.sev : null);
  return (
    <div
      role="listitem"
      data-ordinal={p.ordinal}
      aria-current={p.current ? "true" : undefined}
      className="shrink-0"
    >
      <button
        type="button"
        aria-label={`Image ${p.ordinal + 1}`}
        onClick={p.onOpen}
        style={{ width: p.current ? FILM_CURRENT_W : FILM_W, height: FILM_H }}
        className={cx(
          "relative block overflow-hidden rounded-sm border",
          "transition-transform duration-base ease-out hover:-translate-y-0.5 hover:scale-[1.03]",
          "reduce-motion:transition-none reduce-motion:hover:translate-y-0 reduce-motion:hover:scale-100",
          p.current ? "border-accent ring-2 ring-accent/40" : "border-line",
          focusRing,
        )}
      >
        {thumb.src ? (
          <img src={thumb.src} alt="" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <Skeleton className="h-full w-full rounded-none" />
        )}
        {level && (
          <span
            data-part="sev"
            aria-hidden
            className="absolute bottom-1 left-1 h-2 w-2 rounded-full bg-[color:var(--c)] ring-1 ring-bg"
            style={{ "--c": level.colour } as CSSProperties}
          />
        )}
        {p.reviewed && <span className="sr-only">reviewed</span>}
      </button>
    </div>
  );
}

/** Spec §6.2: the filmstrip under the canvas, over the same index as the grid. */
export function Filmstrip({ projectId, index, currentId, onOpen }: FilmstripProps) {
  const { baseUrl, token } = useBackend();
  const strip = useRef<HTMLDivElement>(null);
  const width = useElementWidth(strip);
  const { ordinal, prev, next } = indexNeighbours(index, currentId);
  const { start, end } = filmstripWindow(ordinal, index.total, width);
  const ids = useMemo(() => index.ids.slice(start, end), [index.ids, start, end]);

  return (
    <div className="flex h-16 items-center gap-2 px-2" data-testid="filmstrip">
      <IconButton
        icon="chevron-left"
        label="Previous image"
        size="sm"
        disabled={!prev}
        onClick={() => prev && onOpen(prev)}
      />
      <div
        ref={strip}
        role="list"
        aria-label="Filmstrip"
        className="flex min-w-0 flex-1 items-center justify-center overflow-hidden"
        style={{ gap: FILM_GAP, maskImage: MASK, WebkitMaskImage: MASK }}
      >
        {ids.map((id, i) => {
          const o = start + i;
          return (
            <Frame
              key={id}
              ordinal={o}
              src={thumbnailUrl(baseUrl, token, projectId, id)}
              sev={index.sev[o] ?? 0}
              reviewed={((index.flags[o] ?? 0) & FLAG_REVIEWED) !== 0}
              current={o === ordinal}
              onOpen={() => onOpen(id)}
            />
          );
        })}
      </div>
      <IconButton
        icon="chevron-right"
        label="Next image"
        size="sm"
        disabled={!next}
        onClick={() => next && onOpen(next)}
      />
      <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
        {ordinal >= 0 ? ordinal + 1 : "—"} / {index.total}
      </span>
    </div>
  );
}
