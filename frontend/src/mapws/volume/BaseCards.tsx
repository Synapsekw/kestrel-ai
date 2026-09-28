import { useState } from "react";
import type { VolumeMeasurement, components } from "@contract/client";
import { Disclosure, Field, Input, Select, cx, focusRing, transition } from "@/ui";
import { BASE_KIND_TEXT } from "@/volumes/model";
import type { BaseCard } from "./baseCardsModel";

type VolumeBase = components["schemas"]["VolumeBase"];

/** The four base cards of the mockup's volume inspector (spec §10), plus "More bases". */
export function BaseCards({
  cards,
  busy,
  measurement: m,
  otherBase = null,
  onBase,
}: {
  cards: BaseCard[];
  busy: boolean;
  measurement: VolumeMeasurement;
  /** A stored surface base no card stands for (`otherSurfaceBase`). */
  otherBase?: string | null;
  onBase: (base: VolumeBase) => void;
}) {
  const designCard = cards.find((c) => c.id === "design");
  const seed = m.base.z != null ? String(m.base.z) : "";
  const [flatZ, setFlatZ] = useState(seed);
  // A saved level comes back as a new measurement: re-seed during render, as MasksSection does.
  const [seenZ, setSeenZ] = useState(m.base.z);
  if (seenZ !== m.base.z) {
    setSeenZ(m.base.z);
    setFlatZ(seed);
  }
  const moreKinds = ["toe_surface", "flat"] as const;
  return (
    <div className="flex flex-col gap-2">
      <div
        role="radiogroup"
        aria-label="Base surface"
        data-testid="base-cards"
        className="grid grid-cols-2 gap-1.5"
      >
        {cards.map((c) => {
          const off = busy || c.base === null;
          return (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={c.selected}
              data-testid={`base-card-${c.id}`}
              aria-label={c.title}
              disabled={off}
              onClick={() => c.base && !busy && onBase(c.base)}
              className={cx(
                "flex min-w-0 flex-col items-start gap-0.5 rounded-control border px-2.5 py-2 text-left",
                transition,
                focusRing,
                c.selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:bg-hover",
                off && "cursor-not-allowed opacity-60",
              )}
            >
              <span className="text-sm font-medium text-ink">{c.title}</span>
              <span className="w-full truncate text-2xs text-muted">{c.disabledReason ?? c.sub}</span>
            </button>
          );
        })}
      </div>
      {otherBase && (
        <p data-testid="base-other" className="text-xs text-muted">
          {otherBase}
        </p>
      )}
      {designCard && designCard.options.length > 0 && designCard.selected && (
        <Field label="Design surface" htmlFor="volume-design">
          <Select
            id="volume-design"
            dense
            disabled={busy}
            value={m.base.surface_id ?? ""}
            onChange={(e) => onBase({ kind: "surface", surface_id: e.target.value })}
          >
            {designCard.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Disclosure label="More bases">
        <div role="radiogroup" aria-label="More bases" className="flex flex-col gap-1.5 pt-2">
          {moreKinds.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                name="volume-more-base"
                checked={m.base.kind === k}
                disabled={busy}
                onChange={() =>
                  k === "flat"
                    ? onBase({ kind: "flat", z: m.base.z ?? null })
                    : onBase({ kind: "toe_surface" })
                }
              />
              {BASE_KIND_TEXT[k]}
            </label>
          ))}
          {m.base.kind === "flat" && (
            <Field label="Level (m)" htmlFor="volume-flat-z" hint="Heights as stored in the survey.">
              <Input
                id="volume-flat-z"
                type="number"
                step={0.01}
                value={flatZ}
                onChange={(e) => setFlatZ(e.target.value)}
                onBlur={() =>
                  flatZ !== "" && Number(flatZ) !== m.base.z && onBase({ kind: "flat", z: Number(flatZ) })
                }
              />
            </Field>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
