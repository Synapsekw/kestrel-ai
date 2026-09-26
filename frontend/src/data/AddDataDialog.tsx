import { useCallback, useState } from "react";
import type { Project } from "@contract/client";
import type { AddDataTile } from "@/app/addDataStore";
import { ImportCloudDialog } from "@/clouds/ImportCloudDialog";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { useChangesStore } from "@/store/changes";
import { ImportElevationDialog } from "@/surfaces/ImportElevationDialog";
import { Dialog, Icon, Tooltip, cx, focusRing, lift, pressable, toast, transition } from "@/ui";
import { ADD_DATA_TILES } from "./addDataTiles";
import { ImportImagesDialog } from "./ImportImagesDialog";

const TILE_NAME: Record<AddDataTile, string> = {
  photos: "Photos",
  orthomosaic: "Orthomosaic",
  elevation: "Elevation",
  point_cloud: "Point cloud",
};

/** F §6.4: five tiles, each opening today's importer; closes once the import job is queued. */
export function AddDataDialog({
  project,
  initialTile = null,
  onClose,
}: {
  project: Project;
  initialTile?: AddDataTile | null;
  onClose: () => void;
}) {
  const [tile, setTile] = useState<AddDataTile | null>(initialTile);
  const started = useCallback(
    (t: AddDataTile) => {
      useChangesStore.getState().bumpData();
      toast("ok", `${TILE_NAME[t]} import started. It runs in the background; follow it in Jobs.`);
      onClose();
    },
    [onClose],
  );
  const pid = project.id;

  if (tile === "photos")
    return <ImportImagesDialog project={project} onClose={onClose} onStarted={() => started("photos")} />;
  if (tile === "orthomosaic")
    return <ImportMapDialog projectId={pid} onClose={onClose} onStarted={() => started("orthomosaic")} />;
  if (tile === "elevation")
    return <ImportElevationDialog projectId={pid} onClose={onClose} onStarted={() => started("elevation")} />;
  if (tile === "point_cloud")
    return <ImportCloudDialog projectId={pid} onClose={onClose} onStarted={() => started("point_cloud")} />;

  return (
    <Dialog
      open
      title="Add data"
      width="lg"
      description="Everything imports in the background. A new item shows as importing until it is ready."
      onClose={onClose}
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ADD_DATA_TILES.map((t) => {
          const choose = t.tile === "drawing" || t.disabledReason ? undefined : t.tile;
          const button = (
            <button
              key={t.tile}
              type="button"
              aria-disabled={choose ? undefined : true}
              onClick={choose ? () => setTile(choose) : undefined}
              className={cx(
                "flex h-full w-full flex-col items-start gap-2 rounded-panel border border-card-line bg-surface p-4 text-left",
                focusRing,
                transition,
                choose ? cx("hover:border-line-strong", lift, pressable) : "cursor-not-allowed opacity-60",
              )}
            >
              <span className="grid h-9 w-9 place-items-center rounded-control bg-accent-soft text-accent-ink">
                <Icon name={t.icon} size={18} />
              </span>
              <span className="text-base font-semibold text-ink">{t.title}</span>
              <span className="text-xs text-muted">{t.disabledReason ?? t.hint}</span>
            </button>
          );
          return t.disabledReason ? (
            <Tooltip key={t.tile} label={t.disabledReason}>
              {button}
            </Tooltip>
          ) : (
            button
          );
        })}
      </div>
    </Dialog>
  );
}
