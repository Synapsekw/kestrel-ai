import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { Project } from "@contract/client";
import { ImportImagesDialog } from "@/data/ImportImagesDialog";
import { ImportMapDialog } from "@/maps/ImportMapDialog";
import { Dialog, Icon, Tooltip, cx, focusRing, type IconName } from "@/ui";
import { useAddData, type AddDataTile } from "./addDataStore";

type TileId = AddDataTile | "drawing";

const TILES: { id: TileId; label: string; hint: string; icon: IconName }[] = [
  { id: "photos", label: "Photos", hint: "A folder of drone photos", icon: "images" },
  { id: "orthomosaic", label: "Orthomosaic", hint: "A GeoTIFF map of the site", icon: "map" },
  { id: "elevation", label: "Elevation", hint: "A DSM, DTM or design surface", icon: "elevation" },
  { id: "point_cloud", label: "Point cloud", hint: "A LAS or LAZ file", icon: "cloud" },
  { id: "drawing", label: "Drawing", hint: "DXF, LandXML, PDF or PNG", icon: "drawing" },
];

function Tile({
  tile,
  disabled,
  onClick,
}: {
  tile: (typeof TILES)[number];
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-3 rounded-control border border-line bg-surface p-3 text-left hover:bg-hover disabled:opacity-50",
        focusRing,
      )}
    >
      <Icon name={tile.icon} size={20} />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-ink">{tile.label}</span>
        <span className="text-xs text-muted">{tile.hint}</span>
      </span>
    </button>
  );
}

/**
 * Add data (spec 2026-09-26-foundation section 6.4), interim until `data/AddDataDialog`: Photos and
 * Orthomosaic open today's importers; Elevation and Point cloud open the screens that import them.
 */
export function AddDataHost({ project }: { project: Project | null }) {
  const { open, tile, show, close, setProject } = useAddData();
  const navigate = useNavigate();
  const projectId = project?.id ?? null;
  useEffect(() => setProject(projectId), [projectId, setProject]);
  // Elevation and Point cloud have no dialog of their own yet: their screens import them.
  useEffect(() => {
    if (!open || !project) return;
    if (tile !== "elevation" && tile !== "point_cloud") return;
    close();
    void navigate(`/p/${project.id}/${tile === "elevation" ? "measurements" : "clouds"}`);
  }, [open, tile, project, close, navigate]);
  if (!open || !project) return null;
  const base = `/p/${project.id}`;
  const leave = (to: string) => {
    close();
    void navigate(to);
  };
  if (tile === "photos")
    return <ImportImagesDialog project={project} onClose={close} onStarted={() => leave(`${base}/images`)} />;
  if (tile === "orthomosaic")
    return <ImportMapDialog projectId={project.id} onClose={close} onStarted={() => leave(`${base}/maps`)} />;
  if (tile === "elevation" || tile === "point_cloud") return null;
  return (
    <Dialog
      open
      title="Add data"
      onClose={close}
      description="Every import runs as a background job; keep working meanwhile."
    >
      <ul className="grid grid-cols-2 gap-2">
        {TILES.map((t) => (
          <li key={t.id}>
            {t.id === "drawing" ? (
              <Tooltip label="Arrives with the Maps workspace">
                <span className="block">
                  <Tile tile={t} disabled />
                </span>
              </Tooltip>
            ) : (
              <Tile tile={t} onClick={() => show(t.id as AddDataTile)} />
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
