import type { Box, ClassDef } from "@contract/client";
import type { ReviewDecision } from "./commands";
import { colourOf, provenanceLabel } from "./labels";

const REVIEW_LABEL: Record<Box["review_state"], string> = {
  unreviewed: "Proposal",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

const REVIEW_CLASS: Record<Box["review_state"], string> = {
  unreviewed: "bg-amber-700/60 text-amber-100",
  accepted: "bg-emerald-800/60 text-emerald-100",
  edited: "bg-sky-800/60 text-sky-100",
  rejected: "bg-slate-700 text-slate-300 line-through",
};

interface Props {
  boxes: Box[];
  classes: ClassDef[];
  selectedId: string | null;
  hoveredId: string | null;
  /** Whether the image is marked "no machinery" (E4): changes the empty-list text. */
  markedEmpty: boolean;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  onSetClass: (id: string, classId: string) => void;
  onDelete: (id: string) => void;
  onReview: (id: string, action: ReviewDecision) => void;
}

export function RegionList({
  boxes,
  classes,
  selectedId,
  hoveredId,
  markedEmpty,
  onSelect,
  onHover,
  onSetClass,
  onDelete,
  onReview,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="border-b border-slate-800 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Regions ({boxes.length})
      </h2>
      <ul role="list" aria-label="Regions" className="min-h-0 flex-1 overflow-auto">
        {boxes.map((b, i) => {
          const n = i + 1;
          const selected = b.id === selectedId;
          return (
            <li
              key={b.id}
              role="listitem"
              tabIndex={0}
              data-box-id={b.id}
              // `aria-current` rather than `aria-selected`: the row holds a <select>, so a
              // listbox/option pattern would nest options inside an option.
              aria-current={selected ? "true" : undefined}
              onClick={() => onSelect(b.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.target === e.currentTarget) {
                  e.preventDefault();
                  onSelect(b.id);
                }
              }}
              onMouseEnter={() => onHover(b.id)}
              onMouseLeave={() => onHover(null)}
              className={`flex cursor-pointer flex-col gap-1 border-b border-slate-800/60 px-3 py-2 text-xs ${
                selected ? "bg-orange-900/40" : b.id === hoveredId ? "bg-slate-800/60" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-3 w-3 shrink-0 rounded-sm"
                  style={{ background: colourOf(classes, b.class_id) }}
                />
                <select
                  aria-label={`Class of box ${n}`}
                  value={b.class_id}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetClass(b.id, e.target.value)}
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <span className="w-8 text-right tabular-nums text-slate-300">
                  {b.confidence === null ? "–" : `${Math.round(b.confidence * 100)}%`}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <span
                  title={provenanceLabel(b.provenance)}
                  className="min-w-0 max-w-[7rem] truncate whitespace-nowrap rounded bg-slate-800 px-1.5 py-0.5 text-slate-300"
                >
                  {provenanceLabel(b.provenance)}
                </span>
                <span className={`shrink-0 rounded px-1.5 py-0.5 ${REVIEW_CLASS[b.review_state]}`}>
                  {REVIEW_LABEL[b.review_state]}
                </span>
                <span className="ml-auto flex shrink-0 gap-1">
                  {b.review_state === "unreviewed" && (
                    <>
                      <button
                        type="button"
                        aria-label={`Accept box ${n}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReview(b.id, "accept");
                        }}
                        className="rounded px-1.5 py-0.5 text-emerald-300 hover:bg-slate-800"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        aria-label={`Reject box ${n}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onReview(b.id, "reject");
                        }}
                        className="rounded px-1.5 py-0.5 text-amber-300 hover:bg-slate-800"
                      >
                        Reject
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label={`Delete box ${n}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(b.id);
                    }}
                    className="rounded px-1.5 py-0.5 text-red-300 hover:bg-slate-800"
                  >
                    Delete
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {boxes.length === 0 && (
        <p className="px-3 py-4 text-xs text-slate-500">
          {markedEmpty
            ? "Marked empty: no machinery on this image."
            : "No boxes yet. Pick a class and drag on the image. Nothing here? Press N."}
        </p>
      )}
    </div>
  );
}
