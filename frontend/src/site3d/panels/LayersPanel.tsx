import { useId, useState } from "react";
import { BUDGETS } from "@/clouds/viewer/budget";
import { groupRows, statusLine, type LayerRow } from "@/site3d/layerRows";
import { Button, Field, GlassPanel, Segmented, Select, Slider, Switch, cx } from "@/ui";
import { COLOUR_BY, type ColourBy } from "./engineBridge";

export type CloudColourChoice = "rgb" | "elevation" | "intensity";
const CLOUD_COLOURS: { value: CloudColourChoice; label: string }[] = [
  { value: "rgb", label: "Colour" },
  { value: "elevation", label: "Height" },
  { value: "intensity", label: "Intensity" },
];
const points = (n: number) => `${n / 1_000_000} M points`;

export interface LayersPanelProps {
  /** Each row's `status` carries "unavailable" (can't place, removed) and errors. */
  rows: readonly LayerRow[];
  onVisible(id: string, visible: boolean): void;
  onOpacity(id: string, opacity: number): void;
  colourBy: ColourBy;
  onColourBy(c: ColourBy): void;
  /** null hides the cloud controls (no placeable cloud). */
  cloudColour: CloudColourChoice | null;
  onCloudColour(c: CloudColourChoice): void;
  budget: number | null;
  onBudget(n: number): void;
}

function Row({
  row,
  onVisible,
  onOpacity,
}: { row: LayerRow } & Pick<LayersPanelProps, "onVisible" | "onOpacity">) {
  const blocked = row.status.kind === "unavailable";
  const line = statusLine(row.status);
  return (
    <li className="flex flex-col gap-1 py-1">
      <Switch
        checked={row.visible && !blocked}
        disabled={blocked}
        onChange={(v) => onVisible(row.id, v)}
        label={row.label}
      />
      {line && (
        <p
          className={cx("pl-10 text-2xs leading-snug", line.tone === "danger" ? "text-danger" : "text-muted")}
        >
          {line.text}
        </p>
      )}
      {row.opacity !== null && row.visible && !blocked && (
        <Slider
          className="pl-10"
          label={`${row.label} opacity`}
          min={0}
          max={100}
          step={5}
          value={Math.round(row.opacity * 100)}
          onChange={(v) => onOpacity(row.id, v / 100)}
          format={(v) => `${v}%`}
        />
      )}
    </li>
  );
}

/**
 * Spec §11 Layers (top left): toggles, opacity, colour-by, cloud height colouring, point budget.
 * The parent places it (left 64 px, top 12 px) and bounds its height; the panel shrinks to that
 * bound. The frosted float holds only the header; the list scrolls in an opaque body (DESIGN.md:
 * never blur a scrolling list).
 */
export function LayersPanel(p: LayersPanelProps) {
  const [open, setOpen] = useState(true);
  const colourId = useId();
  const budgetId = useId();
  const groups = groupRows(p.rows);
  return (
    <GlassPanel
      as="section"
      variant="float"
      radius="panel"
      aria-label="Layers"
      data-testid="site-layers"
      className="pointer-events-auto flex max-h-full min-h-0 w-[280px] flex-col gap-2 p-3 animate-reveal reduce-motion:animate-none"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink">Layers</h2>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide layers" : "Show layers"}
        </Button>
      </div>
      {open && (
        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto rounded-control bg-glass-solid p-2">
          {groups.map(([group, rows]) => (
            <section
              key={group}
              className="flex flex-col gap-1 border-t border-line pt-2 first:border-t-0 first:pt-0"
            >
              <h3 className="text-xs font-medium text-muted">{group}</h3>
              <ul className="flex flex-col">
                {rows.map((r) => (
                  <Row key={r.id} row={r} onVisible={p.onVisible} onOpacity={p.onOpacity} />
                ))}
              </ul>
              {group === "Model" && (
                <Field label="Colour the model by" htmlFor={colourId}>
                  <Select
                    id={colourId}
                    dense
                    value={p.colourBy}
                    onChange={(e) => p.onColourBy(e.target.value as ColourBy)}
                  >
                    {COLOUR_BY.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              {group === "Point clouds" && p.cloudColour !== null && (
                <div className="flex flex-col gap-2">
                  <Segmented
                    label="Cloud colour"
                    size="sm"
                    options={CLOUD_COLOURS}
                    value={p.cloudColour}
                    onChange={p.onCloudColour}
                  />
                  {p.budget !== null && (
                    <Field label="Point budget" htmlFor={budgetId}>
                      <Select
                        id={budgetId}
                        dense
                        value={String(p.budget)}
                        onChange={(e) => p.onBudget(Number(e.target.value))}
                      >
                        {BUDGETS.map((b) => (
                          <option key={b} value={String(b)}>
                            {points(b)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  )}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
