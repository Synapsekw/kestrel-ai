import { useCallback, useId, useState, type FormEvent } from "react";
import type { Job } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { messageOf } from "@/api/errors";
import { importLibraryModel } from "@/api/library";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Field, Input, Textarea } from "@/ui";
import { DEFAULT_ALIASES, formatAliases, parseAliases } from "./aliases";

interface Props {
  /** The import runs as a library job; the caller follows it and selects the model when it succeeds. */
  onStarted: (job: Job) => void;
  onClose: () => void;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop()?.replace(/\.pt$/i, "") ?? "";
}

/** Add a `.pt` file to the library. Native file dialog inside Tauri, text field elsewhere. */
export function ImportModelForm({ onStarted, onClose }: Props) {
  const api = useApi();
  const { mode } = useBackend();
  const id = useId();
  const [name, setName] = useState("");
  const [path, setPath] = useState("");
  const [supplier, setSupplier] = useState("");
  const [aliases, setAliases] = useState(formatAliases(DEFAULT_ALIASES));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const browse = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      directory: false,
      filters: [{ name: "Model file", extensions: ["pt"] }],
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
      const job = await importLibraryModel(api, {
        name: name.trim(),
        weights_path: path.trim(),
        class_aliases: parseAliases(aliases),
        supplier: supplier.trim() || null,
      });
      onStarted(job);
    } catch (err) {
      pushLog(`import model failed: ${messageOf(err, String(err))}`);
      setError(messageOf(err, "could not add the model file"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      aria-label="Import a model file"
      onSubmit={(e) => void submit(e)}
      className="flex max-w-3xl flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        The file is copied into the library and checked before it appears in the list. Aliases rename the
        model&apos;s classes to your project&apos;s classes; classes without a match are left out.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Model name" htmlFor={`${id}-name`}>
          <Input id={`${id}-name`} required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Model file" htmlFor={`${id}-path`} hint="A .pt file.">
          <div className="flex gap-2">
            <Input
              id={`${id}-path`}
              required
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="E:\Models\best.pt"
              className="min-w-0 flex-1 font-mono"
            />
            {mode === "tauri" && (
              <Button icon="folder" onClick={() => void browse()}>
                Browse
              </Button>
            )}
          </div>
        </Field>
        <Field label="Supplier" htmlFor={`${id}-supplier`} hint="Optional: who supplied the model.">
          <Input
            id={`${id}-supplier`}
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            placeholder="Client X"
          />
        </Field>
      </div>
      <Field
        label="Class aliases"
        htmlFor={`${id}-aliases`}
        hint="One per line, model class=project class (for example truck=dump_truck)."
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
          Add to library
        </Button>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
