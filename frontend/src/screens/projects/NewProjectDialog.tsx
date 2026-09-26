import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Project } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Checkbox, Dialog, Field, Input, TypeChip } from "@/ui";
import { fetchPickableTypes, type CatalogueType } from "./catalogueTypes";
import { FolderField } from "./FolderField";

/** F §9.2: a name, a folder and "Types to start with" (optional); there is no kind. */
export function NewProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (p: Project) => void;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [types, setTypes] = useState<{ items: CatalogueType[]; error: string | null } | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPickableTypes(api)
      .then((items) => {
        if (!cancelled) setTypes({ items, error: null });
      })
      .catch((e: unknown) => {
        pushLog(`catalogue unavailable: ${messageOf(e, String(e))}`);
        if (!cancelled) setTypes({ items: [], error: messageOf(e, "the catalogue is unavailable") });
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase();
    return (types?.items ?? []).filter((t) => !needle || t.name.toLocaleLowerCase().includes(needle));
  }, [types, filter]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!name.trim()) return setError("Give the project a name.");
    if (!folder.trim()) return setError("Choose a folder for the project.");
    setBusy(true);
    setError(null);
    try {
      const { data, error: err } = await api.POST("/api/v1/projects", {
        body: { name: name.trim(), folder: folder.trim(), type_ids: picked },
      });
      if (data) onCreated(data);
      else setError(messageOf(err, "could not create the project"));
    } catch (e2) {
      pushLog(`create project failed: ${e2}`);
      setError(String(e2));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <Dialog
      open
      title="New project"
      width="lg"
      onClose={onClose}
      onSubmit={(e) => void submit(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" icon="plus" loading={busy}>
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" htmlFor="project-name">
          <Input
            id="project-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Site name or campaign"
          />
        </Field>
        <FolderField
          id="project-folder"
          label="Folder"
          value={folder}
          onChange={setFolder}
          hint="A new or empty folder. Imported data is copied here; the originals are never touched."
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-xs font-medium text-muted">Types to start with (optional)</legend>
          {types?.error ? (
            <p className="text-xs text-muted">
              The catalogue is unavailable, so types can be added later in Project settings. ({types.error})
            </p>
          ) : (
            <>
              <Input
                type="search"
                aria-label="Filter types"
                placeholder="Filter types"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                dense
              />
              <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
                {shown.map((t) => (
                  <li key={t.id}>
                    <Checkbox
                      label={<TypeChip name={t.name} colour={t.colour} kind={t.kind} />}
                      checked={picked.includes(t.id)}
                      onChange={() => toggle(t.id)}
                    />
                  </li>
                ))}
              </ul>
              {picked.length > 0 && <p className="text-2xs text-muted">{picked.length} selected</p>}
            </>
          )}
        </fieldset>
        {error && (
          <Alert tone="danger" onDismiss={() => setError(null)}>
            {error}
          </Alert>
        )}
      </div>
    </Dialog>
  );
}
