import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import type { ClassDef } from "@contract/client";
import { useApi, useBackend } from "@/api/client";
import { attachmentThumbnailUrl, listAttachments, type FindingAttachment } from "@/api/findings";
import { NameAnomalyField } from "@/catalogue/NameAnomalyField";
import { cloudShortcut } from "@/clouds/keys";
import { useWorkspaceSeams, type WorkspaceSeams } from "@/clouds/workspace/seams";
import { formatFindingNumber } from "@/findings/format";
import { useFinding } from "@/findings/inspector/useFinding";
import { useChangesStore } from "@/store/changes";
import {
  Button,
  Combobox,
  GlassPanel,
  IconButton,
  KeyChord,
  Segmented,
  SeverityPill,
  Textarea,
  TypeChip,
  useSeverityScale,
} from "@/ui";
import { locationLabel } from "./callout";
import type { CloudPin } from "./types";

export interface PinDraftInput {
  typeId: string;
  severity: number | null;
  note: string;
}

/**
 * The seam's own component shape (controller ruling 1 + amendment; T6-1): W1 already types
 * `LikelyViews` with `{point, normal, findingId?, limit?}`, so no local interface or cast is needed
 * here — `seams.LikelyViews` is rendered directly. Task 8 derives the same alias for its own use.
 */
export type LikelyViewsProps = ComponentProps<NonNullable<WorkspaceSeams["LikelyViews"]>>;

export interface PinCalloutViewProps {
  projectId: string;
  pin: CloudPin;
  types: ReadonlyMap<string, ClassDef>;
  onClose: () => void;
  onDelete: () => void;
}

