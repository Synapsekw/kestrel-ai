import type { AgentPlan } from "@/api/agent";
import type { StarterModel, StarterModelKey } from "@contract/client";
import { Button, Field, Input, Select, Textarea } from "@/ui";
import { FolderField } from "./FolderField";
export function PlanEditor({
  plan,
  onChange,
  catalog,
  folder,
  onFolderChange,
  valid,
  busy,
  onCreate,
}: {
  plan: AgentPlan;
  onChange: (plan: AgentPlan) => void;
  catalog: StarterModel[];
  folder: string;
  onFolderChange: (s: string) => void;
  valid: boolean;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-line pt-5" aria-label="Project plan">
      <div>
        <h3 className="text-base font-semibold">Review your project plan</h3>
        <p className="mt-1 text-sm text-muted">Edit these details before creating the local project.</p>
      </div>
      <Field label="Project name" htmlFor="agent-name">
        <Input
          id="agent-name"
          value={plan.name}
          maxLength={120}
          disabled={busy}
          onChange={(e) => onChange({ ...plan, name: e.target.value })}
        />
      </Field>
      <Field label="Classes" htmlFor="agent-classes" hint="One name per line, up to 32 unique classes.">
        <Textarea
          id="agent-classes"
          rows={3}
          value={plan.classes.join("\n")}
          disabled={busy}
          onChange={(e) => onChange({ ...plan, classes: e.target.value.split("\n") })}
        />
      </Field>
      <Field label="Starter detector" htmlFor="agent-starter">
        <Select
          id="agent-starter"
          value={plan.starter_model_key}
          disabled={busy}
          onChange={(e) => onChange({ ...plan, starter_model_key: e.target.value as StarterModelKey })}
        >
          {catalog.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
              {m.available ? " (available)" : " (download)"}
            </option>
          ))}
        </Select>
      </Field>
      <p className="text-xs text-muted">
        Starter weights download in the background. They are a starting point for training on your reviewed
        labels.
      </p>
      <FolderField label="Project folder" value={folder} onChange={onFolderChange} disabled={busy} />
      <p className="text-xs text-muted">Choose a new or empty folder. Source images stay untouched.</p>
      {!valid && (
        <p role="status" className="text-sm text-warn">
          Use a project name, 1–32 unique class names of at most 64 characters, and a supported starter.
        </p>
      )}
      <Button variant="primary" disabled={!valid || !folder.trim() || busy} loading={busy} onClick={onCreate}>
        Create project
      </Button>
    </section>
  );
}
