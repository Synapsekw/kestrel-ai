import { useState, type FormEvent } from "react";
import type { ImportSettings, Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { patchProject } from "@/api/project";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Field, Input } from "@/ui";

interface Props {
  project: Project;
  onSaved: (p: Project) => void;
}

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
    id: `import-${key}`,
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-4 py-8 first:pt-0 last:pb-0"
      noValidate
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Import defaults</h2>
        <p className="text-sm text-muted">Applied to new folders unless changed in the import dialog.</p>
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Field
          label="Max side"
          htmlFor="import-max_side"
          hint="Longest edge in pixels; larger images are scaled down."
        >
          <Input type="number" required min={512} max={12000} {...field("max_side")} />
        </Field>
        <Field label="JPEG quality" htmlFor="import-quality" hint="50 to 100.">
          <Input type="number" required min={50} max={100} {...field("quality")} />
        </Field>
        <Field
          label="Duplicate threshold"
          htmlFor="import-dedupe_threshold"
          hint="0 to 32; lower skips only near-identical frames."
        >
          <Input type="number" required min={0} max={32} {...field("dedupe_threshold")} />
        </Field>
        <Field
          label="Group regex"
          htmlFor="import-group_regex"
          hint="Reads the camera, flight and frame from file names."
        >
          <Input required {...field("group_regex")} className="font-mono" />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={busy}>
          Save import defaults
        </Button>
        {status && (
          <span role="status" className="text-xs text-ok">
            {status}
          </span>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
