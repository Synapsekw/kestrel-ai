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

/** The inputs own strings: an emptied number field must not silently become 0 (`Number("")`). */
interface Form {
  max_side: string;
  quality: string;
  dedupe_threshold: string;
  group_regex: string;
}

function fromProject(p: Project): Form {
  return {
    max_side: String(p.import_defaults.max_side ?? 4000),
    quality: String(p.import_defaults.quality ?? 95),
    dedupe_threshold: String(p.import_defaults.dedupe_threshold ?? 4),
    group_regex:
      p.import_defaults.group_regex ?? "^(?P<camera>[A-Za-z0-9-]+)_(?P<flight>\\d+)_(?P<frame>\\d+)",
  };
}

/** `null` when a field is empty or not a number. */
function toSettings(form: Form): Required<ImportSettings> | null {
  const numbers = [form.max_side, form.quality, form.dedupe_threshold].map((v) =>
    v.trim() === "" ? NaN : Number(v),
  );
  if (numbers.some((n) => !Number.isFinite(n)) || !form.group_regex.trim()) return null;
  const [max_side, quality, dedupe_threshold] = numbers;
  return { max_side, quality, dedupe_threshold, group_regex: form.group_regex };
}

export function ImportDefaultsSection({ project, onSaved }: Props) {
  const api = useApi();
  // Mounted with `key={JSON.stringify(project.import_defaults)}` by SettingsScreen.
  const [form, setForm] = useState<Form>(() => fromProject(project));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    const settings = toSettings(form);
    if (!settings) {
      setError("Every import default needs a value.");
      return;
    }
    setBusy(true);
    try {
      onSaved(await patchProject(api, project.id, { import_defaults: settings }));
      setStatus("Import defaults saved");
    } catch (err) {
      pushLog(`save import defaults failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not save the import defaults"));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof Form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Import defaults</h2>
      <p className="text-sm text-slate-400">Applied to new sources unless overridden at import time.</p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Max side
          <input type="number" required min={512} max={12000} {...field("max_side")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          JPEG quality
          <input type="number" required min={50} max={100} {...field("quality")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Duplicate threshold
          <input type="number" required min={0} max={32} {...field("dedupe_threshold")} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-400">
          Group regex
          <input required {...field("group_regex")} className={`${input} font-mono`} />
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