/** Spec §9.3: the selected pin's glass card. */
export function PinCalloutView({ projectId, pin, types, onClose, onDelete }: PinCalloutViewProps) {
  const api = useApi();
  const { baseUrl, token } = useBackend();
  const { LikelyViews } = useWorkspaceSeams();
  const { finding } = useFinding(projectId, pin.id);
  const revision = useChangesStore((s) => s.findingsRevision);
  const [atts, setAtts] = useState<{ id: string; items: FindingAttachment[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAttachments(api, projectId, pin.id)
      .then((items) => {
        if (!cancelled) setAtts({ id: pin.id, items });
      })
      .catch(() => {
        if (!cancelled) setAtts({ id: pin.id, items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, pin.id, revision]);

  const type = types.get(pin.typeId);
  const shown = atts?.id === pin.id ? atts.items.slice(0, 2) : null;
  // `useFinding` already scopes its returned `finding` to the id it was called with (it holds null
  // while a different id's fetch is in flight), so no extra `finding.id === pin.id` guard is needed.
  const comments = finding ? finding.comment_count : null;
  const number = formatFindingNumber(pin.number);

  return (
    <GlassPanel
      variant="float"
      className="flex flex-col gap-2 p-3"
      role="dialog"
      aria-label={`Finding ${number}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-xs font-semibold text-ink">{number}</div>
          <div className="text-xs text-muted">{locationLabel(pin.p[2], pin.normal)}</div>
        </div>
        <IconButton icon="x" label="Close" size="sm" onClick={onClose} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {type ? (
          <TypeChip name={type.name} colour={type.colour} kind={type.kind} size="sm" />
        ) : (
          <span className="text-xs text-muted">Unknown type</span>
        )}
        <SeverityPill level={pin.severity} size="sm" />
      </div>
      {pin.note && <p className="line-clamp-4 text-sm text-ink">{pin.note}</p>}
      {shown && shown.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {shown.map((a) => (
            <img
              key={a.id}
              src={attachmentThumbnailUrl(baseUrl, token, projectId, pin.id, a.id)}
              alt={a.original_name}
              className="h-20 w-full rounded-control object-cover"
            />
          ))}
        </div>
      )}
      {shown && shown.length === 0 && LikelyViews && (
        <LikelyViews point={pin.p} normal={pin.normal} findingId={pin.id} limit={2} />
      )}
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{comments === null ? "" : `${comments} comment${comments === 1 ? "" : "s"}`}</span>
        <Button size="sm" variant="ghost" icon="trash" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </GlassPanel>
  );
}

export interface PinCalloutCreateProps {
  defectTypes: readonly ClassDef[];
  initialTypeId: string | null;
  busy: boolean;
  locationText: string;
  onCreate: (v: PinDraftInput) => void;
  /** Names a defect that this project does not list yet, and returns it so the draft can use it. */
  onCreateType?: (name: string) => Promise<ClassDef>;
  onCancel: () => void;
  /** Set to this form's submit, so the workspace's global Enter can create (plan Ruling 9). */
  submitRef: MutableRefObject<(() => void) | null>;
}

const NONE = "none";

/** Spec §9.4: the draft pin's create form. Nothing is persisted until Create. */
export function PinCalloutCreate({
  defectTypes,
  initialTypeId,
  busy,
  locationText,
  onCreate,
  onCreateType,
  onCancel,
  submitRef,
}: PinCalloutCreateProps) {
  const scale = useSeverityScale();
  const [typeId, setTypeId] = useState<string | null>(
    () => defectTypes.find((t) => t.id === initialTypeId)?.id ?? null,
  );
  const [severity, setSeverity] = useState<number | null>(
    () => defectTypes.find((t) => t.id === initialTypeId)?.default_severity ?? null,
  );
  const [note, setNote] = useState("");
  const noteRef = useRef<HTMLTextAreaElement>(null);

  // T6-4: the project's types can load after the draft opens (`defectTypes` arrives as a new array
  // once that GET answers). Adjusting state during render in response to that prop change (React's
  // documented pattern) rather than in an effect: seeded only the first time `defectTypes` goes from
  // empty to non-empty, and only while nothing has been picked yet, so a draft opened with no
  // last-used type and `defectTypes` already loaded still leaves Create disabled until the operator
  // chooses one ("disables Create until a type is chosen" test).
  const [seededFrom, setSeededFrom] = useState(defectTypes);
  if (defectTypes !== seededFrom) {
    setSeededFrom(defectTypes);
    if (typeId === null && defectTypes.length > 0) {
      const first = defectTypes.find((t) => t.id === initialTypeId) ?? defectTypes[0];
      setTypeId(first.id);
      setSeverity(first.default_severity);
    }
  }

  const items = useMemo(
    () => defectTypes.map((t) => ({ id: t.id, label: t.name, colour: t.colour, hotkey: t.hotkey })),
    [defectTypes],
  );
  const options = useMemo(
    () => [{ value: NONE, label: "None" }, ...scale.map((l) => ({ value: String(l.level), label: l.name }))],
    [scale],
  );

  const submit = () => {
    if (!typeId || busy) return;
    onCreate({ typeId, severity, note });
  };
  useEffect(() => {
    submitRef.current = submit;
    return () => {
      submitRef.current = null;
    };
  });

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    // Spec §9.4 "Esc discards the draft": W1 skips typing targets, so the note handles its own Esc.
    if (e.key === "Escape" && t === noteRef.current) {
      e.preventDefault();
      onCancel();
      return;
    }
    if (e.key !== "Enter" || e.shiftKey) return;
    if (t.closest('[role="listbox"]') || t.getAttribute("aria-expanded") === "true") return;
    // Final-review ruling (T6-3 re-ruled): only Cancel keeps its own Enter. The closed Type trigger
    // and a Severity segment create; `preventDefault` stops their click and W1's Enter routing.
    if (t.closest("[data-enter-self]")) return;
    e.preventDefault();
    submit();
  };

  return (
    <GlassPanel variant="float" className="p-3" data-testid="pin-callout-create">
      <form
        className="flex flex-col gap-2"
        aria-label="New finding"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold text-ink">New finding</span>
          <span className="text-xs text-muted">{locationText}</span>
        </div>
        <Combobox
          label="Type"
          items={items}
          value={typeId}
          triggerPlaceholder={defectTypes.length === 0 ? "No types yet" : "Choose a defect type…"}
          onChange={(id) => {
            setTypeId(id);
            setSeverity(defectTypes.find((t) => t.id === id)?.default_severity ?? null);
            // Before the list closes: the popover then leaves focus where it is (useFocusTrap).
            noteRef.current?.focus();
          }}
        />
        {onCreateType && (
          <NameAnomalyField
            placeholder={defectTypes.length === 0 ? "Name this anomaly" : "Or name a new anomaly"}
            onCreate={async (name) => {
              const created = await onCreateType(name);
              setTypeId(created.id);
              setSeverity(created.default_severity);
            }}
          />
        )}
        <Segmented
          label="Severity"
          size="sm"
          options={options}
          value={severity === null ? NONE : String(severity)}
          onChange={(v) => setSeverity(v === NONE ? null : Number(v))}
        />
        <Textarea
          ref={noteRef}
          aria-label="Note"
          placeholder="Note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex items-center justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" data-enter-self onClick={onCancel}>
            Cancel <KeyChord chord={cloudShortcut("cancel")} />
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={!typeId} loading={busy}>
            Create <KeyChord chord={cloudShortcut("commit")} />
          </Button>
        </div>
      </form>
    </GlassPanel>
  );
}
