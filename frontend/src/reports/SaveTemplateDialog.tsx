import { useState, type FormEvent } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { createTemplate, type ReportConfig } from "@/api/reports";
import { Alert, Button, Dialog, Field, Input, Textarea, toast } from "@/ui";
import { portableConfig } from "./builderModel";

export interface SaveTemplateDialogProps {
  open: boolean;
  onClose: () => void;
  config: ReportConfig;
  defaultName: string;
}

/**
 * `portableConfig` (Task 2) nulls the project-only fields so the result stays a valid `ReportConfig`
 * for the builder's own state. A saved template's wire body goes further for `cover.logo_asset_id`:
 * the field is dropped outright, not sent as `null` — a template never had a logo (R1 Ruling 2).
 */
function templateWireConfig(c: ReportConfig): ReportConfig {
  const portable = portableConfig(c);
  const { title, subtitle, site, client, author, report_date } = portable.cover;
  return {
    ...portable,
    cover: { title, subtitle, site, client, author, report_date } as ReportConfig["cover"],
  };
}

/** Spec §12: name and description; says that data-item filters are not kept (Ruling 15). */
export function SaveTemplateDialog({ open, onClose, config, defaultName }: SaveTemplateDialogProps) {
  const api = useApi();
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    try {
      await createTemplate(api, {
        name: n,
        description: description.trim(),
        config: templateWireConfig(config),
      });
      toast("ok", `Template "${n}" saved`);
      onClose();
    } catch (err) {
      setError(
        codeOf(err) === "catalogue_unavailable"
          ? "The app-wide catalogue could not be opened, so templates cannot be saved right now. This report is unaffected; try again after restarting the app."
          : messageOf(err, "could not save the template"),
      );
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Save as template"
      description="Templates are app-wide: they keep the sections, their options, the paper and the portable filters."
      onSubmit={(e) => void save(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
            Save template
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Name" htmlFor="template-name">
          <Input id="template-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor="template-description">
          <Textarea
            id="template-description"
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
        <Alert tone="info">
          Data-item filters, the logo and the report date are not kept: a template works in every project.
        </Alert>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
