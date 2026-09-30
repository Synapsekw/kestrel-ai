import { useMemo, useState } from "react";
import { useApi } from "@/api/client";
import {
  createCatalogueType,
  existingTypeId,
  isHotkeyConflict,
  isInvalidSeverityRule,
  patchCatalogueType,
  type CatalogueType,
  type CatalogueTypeUpdated,
} from "@/api/catalogue";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import {
  Alert,
  Button,
  Field,
  IconButton,
  Input,
  InspectorPane,
  InspectorSection,
  Segmented,
  Select,
  SeverityPicker,
  Textarea,
  useSeverityScale,
} from "@/ui";
import { ColourSwatch } from "./ColourSwatch";
import {
  KIND_OPTIONS,
  TYPE_HOTKEYS,
  draftOf,
  findClash,
  supportsDefinition,
  toCreate,
  toPatch,
  validateTypeDraft,
  type TypeDraft,
} from "./catalogueModel";
import { SeverityRulesEditor } from "./SeverityRulesEditor";
import { MAX_DEFINITION, validateRules } from "./severityRulesModel";

export interface TypeEditorProps {
  /** null: a new type. */
  type: CatalogueType | null;
  types: CatalogueType[];
  onSaved: (type: CatalogueType, backfillCandidates: boolean) => void;
  onUseExisting: (id: string) => void;
  onClose: () => void;
}

function split({ backfill_candidates, ...type }: CatalogueTypeUpdated): [CatalogueType, boolean] {
  return [type, Boolean(backfill_candidates)];
}

/**
 * The Catalogue's inspector (F §7.5): name, colour, kind, group, definition, default severity,
 * severity rules (S1 §8), hotkey, archive.
 */
