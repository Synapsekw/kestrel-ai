import { useCallback, useState, type FormEvent } from "react";
import type { ImportSettings, Project } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createSource, type SourceWithJob } from "@/api/sources";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

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

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const label = "flex flex-col gap-1 text-xs text-slate-400";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

function whole(text: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= min && n <= max ? n : null;
}

/** Spec section 5 import job: folder, optional site, preparation settings prefilled from the project defaults. */
export function ImportImagesDialog({ project, onClose, onStarted }: Props) {
  const api = useApi();
  const { mode } = useBackend();
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
  const patch = (p: Partial<Form>) => setForm((f) => ({ ...f, ...p }));

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
      useJobsStore.getState().setPanelOpen(true);
      onStarted(result);
    } catch (err) {
      pushLog(`import images failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not start the import"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      role="dialog"
      aria-label="Import images"
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded border border-slate-700 bg-slate-800/60 p-4"
    >
      <h2 className="text-lg font-medium">Import images</h2>
      <p className="text-sm text-slate-400">
        Originals are never modified: files are converted to JPEG, downscaled past the max side, de-duplicated
        by perceptual hash and grouped by flight. Re-importing a folder picks up new files only.
      </p>
      <label className={label}>
        Folder
        <div className="flex gap-2">
          <input
            aria-label="Folder"
            required
            value={form.folder}
            onChange={(e) => patch({ folder: e.target.value })}
            placeholder="E:\Dev\Yolo\Ahmadia Construction Data"
            className={`${input} min-w-0 flex-1 font-mono`}
          />
          {mode === "tauri" && (
            <button type="button" className={secondary} onClick={() => void browse()}>
              Browse
            </button>
          )}
        </div>
      </label>
      <label className={label}>
        Site name (optional, defaults to the folder name)
        <input
          aria-label="Site name"
          value={form.site}
          onChange={(e) => patch({ site: e.target.value })}
          className={input}
        />
      </label>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className={label}>
          Max side
          <input
            aria-label="Max side"
            type="number"
            min={512}
            max={12000}
            value={form.max_side}
            onChange={(e) => patch({ max_side: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          JPEG quality
          <input
            aria-label="JPEG quality"
            type="number"
            min={50}
            max={100}
            value={form.quality}
            onChange={(e) => patch({ quality: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          Duplicate threshold
          <input
            aria-label="Duplicate threshold"
            type="number"
            min={0}
            max={32}
            value={form.dedupe_threshold}
            onChange={(e) => patch({ dedupe_threshold: e.target.value })}
            className={input}
          />
        </label>
        <label className={label}>
          Group regex
          <input
            aria-label="Group regex"
            value={form.group_regex}
            onChange={(e) => patch({ group_regex: e.target.value })}
            className={`${input} font-mono`}
          />
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>
          Start import
        </button>
        <button type="button" className={secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
