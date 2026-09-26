import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createSiteArea, type SiteArea } from "@/api/siteAreas";
import { Button, Input } from "@/ui";

/**
 * The strip over the map while a site area is being outlined: how to draw, then a name and Save.
 * The outline goes to the server in this map's pixels; the server places it in WGS84, so the same
 * area lands on every other map of the site.
 */
export function SiteAreaDrawBar({
  projectId,
  mapId,
  polygon,
  onCancel,
  onSaved,
}: {
  projectId: string;
  mapId: string;
  polygon: number[][] | null;
  onCancel: () => void;
  onSaved: (area: SiteArea) => void;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    if (!polygon || !name.trim()) return;
    setSaving(true);
    setError(null);
    createSiteArea(api, projectId, { name: name.trim(), map_id: mapId, polygon_px: polygon })
      .then(onSaved)
      .catch((e: unknown) => setError(messageOf(e, "Could not save the site area.")))
      .finally(() => setSaving(false));
  };

  return (
    <div
      data-testid="site-area-draw"
      className="absolute left-1/2 top-3 z-10 flex w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 flex-col gap-2 rounded-control border border-line bg-glass-solid p-3 shadow-float"
    >
      {polygon ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            dense
            autoFocus
            aria-label="Site area name"
            placeholder="Name, e.g. North laydown yard"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Button type="submit" size="sm" variant="primary" disabled={!name.trim()} loading={saving}>
            Save site area
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink">
            Click around the site area to outline it. Double-click to finish.
          </p>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
