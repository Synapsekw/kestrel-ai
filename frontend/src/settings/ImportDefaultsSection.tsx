import { useState, type FormEvent } from "react";
import type { ImportSettings, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";

function fromProject(p: Project): Required<ImportSettings> {
  return {
    max_side: p.import_defaults.max_side ?? 4000,
    quality: p.import_defaults.quality ?? 95,
    dedupe_threshold: p.import_defaults.dedupe_threshold ?? 4,
    group_regex:
      p.import_defaults.group_regex ?? "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)",
  };
}

export function ImportDefaultsSection({ project, onSaved }: Props) {
  const api = useApi();
  // Mounted with `key={JSON.stringify(project.import_defaults)}` by SettingsScreen.
  const [form, setForm] = useState(() => fromProject(project));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      onSaved(await patchProject(api, project.id, { import_defaults: form }));
      setStatus("Import defaults saved");
    } catch (err) {
      pushLog(`save import defaults failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not save the import defaults"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Import defaults</h2>
      <p className="text-sm text-slate-400">Applied to new sources unless overridden at import time.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Max side
          <input
            type="number"
            min={512}
            max={12000}
            value={form.max_side}
            onChange={(e) => setForm({ ...form, max_side: Number(e.target.value) })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          JPEG quality
          <input
            type="number"
            min={50}
            max={100}
            value={form.quality}
            onChange={(e) => setForm({ ...form, quality: Number(e.target.value) })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Duplicate threshold
          <input
            type="number"
            min={0}
            max={32}
            value={form.dedupe_threshold}
            onChange={(e) => setForm({ ...form, dedupe_threshold: Number(e.target.value) })}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Group regex
          <input
            value={form.group_regex}
            onChange={(e) => setForm({ ...form, group_regex: e.target.value })}
            className={`${input} font-mono`}
          />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
        >
          Save import defaults
        </button>
        {status && (
          <span role="status" className="text-xs text-emerald-300">
            {status}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
    </form>
  );
}
