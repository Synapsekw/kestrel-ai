import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { Box, ClassDef } from "@contract/client";
import type { Finding } from "@/api/findings";
import { formatFindingNumber, formatPercent } from "@/findings/format";
import { findingsTabPath } from "@/findings/links";
import { GlassPanel, Pill, cx, severityOf, useSeverityScale } from "@/ui";

const STATUS: Record<string, string> = { open: "Open", reviewed: "Reviewed", closed: "Closed" };
const ROW =
  "grid w-full grid-cols-[10px_minmax(0,1fr)_auto_auto] items-center gap-2 rounded-control border border-transparent px-2 py-1.5 text-left text-xs transition-transform duration-fast ease-out hover:translate-x-0.5 hover:bg-surface-2 reduce-motion:transition-none reduce-motion:hover:translate-x-0";

export interface FindingsOnImageProps {
  projectId: string;
  findings: Finding[];
  more: boolean;
  boxes: Readonly<Record<string, Box>>;
  types: ReadonlyMap<string, ClassDef>;
  selectedId: string | null;
  onSelect: (annotationId: string) => void;
}

const isGroundTruth = (b: Box) =>
  b.provenance.kind === "person" || b.review_state === "accepted" || b.review_state === "edited";

/** §6.3: findings (worst first), then accepted objects; rows and the canvas selection sync both ways. */
export function FindingsOnImage({
  projectId,
  findings,
  more,
  boxes,
  types,
  selectedId,
  onSelect,
}: FindingsOnImageProps) {
  const scale = useSeverityScale();
  const objects = Object.values(boxes).filter(
    (b) => types.get(b.class_id)?.kind === "object" && isGroundTruth(b),
  );
  return (
    <GlassPanel
      as="section"
      aria-label="Findings on this image"
      className="flex min-h-0 flex-col gap-2 p-3.5"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted">{`Findings on this image · ${findings.length}${more ? "+" : ""}`}</h3>
        <Link
          to={findingsTabPath(projectId, "anchor_kind=image")}
          className="text-xs font-medium text-accent-ink hover:underline"
        >
          Open in Findings →
        </Link>
      </div>
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {findings.map((f) => {
          if (f.anchor.kind !== "image") return null;
          const annotationId = f.anchor.annotation_id;
          const type = types.get(f.type_id);
          const sev = severityOf(scale, f.severity);
          const shape = boxes[annotationId]?.shape ?? "box";
          return (
            <button
              key={f.id}
              type="button"
              aria-pressed={selectedId === annotationId}
              onClick={() => onSelect(annotationId)}
              className={cx(ROW, selectedId === annotationId && "border-accent bg-accent-soft")}
              style={{ "--c": type?.colour ?? "#888888" } as CSSProperties}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[color:var(--c)]" />
              <span className="min-w-0 truncate">
                <span className="text-ink">{type?.name ?? "Unknown type"}</span>{" "}
                <small className="font-mono text-muted">{`${formatFindingNumber(f.number)} · ${shape} · ${STATUS[f.status] ?? f.status}`}</small>
              </span>
              <Pill size="sm">Defect</Pill>
              <span className="text-muted">{sev?.name ?? "No severity"}</span>
            </button>
          );
        })}
        {objects.map((b) => {
          const type = types.get(b.class_id);
          return (
            <button
              key={b.id}
              type="button"
              aria-pressed={selectedId === b.id}
              onClick={() => onSelect(b.id)}
              className={cx(ROW, selectedId === b.id && "border-accent bg-accent-soft")}
              style={{ "--c": type?.colour ?? "#888888" } as CSSProperties}
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-[color:var(--c)]" />
              <span className="min-w-0 truncate text-ink">{type?.name ?? "Unknown type"}</span>
              <Pill size="sm">Object</Pill>
              <span className="font-mono text-muted">{formatPercent(b.confidence) ?? "Drawn"}</span>
            </button>
          );
        })}
      </div>
    </GlassPanel>
  );
}
