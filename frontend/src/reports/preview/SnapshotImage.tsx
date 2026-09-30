import { useState } from "react";
import type { SnapshotRef } from "@/api/reports";
import { PRINT, mm, textStyle } from "../printTheme";
import { usePreviewEnv } from "./PreviewContext";
import { useInView } from "./useInView";

/** Figures start loading this far before they scroll into view (spec §9.5: only visible figures). */
export const FIGURE_MARGIN = "600px 0px";

export function SnapshotImage({
  snapshot,
  widthMm,
  heightMm,
  alt,
}: {
  snapshot: SnapshotRef;
  widthMm: number;
  heightMm: number;
  alt: string;
}) {
  const { resolveSnapshot } = usePreviewEnv();
  const [ref, seen] = useInView<HTMLDivElement>(FIGURE_MARGIN, { once: true });
  const [phase, setPhase] = useState<"loading" | "loaded" | "failed">("loading");
  const missing = snapshot.missing_reason ?? null;
  const src = seen && !missing ? resolveSnapshot(snapshot) : null;
  const reason =
    missing ??
    (phase === "failed"
      ? "The snapshot could not be loaded."
      : seen && src === null
        ? "Snapshots show when the report is open in a project."
        : null);
  return (
    <div
      ref={ref}
      data-snapshot={snapshot.key}
      className="relative overflow-hidden"
      style={{
        width: mm(widthMm),
        maxWidth: "100%",
        aspectRatio: `${widthMm} / ${heightMm}`,
        borderRadius: mm(PRINT.radius),
        background: PRINT.placeholder,
      }}
    >
      {reason ? (
        <div
          role="img"
          aria-label={`${alt}: ${reason}`}
          className="absolute inset-0 grid place-items-center text-center"
          style={{ ...textStyle(PRINT.size.small, PRINT.muted), padding: mm(4) }}
        >
          {reason}
        </div>
      ) : (
        <>
          {phase !== "loaded" && (
            <div
              aria-hidden="true"
              data-testid="snapshot-skeleton"
              className={src ? "absolute inset-0 animate-shimmer" : "absolute inset-0"}
            />
          )}
          {src && (
            <img
              src={src}
              alt={alt}
              decoding="async"
              onLoad={() => setPhase("loaded")}
              onError={() => setPhase("failed")}
              className="absolute inset-0 h-full w-full object-contain"
            />
          )}
        </>
      )}
    </div>
  );
}
