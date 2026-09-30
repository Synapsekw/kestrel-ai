import { useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Dialog, Icon, Input, MenuButton, cx, focusRing, toast, type IconName } from "@/ui";
import { deleteTemplate, isTemplateNameTaken, patchTemplate, type ProjectTemplate } from "./api";
import { useSetupDraft } from "./draftStore";
import { ROUTE_ICON } from "./model";
import { SetupCard } from "./SetupCard";
import type { TemplateChoice } from "./templateChoice";
import type { TemplateList } from "./useTemplates";

export interface TemplateCardProps {
  list: TemplateList;
  choice: TemplateChoice;
}

/** Card 1 (spec §8 Template): built-ins, saved templates and Blank; replace-or-keep after an edit. */
export function TemplateCard({ list, choice }: TemplateCardProps) {
  const api = useApi();
  const templateId = useSetupDraft((s) => s.templateId);
  const [deleting, setDeleting] = useState<ProjectTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = list.unavailable ? [] : list.items;

  async function remove(t: ProjectTemplate) {
    setBusy(true);
    try {
      await deleteTemplate(api, t.id);
      // Ruling 15: the page keeps its slots, types and buckets; only the template link goes.
      if (useSetupDraft.getState().templateId === t.id) useSetupDraft.setState({ templateId: null });
      toast("info", `Deleted the template ${t.name}`);
      setDeleting(null);
      list.reload();
    } catch (e) {
      pushLog(`delete template ${t.id} failed: ${messageOf(e, String(e))}`);
      toast("danger", messageOf(e, "could not delete the template"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SetupCard
      n={1}
      title="What are you inspecting?"
      aside="A template only pre-fills this page. You can add any data later."
    >
      <div
        role="radiogroup"
        aria-label="Template"
        className="grid grid-cols-2 gap-2.5 min-[1100px]:grid-cols-4"
      >
        {shown.map((t) => (
          <TemplateTile
            key={t.id}
            template={t}
            checked={t.id === templateId}
            onChoose={() => choice.request(t)}
            onDelete={() => setDeleting(t)}
            onRenamed={list.reload}
          />
        ))}
        <TemplateTile template={null} checked={templateId === null} onChoose={() => choice.request(null)} />
      </div>
      {list.unavailable && (
        <Alert
          tone="warn"
          actions={
            <Button size="sm" onClick={list.reload}>
              Try again
            </Button>
          }
        >
          {`The catalogue is unavailable, so only Blank is offered. Types can be added later in Project settings. (${list.unavailable})`}
        </Alert>
      )}
      {choice.pending !== undefined && (
        <Alert
          tone="warn"
          title="You changed the anomaly list"
          actions={
            <>
              <Button size="sm" variant="primary" onClick={() => choice.resolve("replace")}>
                Replace the anomaly list
              </Button>
              <Button size="sm" onClick={() => choice.resolve("keep")}>
                Keep mine and add the new ones
              </Button>
              <Button size="sm" variant="ghost" onClick={choice.cancel}>
                Cancel
              </Button>
            </>
          }
        >
          {`Switching to ${choice.pending?.name ?? "Blank"} changes the data slots. Replace your anomaly list with the template's, or keep yours and add the types it does not have yet.`}
        </Alert>
      )}
      <Dialog
        open={deleting !== null}
        title={deleting ? `Delete the template ${deleting.name}?` : ""}
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Keep template
            </Button>
            <Button variant="danger" loading={busy} onClick={() => deleting && void remove(deleting)}>
              Delete template
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Projects made from it keep their data and types. This page keeps what you have filled in.
        </p>
      </Dialog>
    </SetupCard>
  );
}

function TemplateTile({
  template,
  checked,
  onChoose,
  onDelete,
  onRenamed,
}: {
  template: ProjectTemplate | null;
  checked: boolean;
  onChoose: () => void;
  onDelete?: () => void;
  onRenamed?: () => void;
}) {
  const api = useApi();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(template?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const first = template?.config.slots[0];
  const icon: IconName = !template ? "plus" : first ? ROUTE_ICON[first.route] : "layers";
  const title = template?.name ?? "Blank";
  const description = !template
    ? "Start empty; add data and types as you go."
    : template.description ||
      `${template.config.slots.length} data slots · ${template.config.types.length} anomaly types`;

  async function rename() {
    if (!template) return;
    const clean = name.trim();
    if (!clean) {
      setError("Give the template a name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await patchTemplate(api, template.id, { name: clean });
      setRenaming(false);
      onRenamed?.();
    } catch (e) {
      setError(
        isTemplateNameTaken(e)
          ? `A template called ${clean} already exists. Choose another name.`
          : messageOf(e, "could not rename the template"),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        role="radio"
        aria-checked={checked}
        onClick={onChoose}
        className={cx(
          "flex h-full w-full flex-col gap-2 rounded-control border p-3 text-left transition-colors duration-fast ease-out reduce-motion:transition-none",
          checked ? "border-accent bg-accent-soft" : "border-card-line bg-surface hover:border-line-strong",
          focusRing,
        )}
      >
        <span className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 place-items-center rounded-sm bg-surface-2 text-muted"
          >
            <Icon name={icon} size={16} />
          </span>
          {checked && <Icon name="check" size={14} className="ml-auto text-accent-ink" />}
        </span>
        <span className="text-sm font-semibold text-ink">{title}</span>
        <span className="text-xs text-muted">{description}</span>
      </button>
      {template && !template.builtin && !renaming && (
        <MenuButton
          iconOnly
          icon="more"
          size="sm"
          variant="ghost"
          label={`More for ${template.name}`}
          className="absolute right-1.5 top-1.5"
          items={[
            {
              id: "rename",
              label: "Rename",
              onSelect: () => {
                setName(template.name);
                setError(null);
                setRenaming(true);
              },
            },
            { id: "delete", label: "Delete", danger: true, onSelect: () => onDelete?.() },
          ]}
        />
      )}
      {template && renaming && (
        <form
          aria-label={`Rename ${template.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
          className="absolute inset-0 flex flex-col justify-center gap-2 rounded-control border border-accent bg-glass-solid p-3"
        >
          <Input
            dense
            aria-label={`New name for ${template.name}`}
            value={name}
            maxLength={80}
            invalid={error !== null}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          {error && (
            <p role="alert" className="text-2xs text-danger">
              {error}
            </p>
          )}
          <span className="flex gap-1.5">
            <Button type="submit" size="sm" variant="primary" loading={saving}>
              Save name
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
          </span>
        </form>
      )}
    </div>
  );
}
