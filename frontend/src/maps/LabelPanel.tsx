import { useState } from "react";
import type { ClassDef, MapLabel, MapRun, MapZone } from "@contract/client";
import { Alert, Button, Field, IconButton, Input, Kbd, Segmented, Select, cx } from "@/ui";
import type { Tool } from "./labelLayers";
import { runTitle } from "./runModel";

export interface LabelPanelProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  classes: ClassDef[];
  activeClassId: string;
  onClass: (id: string) => void;
  /** The class of the currently selected label, or null when nothing is selected. Picking a class
   * reclasses this label instead of setting the drawing class (spec: "Boxes: ... reclass"). */
  selectedClassId: string | null;
  zones: MapZone[];
  labels: MapLabel[];
  warnCount: number;
  seededCount: number;
  runs: MapRun[];
  /** The confidence seeding will use: the current slider value, shown in the button so the
   * operator can predict what they will get. */
  minConf: number;
  onSeed: (runId: string, zoneId: string, minConf: number) => void;
  onRenameZone: (id: string, name: string) => void;
  onDeleteZone: (id: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function LabelPanel(p: LabelPanelProps) {
  const finished = p.runs.filter((r) => r.state === "succeeded");
  const [runId, setRunId] = useState(finished[0]?.id ?? "");
  const [zoneId, setZoneId] = useState(p.zones[0]?.id ?? "");
  const seedRun = runId || finished[0]?.id || "";
  const seedZone = zoneId || p.zones[0]?.id || "";
  return (
    <section className="flex flex-col gap-4" aria-label="Labels">
      <div className="flex items-center gap-2">
        <Segmented
          label="Tool"
          size="sm"
          value={p.tool}
          onChange={p.onTool}
          options={[
            { value: "pan", label: "Select" },
            { value: "zone-rect", label: "Zone ▭" },
            { value: "zone-poly", label: "Zone ⬠" },
            { value: "box", label: "Box" },
          ]}
        />
        <IconButton icon="undo" size="sm" label="Undo" disabled={!p.canUndo} onClick={p.onUndo} />
        <IconButton icon="redo" size="sm" label="Redo" disabled={!p.canRedo} onClick={p.onRedo} />
      </div>
      {p.zones.length === 0 && (
        <Alert tone="info">
          Draw a zone around an area you will label completely. Only boxes inside zones are scored, so a small
          zone labelled fully beats a big one labelled halfway.
        </Alert>
      )}
      <p className="text-xs text-muted">
        {p.selectedClassId
          ? "A class here recolours the selected label."
          : "A class here sets what you draw next."}
      </p>
      <ul className="flex flex-col gap-0.5" aria-label="Classes">
        {p.classes.map((c) => {
          const highlighted = (p.selectedClassId ?? p.activeClassId) === c.id;
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => p.onClass(c.id)}
                aria-pressed={highlighted}
                className={cx(
                  "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
                  highlighted ? "bg-accent-soft text-accent-ink" : "hover:bg-hover/5",
                )}
              >
                <span
                  className="h-2.5 w-2.5 rounded-sm"
                  style={{ background: c.colour }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{c.name}</span>
                {c.hotkey && <Kbd>{c.hotkey}</Kbd>}
              </button>
            </li>
          );
        })}
      </ul>
      {p.warnCount > 0 && (
        <p className="text-sm text-warn">{p.warnCount} labels are outside every zone and will not count.</p>
      )}
      {p.seededCount > 0 && (
        <p className="text-sm text-muted">{p.seededCount} seeded from a run, not yet checked.</p>
      )}
      {p.zones.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label="Zones">
          {p.zones.map((z) => (
            <li key={z.id} className="flex items-center gap-1">
              <Input
                dense
                aria-label="Zone name"
                defaultValue={z.name}
                onBlur={(e) =>
                  e.target.value.trim() &&
                  e.target.value !== z.name &&
                  p.onRenameZone(z.id, e.target.value.trim())
                }
              />
              <IconButton
                icon="trash"
                size="sm"
                label={`Delete ${z.name}`}
                onClick={() => p.onDeleteZone(z.id)}
              />
            </li>
          ))}
        </ul>
      )}
      {finished.length > 0 && p.zones.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border border-line p-3">
          <p className="text-sm font-medium">Start from a run</p>
          <Field label="Run" htmlFor="seed-run">
            <Select id="seed-run" value={seedRun} onChange={(e) => setRunId(e.target.value)}>
              {finished.map((r) => (
                <option key={r.id} value={r.id}>
                  {runTitle(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Zone" htmlFor="seed-zone">
            <Select id="seed-zone" value={seedZone} onChange={(e) => setZoneId(e.target.value)}>
              {p.zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button size="sm" onClick={() => p.onSeed(seedRun, seedZone, p.minConf)}>
            Copy detections at {Math.round(p.minConf * 100)} % confidence or higher
          </Button>
        </div>
      )}
      <p className="text-xs text-muted">
        <Kbd>1</Kbd>–<Kbd>9</Kbd> class · <Kbd>B</Kbd> box · <Kbd>Z</Kbd> zone · <Kbd>Del</Kbd> delete ·{" "}
        <Kbd>Ctrl Z</Kbd> undo · <Kbd>Esc</Kbd> select
      </p>
    </section>
  );
}
