import { useCallback, useId, useState, type FormEvent } from "react";
import type { ImportSettings, Project } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createSource, type SourceWithJob } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Disclosure, Field, Input } from "@/ui";

interface Props {
  project: Project;
  onClose: () => void;
  onStarted: (result: SourceWithJob) => void;
}

interface Form {
  folder: string;
  site: string;
  max_side: string;
  quality: string;
  dedupe_threshold: string;
  group_regex: string;
}

function whole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

/** Spec section 5 import job: folder, optional site, preparation settings prefilled from the project defaults. */
export function ImportImagesDialog({ project, onClose, onStarted }: Props) {
  const api = useApi();
  const { mode } = useBackend();
  const id = useId();
  const d = project.import_defaults;
  const [form, setForm] = useState<Form>({
    folder: "",
    site: "",
    max_side: String(d.max_side),
    quality: String(d.quality),
    dedupe_threshold: String(d.dedupe_threshold),
    group_regex: d.group_regex,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (p: Partial<Form>) => {
    setForm((f) => ({ ...f, ...p }));
    setError(null); // the message was about the values just replaced
  };

  const browse = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true, multiple: false });
    if (typeof picked === "string") setForm((f) => ({ ...f, folder: picked }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const max_side = whole(form.max_side, 512, 12000);
    const quality = whole(form.quality, 50, 100);
    const dedupe_threshold = whole(form.dedupe_threshold, 0, 32);
    if (!form.folder.trim()) return setError("Choose the folder to import.");
    if (max_side === null) return setError("Max side must be a whole number from 512 to 12000.");
    if (quality === null) return setError("JPEG quality must be a whole number from 50 to 100.");
    if (dedupe_threshold === null)
      return setError("Duplicate threshold must be a whole number from 0 to 32.");
    if (!form.group_regex.trim()) return setError("Group regex is required.");
    const settings: ImportSettings = {
      max_side,
      quality,
      dedupe_threshold,
      group_regex: form.group_regex.trim(),
    };
    setBusy(true);
    setError(null);
    try {
      const result = await createSource(api, project.id, {
        folder: form.folder.trim(),
        ...(form.site.trim() ? { site: form.site.trim() } : {}),
        settings,
      });
      useJobsStore.getState().upsert(result.job);
      onStarted(result);
    } catch (err) {
      pushLog(`import images failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title="Import images"
      description="Choose a folder of drone photos. Your originals stay untouched: the project keeps its own copies, skips near-identical photos and groups them by flight. Importing the same folder again adds only new photos."
      onClose={() => {
        if (!busy) onClose();
      }}
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
        <Field label="Folder" htmlFor={`${id}-folder`}>
          <div className="flex gap-2">
            <Input
              id={`${id}-folder`}
              required
              value={form.folder}
              onChange={(e) => patch({ folder: e.target.value })}
              placeholder="E:\Dev\Yolo\Ahmadia Construction Data"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && (
              <Button icon="folder" onClick={() => void browse()}>
                Browse
              </Button>
            )}
          </div>
        </Field>
        <Field label="Site name" htmlFor={`${id}-site`} hint="Optional. Defaults to the folder name.">
          <Input id={`${id}-site`} value={form.site} onChange={(e) => patch({ site: e.target.value })} />
        </Field>
        <Disclosure label="Advanced settings (the defaults suit most imports)">
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-line bg-ground p-4 md:grid-cols-2">
            <Field
              label="Max side"
              htmlFor={`${id}-max`}
              hint="Longest side in pixels; larger images are scaled down, smaller ones are kept as they are."
            >
              <Input
                id={`${id}-max`}
                type="number"
                min={512}
                max={12000}
                value={form.max_side}
                onChange={(e) => patch({ max_side: e.target.value })}
                className="tabular-nums"
              />
            </Field>
            <Field
              label="JPEG quality"
              htmlFor={`${id}-quality`}
              hint="Quality of the prepared copies (95 is visually lossless)."
            >
              <Input
                id={`${id}-quality`}
                type="number"
                min={50}
                max={100}
                value={form.quality}
                onChange={(e) => patch({ quality: e.target.value })}
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Duplicate threshold"
              htmlFor={`${id}-dedupe`}
              hint="How alike two images must be to count as duplicates: 0 only identical pictures, 4 near-identical frames, higher values drop more."
            >
              <Input
                id={`${id}-dedupe`}
                type="number"
                min={0}
                max={32}
                value={form.dedupe_threshold}
                onChange={(e) => patch({ dedupe_threshold: e.target.value })}
                className="tabular-nums"
              />
            </Field>
            <Field
              label="Group regex"
              htmlFor={`${id}-regex`}
              hint="Pattern that reads the flight number from the file name (camera_flight_frame). Images of one flight stay together when a dataset is split. Leave it unless your files are named differently."
            >
              <Input
                id={`${id}-regex`}
                value={form.group_regex}
                onChange={(e) => patch({ group_regex: e.target.value })}
                className="font-mono"
              />
            </Field>
          </div>
        </Disclosure>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
