import { useRef, useState } from "react";
import type { ClassDef } from "@contract/client";
import type { FindingStatus } from "@/api/findings";
import { ComboboxList, cx, focusRing, Icon, Popover, Segmented, transition, TypeChip } from "@/ui";
import { useInspectorCommands } from "../inspectorStore";
import { canTransition, STATUSES, STATUS_LABEL } from "../status";

/** A TypeChip button opening a picker of the project's defect types (F §8.7 item 2, ws-images .type). */
export function TypeField({
  type,
  defectTypes,
  onChange,
}: {
  type: ClassDef | null;
  defectTypes: readonly ClassDef[];
  onChange: (typeId: string) => void;
}) {
  const nonce = useInspectorCommands((s) => s.typePickerNonce);
  const [seenNonce, setSeenNonce] = useState(nonce);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  if (seenNonce !== nonce) {
    setSeenNonce(nonce);
    setOpen(true);
  }
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-control border border-line bg-field px-3 py-2.5 text-left hover:border-line-strong",
          transition,
          focusRing,
        )}
        aria-label={`Type: ${type?.name ?? "Unknown type"}. Change`}
      >
        <span className="min-w-0 flex-1">
          {type ? (
            <TypeChip name={type.name} colour={type.colour} kind={type.kind} />
          ) : (
            <span className="text-sm text-muted">Unknown type</span>
          )}
          {type?.group && (
            <span className="mt-0.5 block truncate text-2xs text-muted">Catalogue › {type.group}</span>
          )}
        </span>
        <Icon name="chevron-down" size={14} className="shrink-0 text-dim" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchorRef={anchor} label="Change type">
        <ComboboxList
          label="Type"
          items={defectTypes.map((t) => ({
            id: t.id,
            label: t.name,
            hint: t.group ?? undefined,
            colour: t.colour,
          }))}
          value={type?.id ?? null}
          emptyText="No defect types in this project"
          onSelect={(id) => {
            setOpen(false);
            if (id !== type?.id) onChange(id);
          }}
        />
      </Popover>
    </>
  );
}

/** Open · Reviewed · Closed; closed → reviewed is disabled and the reason is said (F §8.2). */
export function StatusField({
  value,
  onChange,
}: {
  value: FindingStatus;
  onChange: (next: FindingStatus) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Segmented
        label="Status"
        value={value}
        onChange={(next) => {
          if (canTransition(value, next)) onChange(next);
        }}
        options={STATUSES.map((s) => ({
          value: s,
          label: STATUS_LABEL[s],
          disabled: s !== value && !canTransition(value, s),
        }))}
      />
      {value === "closed" && (
        <p className="text-2xs text-dim">Reopen a closed finding before marking it reviewed.</p>
      )}
    </div>
  );
}
