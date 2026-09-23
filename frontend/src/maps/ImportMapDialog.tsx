import { useState, type FormEvent } from "react";
import type { GeoMap } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createMap } from "@/api/maps";
import { useJobsStore } from "@/store/jobs";
import { Button, Dialog, Field, Input } from "@/ui";

export function ImportMapDialog({
  projectId,
  onClose,
  onStarted,
}: {
  projectId: string;
  onClose: () => void;
  onStarted: (m: GeoMap) => void;
}) {
  const api = useApi();
  const { mode } = useBackend();
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function browse() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "GeoTIFF", extensions: ["tif", "tiff"] }],
    });
    if (typeof picked === "string") setPath(picked);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return setError("Choose the GeoTIFF to import.");
    setBusy(true);
    setError(null);
    try {
      const r = await createMap(api, projectId, {
        path: path.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      useJobsStore.getState().upsert(r.job);
      onStarted(r.map);
    } catch (err) {
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import map"
      description="Pick an orthomosaic GeoTIFF of any size. The file itself is only read: the project keeps a zoomable copy next to it. Big maps take a few minutes and import in the background."
      onClose={() => !busy && onClose()}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="import" loading={busy}>
            Start import
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="GeoTIFF file" htmlFor="map-path" error={error}>
          <div className="flex gap-2">
            <Input
              id="map-path"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="D:\orthos\site.tif"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && <Button onClick={() => void browse()}>Browse</Button>}
          </div>
        </Field>
        <Field label="Name" htmlFor="map-name" hint="Defaults to the file name.">
          <Input id="map-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
