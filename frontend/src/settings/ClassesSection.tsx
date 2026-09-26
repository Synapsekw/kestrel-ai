import { useState } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { saveClasses } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, IconButton, Input, Select } from "@/ui";
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

const HOTKEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * The colour picker: a native `<input type="color">` (the one raw input outside `src/ui/`; the
 * browser's own picker is the right control here) drawn as a 24px rounded square.
 */
function ColourSwatch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (colour: string) => void;
}) {
  return (
    <span
      className="relative inline-block h-6 w-6 shrink-0 overflow-hidden rounded-md border border-line focus-within:ring-2 focus-within:ring-accent focus-within:ring-offset-2 focus-within:ring-offset-bg"
      style={{ backgroundColor: value }}
      title={label}
    >
      <input
        aria-label={label}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  );
}

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
    <section className="flex flex-col gap-4 py-8 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Classes</h2>
        <p className="text-sm text-muted">
          Rename, recolour, change the number key or reorder. A class that still has boxes cannot be removed
          until those boxes are reassigned or deleted.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        {drafts.map((d, i) => {
          const n = i + 1;
          return (
            <div key={d.id ?? `new-${i}`} className="flex items-center gap-2">
              <ColourSwatch
                label={`Colour of class ${n}`}
                value={d.colour}
                onChange={(colour) => update(i, { colour })}
              />
              <Input
                dense
                aria-label={`Name of class ${n}`}
                value={d.name}
                onChange={(e) => update(i, { name: e.target.value })}
                className="flex-1"
              />
              <Select
                dense
                aria-label={`Hotkey of class ${n}`}
                value={d.hotkey}
                onChange={(e) => update(i, { hotkey: e.target.value })}
                wrapperClassName="w-[4.5rem]"
              >
                <option value="">none</option>
                {HOTKEYS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </Select>
              <IconButton
                icon="chevron-down"
                size="sm"
                label={`Move class ${n} up`}
                disabled={i === 0}
                onClick={() => setDrafts((x) => moveDraft(x, i, -1))}
                className="[&_svg]:rotate-180"
              />
              <IconButton
                icon="chevron-down"
                size="sm"
                label={`Move class ${n} down`}
                disabled={i === drafts.length - 1}
                onClick={() => setDrafts((x) => moveDraft(x, i, 1))}
              />
              <IconButton
                icon="trash"
                size="sm"
                label={`Remove class ${n}`}
                onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}
                className="text-muted hover:text-danger"
              />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          icon="plus"
          onClick={() => setDrafts((x) => [...x, { name: "", colour: nextColour(x), hotkey: "" }])}
        >
          Add class
        </Button>
        <Button variant="primary" loading={busy} onClick={() => void save()}>
          Save classes
        </Button>
        {status && (
          <span role="status" className="text-xs text-ok">
            {status}
          </span>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </section>
  );
}