export function TypeEditor({ type, types, onSaved, onUseExisting, onClose }: TypeEditorProps) {
  const api = useApi();
  const [draft, setDraft] = useState<TypeDraft>(() => draftOf(type, types));
  const [error, setError] = useState<string | null>(null);
  const [existingId, setExistingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scale = useSeverityScale();
  const showSetupFields = supportsDefinition(type);
  const groups = useMemo(
    () => [...new Set(types.map((t) => t.group).filter((g): g is string => Boolean(g)))].sort(),
    [types],
  );
  const patch = (p: Partial<TypeDraft>) => setDraft((d) => ({ ...d, ...p }));
  const turningToObject = type?.kind === "defect" && draft.kind === "object";
  const turningToDefect = type?.kind === "object" && draft.kind === "defect";

  async function save() {
    // A rule on a removed level only blocks a save that sends the rules (plan ruling 2).
    const rulesSent = type ? "severity_rules" in toPatch(draft, type) : draft.rules.length > 0;
    const problem =
      validateTypeDraft(draft, types, type?.id) ?? (rulesSent ? validateRules(draft.rules, scale) : null);
    setExistingId(findClash(draft, types, type?.id)?.id ?? null);
    setError(problem);
    if (problem) return;
    setBusy(true);
    try {
      if (type) {
        const body = toPatch(draft, type);
        if (Object.keys(body).length === 0) {
          onClose();
          return;
        }
        const [saved, backfill] = split(await patchCatalogueType(api, type.id, body));
        onSaved(saved, backfill);
      } else {
        onSaved(await createCatalogueType(api, toCreate(draft)), false);
      }
    } catch (e) {
      pushLog(`save catalogue type failed: ${messageOf(e, String(e))}`);
      const existing = existingTypeId(e);
      setExistingId(existing);
      setError(
        existing
          ? "A type with this name already exists."
          : isHotkeyConflict(e)
            ? `Hotkey ${draft.hotkey.toUpperCase()} is already used by another type.`
            : isInvalidSeverityRule(e)
              ? "A rule uses a severity level that is not on the scale. Choose another level for it, then save."
              : messageOf(e, "could not save the type"),
      );
    } finally {
      setBusy(false);
    }
  }

  async function toggleArchived() {
    if (!type) return;
    setBusy(true);
    setError(null);
    try {
      const [saved] = split(await patchCatalogueType(api, type.id, { archived: !type.archived }));
      onSaved(saved, false);
    } catch (e) {
      pushLog(`archive catalogue type failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not change the type"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <InspectorPane
      label="Type"
      header={
        <div className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{type ? type.name : "New type"}</h2>
          <IconButton icon="x" label="Close type" size="sm" onClick={onClose} />
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {type ? "Save type" : "Create type"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {type && (
            <Button
              variant={type.archived ? "secondary" : "danger"}
              className="ml-auto"
              disabled={busy}
              onClick={() => void toggleArchived()}
            >
              {type.archived ? "Restore" : "Archive"}
            </Button>
          )}
        </div>
      }
    >
      <InspectorSection title="Type">
        <div className="flex flex-col gap-4">
          <Field label="Name" htmlFor="type-name">
            <Input id="type-name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
          </Field>
          <div className="flex items-center gap-3">
            <ColourSwatch label="Colour" value={draft.colour} onChange={(colour) => patch({ colour })} />
            <span className="text-xs text-muted">Colour on images, maps and reports</span>
          </div>
          <Field
            label="Group"
            htmlFor="type-group"
            hint="Shown as Catalogue › group, for example Concrete defects."
          >
            <Input
              id="type-group"
              list="catalogue-groups"
              value={draft.group}
              onChange={(e) => patch({ group: e.target.value })}
            />
          </Field>
          <datalist id="catalogue-groups">
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          {showSetupFields && (
            <Field
              label="Definition"
              htmlFor="type-definition"
              hint={
                <span className="flex items-start justify-between gap-3">
                  <span>What it looks like on an image, so every reviewer grades it the same way.</span>
                  <span className="shrink-0 font-mono tabular-nums">
                    {`${draft.definition.length} / ${MAX_DEFINITION}`}
                  </span>
                </span>
              }
            >
              <Textarea
                id="type-definition"
                rows={4}
                maxLength={MAX_DEFINITION}
                value={draft.definition}
                onChange={(e) => patch({ definition: e.target.value })}
              />
            </Field>
          )}
        </div>
      </InspectorSection>

      <InspectorSection title="Kind">
        <div className="flex flex-col gap-3">
          <Segmented
            label="Kind"
            options={KIND_OPTIONS}
            value={draft.kind}
            onChange={(kind) =>
              patch({ kind, defaultSeverity: kind === "object" ? null : draft.defaultSeverity })
            }
          />
          <p className="text-xs text-muted">
            Defect detections become findings. Objects such as machines and stockpiles are counted.
          </p>
          {turningToObject && (
            <Alert tone="info">
              Findings of this type are kept. No new findings will be created from it.
            </Alert>
          )}
          {turningToDefect && (
            <p className="text-xs text-muted">
              After saving you can create findings from its accepted annotations.
            </p>
          )}
        </div>
      </InspectorSection>

      <InspectorSection title="Default severity">
        {draft.kind === "defect" ? (
          <div className="flex flex-col gap-2">
            <SeverityPicker
              label="Default severity"
              allowNone
              value={draft.defaultSeverity}
              onChange={(level) => patch({ defaultSeverity: level })}
            />
            <Button
              size="sm"
              variant={draft.defaultSeverity === null ? "secondary" : "ghost"}
              aria-pressed={draft.defaultSeverity === null}
              className="self-start"
              onClick={() => patch({ defaultSeverity: null })}
            >
              None
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted">Objects are counted, not graded, so they have no severity.</p>
        )}
      </InspectorSection>

      {showSetupFields && (
        <InspectorSection title="Severity rules">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              Read in this order to suggest a severity.
              {draft.rules.length >= 2 && " Alt+↑ and Alt+↓ move the focused rule."}
            </p>
            <SeverityRulesEditor
              rules={draft.rules}
              defaultSeverity={draft.defaultSeverity}
              onChange={(rules) => patch({ rules })}
            />
          </div>
        </InspectorSection>
      )}

      <InspectorSection title="Hotkey">
        <Field label="Hotkey" htmlFor="type-hotkey" hint="Picks this type inside the type picker (T).">
          <Select id="type-hotkey" value={draft.hotkey} onChange={(e) => patch({ hotkey: e.target.value })}>
            <option value="">None</option>
            {TYPE_HOTKEYS.map((k) => (
              <option key={k} value={k}>
                {k.toUpperCase()}
              </option>
            ))}
          </Select>
        </Field>
      </InspectorSection>

      {error && (
        <Alert
          tone="danger"
          actions={
            existingId && existingId !== type?.id ? (
              <Button size="sm" onClick={() => onUseExisting(existingId)}>
                Use existing
              </Button>
            ) : undefined
          }
        >
          {error}
        </Alert>
      )}
    </InspectorPane>
  );
}
