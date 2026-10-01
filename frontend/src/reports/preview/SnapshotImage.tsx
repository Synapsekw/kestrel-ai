import { useState } from "react";
import type { SnapshotRef } from "@/api/reports";
import { Button } from "@/ui";
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
  // Bumped by Retry: a new <img> element re-requests the same src (no cache-busting query).
  const [attempt, setAttempt] = useState(0);
  const retry = () => {
    setPhase("loading");
    setAttempt((n) => n + 1);
  };
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
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{ gap: mm(2.5), padding: mm(4) }}
        >
          <div role="img" aria-label={`${alt}: ${reason}`} style={textStyle(PRINT.size.small, PRINT.muted)}>
            {reason}
          </div>
          {/* Only a failed load can be retried; a missing source or no backend would fail the same way. */}
          {phase === "failed" && !missing ? (
            <Button
              size="sm"
              variant="secondary"
              icon="refresh"
              onClick={retry}
              aria-label={`Retry ${alt}`}
              style={{ color: PRINT.ink, background: PRINT.paper, borderColor: PRINT.rule }}
            >
              Retry
            </Button>
          ) : null}
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
              key={attempt}
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
