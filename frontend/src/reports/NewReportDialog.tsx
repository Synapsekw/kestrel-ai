import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createReport, useReportTemplates } from "@/api/reports";
import { Alert, Button, Dialog, Field, Input, Pill, Skeleton, cx, transition } from "@/ui";

export interface NewReportDialogProps {
  projectId: string;
  open: boolean;
  onClose: () => void;
  /** From `?new=` (R8 hand-off, coordinator ruling 7); unknown ids fall back to the first template. */
  initialTemplateId?: string | null;
}

/** Spec §12: pick a template and a title; the report opens in the builder. */
export function NewReportDialog({
  projectId,
  open,
  onClose,
  initialTemplateId = null,
}: NewReportDialogProps) {
  const api = useApi();
  const navigate = useNavigate();
  // Parents mount this dialog only while it is open, so the list is read once per opening.
  const list = useReportTemplates();
  const templates = list.loading ? null : list.items;
  const loadError = list.error;
  const [picked, setPicked] = useState<string | null>(initialTemplateId);
  const [title, setTitle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = templates?.find((t) => t.id === picked) ?? templates?.[0] ?? null;
  const shownTitle = title ?? chosen?.name ?? "";
  const canCreate = chosen !== null && shownTitle.trim() !== "" && !busy;

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!chosen || !shownTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await createReport(api, projectId, { title: shownTitle.trim(), template_id: chosen.id });
      onClose();
      navigate(`/p/${projectId}/reports/${r.id}`);
    } catch (err) {
      setError(messageOf(err, "could not create the report"));
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New report"
      description="Start from a template; every section and filter can be changed afterwards."
      width="lg"
      onSubmit={(e) => void create(e)}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!canCreate}>
            Create report
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {loadError && <Alert tone="danger">{loadError}</Alert>}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-xs font-medium text-muted">Template</legend>
          {templates === null && !loadError ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            templates?.map((t) => (
              <label
                key={t.id}
                className={cx(
                  "flex cursor-pointer items-start gap-3 rounded-control border px-3 py-2.5",
                  chosen?.id === t.id ? "border-accent bg-accent-soft" : "border-line hover:bg-hover",
                  transition,
                )}
              >
                <input
                  type="radio"
                  name="report-template"
                  value={t.id}
                  checked={chosen?.id === t.id}
                  onChange={() => setPicked(t.id)}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{t.name}</span>
                  {t.description && <span className="block text-xs text-muted">{t.description}</span>}
                </span>
                {t.builtin && <Pill size="sm">Built-in</Pill>}
              </label>
            ))
          )}
        </fieldset>
        <Field label="Title" htmlFor="new-report-title">
          <Input id="new-report-title" value={shownTitle} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
