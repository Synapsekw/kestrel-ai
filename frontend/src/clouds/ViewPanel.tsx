import { BUDGETS } from "@/clouds/viewer/budget";
import { POINT_SIZE_MAX, POINT_SIZE_MIN, type ColourMode } from "@/clouds/viewer/materialOptions";
import { Button, Field, Input, Kbd, Segmented, Select } from "@/ui";

export interface ViewSettings {
  budget: number;
  colour: ColourMode;
  elevationRange: [number, number];
  pointSize: number;
}

export function ViewPanel({
  settings,
  hasRgb,
  defaultRange,
  onChange,
  onFit,
  onTop,
}: {
  settings: ViewSettings;
  hasRgb: boolean;
  defaultRange: [number, number];
  onChange(s: ViewSettings): void;
  onFit(): void;
  onTop(): void;
}) {
  const set = (patch: Partial<ViewSettings>) => onChange({ ...settings, ...patch });
  const [lo, hi] = settings.elevationRange;
  return (
    <div className="flex flex-col gap-4">
      <Field label="Point budget" htmlFor="cloud-budget" hint="More points look denser and use more memory.">
        <Select
          id="cloud-budget"
          value={settings.budget}
          onChange={(e) => set({ budget: Number(e.target.value) })}
        >
          {BUDGETS.map((b) => (
            <option key={b} value={b}>
              {b / 1e6} M
            </option>
          ))}
        </Select>
      </Field>
      <Segmented
        label="Colour"
        value={settings.colour}
        onChange={(colour) => set({ colour })}
        options={[
          { value: "rgb", label: "RGB", disabled: !hasRgb },
          { value: "elevation", label: "Elevation" },
        ]}
      />
      {settings.colour === "elevation" && (
        <div className="flex items-end gap-2">
          <Field label="Lowest" htmlFor="cloud-zlo">
            <Input
              id="cloud-zlo"
              type="number"
              step="0.1"
              value={lo}
              onChange={(e) => set({ elevationRange: [Number(e.target.value), hi] })}
            />
          </Field>
          <Field label="Highest" htmlFor="cloud-zhi">
            <Input
              id="cloud-zhi"
              type="number"
              step="0.1"
              value={hi}
              onChange={(e) => set({ elevationRange: [lo, Number(e.target.value)] })}
            />
          </Field>
          <Button size="sm" variant="ghost" onClick={() => set({ elevationRange: defaultRange })}>
            Reset
          </Button>
        </div>
      )}
      <Field label={`Point size · ${settings.pointSize.toFixed(1)}`} htmlFor="cloud-size">
        <input
          id="cloud-size"
          type="range"
          min={POINT_SIZE_MIN}
          max={POINT_SIZE_MAX}
          step={0.1}
          value={settings.pointSize}
          onChange={(e) => set({ pointSize: Number(e.target.value) })}
          className="accent-accent"
        />
      </Field>
      <div className="flex gap-2">
        <Button size="sm" icon="fit" onClick={onFit}>
          Fit view <Kbd>F</Kbd>
        </Button>
        <Button size="sm" onClick={onTop}>
          Top view <Kbd>T</Kbd>
        </Button>
      </div>
    </div>
  );
}
