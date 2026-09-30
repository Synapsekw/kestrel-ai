import type { ReactNode } from "react";
import { PRINT, mm, textStyle, tint } from "../../printTheme";

export function Dot({ colour, sizeMm = 2.2 }: { colour: string; sizeMm?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-chip"
      style={{ width: mm(sizeMm), height: mm(sizeMm), background: colour }}
    />
  );
}

export function TypeSwatch({ colour }: { colour: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0"
      style={{ width: mm(2.6), height: mm(2.6), borderRadius: mm(0.6), background: colour }}
    />
  );
}

/** Spec §10.1: a filled dot plus ink text on a 12 % tint, never coloured text. */
export function SeverityMark({
  level,
  name,
  colour,
}: {
  level: number | null;
  name: string | null;
  colour: string | null;
}) {
  // Contract (`FindingHead.severity_name`): a null name prints "Ungraded", whatever the level.
  const graded = level !== null && name !== null;
  const c = graded && colour ? colour : PRINT.ungraded;
  const word = graded ? name : "Ungraded";
  return (
    <span
      data-severity={graded ? String(level) : "ungraded"}
      className="inline-flex items-center"
      style={{
        ...textStyle(PRINT.size.body),
        gap: mm(1.2),
        padding: `${mm(0.6)} ${mm(2)}`,
        borderRadius: mm(3),
        background: tint(c),
      }}
    >
      <Dot colour={c} />
      {word}
    </span>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        ...textStyle(PRINT.size.small, PRINT.muted),
        fontWeight: 600,
        margin: `${mm(3)} 0 ${mm(1.5)}`,
      }}
    >
      {children}
    </p>
  );
}
