import { useEffect } from "react";
import type { PointCloud } from "@/api/clouds";
import { Button } from "@/ui";

export interface MapMenu {
  x: number;
  y: number;
  px: number;
  py: number;
}

/** The map's one-item right-click menu (spec §10): "Open this spot in 3D". */
export function MapContextMenu({
  menu,
  clouds,
  georeferenced,
  onOpen,
  onClose,
}: {
  menu: MapMenu;
  clouds: PointCloud[];
  /** The map has a CRS and a geotransform; without them no cloud can ever be linked to a spot on it. */
  georeferenced: boolean;
  onOpen(cloud: PointCloud): void;
  onClose(): void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="menu"
      aria-label="Map"
      className="absolute z-20 flex min-w-48 flex-col gap-0.5 rounded-md border border-line bg-panel p-1 shadow-float"
      style={{ left: menu.x, top: menu.y }}
    >
      {clouds.length === 0 ? (
        <p className="max-w-64 px-2 py-1.5 text-xs text-muted">
          {georeferenced
            ? "Link a point cloud to this map to open spots in 3D."
            : "This map has no coordinates, so its spots cannot be opened in 3D."}
        </p>
      ) : (
        clouds.map((c) => (
          <Button key={c.id} role="menuitem" size="sm" variant="ghost" icon="cloud" onClick={() => onOpen(c)}>
            {clouds.length === 1 ? "Open this spot in 3D" : `Open this spot in 3D: ${c.name}`}
          </Button>
        ))
      )}
    </div>
  );
}
