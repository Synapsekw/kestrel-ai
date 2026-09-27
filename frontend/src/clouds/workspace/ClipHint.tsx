import type { CloudClipBox } from "@contract/client";
import { Button, Input, Segmented } from "@/ui";
import { resizeClip } from "./clip";

const AXES = [
  [0, "Width"],
  [1, "Depth"],
  [2, "Height"],
] as const;

/** The clip-box tool's hint-bar controls (plan Ruling 4): mode, size, yaw and "Clear box". */
export function ClipHint({
  box,
  onChange,
}: {
  box: CloudClipBox | null;
  onChange(b: CloudClipBox | null): void;
}) {
  if (!box) return <span className="text-muted">No box: this cloud has no bounds</span>;
  return (
    <>
      <Segmented
        label="Clip mode"
        size="sm"
        value={box.mode}
        onChange={(mode) => onChange({ ...box, mode })}
        options={[
          { value: "show_inside", label: "Show inside" },
          { value: "highlight_inside", label: "Highlight" },
        ]}
      />
      {AXES.map(([i, label]) => (
        <label key={label} className="flex items-center gap-1 text-xs text-muted">
          {label}
          <span className="w-16">
            <Input
              aria-label={`Box ${label.toLowerCase()} (m)`}
              type="number"
              dense
              min={0.1}
              step={0.5}
              value={Number(box.size[i].toFixed(2))}
              onChange={(e) => onChange(resizeClip(box, i, Number(e.target.value)))}
            />
          </span>
        </label>
      ))}
      <label className="flex items-center gap-1 text-xs text-muted">
        Yaw
        <span className="w-16">
          <Input
            aria-label="Box yaw (°)"
            type="number"
            dense
            step={5}
            value={box.yaw_deg}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) onChange({ ...box, yaw_deg: v });
            }}
          />
        </span>
      </label>
      <Button size="sm" variant="ghost" icon="x" onClick={() => onChange(null)}>
        Clear box
      </Button>
    </>
  );
}
