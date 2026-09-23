import { useCallback, useId, useState, type FormEvent } from "react";
import type { Model } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importModel } from "@/api/models";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Field, Input, Textarea } from "@/ui";
import { DEFAULT_ALIASES, formatAliases, parseAliases } from "./aliases";

interface Props {
  projectId: string;
  onImported: (model: Model) => void;
  onClose: () => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.pt$/i, "") ?? "";
}

/** Register existing `.pt` weights (spec section 7). Native file dialog inside Tauri, text field elsewhere. */
export function ImportModelForm({ projectId, onImported, onClose }: Props) {
  const api = useApi();
  const { mode } = useBackend();
  const id = useId();
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
      aria-label="Import weights"
      onSubmit={(e) => void submit(e)}
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-line bg-panel p-4"
    >
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        The file is copied into the project&apos;s models folder. Aliases map the weights&apos; class names to
        project classes; classes without a match are dropped.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Model name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Weights path" htmlFor={`${id}-path`} hint="A .pt file.">
          <div className="flex gap-2">
            <Input
              id={`${id}-path`}
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="E:\Dev\Yolo\models\yolo11m.pt"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && (
              <Button icon="folder" onClick={() => void browse()}>
                Browse
              </Button>
            )}
          </div>
        </Field>
      </div>
      <Field
        label="Class aliases"
        htmlFor={`${id}-aliases`}
        hint="One per line, weights class=project class (COCO weights: truck=dump_truck)."
      >
        <Textarea
          id={`${id}-aliases`}
          rows={3}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
          className="font-mono"
        />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" icon="import" loading={busy}>
          Import weights
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
