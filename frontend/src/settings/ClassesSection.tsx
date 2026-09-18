import { useState } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveClasses } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import {
  classInUseMessage,
  moveDraft,
  nextColour,
  toClassInputs,
  toDrafts,
  validateDrafts,
  type DraftClass,
} from "./classesModel";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

const input = "rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm";
const btn = "rounded border border-slate-700 px-2 py-1 text-xs hover:bg-slate-800 disabled:opacity-40";
const HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function ClassesSection({ project, onSaved }: Props) {
  const api = useApi();
  // Mounted with `key={JSON.stringify(project.classes)}` by SettingsScreen, so a saved project remounts with fresh drafts.
  const [drafts, setDrafts] = useState<DraftClass[]>(() => toDrafts(project.classes));
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (i: number, patch: Partial<DraftClass>) =>
    setDrafts((d) => d.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  async function save() {
    setError(null);
    setStatus(null);
    const problem = validateDrafts(drafts);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveClasses(api, project.id, toClassInputs(drafts));
      onSaved(saved);
      setStatus("Classes saved");
    } catch (e) {
      pushLog(`save classes failed: ${messageOf(e, String(e))}`);
      const explained = classInUseMessage(e, project.classes);
      setError(explained ?? messageOf(e, "could not save the classes"));
      if (explained) setDrafts(toDrafts(project.classes));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Classes</h2>
      <p className="text-sm text-slate-400">
        Rename, recolour, change hotkeys or reorder. Removing a class that still has boxes is refused until
        those boxes are reassigned or deleted.
      </p>
      <div className="flex flex-col gap-2">
        {drafts.map((d, i) => {
          const n = i + 1;
          return (
            <div key={d.id ?? `new-${i}`} className="flex items-center gap-2">
              <input
                aria-label={`Colour of class ${n}`}
                type="color"
                value={d.colour}
                onChange={(e) => update(i, { colour: e.target.value })}
                className="h-8 w-10 rounded border border-slate-700 bg-slate-800"
              />
              <input
                aria-label={`Name of class ${n}`}
                value={d.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className={`${input} flex-1`}
              />
              <select
                aria-label={`Hotkey of class ${n}`}
                value={d.hotkey}
                onChange={(e) => update(i, { hotkey: e.target.value })}
                className={input}
              >
                <option value="">none</option>
                {HOTKEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label={`Move class ${n} up`}
                className={btn}
                disabled={i === 0}
                onClick={() => setDrafts((x) => moveDraft(x, i, -1))}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move class ${n} down`}
                className={btn}
                disabled={i === drafts.length - 1}
                onClick={() => setDrafts((x) => moveDraft(x, i, 1))}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove class ${n}`}
                className={`${btn} text-red-300`}
                onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}
              >
                Remove
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={btn}
          onClick={() => setDrafts((x) => [...x, { name: "", colour: nextColour(x), hotkey: "" }])}
        >
          Add class
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50"
        >
          Save classes
        </button>
        {status && (
          <span role="status" className="text-xs text-emerald-300">
            {status}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded border border-red-800 bg-red-950 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
    </section>
  );
}
