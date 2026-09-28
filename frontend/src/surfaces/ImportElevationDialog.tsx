import { useState } from "react";
import { Link } from "react-router-dom";
import { Dialog, Icon, cx, focusRing, pressable, transition } from "@/ui";
import { DemImportStep } from "./DemImportStep";
import { ImportDesignDialog } from "./ImportDesignDialog";

type Mode = "design" | "dem";

const OPTION = cx(
  "flex w-full items-start gap-3 rounded-control border border-line bg-field p-3 text-left hover:border-line-strong hover:bg-hover",
  focusRing,
  pressable,
  transition,
);

/**
 * Add data → Elevation (F §6.4). A design surface, a DSM built from a point cloud, and M adds its
 * plain DSM/DTM GeoTIFF mode (M §7).
 */
export function ImportElevationDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  if (mode === "design")
    return <ImportDesignDialog projectId={projectId} onClose={onClose} onStarted={() => onStarted()} />;
  if (mode === "dem")
    return (
      <DemImportStep
        projectId={projectId}
        onBack={() => setMode(null)}
        onClose={onClose}
        onStarted={() => onStarted()}
      />
    );
  return (
    <Dialog
      open
      title="Add elevation"
      description="Every elevation import runs in the background."
      onClose={onClose}
    >
      <div className="flex flex-col gap-2.5">
        <button type="button" className={OPTION} onClick={() => setMode("design")}>
          <Icon name="elevation" size={18} className="mt-0.5 text-accent-ink" />
          <span>
            <span className="block text-sm font-semibold text-ink">Design surface</span>
            <span className="block text-xs text-muted">
              A design model to compare the site against, placed on the map.
            </span>
          </span>
        </button>
        <button type="button" className={OPTION} onClick={() => setMode("dem")}>
          <Icon name="elevation" size={18} className="mt-0.5 text-accent-ink" />
          <span>
            <span className="block text-sm font-semibold text-ink">DSM / DTM GeoTIFF</span>
            <span className="block text-xs text-muted">
              A measured surface with coordinates, such as a photogrammetry DSM, for its survey date.
            </span>
          </span>
        </button>
        <Link to={`/p/${projectId}/measurements`} onClick={onClose} className={OPTION}>
          <Icon name="cloud" size={18} className="mt-0.5 text-accent-ink" />
          <span>
            <span className="block text-sm font-semibold text-ink">Build from a point cloud</span>
            <span className="block text-xs text-muted">
              Opens Measurements, where Build surface turns an imported cloud into a DSM.
            </span>
          </span>
        </Link>
      </div>
    </Dialog>
  );
}
