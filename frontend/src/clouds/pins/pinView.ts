import type { ClassDef } from "@contract/client";
import { formatFindingNumber } from "@/findings/format";
import { severityOf, type SeverityLevel } from "@/ui";
import type { CloudPin, PinView } from "./types";

/** A finding with no severity (spec §9.2). */
export const NEUTRAL_PIN_COLOUR = "rgb(var(--muted))";

export function pinLabel(severity: number | null, typeName: string, scale: readonly SeverityLevel[]): string {
  const s = severity === null ? "Ungraded" : (severityOf(scale, severity)?.name ?? `Level ${severity}`);
  return `${s} · ${typeName}`;
}

export function toPinView(
  pin: CloudPin,
  scale: readonly SeverityLevel[],
  types: ReadonlyMap<string, ClassDef>,
): PinView {
  const label = pinLabel(pin.severity, types.get(pin.typeId)?.name ?? "Unknown type", scale);
  return {
    id: pin.id,
    p: pin.p,
    normal: pin.normal,
    u: pin.u,
    colour: severityOf(scale, pin.severity)?.colour ?? NEUTRAL_PIN_COLOUR,
    label,
    ariaLabel: `${formatFindingNumber(pin.number)} · ${label}`,
    draft: false,
  };
}
