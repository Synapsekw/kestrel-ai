import { useRef, useState } from "react";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, GlassPanel, Popover, cx, useSeverityScale } from "@/ui";
import type { ProjectTemplate } from "./api";
import { Checklist } from "./Checklist";
import { draftSnapshot, useSetupDraft, type SetupDraft } from "./draftStore";
import { canCreate, checklistOf, issueCount, templateLabel, type ChecklistModel } from "./model";
import { SaveTemplateForm } from "./SaveTemplateForm";

export interface SummaryCardProps {
  templates: readonly ProjectTemplate[];
  /** False while the templates cannot be read: Save as my template is hidden. */
  catalogueAvailable: boolean;
  /** `card` from 1100 px (sticky, right column); `bar` below (sticky bottom bar, checklist in a popover). */
  variant: "card" | "bar";
  /** S-R5 placeholder in U5, U6's `runSetup` later. A rejection's message shows here; the draft stays. */
  onCreate: (draft: SetupDraft) => Promise<void>;
  onTemplateSaved: (t: ProjectTemplate) => void;
}

function barLine(c: ChecklistModel): string {
  const slots = c.slotsTotal > 0 ? `${c.slotsFilled} of ${c.slotsTotal} slots` : "No data slots";
  const types = `${c.typeCount} anomaly ${c.typeCount === 1 ? "type" : "types"}`;
  const issues = issueCount(c);
  return [slots, types, ...(issues > 0 ? [`${issues} to check`] : [])].join(" · ");
}

export function SummaryCard({
  templates,
  catalogueAvailable,
  variant,
  onCreate,
  onTemplateSaved,
}: SummaryCardProps) {
  const draft = useSetupDraft();
  const scale = useSeverityScale();
  const model = checklistOf(draft, templateLabel(draft.templateId, templates), scale);
  const ready = canCreate(model);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const checklistButton = useRef<HTMLButtonElement>(null);

  async function create() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(draftSnapshot());
    } catch (e) {
      pushLog(`create project failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not create the project"));
    } finally {
      setBusy(false);
    }
  }

  const createButton = (
    <Button
      variant="primary"
      icon="plus"
      loading={busy}
      disabled={!ready}
      onClick={() => void create()}
      className={cx(variant === "card" && "w-full justify-center")}
    >
      Create project
    </Button>
  );

  const save = !catalogueAvailable ? null : saving ? (
    <SaveTemplateForm
      clash={model.clashes.length > 0}
      onSaved={(t) => {
        setSaving(false);
        onTemplateSaved(t);
      }}
      onCancel={() => setSaving(false)}
    />
  ) : (
    <Button variant="ghost" className="w-full justify-center" onClick={() => setSaving(true)}>
      Save as my template
    </Button>
  );

  if (variant === "bar")
    return (
      <div
        role="region"
        aria-label="Summary"
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 rounded-panel border border-line bg-glass-solid px-4 py-3 shadow-elev-2"
      >
        <p className="min-w-0 flex-1 truncate text-sm text-ink">{barLine(model)}</p>
        <Button
          ref={checklistButton}
          variant="ghost"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          Checklist
        </Button>
        <Popover
          open={open}
          onClose={() => setOpen(false)}
          anchorRef={checklistButton}
          label="Setup checklist"
          side="top"
          align="end"
        >
          <div className="flex w-72 flex-col gap-3 p-1">
            <Checklist model={model} />
            {save}
          </div>
        </Popover>
        {createButton}
        {error && (
          <p role="alert" className="w-full text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );

  return (
    <GlassPanel as="aside" aria-label="Summary" className="sticky top-4 flex flex-col gap-4 p-5">
      <h2 className="text-lg text-ink">Ready to create</h2>
      <Checklist model={model} />
      <p className="border-t border-line pt-3 text-xs text-muted">
        The project opens at once. Every anomaly type you keep here also lands in the app-wide Catalogue.
      </p>
      {createButton}
      {!ready && model.clashes.length > 0 && (
        <p className="text-xs text-danger">Give each type its own hotkey to create the project.</p>
      )}
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      {save}
    </GlassPanel>
  );
}
