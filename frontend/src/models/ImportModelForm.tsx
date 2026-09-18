import { useCallback, useState, type FormEvent } from "react";
import type { Model } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { DEFAULT_ALIASES, formatAliases, parseAliases } from "./aliases";

interface Props {
  projectId: string;
  onImported: (model: Model) => void;
  onClose: () => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";
const secondary = "rounded border border-slate-700 px-3 py-1 text-sm hover:bg-slate-800 disabled:opacity-50";

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.pt$/i, "") ?? "";
}

/** Register existing `.pt` weights (spec section 7). Native file dialog inside Tauri, text field elsewhere. */
export function ImportModelForm({ projectId, onImported, onClose }: Props) {
  const api = useApi();
  const { mode } = useBackend();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [aliases, setAliases] = useState(formatAliases(DEFAULT_ALIASES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "PyTorch weights", extensions: ["pt"] }],
    });
    if (typeof picked === "string") {
      setPath(picked);
      setName((n) => n || baseName(picked));
    }
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const model = await importModel(api, projectId, {
        name: name.trim(),
        weights_path: path.trim(),
        class_aliases: parseAliases(aliases),
      });
      onImported(model);
    } catch (err) {
      pushLog(`import model failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not import the weights"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      role="dialog"
      aria-label="Import weights"
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-3 rounded border border-slate-700 bg-slate-800/60 p-4"
    >
      <h2 className="text-lg font-medium">Import weights</h2>
      <p className="text-sm text-slate-400">
        The file is copied into the project&apos;s models folder. Aliases map the weights&apos; class names to
        project classes, one per line (COCO weights: truck=dump_truck); unmapped classes are dropped.
      </p>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Name
        <input
          aria-label="Model name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Weights path (.pt)
        <div className="flex gap-2">
          <input
            aria-label="Weights path"
            required
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="E:\Dev\Yolo\models\yolo11m.pt"
            className={`${input} min-w-0 flex-1 font-mono`}
          />
          {mode === "tauri" && (
            <button type="button" className={secondary} onClick={() => void browse()}>
              Browse
            </button>
          )}
        </div>
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-400">
        Class aliases
        <textarea
          aria-label="Class aliases"
          rows={3}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          className={`${input} font-mono`}
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>
          Import
        </button>
        <button type="button" className={secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}
