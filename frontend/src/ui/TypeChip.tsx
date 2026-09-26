import type { CSSProperties } from "react";
import { cx } from "./tokens";

export type TypeKind = "defect" | "object";

export interface TypeChipProps {
  name: string;
  /** #rrggbb from the catalogue; travels as --c. */
  colour: string;
  kind: TypeKind;
  archived?: boolean;
  showKind?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/** A catalogue type (ws-images .type): colour square, name, and the Defect or Object tag. */
export function TypeChip({
  name,
  colour,
  kind,
  archived = false,
  showKind = true,
  size = "md",
  className,
}: TypeChipProps) {
  return (
    <span
      style={{ "--c": colour } as CSSProperties}
      className={cx(
        "inline-flex min-w-0 items-center gap-2",
        size === "sm" ? "text-xs" : "text-sm",
        archived && "opacity-60",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-[color:var(--c)] shadow-[0_0_10px_var(--c)] reduce-effects:shadow-none"
      />
      <span className="min-w-0 truncate font-semibold text-ink">{name}</span>
      {archived && <span className="sr-only">(archived)</span>}
      {showKind && (
        <span
          className={cx(
            "shrink-0 rounded-chip px-2 text-2xs font-semibold",
            kind === "defect" ? "bg-danger-soft text-danger" : "bg-info/15 text-info",
          )}
        >
          {kind === "defect" ? "Defect" : "Object"}
        </span>
      )}
    </span>
  );
}
