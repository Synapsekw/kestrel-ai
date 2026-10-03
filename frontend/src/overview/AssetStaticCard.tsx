import { Link } from "react-router-dom";
import type { AssetModel } from "@contract/client";
import { formatHeight } from "@/findings/format";
import { cx, focusRing, Icon } from "@/ui";

export function assetModelPath(projectId: string, modelId: string): string {
  return `/p/${projectId}/models/${modelId}`;
}

/** The hero when the 3D view cannot or should not run (reduced effects, no WebGL, a load error). */
export function AssetStaticCard({ projectId, model }: { projectId: string; model: AssetModel }) {
  const facts = [
    model.tag,
    model.frame ? formatHeight(model.frame.height_m) : null,
    model.current_version !== null ? `v${model.current_version}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      data-testid="asset-static-card"
      className="grid h-full place-items-center bg-surface-2 p-4 text-center"
    >
      <div className="flex flex-col items-center gap-2">
        <Icon name="cube" size={28} className="text-muted" />
        <p className="text-sm font-semibold text-ink">{model.name}</p>
        {facts && <p className="font-mono text-2xs text-muted">{facts}</p>}
        <Link to={assetModelPath(projectId, model.id)} className={cx("text-xs text-accent-ink", focusRing)}>
          Open in Asset models
        </Link>
      </div>
    </div>
  );
}
