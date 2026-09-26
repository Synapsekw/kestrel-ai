import { useEffect, useState, type FormEvent } from "react";
import type { GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import {
  createPointCloud,
  inspectPointCloudFile,
  type PointCloud,
  type PointCloudFileInfo,
} from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { listMaps } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Select } from "@/ui";
import { formatBytes, formatPoints } from "./format";

const INSPECT_DELAY_MS = 300;

export function ImportCloudDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose(): void;
  onStarted(c: PointCloud): void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [mapId, setMapId] = useState("");
  const [maps, setMaps] = useState<GeoMap[]>([]);
  // The last inspect answer and the path it was for: a stale answer for another path shows nothing.
  const [inspected, setInspected] = useState<{
    path: string;
    info: PointCloudFileInfo | null;
    error: string | null;
  } | null>(null);
  const current = inspected && inspected.path === path.trim() ? inspected : null;
  const info = current?.info ?? null;
  const inspectError = current?.error ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void listMaps(api, projectId)
      .then((ms) => setMaps(ms.filter((m) => m.status === "ready" && m.crs_wkt)))
      .catch(() => setMaps([]));
  }, [api, projectId]);

  useEffect(() => {
    const p = path.trim();
    if (!p) return;
    let live = true;
    const t = window.setTimeout(() => {
      inspectPointCloudFile(api, projectId, p)
        .then((i) => live && setInspected({ path: p, info: i, error: null }))
        .catch(
          (e: unknown) =>
            live && setInspected({ path: p, info: null, error: messageOf(e, "could not read the file") }),
        );
    }, INSPECT_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [api, projectId, path]);

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "LAS / LAZ point cloud", extensions: ["las", "laz"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!info?.admission.ok) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createPointCloud(api, projectId, {
        path: path.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(mapId ? { map_id: mapId } : {}),
      });
      useJobsStore.getState().upsert(r.job);
      onStarted(r.cloud);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import point cloud"
      description="Pick a LAS or LAZ file. It is only read: the project keeps a 3D view copy next to it. Big clouds take a few minutes and import in the background, one at a time."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy} disabled={!info?.admission.ok}>
            Import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="LAS or LAZ file" htmlFor="cloud-path" error={inspectError ?? error}>
          <div className="flex gap-2">
            <Input
              id="cloud-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\clouds\site.las"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        {info && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">Points</dt>
            <dd className="text-right tabular-nums">{formatPoints(info.point_count)}</dd>
            <dt className="text-muted">File</dt>
            <dd className="text-right tabular-nums">
              {formatBytes(info.size)} · LAS {info.las_version} · format {info.point_format}
              {info.compressed ? " · LAZ" : ""}
            </dd>
            <dt className="text-muted">Coordinates</dt>
            <dd className="text-right">
              {info.epsg ? `EPSG:${info.epsg}` : info.crs_wkt ? "custom CRS" : "none in the file"}
            </dd>
            <dt className="text-muted">Colour</dt>
            <dd className="text-right">{info.has_rgb ? "RGB" : "none (shown by elevation)"}</dd>
          </dl>
        )}
        {info && !info.admission.ok && <Alert tone="danger">{info.admission.reason}</Alert>}
        <Field label="Name" htmlFor="cloud-name" hint="Defaults to the file name.">
          <Input id="cloud-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {maps.length > 0 && (
          <Field
            label="Linked map"
            htmlFor="cloud-map"
            hint="The orthomosaic of the same flight, for jumping between 2D and 3D."
          >
            <Select id="cloud-map" value={mapId} onChange={(e) => setMapId(e.target.value)}>
              <option value="">No link</option>
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
    </Dialog>
  );
}
