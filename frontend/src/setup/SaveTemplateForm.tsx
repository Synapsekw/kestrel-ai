import { useState, type FormEvent } from "react";
import { isCatalogueUnavailable } from "@/api/catalogue";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { Button, Field, Input, toast } from "@/ui";
import { createTemplate, isTemplateNameTaken, type ProjectTemplate } from "./api";
import { draftSnapshot } from "./draftStore";
import { specOf } from "./model";

/** Spec §8: "Save as my template" asks for a name inline and saves the slots and types only. */
export function SaveTemplateForm({
  clash,
  onSaved,
  onCancel,
}: {
  clash: boolean;
  onSaved: (t: ProjectTemplate) => void;
  onCancel: () => void;
}) {
  const api = useApi();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Give the template a name.");
    if (clash) return setError("Give each type its own hotkey first.");
    setBusy(true);
    setError(null);
    const draft = draftSnapshot();
    try {
      const saved = await createTemplate(api, {
        name: clean,
        config: { config_version: 1, slots: draft.slots, types: draft.types.map(specOf) },
      });
      toast("ok", `Saved the template ${saved.name}`);
      onSaved(saved);
    } catch (err) {
      setError(
        isTemplateNameTaken(err)
          ? `A template called ${clean} already exists. Choose another name.`
          : isCatalogueUnavailable(err)
            ? "The catalogue is unavailable, so the template cannot be saved now."
            : messageOf(err, "could not save the template"),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="Save as my template" onSubmit={(e) => void submit(e)} className="flex flex-col gap-2">
      <Field
        label="Template name"
        htmlFor="save-template-name"
        error={error}
        hint="Saves the data slots and anomaly types, never the name, folder or files."
      >
        <Input
          id="save-template-name"
          value={name}
          maxLength={80}
          invalid={error !== null}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" loading={busy}>
          Save template
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
