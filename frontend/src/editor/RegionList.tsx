import type { Box, ClassDef } from "@contract/client";
import { Button, IconButton, Pill, Select, cx, type PillTone } from "@/ui";
import type { ReviewDecision } from "./commands";
import { colourOf, provenanceLabel } from "./labels";

const REVIEW_LABEL: Record<Box["review_state"], string> = {
  unreviewed: "Suggestion",
  accepted: "Accepted",
  edited: "Edited",
  rejected: "Rejected",
};

const REVIEW_TONE: Record<Box["review_state"], PillTone> = {
  unreviewed: "warn",
  accepted: "ok",
  edited: "neutral",
  rejected: "neutral",
};

interface Props {
  boxes: Box[];
  classes: ClassDef[];
  selectedId: string | null;
  hoveredId: string | null;
  /** Whether the image is marked "no machinery" (E4): changes the empty-list text. */
  markedEmpty: boolean;
  /** Suggestions the confidence floor (E6) keeps out of the list; N would reject them unseen. */
  hiddenByFloor?: number;
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
  hiddenByFloor = 0,
  onSelect,
  onHover,
  onSetClass,
  onDelete,
  onReview,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <h2 className="flex h-11 shrink-0 items-center border-b border-line px-3 text-[11px] font-semibold uppercase tracking-wider text-muted">
        Regions ({boxes.length})
      </h2>
      <ul role="list" aria-label="Regions" className="min-h-0 flex-1 overflow-auto">
        {boxes.map((b, i) => {
          const n = i + 1;
          const selected = b.id === selectedId;
          const pending = b.review_state === "unreviewed";
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
              // No transition: selection follows hotkeys and the canvas, and nothing animates on a key.
              className={cx(
                "group flex cursor-pointer flex-col border-b border-line/70 text-[13px] text-ink",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent",
                selected ? "bg-panel" : b.id === hoveredId ? "bg-hover" : "hover:bg-hover",
              )}
            >
              {/* First line is plain text in the middle, so a click on the row selects it and keeps
                  keyboard focus off the class chooser (hotkeys ignore focused form controls). */}
              <div className="flex h-10 items-center gap-2 px-2">
                <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted">{n}</span>
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                  style={{ background: colourOf(classes, b.class_id) }}
                />
                <span
                  title={provenanceLabel(b.provenance)}
                  className="min-w-0 flex-1 truncate whitespace-nowrap text-ink/80"
                >
                  {provenanceLabel(b.provenance)}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">
                  {b.confidence === null ? "–" : `${Math.round(b.confidence * 100)}%`}
                </span>
                <Pill
                  size="sm"
                  tone={REVIEW_TONE[b.review_state]}
                  className={b.review_state === "rejected" ? "line-through" : undefined}
                >
                  {REVIEW_LABEL[b.review_state]}
                </Pill>
                <IconButton
                  icon="trash"
                  size="sm"
                  label={`Delete box ${n}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(b.id);
                  }}
                  className="-mr-1 !text-muted opacity-0 hover:!text-danger focus-visible:opacity-100 group-hover:opacity-100 group-focus-visible:opacity-100"
                />
              </div>
              <div className="flex h-7 items-start gap-2 pl-8 pr-2">
                <Select
                  dense
                  aria-label={`Class of box ${n}`}
                  value={b.class_id}
                  wrapperClassName="w-40 min-w-0"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onSetClass(b.id, e.target.value)}
                >
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {pending && (
                  <span className="ml-auto flex shrink-0 gap-0.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Accept box ${n}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReview(b.id, "accept");
                      }}
                      className="!h-6 !px-2"
                    >
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Reject box ${n}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onReview(b.id, "reject");
                      }}
                      className="!h-6 !px-2"
                    >
                      Reject
                    </Button>
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {boxes.length === 0 && (
        <p className="px-3 py-4 text-[13px] leading-relaxed text-muted">
          {markedEmpty
            ? "Marked empty: no machinery on this image."
            : hiddenByFloor > 0
              ? `${hiddenByFloor} ${hiddenByFloor === 1 ? "suggestion is" : "suggestions are"} hidden by the confidence floor. Lower it to see them before deciding that nothing is here.`
              : "No boxes yet. Pick a class and drag on the image. Nothing here? Press N."}
        </p>
      )}
    </div>
  );
}
